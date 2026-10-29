// Spotify (Web API): busca de músicas e criação das playlists do Zona de Conforto.
// Login com Authorization Code + PKCE: só o Client ID (público) fica na
// configuração; não há chave secreta. O token de acesso e o de renovação
// ficam no KV. Regras de fevereiro de 2026: app em modo de desenvolvimento,
// dono com Premium, busca com no máximo 10 resultados, POST /me/playlists e
// POST /playlists/{id}/items.

const ACCOUNTS = 'https://accounts.spotify.com';
const API = 'https://api.spotify.com/v1';
const KV_KEY = 'spotify:auth';
const SCOPES = 'playlist-modify-public playlist-modify-private playlist-read-private';

export const redirectUri = (origin) => `${origin.replace(/^http:\/\/(?!localhost|127\.)/, 'https://')}/auth/spotify/callback`;
export const configured = (env) => Boolean(env.SPOTIFY_CLIENT_ID);

const b64url = (buf) => btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

// ---------- Login (PKCE) ----------

export async function authorizeUrl(env, origin) {
  if (!configured(env)) throw new Error('Spotify não configurado: falta SPOTIFY_CLIENT_ID.');
  const state = crypto.randomUUID();
  const verifier = b64url(crypto.getRandomValues(new Uint8Array(48)));
  const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
  await env.KV.put(`spotify:pkce:${state}`, verifier, { expirationTtl: 600 });
  const q = new URLSearchParams({
    client_id: env.SPOTIFY_CLIENT_ID,
    response_type: 'code',
    redirect_uri: redirectUri(origin),
    code_challenge_method: 'S256',
    code_challenge: challenge,
    state,
    scope: SCOPES,
  });
  return `${ACCOUNTS}/authorize?${q}`;
}

async function tokenRequest(env, params) {
  const res = await fetch(`${ACCOUNTS}/api/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: env.SPOTIFY_CLIENT_ID, ...params }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Spotify: ${data.error_description || data.error || `HTTP ${res.status}`}`);
  return data;
}

async function saveTokens(env, data, prev = {}) {
  const auth = {
    ...prev,
    access: data.access_token,
    refresh: data.refresh_token || prev.refresh, // o Spotify pode girar o token de renovação
    expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 - 60_000,
  };
  await env.KV.put(KV_KEY, JSON.stringify(auth));
  return auth;
}

export async function handleCallback(env, origin, { code, state }) {
  const verifier = state && (await env.KV.get(`spotify:pkce:${state}`));
  if (!verifier) throw new Error('Pedido expirado. Tente conectar de novo.');
  await env.KV.delete(`spotify:pkce:${state}`);
  const data = await tokenRequest(env, { grant_type: 'authorization_code', code, redirect_uri: redirectUri(origin), code_verifier: verifier });
  let auth = await saveTokens(env, data);
  const me = await api(env, 'GET', '/me');
  auth = { ...auth, userId: me.id, name: me.display_name || me.id };
  await env.KV.put(KV_KEY, JSON.stringify(auth));
  return auth;
}

export async function getAuth(env) {
  return JSON.parse((await env.KV.get(KV_KEY)) || 'null');
}

export async function disconnect(env) {
  await env.KV.delete(KV_KEY);
}

export async function status(env) {
  const a = await getAuth(env);
  return { configured: configured(env), connected: Boolean(a?.refresh), name: a?.name || null };
}

async function accessToken(env) {
  const auth = await getAuth(env);
  if (!auth?.refresh) throw new Error('Spotify não conectado. Toque em "Conectar Spotify" na aba Zona.');
  if (auth.access && auth.expiresAt > Date.now()) return auth.access;
  const data = await tokenRequest(env, { grant_type: 'refresh_token', refresh_token: auth.refresh });
  return (await saveTokens(env, data, auth)).access;
}

/** Chamada à Web API, com renovação do token e espera quando o Spotify pede (429). */
export async function api(env, method, path, body) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const token = await accessToken(env);
    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && attempt === 0) {
      const auth = await getAuth(env);
      await env.KV.put(KV_KEY, JSON.stringify({ ...auth, expiresAt: 0 }));
      continue;
    }
    if (res.status === 429 && attempt < 2) {
      const wait = Math.min(Number(res.headers.get('Retry-After')) || 2, 10);
      await new Promise((r) => setTimeout(r, wait * 1000));
      continue;
    }
    if (res.status === 204) return {};
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      const msg = data.error?.message || `HTTP ${res.status}`;
      if (res.status === 403) throw new Error(`Spotify recusou (${msg}). Confira se o seu e-mail está em User Management no painel do Spotify e se a conta é Premium.`);
      throw new Error(`Spotify: ${msg}`);
    }
    return data;
  }
  throw new Error('Spotify: muitas tentativas. Tente de novo em instantes.');
}

// ---------- Busca de músicas ----------

