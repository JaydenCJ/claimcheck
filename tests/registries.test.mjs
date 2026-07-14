// Registry classification decides "claimable by an attacker" vs "yours", so
// each branch is pinned: the built-in public list, the private-by-default
// stance for unknown hosts, loopback/file exemptions and config overrides.
import assert from "node:assert/strict";
import { test } from "node:test";
import { classifyRegistry } from "../dist/index.js";

test("the big three public registries classify as public", () => {
  assert.equal(classifyRegistry("https://registry.npmjs.org/").kind, "public");
  assert.equal(classifyRegistry("https://pypi.org/simple").kind, "public");
  assert.equal(classifyRegistry("https://repo.maven.apache.org/maven2").kind, "public");
});

test("unknown hosts default to private, and public detection is exact-host, never substring", () => {
  const cls = classifyRegistry("https://npm.example.test/registry/");
  assert.equal(cls.kind, "private");
  assert.equal(cls.host, "npm.example.test");
  // A lookalike host embedding the public name must NOT count as public.
  assert.equal(classifyRegistry("https://registry.npmjs.org.evil.test/").kind, "private");
});

test("loopback and file URLs are local and exempt from insecure-transport flags", () => {
  assert.equal(classifyRegistry("http://127.0.0.1:4873/").kind, "local");
  assert.equal(classifyRegistry("http://127.0.0.1:4873/").insecure, false);
  assert.equal(classifyRegistry("http://localhost:8081/repository/").kind, "local");
  assert.equal(classifyRegistry("file:///srv/repo").kind, "local");
});

test("plain http to a remote host is insecure regardless of kind", () => {
  assert.equal(classifyRegistry("http://npm.example.test/").insecure, true);
  assert.equal(classifyRegistry("http://registry.npmjs.org/").insecure, true);
  assert.equal(classifyRegistry("https://npm.example.test/").insecure, false);
});

test("config overrides: publicRegistries and privateRegistries win, by host (incl. subdomains) or URL prefix", () => {
  const pub = { publicRegistries: ["npm.example.test"], privateRegistries: [] };
  assert.equal(classifyRegistry("https://npm.example.test/virtual/", pub).kind, "public");
  const sub = { publicRegistries: ["example.test"], privateRegistries: [] };
  assert.equal(classifyRegistry("https://npm.eu.example.test/", sub).kind, "public");
  const priv = { publicRegistries: [], privateRegistries: ["https://mirror.example.test/npmjs"] };
  assert.equal(classifyRegistry("https://mirror.example.test/npmjs/pkg.tgz", priv).kind, "private");
});

test("non-registry specs return null instead of guessing", () => {
  assert.equal(classifyRegistry("not a url"), null);
  assert.equal(classifyRegistry("git+ssh://git@example.test/repo.git"), null);
  // .npmrc values with unexpanded ${VARS} must not be classified.
  assert.equal(classifyRegistry("https://${REGISTRY_HOST}/npm/"), null);
});
