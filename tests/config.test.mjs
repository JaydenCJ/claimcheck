// claimcheck.json validation: every typo must be rejected loudly, because a
// silently dropped "internal" list means a silently useless audit.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseConfig, isIgnored, defaultConfig } from "../dist/index.js";

test("a full valid config parses with defaults filled in", () => {
  const cfg = parseConfig(
    JSON.stringify({
      internal: ["@acme/*"],
      privateRegistries: ["npm.example.test"],
      ignore: ["CC-NPM-005"],
      failOn: "high",
    }),
    "claimcheck.json",
  );
  assert.deepEqual(cfg.internal, ["@acme/*"]);
  assert.equal(cfg.failOn, "high");
  assert.deepEqual(cfg.ecosystems, ["npm", "pip", "maven"]);
  assert.equal(cfg.configPath, "claimcheck.json");
  // No config at all: fail on any finding, audit all three ecosystems.
  const dflt = defaultConfig();
  assert.equal(dflt.failOn, "low");
  assert.deepEqual(dflt.ecosystems, ["npm", "pip", "maven"]);
  assert.deepEqual(dflt.internal, []);
});

test("unknown keys are rejected with the key named", () => {
  assert.throws(() => parseConfig('{"internel": []}', "claimcheck.json"), /unknown key "internel"/);
});

test("wrong-typed values, malformed JSON and non-object documents are rejected", () => {
  assert.throws(() => parseConfig('{"internal": "acme-*"}', "c.json"), /array of non-empty strings/);
  assert.throws(() => parseConfig('{"internal": [""]}', "c.json"), /array of non-empty strings/);
  assert.throws(() => parseConfig('{"failOn": "urgent"}', "c.json"), /failOn/);
  assert.throws(() => parseConfig('{"ecosystems": ["npm", "cargo"]}', "c.json"), /"cargo"/);
  assert.throws(() => parseConfig("{", "c.json"), /not valid JSON/);
  assert.throws(() => parseConfig("[1,2]", "c.json"), /must be a JSON object/);
});

test("ignore entries must name real rules; the bad entry is quoted", () => {
  assert.throws(() => parseConfig('{"ignore": ["CC-NPM-999"]}', "c.json"), /CC-NPM-999/);
  assert.throws(() => parseConfig('{"ignore": ["CC-NPM-001:"]}', "c.json"), /empty package part/);
});

test("isIgnored: whole-rule and rule:package forms, case-insensitive rule ids", () => {
  assert.equal(isIgnored(["CC-NPM-005"], "CC-NPM-005", undefined), true);
  assert.equal(isIgnored(["cc-npm-005"], "CC-NPM-005", undefined), true);
  assert.equal(isIgnored(["CC-NPM-001:acme-cli"], "CC-NPM-001", "acme-cli"), true);
  assert.equal(isIgnored(["CC-NPM-001:acme-cli"], "CC-NPM-001", "acme-sdk"), false);
  assert.equal(isIgnored(["CC-NPM-001:acme-cli"], "CC-NPM-001", undefined), false);
});
