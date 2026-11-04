import { invoke } from '@tauri-apps/api/core';
import type { Db, SqlValue, Stmt } from './db';

export class TauriDb implements Db {
  select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    return invoke<T[]>('db_select', { sql, params });
  }
  execute(sql: string, params: SqlValue[] = []): Promise<number> {
    return invoke<number>('db_execute', { sql, params });
  }
  batch(stmts: Stmt[]): Promise<void> {
    return invoke('db_batch', { stmts: stmts.map((s) => ({ sql: s.sql, params: s.params ?? [] })) });
  }
}
