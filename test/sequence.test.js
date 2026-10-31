// Sequência de agendados: um post por execução, em ordem, com a corrente
// abrindo a execução seguinte; a rotina de cada minuto não fura a fila.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import * as schedule from '../src/schedule.js';

/** D1 de mentira em cima do SQLite do Node. */
function d1() {
  const db = new DatabaseSync(':memory:');
  const ddl = readFileSync(new URL('../schema.sql', import.meta.url), 'utf8');
  db.exec(ddl.slice(ddl.indexOf('CREATE TABLE IF NOT EXISTS scheduled'), ddl.indexOf(');', ddl.indexOf('CREATE TABLE IF NOT EXISTS scheduled')) + 2));
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes), last_row_id: Number(r.lastInsertRowid) } }; },
  });
  return { prepare: (sql) => stmt(sql), raw: db };
}
const memKV = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k), m }; };

function seed(env, n, runAt) {
  for (let i = 1; i <= n; i++) {
    env.DB.raw.prepare(`INSERT INTO scheduled (run_at, text, targets, thread, origin, status, created_at, updated_at)
      VALUES (?, ?, '{}', ?, 'https://app.x', 'pending', 0, 0)`).run(runAt, `post ${i}`, i === 1 ? 'start' : 'reply');
  }
}

test('publica um por execução, em ordem, e a corrente segue até o fim', async () => {
  const env = { DB: d1(), KV: memKV() };
  const now = Date.now();
  seed(env, 3, now - 1000);
  const order = [];
  const orig = env.DB.prepare;
  env.DB.prepare = (sql) => {
    if (/SET status = 'sending'/.test(sql)) {
      const s = orig(sql);
      return { bind: (...a) => { order.push(a.at(-1)); return s.bind(...a); } };
    }
    return orig(sql);
  };
  let hops = 0;
  const next = async () => { hops++; await schedule.runDue(env, { next }); };
  await schedule.runDue(env, { next }).catch(() => {});
  assert.deepEqual(order, [1, 2, 3]);
  assert.equal(hops, 2);
  const left = env.DB.raw.prepare("SELECT COUNT(*) AS n FROM scheduled WHERE status = 'pending'").get();
  assert.equal(left.n, 0);
});

test('com um post saindo, a rotina espera', async () => {
  const env = { DB: d1(), KV: memKV() };
  seed(env, 2, Date.now() - 1000);
  env.DB.raw.prepare("UPDATE scheduled SET status = 'sending', updated_at = ? WHERE id = 1").run(Date.now());
  assert.equal(await schedule.runDue(env), 0);
  assert.equal(env.DB.raw.prepare('SELECT status FROM scheduled WHERE id = 2').get().status, 'pending');
});
