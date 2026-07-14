// Directory scanning end to end (via the library API, real temp trees):
// discovery, the monorepo .npmrc chain, -r include following, suppressions,
// thresholds and the deterministic ordering the renderers rely on.
import assert from "node:assert/strict";
import { test } from "node:test";
import { scan, inferInternalPatterns } from "../dist/index.js";
import { byRule, config, makeTempDir, rmTree, writeTree } from "./helpers.mjs";

function tmp(t, spec) {
  const dir = makeTempDir();
  t.after(() => rmTree(dir));
  return writeTree(dir, spec);
}

test("discovers npm, pip and maven projects across a monorepo tree", (t) => {
  const dir = tmp(t, {
    "services/api/package.json": { name: "api" },
    "services/worker/requirements.txt": "alpha==1.0\n",
    "lib/core/pom.xml": "<project><groupId>org.example</groupId><artifactId>core</artifactId></project>",
  });
  const result = scan(dir, config());
  assert.deepEqual(
    result.projects.map((p) => [p.ecosystem, p.dir]),
    [["npm", "services/api"], ["pip", "services/worker"], ["maven", "lib/core"]],
  );
  // The degenerate case: nothing to scan is a pass, not an error.
  const emptyDir = makeTempDir();
  t.after(() => rmTree(emptyDir));
  const empty = scan(emptyDir, config());
  assert.equal(empty.projects.length, 0);
  assert.equal(empty.ok, true);
});

test("node_modules, .git and friends are never scanned", (t) => {
  const dir = tmp(t, {
    "package.json": { name: "app" },
    "node_modules/acme-x/package.json": { name: "acme-x", dependencies: { "acme-y": "^1.0.0" } },
    ".git/pom.xml": "<project></project>",
  });
  const result = scan(dir, config({ internal: ["acme-*"] }));
  assert.equal(result.projects.length, 1);
  assert.equal(result.projects[0].dir, ".");
});

test("a subproject inherits the root .npmrc, but the nearest .npmrc wins over it", (t) => {
  const dir = tmp(t, {
    ".npmrc": "registry=https://npm.example.test/\n",
    "packages/api/package.json": { name: "api", dependencies: { "acme-kit": "^1.0.0" } },
  });
  const inherited = scan(dir, config({ internal: ["acme-*"] }));
  assert.equal(byRule(inherited.findings, "CC-NPM-001").length, 0);
  // ...while the structural unscoped-name rule still fires.
  assert.equal(byRule(inherited.findings, "CC-NPM-002").length, 1);

  const shadowed = tmp(t, {
    ".npmrc": "registry=https://npm.example.test/\n",
    "packages/api/.npmrc": "registry=https://registry.npmjs.org/\n",
    "packages/api/package.json": { name: "api", dependencies: { "acme-kit": "^1.0.0" } },
  });
  const result = scan(shadowed, config({ internal: ["acme-*"] }));
  assert.equal(byRule(result.findings, "CC-NPM-001").length, 1);
});

test("-r includes are followed relative to the including file, cycles and misses handled", (t) => {
  const dir = tmp(t, {
    "requirements.txt": "-r shared/base.txt\nacme-app==1.0\n",
    "shared/base.txt": "-r base.txt\n--extra-index-url https://pypi.example.test/simple\n",
    "requirements-dev.txt": "-r missing.txt\n",
  });
  const result = scan(dir, config({ internal: ["acme-*"] }));
  // The extra index inside the included file is found...
  assert.equal(byRule(result.findings, "CC-PIP-001").length, 1);
  assert.equal(byRule(result.findings, "CC-PIP-001")[0].file, "shared/base.txt");
  // ...and the missing include is a warning, not a crash.
  assert.equal(result.errors.length, 1);
  assert.match(result.errors[0].message, /not found/);
});

test("malformed manifests become warnings; the rest of the scan proceeds", (t) => {
  const dir = tmp(t, {
    "broken/package.json": "{ not json",
    "broken/pom.xml": "<project><unclosed></project>",
    "ok/package.json": { name: "app", dependencies: { "acme-kit": "^1.0.0" } },
  });
  const result = scan(dir, config({ internal: ["acme-*"] }));
  assert.equal(result.errors.length, 2);
  assert.equal(byRule(result.findings, "CC-NPM-001").length, 1);
});