const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
const words = (s) => new Set(norm(s).split(' ').filter((w) => w.length > 1 && !['the', 'de', 'a', 'o', 'and', 'e'].includes(w)));
const VERSION_RE = /\b(live|ao vivo|en vivo|remix|karaoke|instrumental|medley|demo|acoustic|acustico|cover|tribute|version|edit)\b/;

/** Separa "Música - Artista" (ou "Artista - Música"); a busca testa os dois sentidos. */
export function parseLine(line) {
  const raw = String(line || '').replace(/^\s*(\d+[.)-]\s*|[-•*]\s*)/, '').trim();
  const parts = raw.split(/\s+[-–—]\s+/);
  if (parts.length >= 2) return { raw, a: parts[0].trim(), b: parts.slice(1).join(' - ').trim() };
  return { raw, a: raw, b: '' };
}

function simplify(t) {
  return {
    uri: t.uri,
    id: t.id,
    name: t.name,
    artists: (t.artists || []).map((a) => a.name).join(', '),
    album: t.album?.name || '',
    image: t.album?.images?.at(-1)?.url || t.album?.images?.[0]?.url || null,
    imageLarge: t.album?.images?.[0]?.url || null,
    duration_ms: t.duration_ms,
    url: t.external_urls?.spotify || `https://open.spotify.com/track/${t.id}`,
  };
}

/** Nota de 0 a 1: o quanto a faixa bate com a linha digitada. */
export function score(track, { a, b, raw }) {
  const title = words(track.name);
  const artist = words(track.artists);
  const cover = (want, got) => (want.size ? [...want].filter((w) => got.has(w)).length / want.size : 0);
  const asTitleArtist = 0.6 * cover(words(a), title) + 0.4 * (b ? cover(words(b), artist) : 0.5);
  const asArtistTitle = b ? 0.6 * cover(words(b), title) + 0.4 * cover(words(a), artist) : 0;
  let s = Math.max(asTitleArtist, asArtistTitle);
  // Versões especiais só quando a linha pede.
  if (VERSION_RE.test(norm(track.name)) && !VERSION_RE.test(norm(raw))) s -= 0.15;
  if (track.duration_ms > 9 * 60_000) s -= 0.05;
  return Math.max(0, Math.min(1, s));
}

export async function searchTracks(env, q, limit = 10) {
  const params = new URLSearchParams({ q, type: 'track', limit: String(Math.min(limit, 10)), market: 'BR' });
  const data = await api(env, 'GET', `/search?${params}`);
  return (data.tracks?.items || []).map(simplify);
}

/** Para cada linha da lista: melhor faixa e alternativas, com a nota de confiança. */
export async function matchLines(env, lines) {
  const clean = lines.map((l) => String(l || '').trim()).filter(Boolean).slice(0, 60);
  const out = new Array(clean.length);
  let i = 0;
  const worker = async () => {
    while (i < clean.length) {
      const idx = i++;
      const p = parseLine(clean[idx]);
      let cands = [];
      try {
        cands = await searchTracks(env, [p.a, p.b].filter(Boolean).join(' '));
        if (!cands.length && p.b) cands = await searchTracks(env, p.a);
      } catch (err) {
        out[idx] = { line: clean[idx], error: err.message, candidates: [] };
        continue;
      }
      const ranked = cands.map((t) => ({ ...t, score: Math.round(score(t, p) * 100) / 100 }))
        .sort((x, y) => y.score - x.score);
      out[idx] = { line: clean[idx], candidates: ranked.slice(0, 6) };
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return out;
}

// ---------- Playlists ----------

/** Cria a playlist pública e adiciona as faixas, na ordem. */
export async function createPlaylist(env, { name, description, uris }) {
  if (!uris?.length) throw new Error('Nenhuma música selecionada.');
  const pl = await api(env, 'POST', '/me/playlists', {
    name: String(name).slice(0, 100),
    description: String(description || '').replace(/[<>]/g, '').slice(0, 300),
    public: true,
  });
  for (let k = 0; k < uris.length; k += 100) {
    await api(env, 'POST', `/playlists/${pl.id}/items`, { uris: uris.slice(k, k + 100) });
  }
  return { id: pl.id, url: pl.external_urls?.spotify || `https://open.spotify.com/playlist/${pl.id}`, name: pl.name };
}

/** Playlists da conta com "Zona de Conforto" no nome (para importar as antigas). */
export async function zonaPlaylists(env) {
  const out = [];
  let next = '/me/playlists?limit=50';
  for (let page = 0; next && page < 10; page++) {
    const data = await api(env, 'GET', next);
    for (const p of data.items || []) {
      if (/zona\s+de\s+conforto/i.test(p.name || '')) {
        out.push({
          id: p.id,
          name: p.name,
          public: Boolean(p.public),
          image: p.images?.[0]?.url || null,
          total: p.items?.total ?? p.tracks?.total ?? null,
        });
      }
    }
    next = data.next || null;
  }
  return out;
}

export async function makePublic(env, id) {
  await api(env, 'PUT', `/playlists/${id}`, { public: true });
}
