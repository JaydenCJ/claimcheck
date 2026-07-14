#!/usr/bin/env bash
# Smoke test for claimcheck: exercises the real CLI end to end against the
# bundled example projects and a freshly seeded temp project. No network,
# idempotent, runs from a clean checkout (after `npm install`).
# Prints "SMOKE OK" on success.
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."
ROOT="$(pwd)"

WORKDIR="$(mktemp -d)"
trap 'rm -rf "$WORKDIR"' EXIT

fail() {
  echo "SMOKE FAIL: $1" >&2
  exit 1
}

# 1. Build (idempotent).
npm run build >/dev/null 2>&1 || fail "npm run build failed"
CLI="node $ROOT/dist/cli.js"
echo "[smoke] build ok"

# 2. --version matches package.json; --help documents the surface.
PKG_VERSION="$(node -p "require('$ROOT/package.json').version")"
CLI_VERSION="$($CLI --version)"
[ "$CLI_VERSION" = "$PKG_VERSION" ] || fail "--version mismatch: $CLI_VERSION != $PKG_VERSION"
HELP="$($CLI --help)"
for word in scan rules explain init --fail-on --format --ecosystems "exit codes"; do
  echo "$HELP" | grep -q -- "$word" || fail "--help missing $word"
done
echo "[smoke] --help/--version ok ($CLI_VERSION)"

# 3. Usage, input and config errors exit 2 (distinct from findings' exit 1).
set +e
$CLI --frobnicate >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "unknown flag should exit 2"; }
$CLI scan "$WORKDIR/does-not-exist" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "missing dir should exit 2"; }
$CLI scan . --format yaml >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "bad --format should exit 2"; }
echo '{"internel": []}' > "$WORKDIR/claimcheck.json"
$CLI scan "$WORKDIR" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "config typo should exit 2"; }
set -e
rm -f "$WORKDIR/claimcheck.json"
echo "[smoke] error handling ok (exit 2)"

# 4. The vulnerable npm example trips the classic confusion rules.
set +e
NPM_OUT="$($CLI scan examples/vulnerable-npm)"; NPM_CODE=$?
set -e
[ "$NPM_CODE" -eq 1 ] || fail "vulnerable-npm should exit 1, got $NPM_CODE"
echo "$NPM_OUT" | grep -q 'CC-NPM-001  kestrel-metrics' || fail "npm: public routing finding missing"
echo "$NPM_OUT" | grep -q 'CC-NPM-004  kestrel-metrics' || fail "npm: lockfile evidence finding missing"
echo "$NPM_OUT" | grep -q 'CC-NPM-008  flightdeck' || fail "npm: pattern-gap finding missing"
echo "$NPM_OUT" | grep -q '8 findings: 4 critical, 2 high, 1 medium, 1 low' || fail "npm: summary wrong"
echo "$NPM_OUT" | grep -q 'claimcheck: FAIL' || fail "npm: verdict wrong"
echo "[smoke] vulnerable-npm ok (exit 1)"

# 5. The vulnerable pip example surfaces the Birsan vector itself.
set +e
PIP_OUT="$($CLI scan examples/vulnerable-pip)"; PIP_CODE=$?
set -e
[ "$PIP_CODE" -eq 1 ] || fail "vulnerable-pip should exit 1, got $PIP_CODE"
echo "$PIP_OUT" | grep -q 'CC-PIP-001' || fail "pip: extra-index-url finding missing"
echo "$PIP_OUT" | grep -q 'CC-PIP-002  kestrel-billing' || fail "pip: internal-on-public finding missing"
echo "$PIP_OUT" | grep -q 'CC-PIP-004' || fail "pip: trusted-host finding missing"
echo "$PIP_OUT" | grep -q '6 findings: 1 critical, 2 high, 3 medium, 0 low' || fail "pip: summary wrong"
echo "[smoke] vulnerable-pip ok (exit 1)"

