-- Banco do site público das coberturas (Cloudflare D1).
-- Uma linha em `games` por cobertura (página) e uma em `posts` por post.

CREATE TABLE IF NOT EXISTS games (
  slug        TEXT PRIMARY KEY,          -- ex.: minas-storm-x-pato-basquete-27-10-2026
  title       TEXT NOT NULL,             -- ex.: Minas Storm x Pato Basquete
  lnb_id      TEXT,                      -- ID da partida na LNB, quando vinculado
  home        TEXT,                      -- mandante (como aparece no placar)
  away        TEXT,                      -- visitante
  home_score  INTEGER,
  away_score  INTEGER,
  period      TEXT,                      -- 1Q, 2Q, INT, 3Q, 4Q, OT, FINAL
  status      TEXT NOT NULL DEFAULT 'live', -- live | ended
  started_at  INTEGER NOT NULL,          -- epoch ms
  updated_at  INTEGER NOT NULL,
  cover_key   TEXT                       -- primeira foto, usada na prévia de compartilhamento
);

CREATE TABLE IF NOT EXISTS posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  game_slug   TEXT NOT NULL REFERENCES games(slug) ON DELETE CASCADE,
  text        TEXT NOT NULL DEFAULT '',
  media       TEXT NOT NULL DEFAULT '[]', -- JSON: [{ key, kind, width, height, alt }]
  score       TEXT,                       -- placar no momento do post, ex.: "86 x 65 · Final"
  created_at  INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS posts_by_game ON posts (game_slug, id);
CREATE INDEX IF NOT EXISTS games_by_start ON games (started_at DESC);

-- Blog: artigos escritos no editor visual do app.
CREATE TABLE IF NOT EXISTS articles (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  slug         TEXT NOT NULL UNIQUE,     -- endereço: /blog/<slug>
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  body_html    TEXT NOT NULL DEFAULT '', -- HTML já limpo pelo servidor
  cover_key    TEXT,                     -- foto de capa no R2
  category     TEXT NOT NULL DEFAULT 'Opinião',
  status       TEXT NOT NULL DEFAULT 'draft', -- draft | published
  published_at INTEGER,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS articles_pub ON articles (status, published_at DESC);

-- Páginas fixas editáveis no app: sobre, coluna, zona-de-conforto.
CREATE TABLE IF NOT EXISTS pages (
  slug       TEXT PRIMARY KEY,
  title      TEXT NOT NULL,
  body_html  TEXT NOT NULL DEFAULT '',
  updated_at INTEGER NOT NULL
);

-- Coluna Nas Quadras: links das colunas publicadas no Jornal do Brasil
-- (título, foto e data lidos da página; a foto é copiada para o R2).
CREATE TABLE IF NOT EXISTS columns (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  url          TEXT NOT NULL UNIQUE,
  title        TEXT NOT NULL,
  summary      TEXT NOT NULL DEFAULT '',
  image_key    TEXT,                     -- cópia da foto no R2
  image_url    TEXT,                     -- foto original (reserva)
  source       TEXT NOT NULL DEFAULT 'Jornal do Brasil',
  published_at INTEGER NOT NULL,
  created_at   INTEGER NOT NULL,
  updated_at   INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS columns_by_date ON columns (published_at DESC);
