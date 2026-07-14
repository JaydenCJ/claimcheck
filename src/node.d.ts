/**
 * Minimal ambient declarations for the handful of Node.js built-ins this
 * project uses. Declaring them in-repo keeps `typescript` the only
 * devDependency (no `@types/node`); the surface below is intentionally
 * restricted to exactly what `src/` calls, so a typo against a real Node
 * API still fails to compile.
 */

declare module "node:fs" {
  export interface Stats {
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }
  export interface Dirent {
    name: string;
    isDirectory(): boolean;
    isFile(): boolean;
    isSymbolicLink(): boolean;
  }
  export function readFileSync(path: string, encoding: "utf8"): string;
  export function writeFileSync(path: string, data: string): void;
  export function readdirSync(path: string, options: { withFileTypes: true }): Dirent[];
  export function statSync(path: string): Stats;
  export function existsSync(path: string): boolean;
  const fs: {
    readFileSync: typeof readFileSync;
    writeFileSync: typeof writeFileSync;
    readdirSync: typeof readdirSync;
    statSync: typeof statSync;
    existsSync: typeof existsSync;
  };
  export default fs;
}

declare module "node:path" {
  export function join(...parts: string[]): string;
  export function resolve(...parts: string[]): string;
  export function basename(p: string, ext?: string): string;
  export function dirname(p: string): string;
  export const posix: {
    join(...parts: string[]): string;
    dirname(p: string): string;
    normalize(p: string): string;
  };
  const path: {
    join: typeof join;
    resolve: typeof resolve;
    basename: typeof basename;
    dirname: typeof dirname;
    posix: typeof posix;
  };
  export default path;
}

declare module "node:process" {
  const process: {
    argv: string[];
    cwd(): string;
    exitCode: number | undefined;
    stdout: { write(chunk: string): boolean };
    stderr: { write(chunk: string): boolean };
  };
  export default process;
}

/** WHATWG URL (a global in every supported Node version; lib is ES2022-only). */
declare class URL {
  constructor(input: string, base?: string);
  protocol: string;
  hostname: string;
  pathname: string;
  href: string;
}

declare var process: {
  argv: string[];
  exitCode: number | undefined;
  stdout: { write(chunk: string): boolean };
  stderr: { write(chunk: string): boolean };
};
