/**
 * Glob-lite matching for internal-name patterns.
 *
 * Patterns support a single wildcard character `*` (matches any run of
 * characters, including the empty run); everything else is literal. This is
 * deliberately tiny: internal-package naming conventions are prefixes and
 * scopes ("@acme/*", "acme-*", "com.acme.*"), not full glob languages.
 */

/** Compile one pattern to an anchored RegExp. `*` -> `.*`; all else literal. */
export function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (const ch of pattern) {
    out += ch === "*" ? ".*" : ch.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(out + "$");
}

/** Return the first pattern that matches `name`, or null. Case-sensitive. */
export function matchesAny(name: string, patterns: readonly string[]): string | null {
  for (const p of patterns) {
    if (globToRegExp(p).test(name)) return p;
  }
  return null;
}

/**
 * PEP 503 name normalization: PyPI treats `Foo_Bar`, `foo-bar` and `foo.bar`
 * as the same project. Both requirement names and patterns are normalized
 * before matching so "acme_*" and "acme-*" behave identically.
 */
export function normalizePyPI(name: string): string {
  return name.toLowerCase().replace(/[-_.]+/g, "-");
}

/** matchesAny with PEP 503 normalization applied to both sides. */
export function matchesAnyPyPI(name: string, patterns: readonly string[]): string | null {
  const normalized = normalizePyPI(name);
  for (const p of patterns) {
    if (globToRegExp(normalizePyPI(p)).test(normalized)) return p;
  }
  return null;
}
