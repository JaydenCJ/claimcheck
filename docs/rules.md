# claimcheck rule reference

Every finding cites one of the rule IDs below. `claimcheck rules` prints this
catalogue from the binary itself and `claimcheck explain <id>` prints the full
why/fix prose for one rule — this document adds the detection conditions, so
you can predict exactly when a rule fires.

Severities: **critical** (an attacker-controlled resolution path exists or is
proven), **high** (one config regression away from critical), **medium**
(hygiene that widens the blast radius), **low** (audit-coverage gaps).

A finding is suppressed by adding its ID to `ignore` in `claimcheck.json`,
either for the whole rule (`"CC-NPM-005"`) or one package
(`"CC-NPM-001:legacy-cli"`).

## npm

Inputs: `package.json`, the `.npmrc` chain (project file first, then ancestor
directories up to the scan root, matching npm's nearest-wins precedence), and
`package-lock.json` / `npm-shrinkwrap.json`.

| ID | Severity | Fires when |
|---|---|---|
| CC-NPM-001 | critical | An internal-pattern dependency's *effective registry* (scope mapping → default `registry=` → npm's built-in npmjs.org default) is public. |
| CC-NPM-002 | high | An internal-pattern dependency is unscoped — the name is claimable in the public global namespace, even if currently routed privately. |
| CC-NPM-003 | high | A scoped internal dependency resolves privately only via the default `registry=`; no explicit `@scope:registry=` mapping exists. |
| CC-NPM-004 | critical | The lockfile records a public-registry `resolved` URL for an internal-pattern package. |
| CC-NPM-005 | medium | Any `.npmrc` registry URL uses plain `http:` to a non-loopback host. |
| CC-NPM-006 | medium | Internal dependencies exist but no lockfile is committed. |
| CC-NPM-007 | medium | The package's own name matches an internal pattern and neither `"private": true` nor `publishConfig.registry` is set. |
| CC-NPM-008 | low | A lockfile entry was resolved from a private registry, matches no internal pattern, and its current routing points at a public registry. |

Notes: `file:`, `link:`, `workspace:`, git and tarball-URL specs never resolve
through a registry and are exempt. CC-NPM-003 stays quiet when CC-NPM-001
already fired for the same package — one exposure, one finding.

## pip

Inputs: every `*requirements*.txt` / `*constraints*.txt` / `.in` file
(following `-r` / `-c` includes, cycle-safe), plus `pip.conf` / `pip.ini` in
the project directory or scan root. Requirement-file options take precedence
over `pip.conf`, as in pip itself. Name matching is PEP 503-normalized.

| ID | Severity | Fires when |
|---|---|---|
| CC-PIP-001 | critical | Any `--extra-index-url` is configured, anywhere. pip pools all indexes and installs the best version wherever it lives — the original dependency-confusion vector. |
| CC-PIP-002 | high | An internal-pattern requirement exists while the effective `--index-url` is public PyPI (explicit or defaulted). |
| CC-PIP-003 | medium | An index URL uses plain `http:` to a non-loopback host. |
| CC-PIP-004 | medium | A `--trusted-host` is configured (TLS verification disabled for that host). |
| CC-PIP-005 | medium | An internal-pattern requirement is not pinned with `==` (exact, non-wildcard). |

Notes: direct-URL requirements (`name @ https://…`) and local paths are never
index-resolved and are exempt from CC-PIP-002/005.

## Maven

Inputs: `pom.xml` (dependencies, `<repositories>`, `<pluginRepositories>`,
parent groupId, `${project.groupId}` self-references) and `settings.xml`
(searched in the project directory, its `.mvn/`, then the scan root; mirrors
plus repositories from active profiles). Mirror matching implements Maven's
DefaultMirrorSelector semantics: `*`, `external:*`, `external:http:*`, comma
lists and `!repo` exclusions. Patterns match `groupId` or `groupId:artifactId`.

| ID | Severity | Fires when |
|---|---|---|
| CC-MVN-001 | critical | An internal-pattern dependency is resolvable from an effectively-public repository (after applying all mirrors, a release-enabled repo remains public). |
| CC-MVN-002 | high | `<repositories>` is declared in the POM — per-project routing outside settings.xml / repository-manager control. |
| CC-MVN-003 | medium | Internal groupIds are present and no mirror captures `central` — Maven Central is consulted directly. |
| CC-MVN-004 | medium | A repository or mirror URL uses plain `http:` to a non-loopback host. |
| CC-MVN-005 | medium | Snapshot resolution is enabled against an effectively-public repository. |
| CC-MVN-006 | high | `<pluginRepositories>` is declared in the POM — build plugins (code that runs on the build machine) fetched outside managed routing. |

Notes: `central` is modeled with the super-POM defaults (releases on,
snapshots off). Repositories declared in the POM default both policies to
enabled, exactly as Maven does.

## What claimcheck cannot see statically

- A private repository manager whose *virtual* repo merges the public
  registry server-side is indistinguishable from an isolated private host.
  Declare such hosts in `publicRegistries` so the audit treats names routed
  there as publicly resolvable.
- User-level config outside the repository (`~/.npmrc`, `~/.pip/pip.conf`,
  `~/.m2/settings.xml`) is not read: claimcheck audits what the repo ships,
  which is exactly what a fresh CI runner or a new laptop would get.
- Whether a name is *actually registered* on a public registry — that would
  require probing. claimcheck flags that the resolution path exists at all.
