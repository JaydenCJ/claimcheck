/**
 * Directory scanner and orchestrator: discovers manifests (monorepo-aware,
 * with the usual junk directories skipped), feeds parsed inputs to the three
 * ecosystem auditors, applies suppressions and the fail threshold, and
 * assembles the deterministic ScanResult that both renderers consume.
 *
 * All discovery is local filesystem reads — claimcheck never opens a socket.
 */

import fs from "node:fs";
import type { Dirent, Stats } from "node:fs";
import path from "node:path";
import type {
  Ecosystem,
  Finding,
  ResolvedConfig,
  ScanIssue,
  ScanResult,
  ScanSummary,
  ScannedProject,
  Severity,
} from "./types.js";
import { ECOSYSTEMS, SEVERITY_RANK } from "./types.js";
import { isIgnored } from "./config.js";
import { parseNpmrc, type Npmrc } from "./npmrc.js";
import { auditNpm, parseLockfile, type LockEntry } from "./npm.js";
import { auditPip, parsePipConf, parseRequirements, type RequirementsFile } from "./pip.js";
import { auditMaven, parsePom, parseSettings } from "./maven.js";
import { parseXml } from "./xml.js";
import { classifyRegistry } from "./registries.js";
import { scopeOf } from "./npmrc.js";

/** Raised for unusable scan roots; the CLI maps it to exit code 2. */
export class ScanRootError extends Error {}

const SKIP_DIRS = new Set([
  "node_modules",
  ".git",
  ".hg",
  ".svn",
  "dist",
  "build",
  "out",
  "target",
  "vendor",
  "venv",
  ".venv",
  "__pycache__",
  ".pytest_cache",
  ".idea",
  ".vscode",
  "coverage",
]);

const MAX_DEPTH = 8;

const REQUIREMENTS_RE = /^[a-z0-9._-]*(requirements|constraints)[a-z0-9._-]*\.(txt|in)$/i;

function joinRel(dir: string, name: string): string {
  return dir === "." ? name : `${dir}/${name}`;
}

/** relDir ("." for the root) -> sorted file names. Deterministic order. */
export function walkTree(root: string): Map<string, string[]> {
  const dirs = new Map<string, string[]>();
  const visit = (abs: string, rel: string, depth: number): void => {
    let entries: Dirent[];
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch {
      return;
    }
    entries.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
    const files: string[] = [];
    for (const e of entries) {
      if (e.isSymbolicLink()) continue; // never follow links: cycles and escapes
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && depth < MAX_DEPTH) {
          visit(path.join(abs, e.name), joinRel(rel, e.name), depth + 1);
        }
      } else if (e.isFile()) {
        files.push(e.name);
      }
    }
    dirs.set(rel, files);
  };
  visit(root, ".", 0);
  return dirs;
}

function readText(root: string, rel: string): string {
  return fs.readFileSync(path.join(root, ...rel.split("/")), "utf8");
}

/** Ancestor directories of `dir` from nearest to the scan root, inclusive. */
function ancestors(dir: string): string[] {
  if (dir === ".") return ["."];
  const parts = dir.split("/");
  const out: string[] = [];
  for (let i = parts.length; i > 0; i--) out.push(parts.slice(0, i).join("/"));
  out.push(".");
  return out;
}

interface Collected {
  projects: ScannedProject[];
  findings: Finding[];
  errors: ScanIssue[];
}

function scanNpm(root: string, dirs: Map<string, string[]>, config: ResolvedConfig, out: Collected): void {
  const npmrcCache = new Map<string, Npmrc>();
  const npmrcAt = (dir: string): Npmrc | undefined => {
    if (!(dirs.get(dir) ?? []).includes(".npmrc")) return undefined;
    const rel = joinRel(dir, ".npmrc");
    let rc = npmrcCache.get(rel);
    if (rc === undefined) {
      rc = parseNpmrc(readText(root, rel), rel);
      npmrcCache.set(rel, rc);
    }
    return rc;
  };

  for (const [dir, files] of dirs) {
    if (!files.includes("package.json")) continue;
    const pkgPath = joinRel(dir, "package.json");
    const projectFiles = [pkgPath];

    let packageJson: unknown;
    try {
      packageJson = JSON.parse(readText(root, pkgPath));
    } catch (e) {
      out.errors.push({ file: pkgPath, message: `unreadable package.json: ${(e as Error).message}` });
      continue;
    }

    const chain: Npmrc[] = [];
    for (const anc of ancestors(dir)) {
      const rc = npmrcAt(anc);
      if (rc !== undefined) {
        chain.push(rc);
        projectFiles.push(rc.path);
      }
    }

    let lockfile: { path: string; entries: LockEntry[] } | undefined;
    const lockName = files.includes("package-lock.json")
      ? "package-lock.json"
      : files.includes("npm-shrinkwrap.json")
        ? "npm-shrinkwrap.json"
        : undefined;
    if (lockName !== undefined) {
      const lockPath = joinRel(dir, lockName);
      try {
        lockfile = { path: lockPath, entries: parseLockfile(JSON.parse(readText(root, lockPath))) };
        projectFiles.push(lockPath);
      } catch (e) {
        out.errors.push({ file: lockPath, message: `unreadable lockfile: ${(e as Error).message}` });
      }
    }

    out.projects.push({ ecosystem: "npm", dir, files: projectFiles });
    try {
      out.findings.push(
        ...auditNpm({ packageJsonPath: pkgPath, packageJson, npmrcs: chain, ...(lockfile !== undefined ? { lockfile } : {}) }, config),
      );
    } catch (e) {
      out.errors.push({ file: pkgPath, message: (e as Error).message });
    }
  }
}

