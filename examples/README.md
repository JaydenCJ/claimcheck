# claimcheck examples

Four self-contained projects for a fictional org ("Kestrel", private registry
hosts under `*.kestrel.test`). Each directory carries its own
`claimcheck.json`, so you can point the CLI straight at it:

```bash
claimcheck scan examples/vulnerable-npm     # exit 1 — 8 findings
claimcheck scan examples/vulnerable-pip     # exit 1 — 6 findings
claimcheck scan examples/vulnerable-maven   # exit 1 — 8 findings
claimcheck scan examples/hardened           # exit 0 — clean, all 3 ecosystems
```

## vulnerable-npm

Every classic npm mistake in one manifest: unscoped internal packages
(`kestrel-auth`, `kestrel-metrics`) on a public default registry, an unmapped
`@kestrel` scope, a lockfile that *proves* one internal package already
resolved from npmjs.org, no publish guard on the internal-named root package,
and a privately-resolved package (`flightdeck`) the pattern list misses.

## vulnerable-pip

The original Birsan setup: public PyPI as `--index-url`, the private index
bolted on via `--extra-index-url` (over plain http, with `--trusted-host`),
plus an unpinned internal requirement. pip pools both indexes and installs
the best version — a public `kestrel-billing 99.0` wins instantly.

## vulnerable-maven

No `settings.xml` (so Maven Central is consulted directly for the
`com.kestrel` artifacts), per-POM `<repositories>` including a public repo
with snapshots enabled, a plain-http internal repo, and `<pluginRepositories>`
fetching build plugins outside managed routing.

## hardened

The same service with the fixes applied: scoped npm packages with a pinned
`@kestrel:registry` and a private default registry; one private https pip
index (the repository manager merges public PyPI server-side) with exact
pins; a settings.xml blanket mirror (`<mirrorOf>*</mirrorOf>`) routing every
Maven request through the internal repository manager. Zero findings.
