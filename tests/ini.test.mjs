// The INI reader feeds both .npmrc and pip.conf parsing; the cases below pin
// the two dialect quirks that matter — sectionless files and configparser's
// indented multi-line values (how pip.conf lists several extra-index-urls).
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseIni, iniLookup } from "../dist/index.js";

test("sectionless key=value lines land in the default section with line numbers", () => {
  const entries = parseIni("registry=https://npm.example.test/\n@acme:registry=https://npm.example.test/\n");
  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], {
    section: "",
    key: "registry",
    value: "https://npm.example.test/",
    line: 1,
  });
  assert.equal(entries[1].line, 2);
});

test("comments (# and ;) and blank lines are skipped", () => {
  const entries = parseIni("# comment\n; also a comment\n\nkey=value\n");
  assert.equal(entries.length, 1);
  assert.equal(entries[0].line, 4);
});

test("[section] headers scope the keys that follow", () => {
  const entries = parseIni("[global]\nindex-url = https://pypi.example.test/simple\n[install]\nno-cache = true\n");
  assert.equal(iniLookup(entries, "global", "index-url").length, 1);
  assert.equal(iniLookup(entries, "install", "no-cache").length, 1);
  assert.equal(iniLookup(entries, "global", "no-cache").length, 0);
});

test("indented continuations join into one multi-line value; a blank line closes it", () => {
  const text = "[global]\nextra-index-url =\n    https://a.example.test/simple\n    https://b.example.test/simple\n";
  const [entry] = iniLookup(parseIni(text), "global", "extra-index-url");
  assert.equal(entry.value, "https://a.example.test/simple\nhttps://b.example.test/simple");
  assert.equal(entry.line, 2);
  const closed = iniLookup(parseIni("[global]\nkey =\n    one\n\n    stray\n"), "global", "key");
  assert.equal(closed[0].value, "one");
});

test("values keep internal = signs (query strings) and repeated keys are all preserved", () => {
  const [entry] = parseIni("registry=https://npm.example.test/?auth=1\n");
  assert.equal(entry.value, "https://npm.example.test/?auth=1");
  const repeated = iniLookup(parseIni("[global]\nk = 1\nk = 2\n"), "global", "k");
  assert.deepEqual(repeated.map((e) => e.value), ["1", "2"]);
});