test("ignore suppresses findings and counts them in the summary", (t) => {
  const dir = tmp(t, {
    "package.json": { name: "app", dependencies: { "acme-kit": "^1.0.0" } },
  });
  const noisy = scan(dir, config({ internal: ["acme-*"] }));
  assert.equal(noisy.summary.total, 3); // 001 + 002 + 006 (no lockfile)
  const quiet = scan(dir, config({ internal: ["acme-*"], ignore: ["CC-NPM-006", "CC-NPM-002:acme-kit"] }));
  assert.equal(quiet.summary.total, 1);
  assert.equal(quiet.summary.ignored, 2);
});

test("failOn threshold: medium-only findings pass a high threshold", (t) => {
  const dir = tmp(t, {
    ".npmrc": "registry=http://npm.example.test/\n",
    "package.json": { name: "app" },
  });
  const strict = scan(dir, config({ failOn: "low" }));
  assert.equal(strict.ok, false); // CC-NPM-005 (medium) >= low
  const lenient = scan(dir, config({ failOn: "high" }));
  assert.equal(lenient.ok, true);
  assert.equal(lenient.summary.total, 1); // still reported, just not fatal
});

test("ecosystems filter limits both discovery and findings", (t) => {
  const dir = tmp(t, {
    "package.json": { name: "app", dependencies: { "acme-kit": "^1.0.0" } },
    "requirements.txt": "acme-kit==1.0\n",
  });
  const result = scan(dir, config({ internal: ["acme-*"], ecosystems: ["pip"] }));
  assert.deepEqual(result.projects.map((p) => p.ecosystem), ["pip"]);
  assert.ok(result.findings.every((f) => f.ecosystem === "pip"));
});

test("findings are deterministically ordered: ecosystem, then severity, then id/file/package", (t) => {
  const spec = {
    "package.json": { name: "acme-app", dependencies: { "acme-kit": "^1.0.0" } },
    "requirements.txt": "--extra-index-url https://pypi.example.test/simple\nacme-kit>=1\n",
    "pom.xml": "<project><groupId>com.acme</groupId><artifactId>app</artifactId></project>",
  };
  const dir = tmp(t, spec);
  const cfgObj = config({ internal: ["acme-*", "com.acme", "com.acme.*"] });
  const a = scan(dir, cfgObj);
  const b = scan(dir, cfgObj);
  assert.deepEqual(a.findings, b.findings);
  const ecoOrder = a.findings.map((f) => f.ecosystem);
  assert.deepEqual(ecoOrder, [...ecoOrder].sort((x, y) => ["npm", "pip", "maven"].indexOf(x) - ["npm", "pip", "maven"].indexOf(y)));
  const npmSevs = a.findings.filter((f) => f.ecosystem === "npm").map((f) => f.severity);
  const rank = { critical: 4, high: 3, medium: 2, low: 1 };
  assert.deepEqual(npmSevs, [...npmSevs].sort((x, y) => rank[y] - rank[x]));
});

test("inferInternalPatterns: scopes from .npmrc, private lockfile names, pom groupIds", (t) => {
  const dir = tmp(t, {
    ".npmrc": "@acme:registry=https://npm.example.test/\n",
    "package.json": { name: "app" },
    "package-lock.json": {
      lockfileVersion: 3,
      packages: {
        "": {},
        "node_modules/acme-kit": { resolved: "https://npm.example.test/acme-kit/-/acme-kit-1.0.0.tgz" },
        "node_modules/public-kit": { resolved: "https://registry.npmjs.org/public-kit/-/public-kit-1.0.0.tgz" },
      },
    },
    "pom.xml": "<project><groupId>com.acme</groupId><artifactId>app</artifactId></project>",
  });
  assert.deepEqual(inferInternalPatterns(dir), ["@acme/*", "acme-kit", "com.acme", "com.acme.*"]);
});

