// Maven model parsing, DefaultMirrorSelector semantics and the auditor.
// mirrorMatches gets the most attention: it is real Maven behaviour
// (`*`, `external:*`, comma lists, `!` exclusions) and a wrong match either
// hides a public resolution path or invents one.
import assert from "node:assert/strict";
import { test } from "node:test";
import {
  auditMaven,
  effectiveRepositories,
  mirrorMatches,
  parsePom,
  parseSettings,
  parseXml,
  CENTRAL,
} from "../dist/index.js";
import { byRule, config } from "./helpers.mjs";

const cfg = (over = {}) => config({ internal: ["com.acme", "com.acme.*"], ...over });

const POM = (body) =>
  parsePom(parseXml(`<?xml version="1.0"?><project><modelVersion>4.0.0</modelVersion>${body}</project>`));
const SETTINGS = (body) => parseSettings(parseXml(`<settings>${body}</settings>`));

const DEP = (g, a) => `<dependency><groupId>${g}</groupId><artifactId>${a}</artifactId><version>1.0</version></dependency>`;

test("parsePom: parent groupId fallback, ${project.groupId} resolution, repo policy defaults", () => {
  const pom = POM(
    "<parent><groupId>com.acme</groupId><artifactId>parent</artifactId></parent><artifactId>api</artifactId>" +
      `<dependencies>${DEP("${project.groupId}", "core")}${DEP("org.example", "lib")}</dependencies>`,
  );
  assert.equal(pom.groupId, "com.acme");
  assert.deepEqual(pom.deps[0], { groupId: "com.acme", artifactId: "core" });
  assert.deepEqual(pom.deps[1], { groupId: "org.example", artifactId: "lib" });
  // Maven enables release AND snapshot resolution unless a policy block says otherwise.
  const repos = POM(
    "<groupId>com.acme</groupId><repositories><repository><id>r1</id><url>https://maven.example.test/r1</url><snapshots><enabled>false</enabled></snapshots></repository></repositories>",
  );
  assert.equal(repos.repositories[0].releases, true);
  assert.equal(repos.repositories[0].snapshots, false);
});

test("parseSettings: mirrors, activeByDefault profiles and activeProfiles-listed profiles", () => {
  const s = SETTINGS(
    "<mirrors><mirror><id>corp</id><mirrorOf>*</mirrorOf><url>https://maven.example.test/virtual</url></mirror></mirrors>" +
      "<profiles>" +
      "<profile><id>on</id><activation><activeByDefault>true</activeByDefault></activation><repositories><repository><id>p1</id><url>https://maven.example.test/p1</url></repository></repositories></profile>" +
      "<profile><id>listed</id><repositories><repository><id>p2</id><url>https://maven.example.test/p2</url></repository></repositories></profile>" +
      "<profile><id>off</id><repositories><repository><id>p3</id><url>https://maven.example.test/p3</url></repository></repositories></profile>" +
      "</profiles><activeProfiles><activeProfile>listed</activeProfile></activeProfiles>",
  );
  assert.equal(s.mirrors.length, 1);
  assert.deepEqual(s.repositories.map((r) => r.id), ["p1", "p2"]);
});

test("mirrorMatches: '*' matches everything, exact ids match themselves, external:* skips local repos", () => {
  assert.equal(mirrorMatches("*", CENTRAL), true);
  assert.equal(mirrorMatches("central", CENTRAL), true);
  assert.equal(mirrorMatches("other", CENTRAL), false);
  assert.equal(mirrorMatches("external:*", CENTRAL), true);
  assert.equal(mirrorMatches("external:*", { id: "local", url: "http://localhost:8081/repo" }), false);
  assert.equal(mirrorMatches("external:*", { id: "fs", url: "file:///srv/repo" }), false);
});

test("mirrorMatches: comma lists, ! exclusions and external:http:* (Maven's documented forms)", () => {
  const repo = { id: "corp-snapshots", url: "https://maven.example.test/snap" };
  assert.equal(mirrorMatches("central,corp-snapshots", repo), true);
  assert.equal(mirrorMatches("*,!corp-snapshots", repo), false);
  assert.equal(mirrorMatches("external:http:*", { id: "h", url: "http://maven.example.test/r" }), true);
  assert.equal(mirrorMatches("external:http:*", { id: "h", url: "https://maven.example.test/r" }), false);
});

test("effectiveRepositories: central is implicit; the first matching mirror rewrites the URL", () => {
  const pom = POM("<groupId>com.acme</groupId>");
  const settings = SETTINGS(
    "<mirrors><mirror><id>corp</id><mirrorOf>*</mirrorOf><url>https://maven.example.test/virtual</url></mirror></mirrors>",
  );
  const effective = effectiveRepositories(pom, settings);
  assert.equal(effective.length, 1);
  assert.equal(effective[0].repo.id, "central");
  assert.equal(effective[0].effectiveUrl, "https://maven.example.test/virtual");
  assert.equal(effective[0].mirrorId, "corp");
});

