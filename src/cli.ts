#!/usr/bin/env node
/**
 * claimcheck CLI. Exit codes are part of the contract:
 *   0 — scan completed, no findings at or above the fail-on threshold
 *   1 — scan completed, findings at or above the threshold
 *   2 — usage, configuration or input error (nothing was meaningfully scanned)
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import type { Ecosystem, ResolvedConfig, Severity } from "./types.js";
import { ECOSYSTEMS, SEVERITIES } from "./types.js";
import { CONFIG_FILENAME, ConfigError, defaultConfig, parseConfig } from "./config.js";
import { getRule, RULES } from "./rules.js";
import { inferInternalPatterns, scan, ScanRootError } from "./scan.js";
import { renderExplain, renderJson, renderRules, renderText } from "./report.js";
import { VERSION } from "./version.js";

const USAGE = `claimcheck v${VERSION} — dependency-confusion exposure audit for npm, pip and Maven

usage:
  claimcheck [scan] [dir] [options]   audit resolver configs under dir (default: .)
  claimcheck rules                    list every rule with id, severity and title
  claimcheck explain <rule-id>        print why a rule matters and how to fix it
  claimcheck init [dir] [--force]     write a starter ${CONFIG_FILENAME} with inferred patterns

options:
  --config <path>        claimcheck.json to use (default: <dir>/${CONFIG_FILENAME} if present)
  --format text|json     output format (default: text)
  --fail-on <severity>   minimum severity that fails the scan: ${SEVERITIES.join(", ")} (default: low)
  --ecosystems <list>    comma-separated subset of: ${ECOSYSTEMS.join(", ")}
  --quiet, -q            print only the summary and verdict
  --version, -V          print the version
  --help, -h             print this help

exit codes:
  0  no findings at or above the fail-on threshold
  1  findings at or above the threshold
  2  usage, configuration or input error
`;

class UsageError extends Error {}

interface Options {
  command: "scan" | "rules" | "explain" | "init";
  dir: string;
  ruleId?: string;
  configPath?: string;
  format: "text" | "json";
  failOn?: Severity;
  ecosystems?: Ecosystem[];
  quiet: boolean;
  force: boolean;
}

function parseArgs(argv: string[]): Options | "help" | "version" {
  const opts: Options = { command: "scan", dir: ".", format: "text", quiet: false, force: false };
  const positional: string[] = [];

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i] ?? "";
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new UsageError(`${arg} needs a value`);
      return v;
    };
    switch (arg) {
      case "--help":
      case "-h":
        return "help";
      case "--version":
      case "-V":
        return "version";
      case "--config":
        opts.configPath = next();
        break;
      case "--format": {
        const v = next();
        if (v !== "text" && v !== "json") throw new UsageError(`--format must be text or json, got "${v}"`);
        opts.format = v;
        break;
      }
      case "--fail-on": {
        const v = next();
        if (!SEVERITIES.includes(v as Severity)) {
          throw new UsageError(`--fail-on must be one of ${SEVERITIES.join(", ")}, got "${v}"`);
        }
        opts.failOn = v as Severity;
        break;
      }
      case "--ecosystems": {
        const list = next().split(",").map((s) => s.trim()).filter((s) => s.length > 0);
        for (const eco of list) {
          if (!ECOSYSTEMS.includes(eco as Ecosystem)) {
            throw new UsageError(`--ecosystems entry "${eco}" is not one of ${ECOSYSTEMS.join(", ")}`);
          }
        }
        if (list.length === 0) throw new UsageError("--ecosystems needs at least one ecosystem");
        opts.ecosystems = [...new Set(list)] as Ecosystem[];
        break;
      }
      case "--quiet":
      case "-q":
        opts.quiet = true;
        break;
      case "--force":
        opts.force = true;
        break;
      default:
        if (arg.startsWith("-")) throw new UsageError(`unknown option: ${arg} (see --help)`);
        positional.push(arg);
    }
  }

  const first = positional[0];
  if (first === "rules" || first === "explain" || first === "init" || first === "scan") {
    opts.command = first;
    positional.shift();
  }
  if (opts.command === "explain") {
    const id = positional.shift();
    if (id === undefined) throw new UsageError("explain needs a rule id (see: claimcheck rules)");
    opts.ruleId = id;
  }
  if (opts.command === "scan" || opts.command === "init") {
    const dir = positional.shift();
    if (dir !== undefined) opts.dir = dir;
  }
  if (positional.length > 0) {
    throw new UsageError(`unexpected argument: ${positional[0]}`);
  }
  return opts;
}

function loadConfig(opts: Options): ResolvedConfig {
  let configPath = opts.configPath;
  if (configPath === undefined) {
    const candidate = path.join(opts.dir, CONFIG_FILENAME);
    if (fs.existsSync(candidate)) configPath = candidate;
  }
  let config: ResolvedConfig;
  if (configPath !== undefined) {
    let text: string;
    try {
      text = fs.readFileSync(configPath, "utf8");
    } catch {
      throw new UsageError(`cannot read config file: ${configPath}`);
    }
    config = parseConfig(text, configPath);
  } else {
    config = defaultConfig();
  }
  if (opts.failOn !== undefined) config.failOn = opts.failOn;
  if (opts.ecosystems !== undefined) config.ecosystems = opts.ecosystems;
  return config;
}

function runScan(opts: Options): number {
  const config = loadConfig(opts);
  const result = scan(opts.dir, config);
  process.stdout.write(opts.format === "json" ? renderJson(result) : renderText(result, opts.quiet));
  if (config.internal.length === 0 && opts.format === "text" && !opts.quiet) {
    process.stderr.write(
      `note: no internal patterns configured — rules that target internal names are inert. Run "claimcheck init" or add "internal" to ${CONFIG_FILENAME}.\n`,
    );
  }
  return result.ok ? 0 : 1;
}

function runInit(opts: Options): number {
  const target = path.join(opts.dir, CONFIG_FILENAME);
  if (fs.existsSync(target) && !opts.force) {
    throw new UsageError(`${target} already exists (use --force to overwrite)`);
  }
  if (!fs.existsSync(opts.dir) || !fs.statSync(opts.dir).isDirectory()) {
    throw new UsageError(`not a directory: ${opts.dir}`);
  }
  const internal = inferInternalPatterns(opts.dir);
  const starter = {
    internal,
    publicRegistries: [],
    privateRegistries: [],
    ignore: [],
    failOn: "low",
  };
  fs.writeFileSync(target, JSON.stringify(starter, null, 2) + "\n");
  process.stdout.write(`wrote ${target} (${internal.length} inferred internal pattern${internal.length === 1 ? "" : "s"})\n`);
  if (internal.length === 0) {
    process.stdout.write(`nothing could be inferred — add your naming conventions to "internal" by hand\n`);
  }
  return 0;
}

export function main(argv: string[]): number {
  let parsed: Options | "help" | "version";
  try {
    parsed = parseArgs(argv);
    if (parsed === "help") {
      process.stdout.write(USAGE);
      return 0;
    }
    if (parsed === "version") {
      process.stdout.write(`${VERSION}\n`);
      return 0;
    }
    switch (parsed.command) {
      case "rules":
        process.stdout.write(renderRules(RULES));
        return 0;
      case "explain": {
        const rule = getRule(parsed.ruleId ?? "");
        if (rule === undefined) {
          throw new UsageError(`unknown rule id: ${parsed.ruleId} (see: claimcheck rules)`);
        }
        process.stdout.write(renderExplain(rule));
        return 0;
      }
      case "init":
        return runInit(parsed);
      case "scan":
        return runScan(parsed);
    }
  } catch (e) {
    if (e instanceof UsageError || e instanceof ConfigError || e instanceof ScanRootError) {
      process.stderr.write(`claimcheck: ${e.message}\n`);
      return 2;
    }
    throw e;
  }
}

process.exitCode = main(process.argv.slice(2));
