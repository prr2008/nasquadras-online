import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as coverage from '../src/coverage.js';

const memKV = () => { const m = new Map(); return { get: async (k) => m.get(k) ?? null, put: async (k, v) => void m.set(k, v), delete: async (k) => void m.delete(k), m }; };

test('retoma o fio até 30 min depois de encerrar, mantendo o ponto do fio', async () => {
  const env = { KV: memKV() };
  await coverage.start(env, 'Flamengo x Caxias');
  await coverage.threadsAppend(env, { id: 't1', url: 'u1' });
  const stopped = await coverage.stop(env);
  assert.equal(stopped.active, false);
  assert.ok(stopped.endedAt);
  const back = await coverage.resume(env, stopped.endedAt + 10 * 60_000);
  assert.equal(back.active, true);
  assert.equal(back.endedAt, null);
  assert.equal(await coverage.threadsReplyTo(env), 't1');
});

test('não retoma depois de 30 min', async () => {
  const env = { KV: memKV() };
  await coverage.start(env, 'Jogo');
  const s = await coverage.stop(env);
  await assert.rejects(() => coverage.resume(env, s.endedAt + 31 * 60_000), /30 minutos/);
});
