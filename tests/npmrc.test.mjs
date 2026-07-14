// .npmrc parsing + npm's registry-resolution order. The chain semantics
// (project file wins over ancestor files, scope mapping wins over default,
// built-in npmjs.org default last) are exactly what decides whether an
// internal name routes publicly, so they are pinned here in isolation.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseNpmrc, effectiveRegistry, scopeMapped, scopeOf, DEFAULT_NPM_REGISTRY } from "../dist/index.js";

test("parses default registry and scope mappings with line numbers", () => {
  const rc = parseNpmrc(
    "# corp config\nregistry=https://npm.example.test/\n@acme:registry=https://npm.example.test/\n",
    ".npmrc",
  );
  assert.equal(rc.registry.url, "https://npm.example.test/");
  assert.equal(rc.registry.line, 2);
  assert.equal(rc.scopes.get("@acme").url, "https://npm.example.test/");
  assert.equal(rc.registryUrls.length, 2);
});

test("non-registry keys (auth tokens, flags) are not misread; scopeOf splits names correctly", () => {
  const rc = parseNpmrc(
    "//npm.example.test/:_authToken=abc123\nalways-auth=true\nsave-exact=true\n",
    ".npmrc",
  );
  assert.equal(rc.registry, undefined);
  assert.equal(rc.scopes.size, 0);
  assert.equal(rc.registryUrls.length, 0);
  assert.equal(scopeOf("@acme/logger"), "@acme");
  assert.equal(scopeOf("logger"), null);
  assert.equal(scopeOf("@broken"), null);
});

test("resolution order: scope mapping beats default registry; no config at all means public npmjs.org", () => {
  const rc = parseNpmrc(
    "registry=https://npm.example.test/\n@acme:registry=https://scoped.example.test/\n",
    ".npmrc",
  );
  assert.equal(effectiveRegistry("@acme/logger", [rc]).url, "https://scoped.example.test/");
  assert.equal(effectiveRegistry("plain-pkg", [rc]).url, "https://npm.example.test/");
  // The empty chain is the whole exposure story: npm falls back to the public registry.
  const eff = effectiveRegistry("anything", []);
  assert.equal(eff.url, DEFAULT_NPM_REGISTRY);
  assert.equal(eff.defaulted, true);
});

test("nearest .npmrc in the chain wins, matching npm's project-over-user precedence", () => {
  const near = parseNpmrc("registry=https://near.example.test/\n", "packages/api/.npmrc");
  const far = parseNpmrc(
    "registry=https://far.example.test/\n@acme:registry=https://far-scope.example.test/\n",
    ".npmrc",
  );
  const eff = effectiveRegistry("plain-pkg", [near, far]);
  assert.equal(eff.url, "https://near.example.test/");
  assert.equal(eff.source.path, "packages/api/.npmrc");
  // The scope mapping only exists in the ancestor file — still honored.
  assert.equal(effectiveRegistry("@acme/logger", [near, far]).url, "https://far-scope.example.test/");
});

test("scopeMapped sees mappings anywhere in the chain", () => {
  const far = parseNpmrc("@acme:registry=https://npm.example.test/\n", ".npmrc");
  assert.equal(scopeMapped("@acme", [far]), true);
  assert.equal(scopeMapped("@other", [far]), false);
});
