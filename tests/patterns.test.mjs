// Pattern matching is the gate on every "internal" decision, so its glob and
// PEP 503 semantics get exercised directly: a pattern that over- or
// under-matches silently turns the whole audit into noise or blindness.
import assert from "node:assert/strict";
import { test } from "node:test";
import { globToRegExp, matchesAny, matchesAnyPyPI, normalizePyPI } from "../dist/index.js";

test("star matches any run (including empty) and patterns are anchored, never mid-name", () => {
  assert.equal(matchesAny("acme-metrics", ["acme-*"]), "acme-*");
  assert.equal(matchesAny("acme-", ["acme-*"]), "acme-*");
  assert.equal(matchesAny("acme", ["acme-*"]), null);
  assert.equal(matchesAny("not-acme-metrics", ["acme-*"]), null);
  assert.equal(matchesAny("acme-metrics-fork", ["acme-*"]), "acme-*");
});

test("regex metacharacters stay literal: groupId dots and npm scope slashes are exact", () => {
  assert.equal(matchesAny("com.acme.data", ["com.acme.*"]), "com.acme.*");
  // A regex "." would let "comXacmeXdata" slip through the groupId pattern.
  assert.equal(matchesAny("comXacmeXdata", ["com.acme.*"]), null);
  assert.equal(matchesAny("com.acmeplus.data", ["com.acme.*"]), null);
  assert.equal(matchesAny("@acme/logger", ["@acme/*"]), "@acme/*");
  assert.equal(matchesAny("@acme-labs/logger", ["@acme/*"]), null);
});

test("first matching pattern wins, and globToRegExp anchors both ends", () => {
  assert.equal(matchesAny("acme-core", ["acme-core", "acme-*"]), "acme-core");
  const re = globToRegExp("a*c");
  assert.equal(re.test("abc"), true);
  assert.equal(re.test("abcd"), false);
  assert.equal(re.test("xabc"), false);
});

test("PEP 503: underscores, dots and case fold to one canonical name", () => {
  assert.equal(normalizePyPI("Acme_Billing.Core"), "acme-billing-core");
  assert.equal(normalizePyPI("acme--billing"), "acme-billing");
});

test("pip matching treats acme_* and acme-* as the same pattern", () => {
  assert.equal(matchesAnyPyPI("acme_billing", ["acme-*"]), "acme-*");
  assert.equal(matchesAnyPyPI("ACME.BILLING", ["acme_*"]), "acme_*");
  assert.equal(matchesAnyPyPI("acmebilling", ["acme-*"]), null);
});
