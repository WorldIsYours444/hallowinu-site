/* Minimal Cloudflare D1 API over node:sqlite for tests and local dev.
   Mirrors: prepare().bind().first()/all()/run(), batch() (atomic), exec(). */
import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import path from 'node:path';

class Stmt {
  constructor(db, sql, params = []) { this.db = db; this.sql = sql; this.params = params; }
  bind(...args) {
    for (const a of args) if (a === undefined) throw new Error('D1_TYPE_ERROR: Type undefined is not supported');
    return new Stmt(this.db, this.sql, args.map(a => (typeof a === 'boolean' ? (a ? 1 : 0) : a)));
  }
  _exec(kind) {
    const st = this.db.raw.prepare(this.sql);
    if (kind === 'run' && !/\bRETURNING\b/i.test(this.sql)) { const r = st.run(...this.params); return { rows: [], changes: Number(r.changes), last: Number(r.lastInsertRowid) }; }
    const rows = st.all(...this.params).map(r => ({ ...r }));
    return { rows, changes: rows.length, last: 0 };
  }
  async first(col) { const r = this._exec('all').rows[0]; return r == null ? null : col ? r[col] : r; }
  async all() { const r = this._exec('all'); return { results: r.rows, success: true, meta: { changes: r.changes } }; }
  async run() { const r = this._exec('run'); return { results: r.rows, success: true, meta: { changes: r.changes, last_row_id: r.last } }; }
}

export class D1Shim {
  constructor(file = ':memory:') { this.raw = new DatabaseSync(file); this.raw.exec('PRAGMA foreign_keys = ON;'); }
  prepare(sql) { return new Stmt(this, sql); }
  async batch(stmts) {
    this.raw.exec('BEGIN');
    try { const out = stmts.map(s => { const r = s._exec('run'); return { results: r.rows, success: true, meta: { changes: r.changes } }; }); this.raw.exec('COMMIT'); return out; }
    catch (e) { this.raw.exec('ROLLBACK'); throw e; }
  }
  async exec(sql) { this.raw.exec(sql); return { count: 1 }; }
  migrate(dir) {
    for (const f of fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort()) this.raw.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
  }
}
