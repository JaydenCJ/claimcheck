/**
 * `.npmrc` model: the default registry, per-scope registry mappings and every
 * registry-shaped URL (for transport checks). npm merges config files with
 * nearest-first precedence; `effectiveRegistry` reproduces the resolution the
 * npm CLI applies when it decides which registry serves a given name.
 */

import { parseIni } from "./ini.js";
import { DEFAULT_NPM_REGISTRY } from "./registries.js";

export interface RegistryRef {
  url: string;
  line: number;
}

export interface Npmrc {
  path: string;
  /** The `registry=` line, when present. */
  registry?: RegistryRef;
  /** `@scope:registry=` mappings, keyed by "@scope". */
  scopes: Map<string, RegistryRef>;
  /** Every registry URL in the file (default + scopes), for transport checks. */
  registryUrls: (RegistryRef & { key: string })[];
}

export function parseNpmrc(text: string, path: string): Npmrc {
  const rc: Npmrc = { path, scopes: new Map(), registryUrls: [] };
  for (const entry of parseIni(text)) {
    if (entry.section !== "") continue; // .npmrc has no sections; ignore strays
    if (entry.key === "registry") {
      rc.registry = { url: entry.value, line: entry.line };
      rc.registryUrls.push({ url: entry.value, line: entry.line, key: entry.key });
    } else if (entry.key.startsWith("@") && entry.key.endsWith(":registry")) {
      const scope = entry.key.slice(0, -":registry".length);
      rc.scopes.set(scope, { url: entry.value, line: entry.line });
      rc.registryUrls.push({ url: entry.value, line: entry.line, key: entry.key });
    }
  }
  return rc;
}

/** The "@scope" of a package name, or null for unscoped names. */
export function scopeOf(name: string): string | null {
  if (!name.startsWith("@")) return null;
  const slash = name.indexOf("/");
  return slash > 0 ? name.slice(0, slash) : null;
}

export interface EffectiveRegistry {
  url: string;
  /** Which file/line decided it; absent when npm's built-in default applied. */
  source?: { path: string; line: number };
  /** True when no config file named a registry and npm falls back to npmjs.org. */
  defaulted: boolean;
}

/**
 * Which registry serves `name`, given the config chain nearest-first
 * (project `.npmrc` before ancestor `.npmrc`s). Scope mappings win over the
 * default `registry=`; with no config at all, the public registry serves
 * everything — which is precisely the exposure this tool exists to surface.
 */
export function effectiveRegistry(name: string, chain: readonly Npmrc[]): EffectiveRegistry {
  const scope = scopeOf(name);
  if (scope !== null) {
    for (const rc of chain) {
      const mapped = rc.scopes.get(scope);
      if (mapped !== undefined) {
        return { url: mapped.url, source: { path: rc.path, line: mapped.line }, defaulted: false };
      }
    }
  }
  for (const rc of chain) {
    if (rc.registry !== undefined) {
      return {
        url: rc.registry.url,
        source: { path: rc.path, line: rc.registry.line },
        defaulted: false,
      };
    }
  }
  return { url: DEFAULT_NPM_REGISTRY, defaulted: true };
}

/** True when any file in the chain maps `scope` to a registry. */
export function scopeMapped(scope: string, chain: readonly Npmrc[]): boolean {
  return chain.some((rc) => rc.scopes.has(scope));
}
