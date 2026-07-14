// The in-repo XML parser only needs to be a correct subset — but on that
// subset (real pom.xml / settings.xml shapes) it must be exact, and it must
// fail loudly on malformed input rather than mis-reading a repository URL.
import assert from "node:assert/strict";
import { test } from "node:test";
import { parseXml, child, childrenOf, textOf } from "../dist/index.js";

test("parses declaration, nesting, attributes and text", () => {
  const root = parseXml(
    '<?xml version="1.0" encoding="UTF-8"?>\n<project xmlns="http://maven.apache.org/POM/4.0.0">\n  <groupId>com.example</groupId>\n</project>',
  );
  assert.equal(root.name, "project");
  assert.equal(root.attrs.xmlns, "http://maven.apache.org/POM/4.0.0");
  assert.equal(textOf(root, "groupId"), "com.example");
});

test("comments are skipped anywhere; self-closing tags produce empty elements", () => {
  const root = parseXml("<a><!-- before --><b>x</b><!-- after --></a>");
  assert.equal(childrenOf(root, "b").length, 1);
  assert.equal(textOf(root, "b"), "x");
  const selfClosed = parseXml('<a><b/><c attr="v"/></a>');
  assert.equal(selfClosed.children.length, 2);
  assert.equal(child(selfClosed, "c").attrs.attr, "v");
});

test("CDATA content is taken verbatim", () => {
  const root = parseXml("<a><![CDATA[<not-a-tag> & raw]]></a>");
  assert.equal(root.text, "<not-a-tag> & raw");
});

test("the five predefined entities and numeric references decode", () => {
  const root = parseXml("<a>&lt;&gt;&amp;&quot;&apos;&#65;&#x42;</a>");
  assert.equal(root.text, "<>&\"'AB");
});

test("malformed documents fail loudly with a located error, never a silent recovery", () => {
  // Mis-reading a repository URL would be worse than refusing the file.
  assert.throws(() => parseXml("<a><b></a></b>"), /expected <\/b>/);
  assert.throws(() => parseXml("<a>\n<b>\n</a>"), /line 3/);
  assert.throws(() => parseXml("<a>&nbsp;</a>"), /unknown entity/); // no entity expansion, ever
  assert.throws(() => parseXml("<a/><b/>"), /after the root/);
});

test("repeated children keep document order and round-trip through the element helpers", () => {
  const list = parseXml("<rs><r><id>one</id></r><r><id>two</id></r></rs>");
  assert.deepEqual(childrenOf(list, "r").map((r) => textOf(r, "id")), ["one", "two"]);
  const root = parseXml(
    "<settings><mirrors><mirror><id>corp</id><mirrorOf>external:*</mirrorOf><url>https://maven.example.test/virtual</url></mirror></mirrors></settings>",
  );
  const mirror = child(child(root, "mirrors"), "mirror");
  assert.equal(textOf(mirror, "mirrorOf"), "external:*");
  assert.equal(textOf(mirror, "url"), "https://maven.example.test/virtual");
});
