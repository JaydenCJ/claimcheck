# Changelog

All notable changes to this project are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-07-13

### Added

- `claimcheck scan`: static, fully offline dependency-confusion audit for
  npm, pip and Maven resolver configurations, with exit codes 0 (clean) /
  1 (findings) / 2 (usage or config error) and monorepo-aware discovery
  (junk directories skipped, nested projects found).
- npm auditor: effective-registry resolution across the `.npmrc` chain
  (nearest-wins, scope mapping over default over npm's built-in), lockfile
  evidence checks (v1/v2/v3), publish-guard and pattern-coverage checks —
  rules CC-NPM-001..008.
- pip auditor: full requirements-file grammar (continuations, comments,
  extras, markers, hashes, `-r`/`-c` includes, direct URLs) plus
  `pip.conf`/`pip.ini`, with PEP 503 name normalization; flags the
  `--extra-index-url` merge vector itself — rules CC-PIP-001..005.
- Maven auditor: pom.xml + settings.xml models with Maven's
  DefaultMirrorSelector semantics (`*`, `external:*`, `external:http:*`,
  comma lists, `!` exclusions), effective-repository computation, per-POM
  repository and plugin-repository checks — rules CC-MVN-001..006.
- Registry classification with a curated public-host list, private-by-default
  for unknown hosts, loopback/file exemptions, and `publicRegistries` /
  `privateRegistries` config overrides for virtual (merging) proxies.
- `claimcheck.json` configuration: internal-name glob patterns, registry
  overrides, per-rule and per-package `ignore` suppressions, `failOn`
  severity threshold, ecosystem selection; every unknown key rejected loudly.
- `claimcheck init`: infers starter internal patterns from `.npmrc` scopes,
  privately-resolved lockfile names and POM groupIds.
- `claimcheck rules` and `claimcheck explain <id>`: the 19-rule catalogue is
  queryable offline, with why/fix prose per rule (also in `docs/rules.md`).
- `--format json` with a stable, additive-only shape; `--fail-on`,
  `--ecosystems`, `--config`, `--quiet` flags; byte-deterministic text reports.
- Public programmatic API (parsers, classifiers, the three auditors, `scan`,
  renderers) with type declarations; in-repo minimal XML and INI parsers keep
  runtime dependencies at zero.
- Four bundled example projects (vulnerable npm / pip / Maven, plus a
  hardened trio) used by the docs and the smoke test.
- Test suite: 88 node:test tests (unit + CLI integration in fresh temp dirs)
  and an end-to-end `scripts/smoke.sh` against the bundled examples.

[0.1.0]: https://github.com/JaydenCJ/claimcheck/releases/tag/v0.1.0
