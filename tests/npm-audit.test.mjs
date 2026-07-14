// npm auditor rules, driven with in-memory inputs. Each test names the rule
// it pins and, more importantly, the *negative* space around it — the
// configurations that must NOT fire, because a confusion audit that cries
// wolf gets ignored faster than one that misses.
import assert from "node:assert/strict";
import { test } from "node:test";
import { auditNpm, parseLockfile, parseNpmrc } from "../dist/index.js";
import { byRule, config } from "./helpers.mjs";

const cfg = (over = {}) => config({ internal: ["@acme/*", "acme-*"], ...over });

function run({ pkg, npmrc, lock, conf }) {
  const npmrcs = npmrc !== undefined ? [parseNpmrc(npmrc, ".npmrc")] : [];
  return auditNpm(
    {
      packageJsonPath: "package.json",
      packageJson: pkg,
      npmrcs,
      ...(lock !== undefined
        ? { lockfile: { path: "package-lock.json", entries: parseLockfile(lock) } }
        : {}),
    },
    conf ?? cfg(),
  );
}

test("CC-NPM-001: internal name routed to public registry (npm's built-in default); devDependencies count too", () => {
  const findings = run({ pkg: { name: "app", dependencies: { "acme-metrics": "^1.0.0" } } });
  const hits = byRule(findings, "CC-NPM-001");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].package, "acme-metrics");
  assert.equal(hits[0].severity, "critical");
  assert.match(hits[0].message, /registry\.npmjs\.org/);
  // CI installs devDependencies with the same resolver — same exposure.
  const dev = run({ pkg: { name: "app", devDependencies: { "acme-testkit": "^1.0.0" } } });
  assert.equal(byRule(dev, "CC-NPM-001").length, 1);
});

test("CC-NPM-001 does not fire when the default registry is private", () => {
  const findings = run({
    pkg: { name: "app", dependencies: { "acme-metrics": "^1.0.0" } },
    npmrc: "registry=https://npm.example.test/\n",
  });
  assert.equal(byRule(findings, "CC-NPM-001").length, 0);
});

test("CC-NPM-001 fires for a scoped internal package whose scope is unmapped on a public default", () => {
  const findings = run({
    pkg: { name: "app", dependencies: { "@acme/logger": "^1.0.0" } },
    npmrc: "registry=https://registry.npmjs.org/\n",
  });
  assert.equal(byRule(findings, "CC-NPM-001").length, 1);
  // ...and CC-NPM-003 stays quiet: 001 already names the exposure.
  assert.equal(byRule(findings, "CC-NPM-003").length, 0);
});

test("CC-NPM-002: unscoped internal names are structurally claimable even when routed privately", () => {
  const findings = run({
    pkg: { name: "app", dependencies: { "acme-metrics": "^1.0.0" } },
    npmrc: "registry=https://npm.example.test/\n",
  });
  const hits = byRule(findings, "CC-NPM-002");
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /claimable/);
});

test("CC-NPM-003: scoped internal with private default but no explicit scope mapping", () => {
  const findings = run({
    pkg: { name: "app", dependencies: { "@acme/logger": "^1.0.0" } },
    npmrc: "registry=https://npm.example.test/\n",
  });
  const hits = byRule(findings, "CC-NPM-003");
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /@acme/);
});

test("a fully mapped scope on a private registry (with a lockfile) produces zero findings", () => {
  const findings = run({
    pkg: { name: "app", dependencies: { "@acme/logger": "^1.0.0" } },
    npmrc: "registry=https://npm.example.test/\n@acme:registry=https://npm.example.test/\n",
    lock: {
      lockfileVersion: 3,
      packages: {
        "": { name: "app" },
        "node_modules/@acme/logger": {
          version: "1.0.0",
          resolved: "https://npm.example.test/@acme/logger/-/logger-1.0.0.tgz",
        },
      },
    },
  });
  assert.deepEqual(findings, []);
});

test("non-internal deps and file:/git:/workspace: specs never trigger internal-name rules", () => {
  const external = run({
    pkg: { name: "app", dependencies: { "left-fill": "^1.0.0", "@other/kit": "^2.0.0" } },
  });
  assert.deepEqual(external, []);
  // Non-registry specs never resolve via a registry, internal-looking or not.
  const nonRegistry = run({
    pkg: {
      name: "app",
      dependencies: {
        "acme-local": "file:../acme-local",
        "acme-git": "git+ssh://git@example.test/acme-git.git",
        "acme-ws": "workspace:*",
      },
    },
  });
  assert.deepEqual(nonRegistry, []);
});

