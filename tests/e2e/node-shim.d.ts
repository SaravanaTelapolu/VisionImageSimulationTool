// Minimal typings for the few Node modules the e2e spec uses. @types/node is not installed
// (and no dependency may be added), but `tsc --noEmit` type-checks tests/**.
declare module 'node:fs' {
  export function readFileSync(path: string): Uint8Array;
}
declare module 'node:url' {
  export function fileURLToPath(url: URL | string): string;
}
