// Posts agendados: ficam no D1 e a rotina de cada minuto publica os que
// venceram no Threads, no Bluesky e no site. O post pode abrir a cobertura do
// jogo (vira o 1º do fio e cria a página no site) ou responder no fio.
// A versão para o X vai para a fila do Buffer no momento do agendamento.

import * as threads from './threads.js';
import * as bluesky from './bluesky.js';
import * as coverage from './coverage.js';
import * as site from './site.js';
import * as buffer from './buffer.js';
import { graphemeLength } from './text.js';

const KEY_RE = /^[0-9]{13}-[0-9a-f-]{36}\.(jpg|png|webp|gif|mp4|mov|webm)$/;
const THREAD_MODES = new Set(['start', 'reply', 'none']);
const STUCK_MS = 20 * 60 * 1000;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function cleanMedia(media) {
  return (Array.isArray(media) ? media : [])
    .filter((m) => m && KEY_RE.test(m.key))
    .slice(0, 10)
    .map((m) => ({
      key: m.key,
      kind: m.kind === 'video' ? 'video' : 'image',
      mime: String(m.mime || ''),
      width: Number(m.width) || undefined,
      height: Number(m.height) || undefined,
      alt: typeof m.alt === 'string' ? m.alt.slice(0, 1000) : '',
    }));
}

const withUrls = (origin, media) => media.map((m) => ({ ...m, url: `${origin}/m/${m.key}` }));

function parseRow(r) {
  if (!r) return null;
  return {
    ...r,
    media: JSON.parse(r.media || '[]'),
    targets: JSON.parse(r.targets || '{}'),
    result: r.result ? JSON.parse(r.result) : null,
  };
}

function validate(input, origin) {
  const runAt = Number(input.runAt);
  if (!Number.isFinite(runAt)) throw new Error('Escolha a data e a hora.');
  if (runAt < Date.now() - 60_000) throw new Error('Esse horário já passou.');
  if (runAt > Date.now() + 60 * 86400e3) throw new Error('Agende para no máximo 60 dias à frente.');
  const text = String(input.text || '').trim();
  const media = cleanMedia(input.media);
  const t = input.targets || {};
  const targets = { threads: Boolean(t.threads), bluesky: Boolean(t.bluesky), site: Boolean(t.site) };
  const xText = input.x && typeof input.x.text === 'string' ? input.x.text.trim() : null;
  if (!targets.threads && !targets.bluesky && !targets.site && xText == null) throw new Error('Escolha pelo menos um destino.');
  if (!text && !media.length) throw new Error('Escreva algo ou anexe uma mídia.');
  if (targets.threads && graphemeLength(text) > 500) {
    throw new Error('Texto passa de 500 caracteres para o Threads.');
  }
  if (xText != null && !xText && !media.length) throw new Error('Escreva o texto para o X.');
  const thread = THREAD_MODES.has(input.thread) ? input.thread : 'none';
  return {
    run_at: runAt,
    text,
    media,
    targets,
    thread,
    title: thread === 'start' ? String(input.title || '').trim().slice(0, 80) || 'Cobertura' : null,
    lnb_id: input.lnbId ? String(input.lnbId).slice(0, 20) : null,
    origin: origin.replace(/^http:\/\/(?!localhost|127\.)/, 'https://'),
    x_text: xText,
  };
}

async function sendToBuffer(env, v) {
  if (v.x_text == null) return null;
  return buffer.schedulePost(env, { text: v.x_text, dueAt: v.run_at, media: withUrls(v.origin, v.media) });
}

export async function create(env, input, origin) {
  const v = validate(input, origin);
  const bufferId = await sendToBuffer(env, v);
  const now = Date.now();
  const res = await env.DB.prepare(
    `INSERT INTO scheduled (run_at, text, media, targets, thread, title, lnb_id, origin, x_text, buffer_id, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?)`,
  ).bind(v.run_at, v.text, JSON.stringify(v.media), JSON.stringify(v.targets), v.thread, v.title, v.lnb_id, v.origin,
    v.x_text, bufferId, now, now).run();
  return get(env, res.meta.last_row_id);
}