test("CC-NPM-004: lockfile proves a public resolution of an internal name", () => {
  const findings = run({
    pkg: { name: "app", dependencies: { "acme-metrics": "^1.0.0" } },
    npmrc: "registry=https://npm.example.test/\n",
    lock: {
      lockfileVersion: 3,
      packages: {
        "": { name: "app" },
        "node_modules/acme-metrics": {
          version: "1.0.0",
          resolved: "https://registry.npmjs.org/acme-metrics/-/acme-metrics-1.0.0.tgz",
        },
      },
    },
  });
  const hits = byRule(findings, "CC-NPM-004");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].file, "package-lock.json");
  assert.equal(hits[0].severity, "critical");
});

test("CC-NPM-005: plain-http registry URL cited at its .npmrc line", () => {
  const findings = run({
    pkg: { name: "app" },
    npmrc: "# corp\nregistry=http://npm.example.test/\n",
  });
  const hits = byRule(findings, "CC-NPM-005");
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /line 2/);
  assert.equal(hits[0].file, ".npmrc");
});

test("CC-NPM-006: internal dependencies without any lockfile", () => {
  const withLock = run({
    pkg: { name: "app", dependencies: { "acme-metrics": "^1.0.0" } },
    npmrc: "registry=https://npm.example.test/\n",
    lock: { lockfileVersion: 3, packages: { "": {} } },
  });
  assert.equal(byRule(withLock, "CC-NPM-006").length, 0);
  const withoutLock = run({
    pkg: { name: "app", dependencies: { "acme-metrics": "^1.0.0" } },
    npmrc: "registry=https://npm.example.test/\n",
  });
  assert.equal(byRule(withoutLock, "CC-NPM-006").length, 1);
});

test("CC-NPM-007: internal-named package with no publish guard; private:true silences it", () => {
  const exposed = run({ pkg: { name: "acme-api", version: "1.0.0" } });
  assert.equal(byRule(exposed, "CC-NPM-007").length, 1);
  const guarded = run({ pkg: { name: "acme-api", version: "1.0.0", private: true } });
  assert.equal(byRule(guarded, "CC-NPM-007").length, 0);
  const pinned = run({
    pkg: { name: "acme-api", publishConfig: { registry: "https://npm.example.test/" } },
  });
  assert.equal(byRule(pinned, "CC-NPM-007").length, 0);
});

test("CC-NPM-008: privately-resolved name outside the pattern list that now routes publicly", () => {
  const lock = {
    lockfileVersion: 3,
    packages: {
      "": { name: "app" },
      "node_modules/flight-deck": {
        version: "1.0.0",
        resolved: "https://npm.example.test/flight-deck/-/flight-deck-1.0.0.tgz",
      },
    },
  };
  // No .npmrc: flight-deck's current routing is public npmjs.org -> coverage gap.
  const gap = run({ pkg: { name: "app" }, lock });
  assert.equal(byRule(gap, "CC-NPM-008").length, 1);
  // With the private default registry restored, the same lockfile is quiet.
  const routed = run({ pkg: { name: "app" }, npmrc: "registry=https://npm.example.test/\n", lock });
  assert.equal(byRule(routed, "CC-NPM-008").length, 0);
});

test("parseLockfile flattens v1 nested dependencies and nested v3 paths", () => {
  const v1 = parseLockfile({
    lockfileVersion: 1,
    dependencies: {
      a: { version: "1.0.0", resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz",
        dependencies: { b: { version: "2.0.0", resolved: "https://npm.example.test/b/-/b-2.0.0.tgz" } } },
    },
  });
  assert.deepEqual(v1.map((e) => e.name).sort(), ["a", "b"]);
  const v3 = parseLockfile({
    lockfileVersion: 3,
    packages: {
      "": {},
      "node_modules/a": { resolved: "https://registry.npmjs.org/a/-/a-1.0.0.tgz" },
      "node_modules/a/node_modules/@s/b": { resolved: "https://npm.example.test/@s/b/-/b-1.0.0.tgz" },
    },
  });
  assert.deepEqual(v3.map((e) => e.name).sort(), ["@s/b", "a"]);
});
