// IndexNow: avisa Bing, Yandex, Seznam, Naver e outros buscadores das páginas
// novas ou alteradas, sem esperar a próxima visita do robô. A chave pública
// fica em https://nasquadras.online/<chave>.txt (exigência do protocolo).
//
// Em vez de mexer em cada botão de publicar, uma rotina a cada 10 minutos
// compara o banco com a última verificação: artigos publicados, coberturas
// (e posts novos nelas), colunas, edições do Zona e páginas fixas.

const ENDPOINT = 'https://api.indexnow.org/indexnow';
const KV_SINCE = 'indexnow:since';
const KV_PAUSE = 'indexnow:pause';
const PAUSE_S = 3 * 3600;
const PAGE_PATH = { sobre: '/sobre', coluna: '/coluna', 'zona-de-conforto': '/zona-de-conforto' };

export const configured = (env) => /^[A-Za-z0-9-]{8,128}$/.test(env.INDEXNOW_KEY || '');

/** Conteúdo do arquivo da chave, quando o caminho é /<chave>.txt. */
export function keyFile(env, pathname) {
  return configured(env) && pathname === `/${env.INDEXNOW_KEY}.txt` ? env.INDEXNOW_KEY : null;
}

/** Endereços que mudaram desde `since` (0 = todos, na primeira vez). */
export async function changedUrls(env, origin, since) {
  const q = (sql, ...args) => env.DB.prepare(sql).bind(...args).all().then((r) => r.results || []);
  const [articles, games, cols, eps, pages] = await Promise.all([
    q(`SELECT slug FROM articles WHERE status = 'published' AND updated_at > ? LIMIT 500`, since),
    q(`SELECT slug FROM games WHERE updated_at > ? UNION SELECT game_slug AS slug FROM posts WHERE created_at > ? LIMIT 300`, since, since),
    q('SELECT id FROM columns WHERE updated_at > ? LIMIT 1', since),
    q('SELECT id FROM episodes WHERE updated_at > ? LIMIT 1', since),
    q('SELECT slug FROM pages WHERE updated_at > ?', since),
  ]);
  const paths = new Set();
  if (articles.length) paths.add('/').add('/blog');
  for (const a of articles) paths.add(`/blog/${a.slug}`);
  if (games.length) paths.add('/').add('/c');
  for (const g of games) paths.add(`/c/${g.slug}`);
  if (cols.length) paths.add('/').add('/coluna');
  if (eps.length) paths.add('/').add('/zona-de-conforto');
  for (const p of pages) if (PAGE_PATH[p.slug]) paths.add(PAGE_PATH[p.slug]);
  if (!since) ['/', '/blog', '/c', '/coluna', '/zona-de-conforto', '/sobre', '/apoie'].forEach((p) => paths.add(p));
  return [...paths].slice(0, 10000).map((p) => `${origin}${p}`);
}

export async function submit(env, origin, urls) {
  if (!urls.length) return { sent: 0 };
  const host = new URL(origin).hostname;
  const res = await fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: JSON.stringify({ host, key: env.INDEXNOW_KEY, keyLocation: `${origin}/${env.INDEXNOW_KEY}.txt`, urlList: urls }),
  });
  // 200 = recebido; 202 = recebido, chave ainda em verificação.
  if (res.status !== 200 && res.status !== 202) throw new Error(`IndexNow HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return { sent: urls.length, status: res.status };
}

/** Rotina: envia o que mudou desde a última vez e guarda o novo marco. */
export async function run(env, origin, now = Date.now()) {
  if (!configured(env)) return { skipped: true };
  // Depois de uma recusa (ex.: 429 enquanto a chave é nova), espera antes de tentar de novo.
  if (await env.KV.get(KV_PAUSE)) return { paused: true };
  const since = Number(await env.KV.get(KV_SINCE)) || 0;
  const urls = await changedUrls(env, origin, since);
  if (!urls.length) return { sent: 0, urls };
  let result;
  try {
    result = await submit(env, origin, urls);
  } catch (err) {
    await env.KV.put(KV_PAUSE, String(now), { expirationTtl: PAUSE_S });
    throw err;
  }
  await env.KV.put(KV_SINCE, String(now));
  return { ...result, urls };
}
