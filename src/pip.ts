/**
 * pip auditor: requirements files (with pip's own line grammar — comments,
 * backslash continuations, inline options, -r/-c includes) plus pip.conf.
 *
 * The Birsan vector lives here: pip pools --index-url and every
 * --extra-index-url into one candidate set and installs the best version
 * wherever it lives, so "private package on the extra index" loses to
 * "version 99.0 on PyPI". claimcheck flags the mechanism itself (CC-PIP-001)
 * and each internal name whose effective index is public (CC-PIP-002).
 */

import type { Finding, ResolvedConfig } from "./types.js";
import { iniLookup, parseIni } from "./ini.js";
import { matchesAnyPyPI } from "./patterns.js";
import { classifyRegistry, DEFAULT_PYPI_INDEX } from "./registries.js";
import { rule } from "./rules.js";

export interface Requirement {
  /** Name as written (extras stripped). */
  name: string;
  /** Version specifier text, "" when absent. */
  spec: string;
  /** True for `name==x.y.z` (exact, non-wildcard) pins. */
  pinned: boolean;
  /** True for direct-URL / local-path requirements (never index-resolved). */
  direct: boolean;
  line: number;
}

export interface ReqOption {
  kind: "index-url" | "extra-index-url" | "trusted-host";
  value: string;
  line: number;
}

export interface ReqInclude {
  /** As written after -r / -c (relative to the requirements file). */
  target: string;
  constraint: boolean;
  line: number;
}

export interface RequirementsFile {
  path: string;
  requirements: Requirement[];
  options: ReqOption[];
  includes: ReqInclude[];
}

/** Join backslash continuations, keeping the first physical line's number. */
function logicalLines(text: string): { text: string; line: number }[] {
  const out: { text: string; line: number }[] = [];
  const physical = text.split(/\r?\n/);
  let buffer = "";
  let start = 0;
  for (let i = 0; i < physical.length; i++) {
    const raw = physical[i] ?? "";
    if (buffer === "") start = i + 1;
    if (raw.endsWith("\\") && !raw.endsWith("\\\\")) {
      buffer += raw.slice(0, -1);
      continue;
    }
    buffer += raw;
    out.push({ text: buffer, line: start });
    buffer = "";
  }
  if (buffer !== "") out.push({ text: buffer, line: start });
  return out;
}

/** Strip a pip comment: `#` at line start or preceded by whitespace. */
function stripComment(line: string): string {
  const m = /(^|\s)#/.exec(line);
  return m === null ? line : line.slice(0, m.index);
}

const OPTION_ALIASES: Record<string, ReqOption["kind"]> = {
  "-i": "index-url",
  "--index-url": "index-url",
  "--extra-index-url": "extra-index-url",
  "--trusted-host": "trusted-host",
};

/** True for `==x.y.z` exact pins (arbitrary equality `===` counts; `==1.*` does not). */
export function isExactPin(spec: string): boolean {
  return spec
    .split(",")
    .map((clause) => clause.trim())
    .some((clause) => /^===?[^*]+$/.test(clause) && !clause.includes("*"));
}

export function parseRequirements(text: string, path: string): RequirementsFile {
  const file: RequirementsFile = { path, requirements: [], options: [], includes: [] };

  for (const { text: logical, line } of logicalLines(text)) {
    const stripped = stripComment(logical).trim();
    if (stripped.length === 0) continue;

    if (stripped.startsWith("-")) {
      // Option line. Split on whitespace; also accept --opt=value.
      const tokens = stripped.split(/\s+/);
      let i = 0;
      while (i < tokens.length) {
        const token = tokens[i] ?? "";
        const eq = token.indexOf("=");
        const flag = token.startsWith("--") && eq > 0 ? token.slice(0, eq) : token;
        const inlineValue = token.startsWith("--") && eq > 0 ? token.slice(eq + 1) : undefined;

        if (flag === "-r" || flag === "--requirement" || flag === "-c" || flag === "--constraint") {
          const target = inlineValue ?? tokens[++i];
          if (target !== undefined) {
            file.includes.push({ target, constraint: flag.includes("c"), line });
          }
        } else if (flag in OPTION_ALIASES) {
          const value = inlineValue ?? tokens[++i];
          if (value !== undefined) {
            file.options.push({ kind: OPTION_ALIASES[flag] as ReqOption["kind"], value, line });
          }
        } else if (inlineValue === undefined && /^--?[a-z]/.test(flag) && !flag.startsWith("--no-")) {
          // Unknown option that may consume a value (-e ./pkg, --hash=..): skip
          // conservatively only when the next token is clearly its argument.
          if (i + 1 < tokens.length && !(tokens[i + 1] ?? "").startsWith("-")) i++;
        }
        i++;
      }
      continue;
    }

    // Requirement line. Direct URLs (`name @ https://…`) and local paths are
    // never index-resolved; record them but exempt them from index rules.
    if (stripped.startsWith(".") || stripped.startsWith("/")) {
      continue; // bare local path: nothing claimable
    }
    const noHash = stripped.split(/\s+--hash=/)[0] ?? stripped;
    const noMarker = (noHash.split(";")[0] ?? noHash).trim();
    const direct = noMarker.includes("@") && /https?:|file:|git\+/.test(noMarker);
    const nameMatch = /^[A-Za-z0-9][A-Za-z0-9._-]*/.exec(noMarker);
    if (nameMatch === null) continue;
    const name = nameMatch[0];
    let rest = noMarker.slice(name.length).trim();
    if (rest.startsWith("[")) {
      const close = rest.indexOf("]");
      rest = close >= 0 ? rest.slice(close + 1).trim() : "";
    }
    const spec = direct ? "" : rest;
    file.requirements.push({
      name,
      spec,
      pinned: direct || isExactPin(spec),
      direct,
      line,
    });
  }
  return file;
}