/** Editar = trocar o conteúdo de um agendamento que ainda não saiu. */
export async function update(env, id, input, origin) {
  const cur = await get(env, id);
  if (!cur) return null;
  if (cur.status !== 'pending') throw new Error('Esse post já saiu ou foi cancelado.');
  const v = validate(input, origin);
  if (cur.buffer_id) await buffer.deletePost(env, cur.buffer_id).catch(() => {});
  const bufferId = await sendToBuffer(env, v);
  const r = await env.DB.prepare(
    `UPDATE scheduled SET run_at = ?, text = ?, media = ?, targets = ?, thread = ?, title = ?, lnb_id = ?, origin = ?,
       x_text = ?, buffer_id = ?, updated_at = ? WHERE id = ? AND status = 'pending'`,
  ).bind(v.run_at, v.text, JSON.stringify(v.media), JSON.stringify(v.targets), v.thread, v.title, v.lnb_id, v.origin,
    v.x_text, bufferId, Date.now(), id).run();
  if (!r.meta.changes) throw new Error('Esse post acabou de sair.');
  return get(env, id);
}

export async function cancel(env, id) {
  const cur = await get(env, id);
  if (!cur) return false;
  if (cur.status === 'pending') {
    const r = await env.DB.prepare("UPDATE scheduled SET status = 'canceled', updated_at = ? WHERE id = ? AND status = 'pending'")
      .bind(Date.now(), id).run();
    if (!r.meta.changes) throw new Error('Esse post acabou de sair.');
    let note = null;
    if (cur.buffer_id) {
      try { await buffer.deletePost(env, cur.buffer_id); } catch (err) { note = `Não consegui tirar do Buffer (${err.message}). Apague lá o post do X.`; }
    }
    return { ok: true, note };
  }
  // Já saiu, deu erro ou foi cancelado: só tira da lista.
  await env.DB.prepare('DELETE FROM scheduled WHERE id = ?').bind(id).run();
  return { ok: true };
}

export async function get(env, id) {
  return parseRow(await env.DB.prepare('SELECT * FROM scheduled WHERE id = ?').bind(id).first());
}

/** Pendentes (por horário) e os últimos que já saíram. */
export async function list(env) {
  const { results: pending } = await env.DB.prepare(
    "SELECT * FROM scheduled WHERE status IN ('pending', 'sending') ORDER BY run_at ASC LIMIT 50",
  ).all();
  const { results: done } = await env.DB.prepare(
    "SELECT * FROM scheduled WHERE status IN ('sent', 'error', 'partial') AND run_at > ? ORDER BY run_at DESC LIMIT 10",
  ).bind(Date.now() - 2 * 86400e3).all();
  return { pending: pending.map(parseRow), done: done.map(parseRow) };
}

/** Mídias de agendamentos pendentes ou recentes: a limpeza diária não pode apagar. */
export async function referencedKeys(env) {
  const { results } = await env.DB.prepare(
    "SELECT media FROM scheduled WHERE status IN ('pending', 'sending') OR run_at > ?",
  ).bind(Date.now() - 3 * 86400e3).all();
  const keys = new Set();
  for (const r of results) for (const m of JSON.parse(r.media || '[]')) keys.add(m.key);
  return keys;
}

// ---------- Publicação ----------

async function threadsPost(env, text, media, replyToId) {
  let { containerId, itemIds } = await threads.createContainers(env, { text, media, replyToId });
  const wait = async (ids, maxTries) => {
    for (let i = 0; i < maxTries; i++) {
      const st = await threads.containerStatus(env, ids);
      const bad = st.find((s) => s.status === 'ERROR' || s.status === 'EXPIRED');
      if (bad) throw new Error(bad.error || 'o Threads não aceitou a mídia');
      if (st.every((s) => s.status === 'FINISHED')) return;
      await sleep(media.some((m) => m.kind === 'video') ? 5000 : 2000);
    }
    throw new Error('o Threads demorou demais para processar a mídia');
  };
  if (itemIds.length) {
    await wait(itemIds, 60);
    containerId = (await threads.createCarousel(env, { text, itemIds, replyToId })).containerId;
  }
  await wait([containerId], 60);
  return threads.publish(env, containerId);
}

async function appendHistory(env, entry) {
  const list = JSON.parse((await env.KV.get('history')) || '[]');
  list.unshift({ ...entry, at: new Date().toISOString() });
  await env.KV.put('history', JSON.stringify(list.slice(0, 40)));
}

