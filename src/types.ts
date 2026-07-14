/**
 * Shared types for claimcheck: findings, rules, configuration and scan results.
 * Everything in this module is data-only — no I/O — so the auditors stay pure
 * and unit-testable, and the JSON output shape has one authoritative home.
 */

export type Ecosystem = "npm" | "pip" | "maven";

export const ECOSYSTEMS: readonly Ecosystem[] = ["npm", "pip", "maven"];

export type Severity = "critical" | "high" | "medium" | "low";

/** Numeric rank for threshold comparisons; higher is worse. */
export const SEVERITY_RANK: Record<Severity, number> = {
  critical: 4,
  high: 3,
  medium: 2,
  low: 1,
};

export const SEVERITIES: readonly Severity[] = ["critical", "high", "medium", "low"];

/** A static audit rule. The full catalogue lives in rules.ts. */
export interface Rule {
  id: string;
  ecosystem: Ecosystem;
  severity: Severity;
  title: string;
  /** Why this configuration is a dependency-confusion exposure (for `explain`). */
  why: string;
  /** Concrete remediation (for `explain` and reports). */
  fix: string;
}

/** One concrete hit of a rule against a scanned file. */
export interface Finding {
  id: string;
  severity: Severity;
  ecosystem: Ecosystem;
  /** Path relative to the scan root, "/"-separated. */
  file: string;
  /** Affected package name / requirement / groupId, when the rule targets one. */
  package?: string;
  message: string;
  remediation: string;
}

/** Fully validated configuration with defaults applied. */
export interface ResolvedConfig {
  /** Glob-lite patterns naming internal packages (e.g. "@acme/*", "acme-*", "com.acme.*"). */
  internal: string[];
  /** Hosts / URL prefixes to treat as PUBLIC even though claimcheck does not know them
   *  (e.g. a virtual repo that merges the public registry server-side). */
  publicRegistries: string[];
  /** Hosts / URL prefixes to force-treat as private. Unknown hosts already default to private. */
  privateRegistries: string[];
  /** Suppressions: "CC-NPM-005" (whole rule) or "CC-NPM-001:pkg-name" (rule for one package). */
  ignore: string[];
  /** Minimum severity that makes the scan fail (exit 1). */
  failOn: Severity;
  /** Ecosystems to audit. */
  ecosystems: Ecosystem[];
  /** Where the config was loaded from, when it came from a file. */
  configPath?: string;
}

export interface ScanSummary {
  critical: number;
  high: number;
  medium: number;
  low: number;
  total: number;
  ignored: number;
}

/** A file that was found but could not be parsed; reported, never fatal to the scan. */
export interface ScanIssue {
  file: string;
  message: string;
}

export interface ScannedProject {
  ecosystem: Ecosystem;
  /** Directory relative to the scan root; "." for the root itself. */
  dir: string;
  files: string[];
}

export interface ScanResult {
  root: string;
  ecosystems: Ecosystem[];
  projects: ScannedProject[];
  findings: Finding[];
  errors: ScanIssue[];
  summary: ScanSummary;
  failOn: Severity;
  ok: boolean;
}
