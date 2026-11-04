import type { Database, SqlJsStatic } from 'sql.js';
import type { Db, SqlValue, Stmt } from './db';

/**
 * sql.js implementation, used by unit tests and by the plain-browser preview.
 * In the browser the file is snapshotted to localStorage after each write.
 */
export class SqlJsDb implements Db {
  private constructor(
    private db: Database,
    private persistKey: string | null,
  ) {
    db.exec('PRAGMA foreign_keys = ON;');
  }

  static async create(SQL: SqlJsStatic, persistKey: string | null = null): Promise<SqlJsDb> {
    let data: Uint8Array | undefined;
    if (persistKey) {
      try {
        const saved = localStorage.getItem(persistKey);
        if (saved) data = Uint8Array.from(atob(saved), (c) => c.charCodeAt(0));
      } catch {
        /* storage unavailable: start empty */
      }
    }
    return new SqlJsDb(new SQL.Database(data), persistKey);
  }

  private persist() {
    if (!this.persistKey) return;
    try {
      const bytes = this.db.export();
      let s = '';
      for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
      localStorage.setItem(this.persistKey, btoa(s));
    } catch {
      /* best effort */
    }
  }

  async select<T>(sql: string, params: SqlValue[] = []): Promise<T[]> {
    const stmt = this.db.prepare(sql);
    try {
      stmt.bind(params);
      const out: T[] = [];
      while (stmt.step()) out.push(stmt.getAsObject() as T);
      return out;
    } finally {
      stmt.free();
    }
  }

  private run(sql: string, params: SqlValue[]) {
    if (!params.length && sql.trim().replace(/;$/, '').includes(';')) this.db.exec(sql);
    else this.db.run(sql, params);
    return this.db.getRowsModified();
  }

  async execute(sql: string, params: SqlValue[] = []): Promise<number> {
    const n = this.run(sql, params);
    this.persist();
    return n;
  }

  async batch(stmts: Stmt[]): Promise<void> {
    this.db.exec('BEGIN');
    try {
      for (const s of stmts) this.run(s.sql, s.params ?? []);
      this.db.exec('COMMIT');
    } catch (e) {
      this.db.exec('ROLLBACK');
      throw e;
    }
    this.persist();
  }
}
