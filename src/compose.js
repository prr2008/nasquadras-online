// Monta o texto de cada rede a partir do texto do post e das hashtags fixas.
//
// - Threads: só aceita um "tema" por post. O primeiro hashtag vai como
//   topic_tag (parâmetro da API) e o texto sai limpo, sem hashtags.
// - Bluesky: hashtags no post avulso, no 1º post do fio e a partir do fim de
//   jogo; nas respostas do meio do fio, o texto sai sem elas.
// - X: texto + hashtags (a versão do X é montada no app).
// - Site: sem hashtags.
// Em todas, os apelidos de menção (@nbb…) viram o perfil certo de cada rede.

const MENTIONS_KEY = 'mentions';
const NETWORKS = ['threads', 'bluesky', 'x'];

/** "#NBB #NasQuadras" -> ['#NBB', '#NasQuadras'] (só hashtags válidos). */
export function splitTags(tags) {
  return String(tags || '').match(/#[\p{L}\p{N}_]*\p{L}[\p{L}\p{N}_]*/gu) || [];
}

// ---------- Menções ----------

const cleanHandle = (s) => String(s || '').trim().replace(/^@+/, '').replace(/^https?:\/\/\S+\//, '').slice(0, 100);

/** Lista de apelidos: [{ key, name, threads, bluesky, x }]. */
export async function getMentions(env) {
  try { return JSON.parse((await env.KV.get(MENTIONS_KEY)) || '[]'); } catch { return []; }
}

export async function saveMentions(env, list) {
  const seen = new Set();
  const clean = (Array.isArray(list) ? list : []).map((m) => ({
    key: cleanHandle(m.key).toLowerCase().replace(/[^a-z0-9_.]/g, ''),
    name: String(m.name || '').trim().slice(0, 60),
    threads: cleanHandle(m.threads),
    bluesky: cleanHandle(m.bluesky),
    x: cleanHandle(m.x),
  })).filter((m) => m.key && !seen.has(m.key) && seen.add(m.key)).slice(0, 200);
  await env.KV.put(MENTIONS_KEY, JSON.stringify(clean));
  return clean;
}

const MENTION_RE = /(^|[\s(“"'])@([A-Za-z0-9_][A-Za-z0-9_.]*[A-Za-z0-9_])/g;

/**
 * Troca @apelido pelo perfil da rede. Sem perfil naquela rede, usa o nome
 * (ex.: "NBB"); sem apelido cadastrado, deixa como foi escrito.
 */
export function applyMentions(text, network, list) {
  if (!list?.length) return text;
  const map = new Map(list.map((m) => [m.key, m]));
  return String(text).replace(MENTION_RE, (whole, pre, handle) => {
    const m = map.get(handle.toLowerCase());
    if (!m) return whole;
    const target = NETWORKS.includes(network) ? m[network] : '';
    if (target) return `${pre}@${target}`;
    return `${pre}${m.name || handle}`;
  });
}

// ---------- Texto por rede ----------

const validTopic = (t) => t && t.length <= 50 && !/[.&]/.test(t);

/**
 * opts: { network, text, tags, threadFirst, inThread, final, mentions }
 * Devolve { text, topic } (topic só no Threads).
 */
export function compose({ network, text, tags = '', inThread = false, threadFirst = false, final = false, mentions = [] }) {
  const body = applyMentions(String(text || '').trim(), network, mentions).replace(/\n{3,}/g, '\n\n');
  const list = splitTags(tags);
  const join = (t) => (list.length ? `${t}\n\n${list.join(' ')}`.trim() : t);

  if (network === 'threads') {
    const topic = list[0]?.slice(1);
    return { text: body, topic: validTopic(topic) ? topic : undefined };
  }
  if (network === 'bluesky') {
    const withTags = !inThread || threadFirst || final;
    return { text: withTags ? join(body) : body };
  }
  if (network === 'x') return { text: join(body) };
  return { text: body }; // site
}
