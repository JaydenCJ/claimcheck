/**
 * Minimal, dependency-free XML parser — just enough for `pom.xml` and
 * `settings.xml`: elements, attributes, text, comments, CDATA, the XML
 * declaration and a DOCTYPE line. No namespaces resolution (Maven files use
 * a default namespace only), no external entities (by construction: nothing
 * is ever fetched), no processing beyond the five predefined entities and
 * numeric character references.
 */

export interface XmlElement {
  name: string;
  attrs: Record<string, string>;
  children: XmlElement[];
  /** Concatenated direct text content, entity-decoded, whitespace preserved. */
  text: string;
}

class Cursor {
  pos = 0;
  constructor(readonly input: string) {}

  line(): number {
    let n = 1;
    for (let i = 0; i < this.pos && i < this.input.length; i++) {
      if (this.input[i] === "\n") n++;
    }
    return n;
  }
}

function err(c: Cursor, message: string): Error {
  return new Error(`XML parse error at line ${c.line()}: ${message}`);
}

function decodeEntities(c: Cursor, raw: string): string {
  return raw.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z]+);/g, (whole, body: string) => {
    switch (body) {
      case "lt": return "<";
      case "gt": return ">";
      case "amp": return "&";
      case "quot": return '"';
      case "apos": return "'";
    }
    if (body.startsWith("#x") || body.startsWith("#X")) {
      const code = Number.parseInt(body.slice(2), 16);
      if (Number.isFinite(code)) return String.fromCodePoint(code);
    } else if (body.startsWith("#")) {
      const code = Number.parseInt(body.slice(1), 10);
      if (Number.isFinite(code)) return String.fromCodePoint(code);
    }
    throw err(c, `unknown entity ${JSON.stringify(whole)}`);
  });
}

function skipMisc(c: Cursor): void {
  for (;;) {
    while (c.pos < c.input.length && /\s/.test(c.input[c.pos] as string)) c.pos++;
    if (c.input.startsWith("<?", c.pos)) {
      const end = c.input.indexOf("?>", c.pos);
      if (end < 0) throw err(c, "unterminated <? ... ?>");
      c.pos = end + 2;
    } else if (c.input.startsWith("<!--", c.pos)) {
      const end = c.input.indexOf("-->", c.pos);
      if (end < 0) throw err(c, "unterminated comment");
      c.pos = end + 3;
    } else if (c.input.startsWith("<!DOCTYPE", c.pos)) {
      const end = c.input.indexOf(">", c.pos);
      if (end < 0) throw err(c, "unterminated DOCTYPE");
      c.pos = end + 1;
    } else {
      return;
    }
  }
}

function parseAttrs(c: Cursor): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (;;) {
    while (c.pos < c.input.length && /\s/.test(c.input[c.pos] as string)) c.pos++;
    const ch = c.input[c.pos];
    if (ch === undefined) throw err(c, "unterminated start tag");
    if (ch === ">" || ch === "/") return attrs;
    const m = /^[^\s=/>]+/.exec(c.input.slice(c.pos));
    if (m === null) throw err(c, "malformed attribute");
    const name = m[0];
    c.pos += name.length;
    while (c.pos < c.input.length && /\s/.test(c.input[c.pos] as string)) c.pos++;
    if (c.input[c.pos] !== "=") throw err(c, `attribute ${name} has no value`);
    c.pos++;
    while (c.pos < c.input.length && /\s/.test(c.input[c.pos] as string)) c.pos++;
    const quote = c.input[c.pos];
    if (quote !== '"' && quote !== "'") throw err(c, `attribute ${name} value is unquoted`);
    c.pos++;
    const end = c.input.indexOf(quote, c.pos);
    if (end < 0) throw err(c, `unterminated value for attribute ${name}`);
    attrs[name] = decodeEntities(c, c.input.slice(c.pos, end));
    c.pos = end + 1;
  }
}

function parseElement(c: Cursor): XmlElement {
  if (c.input[c.pos] !== "<") throw err(c, "expected an element");
  c.pos++;
  const m = /^[^\s/>]+/.exec(c.input.slice(c.pos));
  if (m === null || m[0].startsWith("!") || m[0].startsWith("?")) {
    throw err(c, "expected a tag name");
  }
  const name = m[0];
  c.pos += name.length;
  const attrs = parseAttrs(c);
  const el: XmlElement = { name, attrs, children: [], text: "" };

  if (c.input.startsWith("/>", c.pos)) {
    c.pos += 2;
    return el;
  }
  if (c.input[c.pos] !== ">") throw err(c, `malformed start tag <${name}>`);
  c.pos++;

  for (;;) {
    if (c.pos >= c.input.length) throw err(c, `unclosed element <${name}>`);
    if (c.input.startsWith("</", c.pos)) {
      const end = c.input.indexOf(">", c.pos);
      if (end < 0) throw err(c, `unterminated end tag in <${name}>`);
      const closing = c.input.slice(c.pos + 2, end).trim();
      if (closing !== name) throw err(c, `expected </${name}>, found </${closing}>`);
      c.pos = end + 1;
      return el;
    }
    if (c.input.startsWith("<!--", c.pos)) {
      const end = c.input.indexOf("-->", c.pos);
      if (end < 0) throw err(c, "unterminated comment");
      c.pos = end + 3;
      continue;
    }
    if (c.input.startsWith("<![CDATA[", c.pos)) {
      const end = c.input.indexOf("]]>", c.pos);
      if (end < 0) throw err(c, "unterminated CDATA section");
      el.text += c.input.slice(c.pos + 9, end);
      c.pos = end + 3;
      continue;
    }
    if (c.input[c.pos] === "<") {
      el.children.push(parseElement(c));
      continue;
    }
    let next = c.input.indexOf("<", c.pos);
    if (next < 0) next = c.input.length;
    el.text += decodeEntities(c, c.input.slice(c.pos, next));
    c.pos = next;
  }
}

/** Parse a document and return its single root element. */
export function parseXml(input: string): XmlElement {
  const c = new Cursor(input);
  skipMisc(c);
  if (c.pos >= c.input.length) throw err(c, "document has no root element");
  const root = parseElement(c);
  skipMisc(c);
  if (c.pos < c.input.length) throw err(c, "content after the root element");
  return root;
}

/** First direct child named `name`, or undefined. */
export function child(el: XmlElement, name: string): XmlElement | undefined {
  return el.children.find((ch) => ch.name === name);
}

/** All direct children named `name`. */
export function childrenOf(el: XmlElement, name: string): XmlElement[] {
  return el.children.filter((ch) => ch.name === name);
}

/** Trimmed text content of the first direct child named `name`, or undefined. */
export function textOf(el: XmlElement, name: string): string | undefined {
  const ch = child(el, name);
  if (ch === undefined) return undefined;
  const t = ch.text.trim();
  return t.length > 0 ? t : undefined;
}