function scanPip(root: string, dirs: Map<string, string[]>, config: ResolvedConfig, out: Collected): void {
  const discovered = new Set<string>();
  for (const [dir, files] of dirs) {
    for (const f of files) {
      if (REQUIREMENTS_RE.test(f)) discovered.add(joinRel(dir, f));
    }
  }

  for (const [dir, files] of dirs) {
    const reqNames = files.filter((f) => REQUIREMENTS_RE.test(f)).sort();
    const confName = files.includes("pip.conf") ? "pip.conf" : files.includes("pip.ini") ? "pip.ini" : undefined;
    if (reqNames.length === 0 && confName === undefined) continue;

    const parsed: RequirementsFile[] = [];
    const projectFiles: string[] = [];
    const visited = new Set<string>();

    const load = (rel: string, viaInclude: boolean): void => {
      if (visited.has(rel)) return;
      visited.add(rel);
      // Files that the walker already assigns to another directory's project
      // are audited there; following the include would double-count them.
      if (viaInclude && discovered.has(rel) && !rel.startsWith(dir === "." ? "" : dir + "/")) return;
      let text: string;
      try {
        text = readText(root, rel);
      } catch {
        out.errors.push({ file: rel, message: "included requirements file not found" });
        return;
      }
      const file = parseRequirements(text, rel);
      parsed.push(file);
      projectFiles.push(rel);
      for (const inc of file.includes) {
        const target = path.posix.normalize(path.posix.join(path.posix.dirname(rel), inc.target));
        if (target.startsWith("..")) {
          out.errors.push({ file: rel, message: `include "${inc.target}" points outside the scan root` });
          continue;
        }
        load(target, true);
      }
    };
    for (const name of reqNames) load(joinRel(dir, name), false);

    let conf;
    let confRel: string | undefined;
    if (confName !== undefined) confRel = joinRel(dir, confName);
    else {
      const rootFiles = dirs.get(".") ?? [];
      if (rootFiles.includes("pip.conf")) confRel = "pip.conf";
      else if (rootFiles.includes("pip.ini")) confRel = "pip.ini";
    }
    if (confRel !== undefined) {
      conf = parsePipConf(readText(root, confRel), confRel);
      if (!projectFiles.includes(confRel)) projectFiles.push(confRel);
    }

    out.projects.push({ ecosystem: "pip", dir, files: projectFiles });
    out.findings.push(...auditPip({ files: parsed, ...(conf !== undefined ? { conf } : {}) }, config));
  }
}

function scanMaven(root: string, dirs: Map<string, string[]>, config: ResolvedConfig, out: Collected): void {
  for (const [dir, files] of dirs) {
    if (!files.includes("pom.xml")) continue;
    const pomPath = joinRel(dir, "pom.xml");
    const projectFiles = [pomPath];

    let pom;
    try {
      pom = parsePom(parseXml(readText(root, pomPath)));
    } catch (e) {
      out.errors.push({ file: pomPath, message: (e as Error).message });
      continue;
    }

    // settings.xml: project dir, then the project's .mvn/, then the scan root.
    const candidates = [
      joinRel(dir, "settings.xml"),
      joinRel(joinRel(dir, ".mvn"), "settings.xml"),
      "settings.xml",
    ];
    let settings;
    let settingsPath: string | undefined;
    for (const cand of candidates) {
      const parts = cand.split("/");
      const candDir = parts.length > 1 ? parts.slice(0, -1).join("/") : ".";
      const candName = parts[parts.length - 1] ?? "";
      if (!(dirs.get(candDir) ?? []).includes(candName)) continue;
      try {
        settings = parseSettings(parseXml(readText(root, cand)));
        settingsPath = cand;
        projectFiles.push(cand);
      } catch (e) {
        out.errors.push({ file: cand, message: (e as Error).message });
      }
      break;
    }

    out.projects.push({ ecosystem: "maven", dir, files: projectFiles });
    out.findings.push(
      ...auditMaven(
        {
          pomPath,
          pom,
          ...(settings !== undefined ? { settings } : {}),
          ...(settingsPath !== undefined ? { settingsPath } : {}),
        },
        config,
      ),
    );
  }
}

