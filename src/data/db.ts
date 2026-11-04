export type SqlValue = string | number | null;

export interface Stmt {
  sql: string;
  params?: SqlValue[];
}

/**
 * Minimal database port. Implemented by the Tauri bridge (rusqlite) in the desktop app
 * and by sql.js for tests and the browser preview.
 */
export interface Db {
  select<T = Record<string, unknown>>(sql: string, params?: SqlValue[]): Promise<T[]>;
  execute(sql: string, params?: SqlValue[]): Promise<number>;
  /** Atomic: all statements commit or none do. */
  batch(stmts: Stmt[]): Promise<void>;
}
