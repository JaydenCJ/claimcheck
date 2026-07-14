// CLI integration: the compiled binary against the committed examples and
// fresh temp trees. Exit codes (0/1/2) are contract; so is the JSON shape.
import assert from "node:assert/strict";
import { test } from "node:test";
import fs from "node:fs";
import path from "node:path";
import { CLI, ROOT, makeTempDir, rmTree, runCli, writeTree } from "./helpers.mjs";

function tmp(t, spec) {
  const dir = makeTempDir();
  t.after(() => rmTree(dir));
  return writeTree(dir, spec);
}

test("--version matches package.json; --help documents commands, options and exit codes", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  const version = runCli(["--version"]);
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), pkg.version);
  const help = runCli(["--help"]);
  assert.equal(help.code, 0);
  for (const word of ["scan", "rules", "explain", "init", "--fail-on", "--format", "exit codes"]) {
    assert.ok(help.stdout.includes(word), `help is missing "${word}"`);
  }
});

test("usage and config errors exit 2: bad flags, missing dir, claimcheck.json typos", (t) => {
  assert.equal(runCli(["--frobnicate"]).code, 2);
  assert.equal(runCli(["scan", ".", "--format", "yaml"]).code, 2);
  assert.equal(runCli(["scan", ".", "--fail-on", "urgent"]).code, 2);
  // Stray positionals must be rejected, not silently treated as a scan dir.
  assert.equal(runCli(["explain", "CC-PIP-001", "stray"]).code, 2);
  assert.equal(runCli(["rules", "stray"]).code, 2);
  const missing = runCli(["scan", "/nonexistent-claimcheck-root"]);
  assert.equal(missing.code, 2);
  assert.match(missing.stderr, /does not exist/);
  // A typo in claimcheck.json must abort with the key named, not silently no-op.
  const dir = tmp(t, {
    "claimcheck.json": '{"internel": ["acme-*"]}',
    "package.json": { name: "app" },
  });
  const typo = runCli(["scan", dir]);
  assert.equal(typo.code, 2);
  assert.match(typo.stderr, /unknown key "internel"/);
});

test("vulnerable-npm example: exit 1 with the expected finding mix; --quiet keeps only the verdict", () => {
  const { stdout, code } = runCli(["scan", "examples/vulnerable-npm"], { cwd: ROOT });
  assert.equal(code, 1);
  assert.match(stdout, /8 findings: 4 critical, 2 high, 1 medium, 1 low/);
  assert.match(stdout, /CC-NPM-001 {2}kestrel-metrics/);
  assert.match(stdout, /claimcheck: FAIL/);
  const quiet = runCli(["scan", "examples/vulnerable-npm", "--quiet"], { cwd: ROOT });
  assert.equal(quiet.code, 1);
  assert.ok(!quiet.stdout.includes("CC-NPM-001"));
  assert.match(quiet.stdout, /8 findings/);
});

test("vulnerable-pip and vulnerable-maven examples both fail, with byte-identical repeat output", () => {
  const pip = runCli(["scan", "examples/vulnerable-pip"], { cwd: ROOT });
  assert.equal(pip.code, 1);
  assert.match(pip.stdout, /CC-PIP-001/);
  const maven = runCli(["scan", "examples/vulnerable-maven"], { cwd: ROOT });
  assert.equal(maven.code, 1);
  assert.match(maven.stdout, /CC-MVN-001 {2}com\.kestrel:kestrel-core/);
  const again = runCli(["scan", "examples/vulnerable-maven"], { cwd: ROOT });
  assert.equal(again.stdout, maven.stdout); // reports must diff cleanly in CI logs
});

test("hardened example: all three ecosystems scanned, zero findings, exit 0", () => {
  const { stdout, code } = runCli(["scan", "examples/hardened"], { cwd: ROOT });
  assert.equal(code, 0);
  assert.match(stdout, /1 npm, 1 pip, 1 maven/);
  assert.match(stdout, /0 findings/);
  assert.match(stdout, /claimcheck: OK/);
});

test("--format json emits the stable shape, exits 1 on findings; --fail-on still applies", () => {
  const { stdout, code } = runCli(["scan", "examples/vulnerable-npm", "--format", "json"], { cwd: ROOT });
  assert.equal(code, 1);
  const doc = JSON.parse(stdout);
  assert.equal(doc.claimcheck, "0.1.0");
  assert.equal(doc.ok, false);
  assert.equal(doc.summary.total, 8);
  assert.equal(doc.findings.length, 8);
  for (const f of doc.findings) {
    for (const key of ["id", "severity", "ecosystem", "file", "message", "remediation"]) {
      assert.ok(key in f, `finding missing ${key}`);
    }
  }
  const strict = runCli(["scan", "examples/vulnerable-npm", "--fail-on", "critical"], { cwd: ROOT });
  assert.equal(strict.code, 1); // criticals present, still fails at the raised bar
});

test("scan without internal patterns hints at claimcheck init on stderr", (t) => {
  const dir = tmp(t, { "package.json": { name: "app" } });
  const { stderr, code } = runCli(["scan", dir]);
  assert.equal(code, 0);
  assert.match(stderr, /no internal patterns configured/);
});

test("rules lists all 19 rules exactly once; explain prints why/fix and rejects unknown ids", () => {
  const rules = runCli(["rules"]);
  assert.equal(rules.code, 0);
  const ids = rules.stdout.match(/CC-[A-Z]+-\d{3}/g) ?? [];
  assert.equal(new Set(ids).size, 19);
  assert.equal(ids.length, 19);
  const explain = runCli(["explain", "cc-pip-001"]); // case-insensitive lookup
  assert.equal(explain.code, 0);
  assert.match(explain.stdout, /CC-PIP-001/);
  assert.match(explain.stdout, /why it matters:/);
  assert.match(explain.stdout, /how to fix it:/);
  assert.equal(runCli(["explain", "CC-XYZ-123"]).code, 2);
});

test("init writes a starter config with inferred patterns and refuses to overwrite", (t) => {
  const dir = tmp(t, {
    ".npmrc": "@acme:registry=https://npm.example.test/\n",
    "package.json": { name: "app" },
  });
  const first = runCli(["init", dir]);
  assert.equal(first.code, 0);
  const written = JSON.parse(fs.readFileSync(path.join(dir, "claimcheck.json"), "utf8"));
  assert.deepEqual(written.internal, ["@acme/*"]);
  assert.equal(written.failOn, "low");
  const second = runCli(["init", dir]);
  assert.equal(second.code, 2);
  assert.match(second.stderr, /--force/);
  assert.equal(runCli(["init", dir, "--force"]).code, 0);
});

test("the init->scan loop closes: inferred config turns a silent gap into findings", (t) => {
  const dir = tmp(t, {
    "package.json": { name: "app", dependencies: { "acme-kit": "^1.0.0" } },
    "package-lock.json": {
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/acme-kit": { resolved: "https://npm.example.test/acme-kit/-/acme-kit-1.0.0.tgz" },
      },
    },
  });
  assert.equal(runCli(["init", dir]).code, 0);
  const { stdout, code } = runCli(["scan", dir]);
  assert.equal(code, 1);
  assert.match(stdout, /CC-NPM-001 {2}acme-kit/);
});
