/**
 * The rule catalogue. Every finding cites one of these IDs; `claimcheck rules`
 * lists them and `claimcheck explain <id>` prints the why/fix prose. Rules are
 * data, not code — the detection logic lives in the per-ecosystem auditors —
 * so the catalogue doubles as the documented contract (see docs/rules.md).
 */

import type { Rule } from "./types.js";

export const RULES: readonly Rule[] = [
  // ── npm ────────────────────────────────────────────────────────────────
  {
    id: "CC-NPM-001",
    ecosystem: "npm",
    severity: "critical",
    title: "Internal package resolves from a public registry",
    why: "The effective registry for this internal name (after applying every .npmrc scope mapping and default) is a public registry. Anyone who publishes that name publicly — at any version — gets installed on the next `npm install`.",
    fix: "Route the name through your private registry: publish it under an org scope and pin the scope with `@scope:registry=https://npm.example.test/` in .npmrc, or point the default `registry=` at your private registry.",
  },
  {
    id: "CC-NPM-002",
    ecosystem: "npm",
    severity: "high",
    title: "Internal package is unscoped",
    why: "Unscoped names live in the public registry's global namespace, so the private name is claimable by anyone on npmjs.org. Protection then rests entirely on every machine (each laptop, each CI runner) carrying the right .npmrc — one missing config file and the public copy wins.",
    fix: "Move the package under an org scope (e.g. @acme/thing) and map the scope in .npmrc. If renaming is impossible, register the public name yourself as a placeholder so nobody else can.",
  },
  {
    id: "CC-NPM-003",
    ecosystem: "npm",
    severity: "high",
    title: "Internal scope has no registry mapping",
    why: "This scoped internal package currently resolves privately only because the default `registry=` happens to point at a private registry. Without an explicit `@scope:registry=` line, any environment that lacks (or overrides) that default silently falls back to the public registry for the whole scope.",
    fix: "Add an explicit `@scope:registry=https://npm.example.test/` mapping to the project .npmrc so the scope's routing never depends on ambient defaults.",
  },
  {
    id: "CC-NPM-004",
    ecosystem: "npm",
    severity: "critical",
    title: "Lockfile resolves an internal package from a public registry",
    why: "The committed lockfile records a public-registry URL for an internal name. This is not a hypothetical: some install already fetched — or will reproducibly fetch — this internal package from the public registry.",
    fix: "Fix the registry routing first, then purge the poisoned resolution: remove the lockfile entry (or the whole lockfile), reinstall against the private registry, and audit what the publicly-fetched artifact contained.",
  },
  {
    id: "CC-NPM-005",
    ecosystem: "npm",
    severity: "medium",
    title: "Registry URL uses plain http",
    why: "A registry reached over plain http can be tampered with in transit; an on-path attacker can substitute packages without ever claiming a name.",
    fix: "Serve the registry over https and update the .npmrc URL.",
  },
  {
    id: "CC-NPM-006",
    ecosystem: "npm",
    severity: "medium",
    title: "Internal dependencies without a lockfile",
    why: "Without a committed lockfile nothing pins resolved URLs or integrity hashes, so a registry-routing mistake (or a higher public version) changes what installs with no diff to review.",
    fix: "Commit package-lock.json (or npm-shrinkwrap.json) and install with `npm ci`.",
  },
  {
    id: "CC-NPM-007",
    ecosystem: "npm",
    severity: "medium",
    title: "Internal package can be published publicly by accident",
    why: "The package's own name matches an internal pattern, but the manifest sets neither `\"private\": true` nor `publishConfig.registry`. A reflexive `npm publish` sends the internal code — name, source and all — to the public registry.",
    fix: "Set `\"private\": true` on applications, or pin `publishConfig.registry` to the private registry on libraries that are meant to be published internally.",
  },
  {
    id: "CC-NPM-008",
    ecosystem: "npm",
    severity: "low",
    title: "Privately-resolved package not covered by internal patterns",
    why: "The lockfile shows this name was resolved from a private registry, yet no internal pattern matches it and its current routing points at a public registry. Either the pattern list is incomplete or the registry config regressed — both mean this audit is not actually covering the package.",
    fix: "Add the name (or its prefix) to `internal` in claimcheck.json, or restore the registry mapping that used to route it privately.",
  },

  // ── pip ────────────────────────────────────────────────────────────────
  {
    id: "CC-PIP-001",
    ecosystem: "pip",
    severity: "critical",
    title: "--extra-index-url merges public and private indexes",
    why: "pip treats --index-url and every --extra-index-url as one pool of candidates and installs the best (usually highest) version wherever it lives. A public package with a bigger version number beats your private one — this exact behaviour is the original dependency-confusion vector.",
    fix: "Serve everything from a single index: run a repository manager that merges public and private packages server-side, point --index-url at it, and delete every --extra-index-url.",
  },
  {
    id: "CC-PIP-002",
    ecosystem: "pip",
    severity: "high",
    title: "Internal requirement with a public effective index",
    why: "This requirement matches an internal pattern, but the effective --index-url is public PyPI. Installs will look the name up publicly, so whoever registers it on PyPI supplies the code.",
    fix: "Point --index-url (in requirements.txt or pip.conf) at your private index for every environment that installs internal packages.",
  },
  {
    id: "CC-PIP-003",
    ecosystem: "pip",
    severity: "medium",
    title: "Index URL uses plain http",
    why: "An index reached over plain http can be rewritten in transit — package substitution without name-claiming.",
    fix: "Serve the index over https and update the URL.",
  },
  {
    id: "CC-PIP-004",
    ecosystem: "pip",
    severity: "medium",
    title: "--trusted-host disables TLS verification",
    why: "--trusted-host tells pip to skip certificate verification (and allow plain http) for that host, so anyone who can answer for the hostname can serve arbitrary packages.",
    fix: "Give the index a valid certificate and remove the --trusted-host line.",
  },
  {
    id: "CC-PIP-005",
    ecosystem: "pip",
    severity: "medium",
    title: "Internal requirement is not pinned to an exact version",
    why: "An unpinned (or range-pinned) internal requirement lets \"the highest available version\" win. Combined with any public resolution path, an attacker publishing version 99.0 takes the slot instantly.",
    fix: "Pin internal requirements with `==` (and ideally `--hash=`) so no higher version — public or private — can be substituted silently.",
  },

  // ── Maven ──────────────────────────────────────────────────────────────
  {
    id: "CC-MVN-001",
    ecosystem: "maven",
    severity: "critical",
    title: "Internal groupId resolvable from a public repository",
    why: "After applying every mirror in settings.xml, at least one repository serving release artifacts for this internal groupId is public. Maven will consult it, and whoever publishes the coordinates there (Central's com.* namespace claims included) can supply the artifact.",
    fix: "Add a blanket mirror (`<mirrorOf>*</mirrorOf>` or `external:*`) pointing at your repository manager, and route internal groupIds to the private repo inside the manager.",
  },
  {
    id: "CC-MVN-002",
    ecosystem: "maven",
    severity: "high",
    title: "<repositories> declared in pom.xml",
    why: "Repositories declared per-project bypass centrally managed routing: they are consulted by every consumer of the POM, cannot be overridden without a mirror, and quietly widen where dependencies may come from.",
    fix: "Delete <repositories> from the POM and declare all repositories in settings.xml (or, better, only in the repository manager) where mirrors and ops policy apply.",
  },
  {
    id: "CC-MVN-003",
    ecosystem: "maven",
    severity: "medium",
    title: "No blanket mirror while internal groupIds are present",
    why: "Without a `<mirrorOf>*</mirrorOf>` (or `external:*`) mirror, Maven talks to Maven Central directly. Any internal groupId that is claimable in Central's namespace — or any repo added later — resolves publicly by default.",
    fix: "Mirror everything through your repository manager in settings.xml so there is exactly one, policy-controlled resolution path.",
  },
  {
    id: "CC-MVN-004",
    ecosystem: "maven",
    severity: "medium",
    title: "Repository or mirror URL uses plain http",
    why: "Artifacts fetched over plain http can be replaced in transit (Maven itself blocks http by default since 3.8.1 for exactly this reason).",
    fix: "Serve the repository over https and update the URL.",
  },
  {
    id: "CC-MVN-005",
    ecosystem: "maven",
    severity: "medium",
    title: "Snapshots enabled on a public repository",
    why: "Snapshot resolution re-queries repository metadata and takes the newest timestamp, so a public repo with snapshots enabled is a standing invitation to have -SNAPSHOT artifacts silently replaced.",
    fix: "Disable <snapshots> on public repositories; host snapshots only on the private repository manager.",
  },
  {
    id: "CC-MVN-006",
    ecosystem: "maven",
    severity: "high",
    title: "<pluginRepositories> declared in pom.xml",
    why: "Plugin repositories declared per-project fetch build plugins — code that executes on the build machine — from wherever the POM says, outside centrally managed routing.",
    fix: "Remove <pluginRepositories> from the POM; resolve plugins through the mirrored repository manager like everything else.",
  },
];

const BY_ID: ReadonlyMap<string, Rule> = new Map(RULES.map((r) => [r.id, r]));

export function getRule(id: string): Rule | undefined {
  return BY_ID.get(id.toUpperCase());
}

/** Look up a rule that must exist; used by auditors to stay in sync with the catalogue. */
export function rule(id: string): Rule {
  const r = BY_ID.get(id);
  if (r === undefined) throw new Error(`unknown rule id: ${id}`);
  return r;
}