function summarize(findings: readonly Finding[], ignored: number): ScanSummary {
  const summary: ScanSummary = { critical: 0, high: 0, medium: 0, low: 0, total: findings.length, ignored };
  for (const f of findings) summary[f.severity]++;
  return summary;
}

function compareFindings(a: Finding, b: Finding): number {
  const eco = ECOSYSTEMS.indexOf(a.ecosystem) - ECOSYSTEMS.indexOf(b.ecosystem);
  if (eco !== 0) return eco;
  const sev = SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity];
  if (sev !== 0) return sev;
  for (const key of ["id", "file", "package", "message"] as const) {
    const av = a[key] ?? "";
    const bv = b[key] ?? "";
    if (av !== bv) return av < bv ? -1 : 1;
  }
  return 0;
}

/** True when the scan should fail (exit 1) under the configured threshold. */
export function failsThreshold(findings: readonly Finding[], failOn: Severity): boolean {
  return findings.some((f) => SEVERITY_RANK[f.severity] >= SEVERITY_RANK[failOn]);
}

export function scan(rootDir: string, config: ResolvedConfig): ScanResult {
  let stat: Stats;
  try {
    stat = fs.statSync(rootDir);
  } catch {
    throw new ScanRootError(`scan root does not exist: ${rootDir}`);
  }
  if (!stat.isDirectory()) throw new ScanRootError(`scan root is not a directory: ${rootDir}`);

  const dirs = walkTree(rootDir);
  const out: Collected = { projects: [], findings: [], errors: [] };
  if (config.ecosystems.includes("npm")) scanNpm(rootDir, dirs, config, out);
  if (config.ecosystems.includes("pip")) scanPip(rootDir, dirs, config, out);
  if (config.ecosystems.includes("maven")) scanMaven(rootDir, dirs, config, out);

  const kept: Finding[] = [];
  let ignored = 0;
  for (const f of out.findings) {
    if (isIgnored(config.ignore, f.id, f.package)) ignored++;
    else kept.push(f);
  }
  kept.sort(compareFindings);
  out.errors.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));

  const ecoOrder = (e: Ecosystem): number => ECOSYSTEMS.indexOf(e);
  out.projects.sort((a, b) => ecoOrder(a.ecosystem) - ecoOrder(b.ecosystem) || (a.dir < b.dir ? -1 : a.dir > b.dir ? 1 : 0));

  return {
    root: rootDir,
    ecosystems: config.ecosystems,
    projects: out.projects,
    findings: kept,
    errors: out.errors,
    summary: summarize(kept, ignored),
    failOn: config.failOn,
    ok: !failsThreshold(kept, config.failOn),
  };
}

/**
 * Best-effort inference of internal patterns for `claimcheck init`: scopes
 * mapped in .npmrc files, names the lockfile resolved from private hosts,
 * and the groupIds of scanned POMs. Parse failures are silently skipped —
 * init is a starting point, not an audit.
 */
export function inferInternalPatterns(rootDir: string): string[] {
  const dirs = walkTree(rootDir);
  const patterns = new Set<string>();
  const noOverrides = { publicRegistries: [], privateRegistries: [] };

  for (const [dir, files] of dirs) {
    for (const name of files) {
      const rel = joinRel(dir, name);
      try {
        if (name === ".npmrc") {
          for (const scope of parseNpmrc(readText(rootDir, rel), rel).scopes.keys()) {
            patterns.add(`${scope}/*`);
          }
        } else if (name === "package-lock.json" || name === "npm-shrinkwrap.json") {
          for (const entry of parseLockfile(JSON.parse(readText(rootDir, rel)))) {
            if (entry.resolved === undefined) continue;
            const cls = classifyRegistry(entry.resolved, noOverrides);
            if (cls === null || cls.kind !== "private") continue;
            const scope = scopeOf(entry.name);
            patterns.add(scope !== null ? `${scope}/*` : entry.name);
          }
        } else if (name === "pom.xml") {
          const pom = parsePom(parseXml(readText(rootDir, rel)));
          if (pom.groupId !== undefined && !pom.groupId.includes("$")) {
            patterns.add(pom.groupId);
            patterns.add(`${pom.groupId}.*`);
          }
        }
      } catch {
        // init never fails on a malformed file; `claimcheck scan` reports it.
      }
    }
  }
  return [...patterns].sort();
}
