/**
 * Minimal ambient types for `node:sqlite` (stable since Node 24, built in — no
 * native module to compile). @types/node ships its own declarations on newer
 * releases; this fallback keeps `tsc` green on the versions that don't yet.
 * Only the surface this bot actually uses is declared.
 */
declare module "node:sqlite" {
  interface StatementSync {
    get(...params: unknown[]): unknown;
    all(...params: unknown[]): unknown[];
    run(...params: unknown[]): { changes: number | bigint; lastInsertRowid: number | bigint };
  }

  interface DatabaseSyncOptions {
    open?: boolean;
    readOnly?: boolean;
    enableForeignKeyConstraints?: boolean;
  }

  class DatabaseSync {
    constructor(path: string, options?: DatabaseSyncOptions);
    close(): void;
    exec(sql: string): void;
    prepare(sql: string): StatementSync;
  }

  export { DatabaseSync, StatementSync };
}
