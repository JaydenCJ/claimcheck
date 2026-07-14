/**
 * Maven auditor: pom.xml (dependencies + per-project repositories) and
 * settings.xml (mirrors + active-profile repositories).
 *
 * The analysis mirrors Maven's own resolution shape: start from the implicit
 * `central` repository, add every declared repository, then apply the first
 * matching mirror to each (Maven's DefaultMirrorSelector semantics, including
 * `*`, `external:*`, `!repo` exclusions and comma lists). What remains
 * effectively public after mirroring is what an attacker can serve.
 */

import type { Finding, ResolvedConfig } from "./types.js";
import { matchesAny } from "./patterns.js";
import { classifyRegistry, MAVEN_CENTRAL_ID, MAVEN_CENTRAL_URL } from "./registries.js";
import { rule } from "./rules.js";
import { child, childrenOf, textOf, type XmlElement } from "./xml.js";

export interface MavenRepo {
  id: string;
  url: string;
  releases: boolean;
  snapshots: boolean;
}

export interface MavenDep {
  groupId: string;
  artifactId: string;
}

export interface PomModel {
  groupId?: string;
  artifactId?: string;
  deps: MavenDep[];
  repositories: MavenRepo[];
  pluginRepositories: MavenRepo[];
}

export interface Mirror {
  id: string;
  mirrorOf: string;
  url: string;
}

export interface SettingsModel {
  mirrors: Mirror[];
  /** Repositories contributed by active profiles (activeByDefault or listed in <activeProfiles>). */
  repositories: MavenRepo[];
}

function parseRepo(el: XmlElement): MavenRepo {
  const enabled = (name: string, dflt: boolean): boolean => {
    const section = child(el, name);
    if (section === undefined) return dflt;
    const t = textOf(section, "enabled");
    return t === undefined ? dflt : t === "true";
  };
  return {
    id: textOf(el, "id") ?? "(no id)",
    url: textOf(el, "url") ?? "",
    // Maven defaults: both release and snapshot resolution are enabled unless
    // a policy block says otherwise (central itself disables snapshots).
    releases: enabled("releases", true),
    snapshots: enabled("snapshots", true),
  };
}

function parseRepoList(parent: XmlElement | undefined, listName: string): MavenRepo[] {
  if (parent === undefined) return [];
  const list = child(parent, listName);
  if (list === undefined) return [];
  const itemName = listName === "pluginRepositories" ? "pluginRepository" : "repository";
  return childrenOf(list, itemName).map(parseRepo);
}

/** Parse a pom.xml root element into the fields the audit needs. */
export function parsePom(root: XmlElement): PomModel {
  if (root.name !== "project") {
    throw new Error(`expected <project> as the root element, found <${root.name}>`);
  }
  const parent = child(root, "parent");
  const groupId = textOf(root, "groupId") ?? (parent !== undefined ? textOf(parent, "groupId") : undefined);
  const artifactId = textOf(root, "artifactId");

  const deps: MavenDep[] = [];
  const depsEl = child(root, "dependencies");
  if (depsEl !== undefined) {
    for (const dep of childrenOf(depsEl, "dependency")) {
      let g = textOf(dep, "groupId") ?? "";
      const a = textOf(dep, "artifactId") ?? "";
      // The one property indirection worth resolving statically: self-reference.
      if ((g === "${project.groupId}" || g === "${pom.groupId}") && groupId !== undefined) {
        g = groupId;
      }
      if (g.length > 0 && a.length > 0) deps.push({ groupId: g, artifactId: a });
    }
  }

  return {
    ...(groupId !== undefined ? { groupId } : {}),
    ...(artifactId !== undefined ? { artifactId } : {}),
    deps,
    repositories: parseRepoList(root, "repositories"),
    pluginRepositories: parseRepoList(root, "pluginRepositories"),
  };
}