# 6. The vulnerable Maven example: unmirrored central + per-POM repositories.
set +e
MVN_OUT="$($CLI scan examples/vulnerable-maven)"; MVN_CODE=$?
set -e
[ "$MVN_CODE" -eq 1 ] || fail "vulnerable-maven should exit 1, got $MVN_CODE"
echo "$MVN_OUT" | grep -q 'CC-MVN-001  com.kestrel:kestrel-core' || fail "maven: public-resolvable finding missing"
echo "$MVN_OUT" | grep -q 'CC-MVN-002' || fail "maven: pom repositories finding missing"
echo "$MVN_OUT" | grep -q 'CC-MVN-006' || fail "maven: plugin repositories finding missing"
echo "$MVN_OUT" | grep -q '8 findings: 2 critical, 3 high, 3 medium, 0 low' || fail "maven: summary wrong"
echo "[smoke] vulnerable-maven ok (exit 1)"

# 7. The hardened example is silent across all three ecosystems.
HARD_OUT="$($CLI scan examples/hardened)" || fail "hardened should exit 0"
echo "$HARD_OUT" | grep -q '1 npm, 1 pip, 1 maven' || fail "hardened: project counts wrong"
echo "$HARD_OUT" | grep -q '0 findings' || fail "hardened: should have no findings"
echo "$HARD_OUT" | grep -q 'claimcheck: OK' || fail "hardened: verdict wrong"
echo "[smoke] hardened ok (exit 0)"

# 8. JSON output is valid JSON with the stable shape.
set +e
JSON_OUT="$($CLI scan examples/vulnerable-npm --format json)"; JSON_CODE=$?
set -e
[ "$JSON_CODE" -eq 1 ] || fail "json run should still exit 1"
echo "$JSON_OUT" | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{const j=JSON.parse(s);if(j.ok!==false||j.summary.total!==8||j.findings.length!==8)throw new Error('bad shape')})" \
  || fail "--format json shape wrong"
echo "[smoke] JSON output ok"

# 9. rules / explain: the catalogue is queryable offline.
$CLI rules | grep -q 'CC-MVN-006' || fail "rules listing incomplete"
[ "$($CLI rules | grep -c 'CC-[A-Z]*-[0-9]')" -eq 19 ] || fail "rules should list 19 rules"
$CLI explain CC-PIP-001 | grep -q 'why it matters:' || fail "explain output wrong"
echo "[smoke] rules/explain ok"

# 10. Full init -> scan loop on a fresh temp project: infer, then audit.
mkdir -p "$WORKDIR/app"
cat > "$WORKDIR/app/package.json" <<'EOF'
{ "name": "app", "dependencies": { "acme-kit": "^1.0.0" } }
EOF
cat > "$WORKDIR/app/package-lock.json" <<'EOF'
{ "lockfileVersion": 3, "packages": { "": {},
  "node_modules/acme-kit": { "resolved": "https://npm.example.test/acme-kit/-/acme-kit-1.0.0.tgz" } } }
EOF
$CLI init "$WORKDIR/app" | grep -q '1 inferred internal pattern' || fail "init inference wrong"
set +e
$CLI init "$WORKDIR/app" >/dev/null 2>&1; [ $? -eq 2 ] || { set -e; fail "re-init without --force should exit 2"; }
LOOP_OUT="$($CLI scan "$WORKDIR/app")"; LOOP_CODE=$?
set -e
[ "$LOOP_CODE" -eq 1 ] || fail "post-init scan should exit 1"
echo "$LOOP_OUT" | grep -q 'CC-NPM-001  acme-kit' || fail "post-init scan missing the routing finding"
# Fix the routing the way the finding says to, and the scan goes green.
printf 'registry=https://npm.example.test/\n' > "$WORKDIR/app/.npmrc"
echo '{"internal": ["acme-kit"], "ignore": ["CC-NPM-002:acme-kit"]}' > "$WORKDIR/app/claimcheck.json"
$CLI scan "$WORKDIR/app" -q | grep -q 'claimcheck: OK' || fail "hardened temp project should pass"
echo "[smoke] init -> scan -> fix loop ok"

# 11. Determinism: repeat runs over the same tree are byte-identical.
$CLI scan examples/vulnerable-maven > "$WORKDIR/run1.txt" 2>/dev/null || true
$CLI scan examples/vulnerable-maven > "$WORKDIR/run2.txt" 2>/dev/null || true
cmp -s "$WORKDIR/run1.txt" "$WORKDIR/run2.txt" || fail "repeat runs differ"
echo "[smoke] determinism ok"

echo "SMOKE OK"
