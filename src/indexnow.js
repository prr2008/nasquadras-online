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

// O IndexNow compartilha os avisos entre os buscadores; basta um deles aceitar.
// Os Workers saem por IPs compartilhados da Cloudflare, e o api.indexnow.org
// costuma recusar (429) por excesso de pedidos vindos desses IPs.
const ENDPOINTS = ['https://www.bing.com/indexnow', 'https://yandex.com/indexnow', ENDPOINT];

export async function submit(env, origin, urls) {
  if (!urls.length) return { sent: 0 };
  const host = new URL(origin).hostname;
  const body = JSON.stringify({ host, key: env.INDEXNOW_KEY, keyLocation: `${origin}/${env.INDEXNOW_KEY}.txt`, urlList: urls });
  const errors = [];
  for (const url of ENDPOINTS) {
    try {
      const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body });
      // 200 = recebido; 202 = recebido, chave ainda em verificação.
      if (res.status === 200 || res.status === 202) return { sent: urls.length, status: res.status, via: new URL(url).hostname };
      errors.push(`${new URL(url).hostname} HTTP ${res.status}: ${(await res.text()).slice(0, 120)}`);
    } catch (err) {
      errors.push(`${new URL(url).hostname}: ${err.message}`);
    }
  }
  if (env.BING_API_KEY) return bingSubmit(env, origin, urls, errors);
  throw new Error(`IndexNow recusado: ${errors.join(' | ')}`);
}

/**
 * Plano B: API de envio de URLs do Bing Webmaster Tools, autenticada pela
 * chave da conta (cota diária própria, sem disputa com outros sites).
 */
export async function bingSubmit(env, origin, urls, previous = []) {
  const api = `https://ssl.bing.com/webmaster/api.svc/json/SubmitUrlBatch?apikey=${encodeURIComponent(env.BING_API_KEY)}`;
  for (const size of [100, 10]) {
    const list = urls.slice(0, size);
    const res = await fetch(api, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ siteUrl: origin, urlList: list }),
    });
    if (res.ok) return { sent: list.length, status: res.status, via: 'bing-api' };
    previous.push(`bing-api HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }
  throw new Error(`IndexNow recusado: ${previous.join(' | ')}`);
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