/** Parse a settings.xml root element: mirrors and active-profile repositories. */
export function parseSettings(root: XmlElement): SettingsModel {
  if (root.name !== "settings") {
    throw new Error(`expected <settings> as the root element, found <${root.name}>`);
  }
  const mirrors: Mirror[] = [];
  const mirrorsEl = child(root, "mirrors");
  if (mirrorsEl !== undefined) {
    for (const m of childrenOf(mirrorsEl, "mirror")) {
      mirrors.push({
        id: textOf(m, "id") ?? "(no id)",
        mirrorOf: textOf(m, "mirrorOf") ?? "",
        url: textOf(m, "url") ?? "",
      });
    }
  }

  const activeIds = new Set<string>();
  const activeEl = child(root, "activeProfiles");
  if (activeEl !== undefined) {
    for (const p of childrenOf(activeEl, "activeProfile")) {
      const id = p.text.trim();
      if (id.length > 0) activeIds.add(id);
    }
  }

  const repositories: MavenRepo[] = [];
  const profilesEl = child(root, "profiles");
  if (profilesEl !== undefined) {
    for (const profile of childrenOf(profilesEl, "profile")) {
      const id = textOf(profile, "id") ?? "";
      const activation = child(profile, "activation");
      const byDefault = activation !== undefined && textOf(activation, "activeByDefault") === "true";
      if (!byDefault && !activeIds.has(id)) continue;
      repositories.push(...parseRepoList(profile, "repositories"));
    }
  }
  return { mirrors, repositories };
}

