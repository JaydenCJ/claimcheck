/**
 * Public programmatic API. Everything exported here is covered by semver;
 * the CLI is a thin shell over these functions.
 */

export { VERSION } from "./version.js";
export type {
  Ecosystem,
  Severity,
  Rule,
  Finding,
  ResolvedConfig,
  ScanSummary,
  ScanIssue,
  ScannedProject,
  ScanResult,
} from "./types.js";
export { ECOSYSTEMS, SEVERITIES, SEVERITY_RANK } from "./types.js";

export { CONFIG_FILENAME, ConfigError, defaultConfig, parseConfig, isIgnored } from "./config.js";
export { RULES, getRule } from "./rules.js";
export { globToRegExp, matchesAny, matchesAnyPyPI, normalizePyPI } from "./patterns.js";
export {
  classifyRegistry,
  DEFAULT_NPM_REGISTRY,
  DEFAULT_PYPI_INDEX,
  MAVEN_CENTRAL_ID,
  MAVEN_CENTRAL_URL,
} from "./registries.js";
export type { RegistryClass, RegistryKind, RegistryOverrides } from "./registries.js";

export { parseIni, iniLookup } from "./ini.js";
export type { IniEntry } from "./ini.js";
export { parseXml, child, childrenOf, textOf } from "./xml.js";
export type { XmlElement } from "./xml.js";

export { parseNpmrc, effectiveRegistry, scopeMapped, scopeOf } from "./npmrc.js";
export type { Npmrc, EffectiveRegistry, RegistryRef } from "./npmrc.js";
export { auditNpm, parseLockfile } from "./npm.js";
export type { NpmInput, LockEntry } from "./npm.js";

export { auditPip, parseRequirements, parsePipConf, isExactPin } from "./pip.js";
export type { PipInput, PipConf, Requirement, RequirementsFile, ReqOption, ReqInclude } from "./pip.js";

export {
  auditMaven,
  parsePom,
  parseSettings,
  mirrorMatches,
  effectiveRepositories,
  CENTRAL,
} from "./maven.js";
export type {
  MavenInput,
  MavenRepo,
  MavenDep,
  PomModel,
  SettingsModel,
  Mirror,
  EffectiveRepo,
} from "./maven.js";

export { scan, walkTree, inferInternalPatterns, failsThreshold, ScanRootError } from "./scan.js";
export { renderText, renderJson, renderRules, renderExplain } from "./report.js";