export interface PipConf {
  path: string;
  indexUrl?: { url: string; line: number };
  extraIndexUrls: { url: string; line: number }[];
  trustedHosts: { host: string; line: number }[];
}

/** pip reads [global] for every command and [install] for `pip install`. */
export function parsePipConf(text: string, path: string): PipConf {
  const entries = parseIni(text);
  const conf: PipConf = { path, extraIndexUrls: [], trustedHosts: [] };
  for (const section of ["global", "install"]) {
    for (const e of iniLookup(entries, section, "index-url")) {
      conf.indexUrl = { url: e.value.split(/\s|\n/)[0] ?? e.value, line: e.line };
    }
    for (const e of iniLookup(entries, section, "extra-index-url")) {
      for (const url of e.value.split(/[\s\n]+/).filter((u) => u.length > 0)) {
        conf.extraIndexUrls.push({ url, line: e.line });
      }
    }
    for (const e of iniLookup(entries, section, "trusted-host")) {
      for (const host of e.value.split(/[\s\n]+/).filter((h) => h.length > 0)) {
        conf.trustedHosts.push({ host, line: e.line });
      }
    }
  }
  return conf;
}

export interface PipInput {
  files: readonly RequirementsFile[];
  conf?: PipConf;
}

export function auditPip(input: PipInput, config: ResolvedConfig): Finding[] {
  const findings: Finding[] = [];
  const add = (id: string, file: string, message: string, pkgName?: string): void => {
    const r = rule(id);
    findings.push({
      id: r.id,
      severity: r.severity,
      ecosystem: "pip",
      file,
      ...(pkgName !== undefined ? { package: pkgName } : {}),
      message,
      remediation: r.fix,
    });
  };

  // Gather the index configuration: requirements-file options win over pip.conf.
  const indexUrls: { url: string; file: string; line: number }[] = [];
  const extraIndexUrls: { url: string; file: string; line: number }[] = [];
  const trustedHosts: { host: string; file: string; line: number }[] = [];
  for (const f of input.files) {
    for (const opt of f.options) {
      const at = { file: f.path, line: opt.line };
      if (opt.kind === "index-url") indexUrls.push({ url: opt.value, ...at });
      else if (opt.kind === "extra-index-url") extraIndexUrls.push({ url: opt.value, ...at });
      else trustedHosts.push({ host: opt.value, ...at });
    }
  }
  if (input.conf !== undefined) {
    const c = input.conf;
    if (c.indexUrl !== undefined) {
      indexUrls.push({ url: c.indexUrl.url, file: c.path, line: c.indexUrl.line });
    }
    for (const e of c.extraIndexUrls) extraIndexUrls.push({ url: e.url, file: c.path, line: e.line });
    for (const t of c.trustedHosts) trustedHosts.push({ host: t.host, file: c.path, line: t.line });
  }

  // CC-PIP-001: the merge-and-take-the-best mechanism itself.
  for (const extra of extraIndexUrls) {
    add(
      "CC-PIP-001",
      extra.file,
      `--extra-index-url ${extra.url} (line ${extra.line}) — pip merges all indexes and installs the best version, wherever it lives`,
    );
  }

  // CC-PIP-003 / CC-PIP-004: transport hygiene across every configured URL/host.
  for (const idx of [...indexUrls, ...extraIndexUrls]) {
    const cls = classifyRegistry(idx.url, config);
    if (cls !== null && cls.insecure) {
      add("CC-PIP-003", idx.file, `index URL uses plain http: ${idx.url} (line ${idx.line})`);
    }
  }
  for (const t of trustedHosts) {
    add(
      "CC-PIP-004",
      t.file,
      `--trusted-host ${t.host} (line ${t.line}) disables TLS verification for that host`,
    );
  }

  // Effective primary index: first explicit --index-url, else the PyPI default.
  const primary = indexUrls[0];
  const effectiveUrl = primary?.url ?? DEFAULT_PYPI_INDEX;
  const effectiveCls = classifyRegistry(effectiveUrl, config);
  const publicIndex = effectiveCls !== null && effectiveCls.kind === "public";

  for (const f of input.files) {
    for (const req of f.requirements) {
      if (req.direct) continue;
      if (matchesAnyPyPI(req.name, config.internal) === null) continue;
      if (publicIndex) {
        const via = primary === undefined ? "no index is configured, so pip defaults to" : "the effective index is";
        add(
          "CC-PIP-002",
          f.path,
          `internal requirement (line ${req.line}) while ${via} ${effectiveUrl}`,
          req.name,
        );
      }
      if (!req.pinned) {
        add(
          "CC-PIP-005",
          f.path,
          `internal requirement is not pinned to an exact version (line ${req.line}: ${req.spec.length > 0 ? `"${req.spec}"` : "no specifier"})`,
          req.name,
        );
      }
    }
  }

  return findings;
}
