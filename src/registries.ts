/**
 * Registry URL classification: is this URL a *public, anyone-can-claim-a-name*
 * registry, a private one, or a local/loopback endpoint?
 *
 * The classification is the heart of every rule: a name routed to a public
 * registry is a name an attacker can claim. Unknown hosts default to PRIVATE
 * (an org's own registry manager is exactly a host we have never heard of);
 * the `publicRegistries` config exists for the one case static analysis
 * cannot see — a "virtual" repo that merges the public registry server-side.
 */

export const DEFAULT_NPM_REGISTRY = "https://registry.npmjs.org/";
export const DEFAULT_PYPI_INDEX = "https://pypi.org/simple";
export const MAVEN_CENTRAL_ID = "central";
export const MAVEN_CENTRAL_URL = "https://repo.maven.apache.org/maven2";

/** Registries where any unclaimed name can be registered by anyone. */
const PUBLIC_HOSTS: ReadonlySet<string> = new Set([
  // npm
  "registry.npmjs.org",
  "registry.npmjs.com",
  "registry.yarnpkg.com",
  // PyPI
  "pypi.org",
  "pypi.python.org",
  "test.pypi.org",
  "files.pythonhosted.org",
  // Maven
  "repo.maven.apache.org",
  "repo1.maven.org",
  "central.sonatype.com",
  "oss.sonatype.org",
  "s01.oss.sonatype.org",
  "jitpack.io",
  "plugins.gradle.org",
  "maven.google.com",
]);

const LOOPBACK_HOSTS: ReadonlySet<string> = new Set(["localhost", "0.0.0.0", "::1", "[::1]"]);

export type RegistryKind = "public" | "private" | "local";

export interface RegistryClass {
  url: string;
  host: string;
  kind: RegistryKind;
  /** Plain-http transport to a non-local host: tamperable in transit. */
  insecure: boolean;
}

export interface RegistryOverrides {
  publicRegistries: readonly string[];
  privateRegistries: readonly string[];
}

function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host) || host.startsWith("127.");
}

/** True when `entry` (a bare host or a URL prefix) covers this URL. */
function overrideMatches(url: string, host: string, entry: string): boolean {
  if (entry.length === 0) return false;
  const e = entry.toLowerCase();
  if (host === e || host.endsWith("." + e)) return true;
  return url.toLowerCase().startsWith(e);
}

/**
 * Classify a registry/index/repository URL. Returns null for URLs that are
 * not remote registries at all (git specs, unparsable strings, ${VAR}
 * placeholders) — callers skip those.
 */
export function classifyRegistry(
  url: string,
  overrides: RegistryOverrides = { publicRegistries: [], privateRegistries: [] },
): RegistryClass | null {
  // Unexpanded ${VAR} placeholders (common in committed .npmrc files) are not
  // classifiable — WHATWG URL would happily parse them, so reject explicitly.
  if (url.includes("${")) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  const protocol = parsed.protocol;
  if (protocol === "file:") {
    return { url, host: "", kind: "local", insecure: false };
  }
  if (protocol !== "http:" && protocol !== "https:") return null;
  const host = parsed.hostname.toLowerCase();
  if (host.length === 0) return null;

  let kind: RegistryKind;
  if (overrides.publicRegistries.some((e) => overrideMatches(url, host, e))) {
    kind = "public";
  } else if (overrides.privateRegistries.some((e) => overrideMatches(url, host, e))) {
    kind = "private";
  } else if (isLoopbackHost(host)) {
    kind = "local";
  } else if (PUBLIC_HOSTS.has(host)) {
    kind = "public";
  } else {
    kind = "private";
  }

  const insecure = protocol === "http:" && kind !== "local";
  return { url, host, kind, insecure };
}