test("CC-MVN-001: internal dep resolvable from unmirrored central; the blanket mirror silences it", () => {
  const pom = POM(`<groupId>com.acme</groupId><dependencies>${DEP("com.acme", "core")}</dependencies>`);
  const bare = auditMaven({ pomPath: "pom.xml", pom }, cfg());
  const hits = byRule(bare, "CC-MVN-001");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].package, "com.acme:core");
  const settings = SETTINGS(
    "<mirrors><mirror><id>corp</id><mirrorOf>*</mirrorOf><url>https://maven.example.test/virtual</url></mirror></mirrors>",
  );
  const mirrored = auditMaven({ pomPath: "pom.xml", pom, settings, settingsPath: "settings.xml" }, cfg());
  assert.equal(byRule(mirrored, "CC-MVN-001").length, 0);
});

test("CC-MVN-001 matches groupId:artifactId patterns too", () => {
  const pom = POM(`<dependencies>${DEP("org.shared", "acme-internal-client")}</dependencies>`);
  const findings = auditMaven({ pomPath: "pom.xml", pom }, cfg({ internal: ["org.shared:acme-*"] }));
  assert.equal(byRule(findings, "CC-MVN-001").length, 1);
});

test("CC-MVN-002 / CC-MVN-006: per-project repositories and pluginRepositories", () => {
  const pom = POM(
    "<groupId>org.example</groupId><repositories><repository><id>extra</id><url>https://maven.example.test/extra</url></repository></repositories>" +
      "<pluginRepositories><pluginRepository><id>plug</id><url>https://maven.example.test/plug</url></pluginRepository></pluginRepositories>",
  );
  const findings = auditMaven({ pomPath: "pom.xml", pom }, cfg());
  assert.equal(byRule(findings, "CC-MVN-002").length, 1);
  assert.equal(byRule(findings, "CC-MVN-006").length, 1);
});

test("CC-MVN-003 needs internal coordinates present; a purely public project is quiet", () => {
  const internal = POM(`<groupId>com.acme</groupId><dependencies>${DEP("org.example", "lib")}</dependencies>`);
  assert.equal(byRule(auditMaven({ pomPath: "pom.xml", pom: internal }, cfg()), "CC-MVN-003").length, 1);
  const publicOnly = POM(`<groupId>org.example</groupId><dependencies>${DEP("org.other", "lib")}</dependencies>`);
  assert.equal(byRule(auditMaven({ pomPath: "pom.xml", pom: publicOnly }, cfg()), "CC-MVN-003").length, 0);
});

test("CC-MVN-004: plain-http repository URLs, deduplicated; mirror URLs are checked too", () => {
  const pom = POM(
    "<groupId>com.acme</groupId><repositories><repository><id>r1</id><url>http://maven.example.test/r1</url></repository></repositories>",
  );
  const settings = SETTINGS(
    "<mirrors><mirror><id>m</id><mirrorOf>central</mirrorOf><url>http://mirror.example.test/central</url></mirror></mirrors>",
  );
  const findings = auditMaven({ pomPath: "pom.xml", pom, settings, settingsPath: "settings.xml" }, cfg());
  const hits = byRule(findings, "CC-MVN-004");
  assert.deepEqual(hits.map((h) => h.file).sort(), ["pom.xml", "settings.xml"]);
});

test("CC-MVN-005: snapshots enabled on a public repo (Maven's default when unspecified)", () => {
  const pom = POM(
    "<groupId>org.example</groupId><repositories><repository><id>jitpack</id><url>https://jitpack.io</url></repository></repositories>",
  );
  const findings = auditMaven({ pomPath: "pom.xml", pom }, cfg());
  const hits = byRule(findings, "CC-MVN-005");
  assert.equal(hits.length, 1);
  assert.match(hits[0].message, /jitpack/);
  // central never trips it: the super-POM disables snapshots on central.
  assert.ok(!hits.some((h) => h.message.includes('"central"')));
});

test("a hardened setup — no POM repos, blanket mirror to a private manager — is completely quiet", () => {
  const pom = POM(`<groupId>com.acme</groupId><dependencies>${DEP("com.acme", "core")}${DEP("org.example", "lib")}</dependencies>`);
  const settings = SETTINGS(
    "<mirrors><mirror><id>corp</id><mirrorOf>*</mirrorOf><url>https://maven.example.test/virtual</url></mirror></mirrors>",
  );
  assert.deepEqual(auditMaven({ pomPath: "pom.xml", pom, settings, settingsPath: "settings.xml" }, cfg()), []);
});
