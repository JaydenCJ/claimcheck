// Shared test helpers: build throwaway project trees inside fresh temp
// directories and run the compiled CLI against them. Every test is hermetic:
// no network, no shared mutable state, no reliance on the repo's own tree
// (except the compiled dist/ and the committed examples/, which are inputs
// by design).
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import url from "node:url";

export const ROOT = path.join(path.dirname(url.fileURLToPath(import.meta.url)), "..");
export const CLI = path.join(ROOT, "dist", "cli.js");

/** Create a fresh temp directory; caller cleans up via t.after or rmTree. */
export function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "claimcheck-test-"));
}

export function rmTree(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
}

/**
 * Materialize a file tree from a { "relative/path": content } spec.
 * Objects are JSON-stringified, strings written verbatim.
 */
export function writeTree(dir, spec) {
  for (const [rel, content] of Object.entries(spec)) {
    const target = path.join(dir, ...rel.split("/"));
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const text = typeof content === "string" ? content : JSON.stringify(content, null, 2);
    fs.writeFileSync(target, text);
  }
  return dir;
}

/** Run the compiled CLI; returns { stdout, stderr, code } without throwing. */
export function runCli(args, options = {}) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...options,
  });
  return { stdout: r.stdout ?? "", stderr: r.stderr ?? "", code: r.status ?? -1 };
}

/** A ResolvedConfig literal for direct auditor calls. */
export function config(overrides = {}) {
  return {
    internal: [],
    publicRegistries: [],
    privateRegistries: [],
    ignore: [],
    failOn: "low",
    ecosystems: ["npm", "pip", "maven"],
    ...overrides,
  };
}

/** Findings filtered to one rule id, for focused assertions. */
export function byRule(findings, id) {
  return findings.filter((f) => f.id === id);
}
