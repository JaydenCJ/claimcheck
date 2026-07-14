/**
 * Renderers. Text output is grep-friendly, column-aligned and byte-stable —
 * identical inputs produce identical bytes, so scan reports diff cleanly in
 * CI logs. JSON output has a stable, additive-only shape (documented in the
 * README); consumers may rely on existing fields never being renamed.
 */

import type { Ecosystem, Finding, Rule, ScanResult } from "./types.js";
import { ECOSYSTEMS } from "./types.js";
import { VERSION } from "./version.js";

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

function findingLine(f: Finding): string {
  const sev = f.severity.toUpperCase().padEnd(8);
  const subject = f.package !== undefined ? `${f.package}: ` : "";
  return `  ${sev}  ${f.id}  ${subject}${f.message}  [${f.file}]`;
}

export function renderText(result: ScanResult, quiet = false): string {
  const lines: string[] = [];
  const projectCounts = ECOSYSTEMS.filter((e) => result.ecosystems.includes(e)).map((eco) => {
    const n = result.projects.filter((p) => p.ecosystem === eco).length;
    return `${n} ${eco}`;
  });
  lines.push(`claimcheck v${VERSION} — ${result.root} (${projectCounts.join(", ")})`);

  if (!quiet) {
    if (result.projects.length === 0) {
      lines.push("");
      lines.push("no projects found — looked for package.json, requirements*.txt / pip.conf and pom.xml");
    }
    for (const eco of ECOSYSTEMS) {
      const findings = result.findings.filter((f) => f.ecosystem === eco);
      if (findings.length === 0) continue;
      lines.push("");
      lines.push(`${eco}`);
      for (const f of findings) {
        lines.push(findingLine(f));
        lines.push(`            fix: ${f.remediation}`);
      }
    }
    if (result.errors.length > 0) {
      lines.push("");
      lines.push("warnings (files found but not audited):");
      for (const e of result.errors) lines.push(`  ${e.file}: ${e.message}`);
    }
  }

  const s = result.summary;
  lines.push("");
  const ignoredNote = s.ignored > 0 ? ` (${s.ignored} ignored)` : "";
  lines.push(
    `${plural(s.total, "finding")}: ${s.critical} critical, ${s.high} high, ${s.medium} medium, ${s.low} low${ignoredNote}`,
  );
  lines.push(
    result.ok
      ? `claimcheck: OK — no findings at or above "${result.failOn}"`
      : `claimcheck: FAIL — findings at or above "${result.failOn}"`,
  );
  return lines.join("\n") + "\n";
}

export function renderJson(result: ScanResult): string {
  const payload = {
    claimcheck: VERSION,
    root: result.root,
    ecosystems: result.ecosystems,
    projects: result.projects,
    findings: result.findings,
    errors: result.errors,
    summary: result.summary,
    failOn: result.failOn,
    ok: result.ok,
  };
  return JSON.stringify(payload, null, 2) + "\n";
}

export function renderRules(rules: readonly Rule[]): string {
  const lines: string[] = [`claimcheck v${VERSION} — ${rules.length} rules`, ""];
  let lastEco: Ecosystem | null = null;
  for (const r of rules) {
    if (r.ecosystem !== lastEco) {
      if (lastEco !== null) lines.push("");
      lastEco = r.ecosystem;
    }
    lines.push(`${r.id}  ${r.severity.padEnd(8)}  ${r.title}`);
  }
  lines.push("");
  lines.push('run "claimcheck explain <id>" for the why and the fix');
  return lines.join("\n") + "\n";
}

function wrap(text: string, width: number, indent: string): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (current.length > 0 && current.length + 1 + word.length > width) {
      lines.push(indent + current);
      current = word;
    } else {
      current = current.length > 0 ? `${current} ${word}` : word;
    }
  }
  if (current.length > 0) lines.push(indent + current);
  return lines;
}

export function renderExplain(rule: Rule): string {
  const lines: string[] = [
    `${rule.id} — ${rule.title}`,
    `ecosystem: ${rule.ecosystem}`,
    `severity:  ${rule.severity}`,
    "",
    "why it matters:",
    ...wrap(rule.why, 76, "  "),
    "",
    "how to fix it:",
    ...wrap(rule.fix, 76, "  "),
  ];
  return lines.join("\n") + "\n";
}
