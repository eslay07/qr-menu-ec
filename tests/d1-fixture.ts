import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
import { D1DocumentStore } from '../lib/d1-documents';
export function createD1Fixture() {
  const sqlite = new DatabaseSync(':memory:');
  sqlite.exec(readFileSync('deployment/cloudflare/d1-documents.sql','utf8'));
  function prepare(sql: string) {
    let values: Array<string | number | null> = [];
    return {
      bind(...input: Array<string | number | null>) { values=input; return this; },
      async first() { return sqlite.prepare(sql).get(...values) || null; },
      async all() { return { results:sqlite.prepare(sql).all(...values) }; },
      async run() { return { success:true, meta:sqlite.prepare(sql).run(...values) }; },
      execute() { return sqlite.prepare(sql).run(...values); },
    };
  }
  const sql = { prepare, async batch(statements: Array<ReturnType<typeof prepare>>) {
    sqlite.exec('BEGIN');
    try { const results=statements.map(statement=>statement.execute()); sqlite.exec('COMMIT'); return results; }
    catch (error) { sqlite.exec('ROLLBACK'); throw error; }
  }} as unknown as D1Database;
  return { db:new D1DocumentStore(sql), sql, sqlite };
}