/** True when `url` is exempt from `external:*` (localhost or file://). */
function isInternalUrl(url: string): boolean {
  if (url.startsWith("file://")) return true;
  try {
    const host = new URL(url).hostname;
    return host === "localhost" || host === "127.0.0.1" || host === "::1" || host === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Maven's mirror matching (DefaultMirrorSelector): a comma-separated pattern
 * list where `*` matches everything, `external:*` matches non-local repos,
 * `external:http:*` matches non-local plain-http repos, `!id` excludes, and
 * anything else is an exact repository-id match. A repo matches when some
 * positive pattern hits and no exclusion does.
 */
export function mirrorMatches(mirrorOf: string, repo: { id: string; url: string }): boolean {
  let matched = false;
  for (const raw of mirrorOf.split(",")) {
    const pattern = raw.trim();
    if (pattern.length === 0) continue;
    if (pattern.startsWith("!")) {
      if (pattern.slice(1) === repo.id) return false;
      continue;
    }
    if (pattern === "*") matched = true;
    else if (pattern === "external:*") {
      if (!isInternalUrl(repo.url)) matched = true;
    } else if (pattern === "external:http:*") {
      if (repo.url.startsWith("http://") && !isInternalUrl(repo.url)) matched = true;
    } else if (pattern === repo.id) matched = true;
  }
  return matched;
}

export interface EffectiveRepo {
  repo: MavenRepo;
  /** Where requests actually go after mirroring. */
  effectiveUrl: string;
  /** The mirror that captured this repo, if any. */
  mirrorId?: string;
}

export const CENTRAL: MavenRepo = {
  id: MAVEN_CENTRAL_ID,
  url: MAVEN_CENTRAL_URL,
  releases: true,
  snapshots: false, // the super-POM disables snapshots on central
};

/** The repository set Maven will actually consult, after applying mirrors. */
export function effectiveRepositories(pom: PomModel, settings?: SettingsModel): EffectiveRepo[] {
  const repos: MavenRepo[] = [CENTRAL, ...pom.repositories, ...(settings?.repositories ?? [])];
  const mirrors = settings?.mirrors ?? [];
  return repos.map((repo) => {
    const mirror = mirrors.find((m) => mirrorMatches(m.mirrorOf, repo));
    return mirror !== undefined
      ? { repo, effectiveUrl: mirror.url, mirrorId: mirror.id }
      : { repo, effectiveUrl: repo.url };
  });
}

export interface MavenInput {
  pomPath: string;
  pom: PomModel;
  settingsPath?: string;
  settings?: SettingsModel;
}

export function auditMaven(input: MavenInput, config: ResolvedConfig): Finding[] {
  const findings: Finding[] = [];
  const add = (id: string, file: string, message: string, pkgName?: string): void => {
    const r = rule(id);
    findings.push({
      id: r.id,
      severity: r.severity,
      ecosystem: "maven",
      file,
      ...(pkgName !== undefined ? { package: pkgName } : {}),
      message,
      remediation: r.fix,
    });
  };

  const isInternal = (dep: MavenDep): boolean =>
    matchesAny(dep.groupId, config.internal) !== null ||
    matchesAny(`${dep.groupId}:${dep.artifactId}`, config.internal) !== null;

  const internalDeps = input.pom.deps.filter(isInternal);
  const ownInternal =
    input.pom.groupId !== undefined && matchesAny(input.pom.groupId, config.internal) !== null;
  const internalPresent = internalDeps.length > 0 || ownInternal;

  const effective = effectiveRepositories(input.pom, input.settings);
  const classify = (url: string) => classifyRegistry(url, config);

  // CC-MVN-001: internal coordinates fetchable from an effectively-public repo.
  const publicRepos = effective.filter((e) => {
    const cls = classify(e.effectiveUrl);
    return e.repo.releases && cls !== null && cls.kind === "public";
  });
  if (publicRepos.length > 0) {
    const names = publicRepos.map((e) => e.repo.id).join(", ");
    for (const dep of internalDeps) {
      add(
        "CC-MVN-001",
        input.pomPath,
        `resolvable from public ${publicRepos.length === 1 ? "repository" : "repositories"} ${names}`,
        `${dep.groupId}:${dep.artifactId}`,
      );
    }
  }

  // CC-MVN-002 / CC-MVN-006: per-project repository declarations.
  for (const repo of input.pom.repositories) {
    add(
      "CC-MVN-002",
      input.pomPath,
      `<repositories> declares "${repo.id}" (${repo.url}) — repository routing belongs in settings.xml / the repository manager`,
    );
  }
  for (const repo of input.pom.pluginRepositories) {
    add(
      "CC-MVN-006",
      input.pomPath,
      `<pluginRepositories> declares "${repo.id}" (${repo.url}) — build plugins execute on the build machine`,
    );
  }

  // CC-MVN-003: central still reached directly while internal groupIds exist.
  const central = effective.find((e) => e.repo.id === MAVEN_CENTRAL_ID);
  if (internalPresent && central !== undefined) {
    const cls = classify(central.effectiveUrl);
    if (cls !== null && cls.kind === "public") {
      add(
        "CC-MVN-003",
        input.settingsPath ?? input.pomPath,
        input.settings === undefined
          ? "no settings.xml found — Maven Central is consulted directly for every artifact"
          : "no mirror captures central — Maven Central is consulted directly for every artifact",
      );
    }
  }

  // CC-MVN-004: plain-http repository / mirror URLs (deduplicated by URL).
  const seenInsecure = new Set<string>();
  const flagInsecure = (id: string, url: string, file: string): void => {
    const cls = classify(url);
    if (cls !== null && cls.insecure && !seenInsecure.has(url)) {
      seenInsecure.add(url);
      add("CC-MVN-004", file, `"${id}" uses plain http: ${url}`);
    }
  };
  for (const e of effective) {
    if (e.mirrorId !== undefined) {
      flagInsecure(e.mirrorId, e.effectiveUrl, input.settingsPath ?? input.pomPath);
    } else if (e.repo.id !== MAVEN_CENTRAL_ID) {
      flagInsecure(e.repo.id, e.repo.url, input.pomPath);
    }
  }

  // CC-MVN-005: snapshot resolution against an effectively-public repo.
  for (const e of effective) {
    const cls = classify(e.effectiveUrl);
    if (e.repo.snapshots && cls !== null && cls.kind === "public") {
      add(
        "CC-MVN-005",
        input.pomPath,
        `snapshots are enabled on public repository "${e.repo.id}" (${e.effectiveUrl})`,
      );
    }
  }

  return findings;
}
