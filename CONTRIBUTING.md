# Contributing to claimcheck

Issues, discussions and pull requests are all welcome — this project aims to
stay small, zero-dependency at runtime, and honest about what static analysis
can and cannot see.

## Getting started

Requirements: Node.js >= 22.13 (for the stable `node:test` runner used by the suite).

```bash
git clone https://github.com/JaydenCJ/claimcheck.git
cd claimcheck
npm install            # installs typescript, the only devDependency
npm run build          # compile TypeScript to dist/
npm test               # build + 88 node:test tests
bash scripts/smoke.sh  # end-to-end CLI check against examples/
```

`scripts/smoke.sh` exercises the real CLI (all four example projects, exit
codes, JSON output, rules/explain, the init → scan → fix loop, determinism)
and must print `SMOKE OK`.

## Before you open a pull request

1. `npx tsc -p tsconfig.json --noEmit` — the tree must type-check clean (strict mode is enforced).
2. `npm test` — all tests must pass.
3. `bash scripts/smoke.sh` — must print `SMOKE OK`.
4. Add tests for behavior changes; keep logic in pure, unit-testable modules
   (parsers, classification and the three auditors all take values — only
   `scan.ts` reads the filesystem and only `cli.ts` touches process state).
5. Anything that changes when a rule fires needs an update to `docs/rules.md`
   in the same PR — the detection conditions and their documentation must
   never drift apart.

## Ground rules

- **No runtime dependencies.** A supply-chain audit tool with a supply chain
  of its own would be a punchline; adding one needs justification in the PR
  and will usually be declined.
- No network calls, ever — claimcheck reads config files and prints. It never
  probes a registry; that is the entire point of the tool.
- Determinism is a feature: identical trees must produce byte-identical
  output. No timestamps, no unsorted maps, no locale-dependent formatting.
- False positives are bugs too. Every rule needs "negative space" tests
  proving hardened configurations stay quiet.
- Rule IDs, the JSON output shape and exit codes (0/1/2) are stable API;
  fields are only ever added, never renamed or removed.
- Code comments and doc comments are written in English.

## Reporting bugs

Please include: `claimcheck --version` output, the exact command line, and a
minimal config file set (package.json + .npmrc, requirements.txt, or
pom.xml + settings.xml) that reproduces the problem. If a rule fires where
you believe it should not — or stays quiet where it should fire — say which
registry you expected the name to resolve from; `claimcheck explain <id>`
states each rule's exact claim.

## Security

Do not open public issues for security problems; use GitHub private
vulnerability reporting on this repository instead.
