// pip requirements grammar + auditor rules. The parser tests cover the line
// forms that appear in real requirement files (continuations, markers,
// extras, hashes, direct URLs); the audit tests pin the Birsan mechanics —
// --extra-index-url is the finding, and index precedence decides the rest.
import assert from "node:assert/strict";
import { test } from "node:test";
import { auditPip, isExactPin, parsePipConf, parseRequirements } from "../dist/index.js";
import { byRule, config } from "./helpers.mjs";

const cfg = (over = {}) => config({ internal: ["acme-*"], ...over });

test("parses plain, pinned and range requirements; isExactPin knows PEP 440 pin forms", () => {
  const f = parseRequirements("alpha==1.2.3\nbeta>=2.0\ngamma\n", "requirements.txt");
  assert.deepEqual(
    f.requirements.map((r) => [r.name, r.spec, r.pinned, r.line]),
    [["alpha", "==1.2.3", true, 1], ["beta", ">=2.0", false, 2], ["gamma", "", false, 3]],
  );
  assert.equal(isExactPin("==1.2.3"), true);
  assert.equal(isExactPin("===1.2.3"), true); // arbitrary equality counts
  assert.equal(isExactPin("==1.2.*"), false); // wildcard pin is not exact
  assert.equal(isExactPin(">=1.2,<2.0"), false);
  assert.equal(isExactPin(">=1.0,==1.4.2"), true);
});

test("backslash continuations, extras, markers and pip's whitespace-# comment rule parse cleanly", () => {
  const commented = parseRequirements(
    "# full line comment\nalpha==1.0 # trailing\n--index-url https://pypi.example.test/simple#frag\n",
    "requirements.txt",
  );
  assert.equal(commented.requirements.length, 1);
  // No whitespace before "#": the fragment is part of the URL, not a comment.
  assert.equal(commented.options[0].value, "https://pypi.example.test/simple#frag");
  const f = parseRequirements("alpha==1.0 \\\n    --hash=sha256:abc\nbeta==2.0\n", "requirements.txt");
  assert.equal(f.requirements.length, 2);
  assert.equal(f.requirements[0].line, 1);
  assert.equal(f.requirements[1].line, 3);
  const marked = parseRequirements('alpha[fast,tls]==1.0 ; python_version >= "3.9"\n', "requirements.txt");
  assert.equal(marked.requirements[0].name, "alpha");
  assert.equal(marked.requirements[0].pinned, true);
});

test("option forms: -i, --index-url=x, --extra-index-url, --trusted-host, -r includes", () => {
  const f = parseRequirements(
    "-i https://one.example.test/simple\n--index-url=https://two.example.test/simple\n--extra-index-url https://three.example.test/simple\n--trusted-host three.example.test\n-r base.txt\n-c constraints.txt\n",
    "requirements.txt",
  );
  assert.deepEqual(
    f.options.map((o) => o.kind),
    ["index-url", "index-url", "extra-index-url", "trusted-host"],
  );
  assert.deepEqual(f.includes.map((i) => [i.target, i.constraint]), [["base.txt", false], ["constraints.txt", true]]);
});

test("direct-URL and local-path requirements are exempt from index rules", () => {
  const f = parseRequirements(
    "acme-lib @ https://files.example.test/acme_lib-1.0-py3-none-any.whl\n./vendored/acme-tool\n",
    "requirements.txt",
  );
  assert.equal(f.requirements.length, 1);
  assert.equal(f.requirements[0].direct, true);
  const findings = auditPip({ files: [f] }, cfg());
  assert.equal(byRule(findings, "CC-PIP-002").length, 0);
  assert.equal(byRule(findings, "CC-PIP-005").length, 0);
});

test("pip.conf: [global]/[install] sections, multi-line extra-index-url, trusted hosts", () => {
  const conf = parsePipConf(
    "[global]\nindex-url = https://pypi.example.test/simple\nextra-index-url =\n    https://a.example.test/simple\n    https://b.example.test/simple\n[install]\ntrusted-host = a.example.test b.example.test\n",
    "pip.conf",
  );
  assert.equal(conf.indexUrl.url, "https://pypi.example.test/simple");
  assert.deepEqual(conf.extraIndexUrls.map((e) => e.url), [
    "https://a.example.test/simple",
    "https://b.example.test/simple",
  ]);
  assert.deepEqual(conf.trustedHosts.map((t) => t.host), ["a.example.test", "b.example.test"]);
});

test("CC-PIP-001 fires once per extra index, wherever it is configured", () => {
  const reqs = parseRequirements("--extra-index-url https://a.example.test/simple\nalpha==1.0\n", "requirements.txt");
  const conf = parsePipConf("[global]\nextra-index-url = https://b.example.test/simple\n", "pip.conf");
  const findings = auditPip({ files: [reqs], conf }, cfg());
  const hits = byRule(findings, "CC-PIP-001");
  assert.equal(hits.length, 2);
  assert.deepEqual(hits.map((h) => h.file).sort(), ["pip.conf", "requirements.txt"]);
  assert.equal(hits[0].severity, "critical");
});

test("CC-PIP-002: internal requirement against default PyPI (no index configured at all)", () => {
  const f = parseRequirements("acme-billing==1.0\n", "requirements.txt");
  const findings = auditPip({ files: [f] }, cfg());
  const hits = byRule(findings, "CC-PIP-002");
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /pypi\.org/);
});

test("CC-PIP-002 respects PEP 503: Acme_Billing matches the acme-* pattern", () => {
  const f = parseRequirements("Acme_Billing==1.0\n", "requirements.txt");
  assert.equal(byRule(auditPip({ files: [f] }, cfg()), "CC-PIP-002").length, 1);
});

test("CC-PIP-002 is quiet when the effective index is private (requirements option wins over pip.conf)", () => {
  const f = parseRequirements("--index-url https://pypi.example.test/simple\nacme-billing==1.0\n", "requirements.txt");
  const conf = parsePipConf("[global]\nindex-url = https://pypi.org/simple\n", "pip.conf");
  const findings = auditPip({ files: [f], conf }, cfg());
  assert.equal(byRule(findings, "CC-PIP-002").length, 0);
  // The fully hardened shape — one private https index, pinned internals — is silent.
  const hardened = parseRequirements(
    "--index-url https://pypi.example.test/simple\nacme-billing==1.2.0\nhttpx-lite==0.27.0\n",
    "requirements.txt",
  );
  assert.deepEqual(auditPip({ files: [hardened] }, cfg()), []);
});

test("CC-PIP-003 and CC-PIP-004: http indexes and trusted-host lines are cited per source", () => {
  const f = parseRequirements("--index-url http://pypi.example.test/simple\nalpha==1.0\n", "requirements.txt");
  const conf = parsePipConf("[global]\ntrusted-host = pypi.example.test\n", "pip.conf");
  const findings = auditPip({ files: [f], conf }, cfg());
  assert.equal(byRule(findings, "CC-PIP-003").length, 1);
  const trust = byRule(findings, "CC-PIP-004");
  assert.equal(trust.length, 1);
  assert.equal(trust[0].file, "pip.conf");
});

test("CC-PIP-005: unpinned internal requirement, even on a private index", () => {
  const f = parseRequirements("--index-url https://pypi.example.test/simple\nacme-billing>=1.2\nacme-common==3.4.1\n", "requirements.txt");
  const hits = byRule(auditPip({ files: [f] }, cfg()), "CC-PIP-005");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].package, "acme-billing");
});
