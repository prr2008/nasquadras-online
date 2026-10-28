# Nas Quadras Online

Webapp para coberturas ao vivo: escreve uma vez e publica ao mesmo tempo no **Threads** e no **Bluesky**, com fotos e vídeos. Roda na Cloudflare (Workers + R2 + KV), no plano gratuito.

## O que ele faz

- **Placar do jogo** digitável ou com botões +1/+2/+3, período e atalhos ("Cesta de 3", "Fim do quarto", "Final") que inserem o placar no texto.
- **Placar automático pela LNB**: o botão *📡 LNB* lista os jogos do dia (ou aceita o link da página do jogo) e, depois de vincular, o placar, os times e o período se atualizam sozinhos a cada 30 segundos. Atalhos com dados reais: *Parciais*, *Cestinhas*, *Destaques* (pontos, rebotes e assistências), *Do quarto* e *Última cesta*. Os dados vêm dos mesmos arquivos que a página "Tempo real" do site da LNB usa.
- **Fio da cobertura**: toque em *Iniciar fio do jogo* e o próximo post abre o fio; os seguintes saem como respostas ao anterior, no Threads e no Bluesky. A chave *Responder no fio* permite soltar um post avulso sem encerrar o fio. *Encerrar* volta aos posts soltos.
- **Site público das coberturas** (`/c`): cada cobertura vira uma página com placar (ao vivo pela LNB, quando vinculado), posts com horário e fotos, além de uma galeria. A página se atualiza sozinha durante o jogo e mostra prévia com placar e foto ao ser compartilhada. No app, a chave *Site* envia o post para a página da cobertura ativa. Logado no app, você vê o botão *Apagar* em cada post do site.
- **Hashtags fixas** acrescentadas automaticamente (liga/desliga).
- **Contadores** para os limites de cada rede (Threads 500, Bluesky 300). Acima de 300, o Bluesky recebe um **fio numerado** automaticamente.
- **Fotos e vídeos**: as fotos são comprimidas no próprio celular para caber no limite do Bluesky; os envios começam assim que você escolhe o arquivo. Campo de descrição (texto alternativo) em cada mídia.
  - Threads: até 10 mídias (carrossel, pode misturar foto e vídeo); vídeo até 5 min.
  - Bluesky: até 4 fotos **ou** 1 vídeo por post.
  - Limite de 100 MB por arquivo.
- **Links e hashtags clicáveis** no Bluesky.
- **Histórico** dos últimos posts com links.
- **Rotina diária** que renova o acesso ao Threads (o token dura 60 dias) e apaga do R2 a mídia com mais de 24 horas.

## Configuração (uma vez só)

### 1. Ligar o repositório à Cloudflare

No painel da Cloudflare: **Workers & Pages → Create → Import a repository** → escolha `prr2008/nasquadras-online`.

- Build command: deixe em branco
- Deploy command: `npx wrangler deploy`

Depois do primeiro deploy, o app fica em `https://nasquadras-online.<seu-subdominio>.workers.dev`. Cada atualização enviada ao GitHub é publicada sozinha.

O bucket R2 (`nasquadras-media`) e o KV (`nasquadras-online-kv`) já foram criados e estão referenciados no `wrangler.jsonc`.

### 2. Cadastrar os segredos

No Worker: **Settings → Variables and Secrets → Add**, sempre com o tipo **Secret**:

| Nome | O que colocar |
|---|---|
| `APP_PASSWORD` | Uma senha que você vai usar para entrar no app |
| `SESSION_SECRET` | Uma frase longa e aleatória qualquer (só o servidor usa) |
| `THREADS_APP_SECRET` | A "Chave secreta do app" do Threads, no painel da Meta |
| `BLUESKY_APP_PASSWORD` | A senha de app criada no Bluesky (nunca a senha principal) |

O ID do app do Threads e o usuário do Bluesky (`BLUESKY_HANDLE`) não são segredos e ficam no `wrangler.jsonc`. Variáveis comuns criadas só no painel podem sumir num deploy; por isso, tudo que não é segredo fica no repositório.

### 3. Configurar o app na Meta

Em developers.facebook.com → seu app → **Casos de uso → Acessar a API do Threads → Personalizar**:

1. **Permissões**: `threads_basic`, `threads_content_publish` e `threads_manage_replies` (esta última é a que permite montar o fio).
2. **Configurações**: em *URLs de retorno de chamada de redirecionamento*, coloque
   `https://nasquadras-online.<seu-subdominio>.workers.dev/auth/threads/callback`
   (o próprio app mostra essa URL exata ao tocar em "Threads" no topo). Nos campos de *desinstalação* e *exclusão*, pode usar a mesma URL base.
3. **Funções do app → Funções → Testadores do Threads**: adicione sua conta do Threads e aceite o convite no app do Threads (Configurações → Conta → Permissões do site → Convites).

### 4. Conectar

Abra o app, entre com a `APP_PASSWORD`, toque em **Threads** no topo → **Conectar Threads** e autorize. O Bluesky conecta sozinho com os segredos do passo 2 (os indicadores no topo ficam verdes).

Dica: no iPhone, use **Compartilhar → Adicionar à Tela de Início** para abrir como app.

## Desenvolvimento

```bash
npm install
cp .dev.vars.example .dev.vars   # preencha os valores
npm run dev                      # http://localhost:8787
npm test
```

## Estrutura

```
public/          interface (HTML, CSS, JS)
src/index.js     rotas, upload de mídia, login e rotina diária
src/threads.js   OAuth e publicação no Threads
src/bluesky.js   sessão e publicação no Bluesky
src/site.js      site público (banco D1 e páginas)
src/lnb.js       leitura dos dados de tempo real da LNB
src/coverage.js  fio da cobertura (último post de cada rede)
src/text.js      contagem de caracteres, fio e links/hashtags do Bluesky
schema.sql       tabelas do banco do site (D1)
test/            testes (com as APIs simuladas)
```
