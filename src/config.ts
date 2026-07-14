/**
 * claimcheck.json loading and validation. The config is deliberately small —
 * internal-name patterns, registry overrides, suppressions, a fail threshold —
 * and every typo is rejected loudly with the offending key named, because a
 * silently-ignored `internel` list would mean a silently useless audit.
 */

import type { Ecosystem, ResolvedConfig, Severity } from "./types.js";
import { ECOSYSTEMS, SEVERITIES } from "./types.js";
import { getRule } from "./rules.js";

export const CONFIG_FILENAME = "claimcheck.json";

/** Raised for malformed configuration; the CLI maps it to exit code 2. */
export class ConfigError extends Error {}

const ALLOWED_KEYS = new Set([
  "internal",
  "publicRegistries",
  "privateRegistries",
  "ignore",
  "failOn",
  "ecosystems",
]);

export function defaultConfig(): ResolvedConfig {
  return {
    internal: [],
    publicRegistries: [],
    privateRegistries: [],
    ignore: [],
    failOn: "low",
    ecosystems: [...ECOSYSTEMS],
  };
}

function stringArray(value: unknown, key: string, path: string): string[] {
  if (!Array.isArray(value) || value.some((v) => typeof v !== "string" || v.length === 0)) {
    throw new ConfigError(`${path}: "${key}" must be an array of non-empty strings`);
  }
  return value as string[];
}

/** Validate an ignore entry: "CC-XXX-NNN" or "CC-XXX-NNN:package-name". */
function checkIgnoreEntry(entry: string, path: string): void {
  const colon = entry.indexOf(":");
  const id = colon >= 0 ? entry.slice(0, colon) : entry;
  if (getRule(id) === undefined) {
    throw new ConfigError(`${path}: "ignore" entry "${entry}" names unknown rule "${id}"`);
  }
  if (colon >= 0 && entry.slice(colon + 1).length === 0) {
    throw new ConfigError(`${path}: "ignore" entry "${entry}" has an empty package part`);
  }
}

/** Parse and validate a claimcheck.json document. Throws ConfigError on any problem. */
export function parseConfig(text: string, path: string): ResolvedConfig {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (e) {
    throw new ConfigError(`${path}: not valid JSON (${(e as Error).message})`);
  }
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    throw new ConfigError(`${path}: top level must be a JSON object`);
  }
  const obj = raw as Record<string, unknown>;
  for (const key of Object.keys(obj)) {
    if (!ALLOWED_KEYS.has(key)) {
      throw new ConfigError(
        `${path}: unknown key "${key}" (allowed: ${[...ALLOWED_KEYS].join(", ")})`,
      );
    }
  }

  const cfg = defaultConfig();
  cfg.configPath = path;

  if (obj.internal !== undefined) cfg.internal = stringArray(obj.internal, "internal", path);
  if (obj.publicRegistries !== undefined) {
    cfg.publicRegistries = stringArray(obj.publicRegistries, "publicRegistries", path);
  }
  if (obj.privateRegistries !== undefined) {
    cfg.privateRegistries = stringArray(obj.privateRegistries, "privateRegistries", path);
  }
  if (obj.ignore !== undefined) {
    cfg.ignore = stringArray(obj.ignore, "ignore", path);
    for (const entry of cfg.ignore) checkIgnoreEntry(entry, path);
  }
  if (obj.failOn !== undefined) {
    if (typeof obj.failOn !== "string" || !SEVERITIES.includes(obj.failOn as Severity)) {
      throw new ConfigError(`${path}: "failOn" must be one of ${SEVERITIES.join(", ")}`);
    }
    cfg.failOn = obj.failOn as Severity;
  }
  if (obj.ecosystems !== undefined) {
    const list = stringArray(obj.ecosystems, "ecosystems", path);
    for (const eco of list) {
      if (!ECOSYSTEMS.includes(eco as Ecosystem)) {
        throw new ConfigError(`${path}: "ecosystems" entry "${eco}" is not one of ${ECOSYSTEMS.join(", ")}`);
      }
    }
    if (list.length === 0) throw new ConfigError(`${path}: "ecosystems" must not be empty`);
    cfg.ecosystems = [...new Set(list)] as Ecosystem[];
  }
  return cfg;
}

/** True when `finding` (rule id + optional package) is suppressed by config.ignore. */
export function isIgnored(
  ignore: readonly string[],
  ruleId: string,
  pkg: string | undefined,
): boolean {
  for (const entry of ignore) {
    const colon = entry.indexOf(":");
    if (colon < 0) {
      if (entry.toUpperCase() === ruleId) return true;
    } else if (
      entry.slice(0, colon).toUpperCase() === ruleId &&
      pkg !== undefined &&
      entry.slice(colon + 1) === pkg
    ) {
      return true;
    }
  }
  return false;
}
