/** Minimal Node globals used by tests (the app tsconfig does not load @types/node). */
declare const process: { readonly env: Readonly<Record<string, string | undefined>> };
