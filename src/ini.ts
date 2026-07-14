/**
 * Minimal INI reader covering the two dialects claimcheck consumes:
 *
 *  - `.npmrc`: flat `key=value` lines, `#`/`;` comments, no sections.
 *  - `pip.conf` / `pip.ini`: `[section]` headers plus configparser-style
 *    multi-line values (continuation lines indented under their key).
 *
 * The parser returns a flat entry list with line numbers so auditors can cite
 * the exact line a finding came from.
 */

export interface IniEntry {
  section: string;
  key: string;
  /** Continuation lines are joined with "\n" (configparser semantics). */
  value: string;
  /** 1-based line of the `key = value` line. */
  line: number;
}

export function parseIni(text: string): IniEntry[] {
  const entries: IniEntry[] = [];
  let section = "";
  let current: IniEntry | null = null;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i] ?? "";
    const trimmed = raw.trim();

    if (trimmed.length === 0) {
      current = null;
      continue;
    }
    if (trimmed.startsWith("#") || trimmed.startsWith(";")) continue;

    // Continuation: indented, non-header line while a key is open.
    if (current !== null && /^[ \t]/.test(raw) && !trimmed.startsWith("[")) {
      current.value += (current.value.length > 0 ? "\n" : "") + trimmed;
      continue;
    }
    current = null;

    const header = /^\[([^\]]*)\]$/.exec(trimmed);
    if (header !== null) {
      section = (header[1] ?? "").trim();
      continue;
    }

    const eq = trimmed.indexOf("=");
    if (eq < 0) continue; // bare word: not meaningful to any consumer here
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (key.length === 0) continue;
    const entry: IniEntry = { section, key, value, line: i + 1 };
    entries.push(entry);
    current = entry;
  }
  return entries;
}

/** All entries for `key` under `section` (order preserved; keys may repeat). */
export function iniLookup(entries: readonly IniEntry[], section: string, key: string): IniEntry[] {
  return entries.filter((e) => e.section === section && e.key === key);
}