/** Publica um agendamento agora (chamado pela rotina ou por "Publicar agora"). */
export async function publish(env, row) {
  const media = withUrls(row.origin, row.media);
  const { targets } = row;
  const result = {};

  if (row.thread === 'start') {
    const cov = await coverage.start(env, row.title || 'Cobertura');
    if (targets.site) {
      const slug = await site.ensureGame(env, { title: cov.title || 'Cobertura', startedAt: cov.startedAt, lnbId: row.lnb_id });
      await coverage.setSlug(env, slug);
    }
  }
  const inThread = row.thread !== 'none' && (await coverage.get(env)).active;

  const jobs = [];
  if (targets.threads) {
    jobs.push((async () => {
      const auth = await threads.getAuth(env);
      const replyToId = inThread && threads.canReply(auth) ? await coverage.threadsReplyTo(env) : null;
      const r = await threadsPost(env, row.text, media, replyToId);
      if (inThread) await coverage.threadsAppend(env, r);
      result.threads = r.url || 'ok';
    })().catch((err) => { result.threadsError = err.message; }));
  }
  if (targets.bluesky) {
    jobs.push((async () => {
      const replyTo = inThread ? await coverage.blueskyReplyTo(env) : null;
      const r = await bluesky.post(env, { text: row.text, media, replyTo });
      if (inThread) await coverage.blueskyAppend(env, r);
      result.bluesky = r.url;
    })().catch((err) => { result.blueskyError = err.message; }));
  }
  if (targets.site) {
    jobs.push((async () => {
      const m = await coverage.meta(env);
      if (!m?.active) throw new Error('nenhuma cobertura ativa no horário (o post não foi para o site)');
      let slug = m.slug;
      if (!slug) {
        slug = await site.ensureGame(env, { title: m.title || 'Cobertura', startedAt: m.startedAt || Date.now(), lnbId: row.lnb_id });
        await coverage.setSlug(env, slug);
      }
      await site.addPost(env, slug, { text: row.text, media, lnbId: row.lnb_id });
      result.site = `${row.origin}/c/${slug}`;
    })().catch((err) => { result.siteError = err.message; }));
  }
  await Promise.all(jobs);
  if (row.buffer_id) result.x = 'buffer';

  const ok = ['threads', 'bluesky', 'site'].filter((k) => result[k]);
  const failed = ['threads', 'bluesky', 'site'].filter((k) => result[`${k}Error`]);
  const status = failed.length ? (ok.length ? 'partial' : 'error') : 'sent';
  await env.DB.prepare('UPDATE scheduled SET status = ?, result = ?, updated_at = ? WHERE id = ?')
    .bind(status, JSON.stringify(result), Date.now(), row.id).run();
  if (ok.length) {
    await appendHistory(env, { text: `⏰ ${row.text}`.slice(0, 200), threads: result.threads || null, bluesky: result.bluesky || null, site: result.site || null });
  }
  return { status, result };
}

/** Reserva o agendamento (evita publicar duas vezes) e publica. */
export async function claimAndPublish(env, id, { now = false } = {}) {
  const t = Date.now();
  const r = await env.DB.prepare(
    `UPDATE scheduled SET status = 'sending', updated_at = ?${now ? ', run_at = ?' : ''} WHERE id = ? AND status = 'pending'`,
  ).bind(...(now ? [t, t, id] : [t, id])).run();
  if (!r.meta.changes) throw new Error('Esse post já saiu ou foi cancelado.');
  return publish(env, await get(env, id));
}

/** Rotina de cada minuto: publica, em ordem, os que já venceram. */
export async function runDue(env) {
  await env.DB.prepare("UPDATE scheduled SET status = 'error', result = ?, updated_at = ? WHERE status = 'sending' AND updated_at < ?")
    .bind(JSON.stringify({ error: 'Publicação interrompida. Confira as redes antes de tentar de novo.' }), Date.now(), Date.now() - STUCK_MS).run();
  const { results } = await env.DB.prepare(
    "SELECT id FROM scheduled WHERE status = 'pending' AND run_at <= ? ORDER BY run_at ASC, id ASC LIMIT 10",
  ).bind(Date.now()).all();
  // Em sequência: o post que abre o fio precisa sair antes das respostas.
  for (const { id } of results) {
    try { await claimAndPublish(env, id); } catch (err) { console.error('agendado', id, err); }
  }
  return results.length;
}
