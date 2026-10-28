// "Fio da cobertura": enquanto ativo, cada post responde ao anterior,
// formando um fio único por jogo no Threads e no Bluesky.
// Cada rede guarda seu ponto do fio numa chave própria, porque as duas
// publicações correm em paralelo e não podem sobrescrever uma à outra.

const META = 'cov:meta';
const NET = { threads: 'cov:threads', bluesky: 'cov:bluesky' };

const read = async (env, key) => JSON.parse((await env.KV.get(key)) || 'null');

export async function get(env) {
  const [meta, threads, bluesky] = await Promise.all([
    read(env, META), read(env, NET.threads), read(env, NET.bluesky),
  ]);
  return {
    active: Boolean(meta?.active),
    title: meta?.title || '',
    startedAt: meta?.startedAt || null,
    threads: threads ? { count: threads.count, rootUrl: threads.rootUrl } : { count: 0 },
    bluesky: bluesky ? { count: bluesky.count, rootUrl: bluesky.rootUrl } : { count: 0 },
  };
}

/** Começa um fio novo: o próximo post vira o primeiro do fio. */
export async function start(env, title = '') {
  await Promise.all([env.KV.delete(NET.threads), env.KV.delete(NET.bluesky)]);
  await env.KV.put(META, JSON.stringify({ active: true, title: String(title).slice(0, 80), startedAt: Date.now() }));
  return get(env);
}

/** Encerra o fio: os próximos posts saem soltos. */
export async function stop(env) {
  const meta = await read(env, META);
  await env.KV.put(META, JSON.stringify({ ...(meta || {}), active: false }));
  return get(env);
}

async function isActive(env) {
  return Boolean((await read(env, META))?.active);
}

// ---------- Threads ----------

/** ID do último post do fio (para usar em reply_to_id), ou null se for o primeiro. */
export async function threadsReplyTo(env) {
  if (!(await isActive(env))) return null;
  return (await read(env, NET.threads))?.lastId || null;
}

export async function threadsAppend(env, { id, url }) {
  if (!(await isActive(env))) return;
  const cur = await read(env, NET.threads);
  await env.KV.put(NET.threads, JSON.stringify({
    rootId: cur?.rootId || id,
    rootUrl: cur?.rootUrl || url || null,
    lastId: id,
    count: (cur?.count || 0) + 1,
  }));
}

// ---------- Bluesky ----------

export async function blueskyReplyTo(env) {
  if (!(await isActive(env))) return null;
  const cur = await read(env, NET.bluesky);
  return cur ? { root: cur.root, parent: cur.parent } : null;
}

export async function blueskyAppend(env, { root, last, rootUrl, parts }) {
  if (!(await isActive(env))) return;
  const cur = await read(env, NET.bluesky);
  await env.KV.put(NET.bluesky, JSON.stringify({
    root: cur?.root || root,
    rootUrl: cur?.rootUrl || rootUrl,
    parent: last,
    count: (cur?.count || 0) + (parts || 1),
  }));
}
