# Novidades do Nas Quadras

Registro das mudanças no app e no site a partir da versão 1.0. A versão mais recente fica no topo.

## 1.15 — 29/10/2026

- **Apoie:** caixa com **Pix** (QR Code e botão **Copiar código Pix**, valor livre) e **Ko-fi** no Início, no fim dos textos do blog e no Sobre, além da página própria **nasquadras.online/apoie**, boa para divulgar na bio das redes. Link **Apoie** no rodapé.
- O Pix aparece assim que a chave for configurada; até lá, a caixa mostra só o Ko-fi.

## 1.14 — 29/10/2026

- **Newsletter no site:** caixa de inscrição do Substack (oficial e gratuita) no Início, ao lado do Zona de Conforto, no fim de cada texto do blog e na página Sobre. Quem se inscreve entra direto na lista do Substack.
- **Substack** nos links **Siga** e no rodapé.

## 1.13 — 29/10/2026

- **Buscadores avisados na hora (IndexNow):** a cada 10 minutos, o app avisa o Bing (e Yandex, Seznam, Naver e outros) das páginas novas ou alteradas: textos do blog, coberturas e posts novos nelas, coluna, Zona de Conforto e Sobre. Nada muda no jeito de publicar. Na primeira vez, o site inteiro foi enviado.
- **Crawler Hints** ligado na Cloudflare (Caching → Configuration).
- O Google não usa o IndexNow; para ele continua valendo o mapa do site no Search Console.

## 1.12 — 29/10/2026

- **Site no endereço principal:** o site saiu do Squarespace e agora responde em **nasquadras.online** (o **www** redireciona para lá). O app continua em **app.nasquadras.online**.
- Links oficiais (Google, RSS, mapa do site, compartilhamentos e divulgações) passam a usar nasquadras.online.
- O botão **Ver site** do app abre nasquadras.online; quem acessar nasquadras.online/app é levado ao app.
- E-mail do domínio (iCloud) não foi alterado.

## 1.11 — 29/10/2026

- **Audiência do site com o Cloudflare Web Analytics** (gratuito e sem cookies, então sem faixa de consentimento): visitas, páginas mais lidas, de onde vêm os leitores, país, dispositivo e velocidade de carregamento. Medido só nas páginas públicas: o uso do app não entra na conta. Painel em Cloudflare → Analytics → Web analytics.

## 1.10 — 29/10/2026

- **Início com destaques:** logo abaixo da apresentação (e do aviso de jogo ao vivo), **Coberturas** e **Coluna Nas Quadras** aparecem lado a lado no computador e em sequência no celular. Em cada uma, o mais recente vem grande, com foto (placar final e número de posts na cobertura; resumo e link para o JB na coluna), e os anteriores numa lista logo abaixo.
- O blog vem em seguida (6 textos mais recentes), com Zona de Conforto e Siga na lateral.
- Cobertura aberta com o título padrão ("Cobertura") passa a aparecer com o nome dos times ("Botafogo x Caxias do Sul").

## 1.9 — 29/10/2026

- **Importar posts do WordPress** (Blog → **📦 Importar posts do WordPress**): traz os posts publicados de um site WordPress.com já publicados no blog, com a **data original**, as **fotos copiadas** para cá, os **vídeos** (YouTube, Spotify, VideoPress) como player e os **posts do X e do Instagram** incorporados. A primeira foto (ou a miniatura do vídeo) vira a capa; a categoria é escolhida pelo assunto (NBB, NBA, Seleção…), e dá para mudar no editor. Rodar de novo não duplica. Há um modo de simulação.
- **Posts do X e do Instagram no editor do Blog:** o botão de vídeo agora aceita também links de posts do X e do Instagram; eles aparecem no editor como um bloco e, no site, como o post incorporado.
- **Correção:** o editor salvava vídeos do YouTube/Spotify/Vimeo como link em vez de player. Agora o player é mantido ao salvar.

## 1.8 — 29/10/2026

Playlists do Zona de Conforto criadas pelo próprio app, direto no Spotify.

- **Conectar Spotify** (aba **Zona**): login seguro na sua conta, sem senha nem chave secreta guardada.
- **Nova edição a partir da lista:** informe número, data e tema, cole as músicas ("Música - Artista" ou "Artista - Música") e toque em **Buscar músicas no Spotify**. O nome da playlist se monta sozinho ("Zona de Conforto · Ep. 7 · 02/06/2026").
- **Conferência faixa a faixa:** cada música vem com a melhor opção e alternativas (álbum e duração), botão para ouvir e campo para buscar outra versão. Versões ao vivo, remix e medley perdem prioridade; as duvidosas ficam com borda amarela e as não encontradas, com borda vermelha.
- **Um botão faz o resto:** cria a playlist **pública** no seu Spotify, com descrição do programa e as faixas na ordem, e publica a edição no site. Divulgação opcional no Threads e no Bluesky.
- **Importar playlists antigas:** lista as suas playlists com "Zona de Conforto" no nome; as marcadas ficam públicas e entram no site com a data lida do nome.
- O TuneMyMusic e o conector do Claude deixam de ser necessários.

## 1.7 — 29/10/2026

- **Zona de Conforto com as edições do programa:** a página do site lista as edições, das mais recentes para as mais antigas, cada uma com o **player do Spotify** tocável, número, data, tema e resumo. No computador, em duas colunas.
- **Nova aba Zona no app:** cole o link da playlist no Spotify e o app lê o nome, a capa, o número e a data da edição (de nomes como "Ep. 6 · 26/05/2026" ou "11 de agosto 2026"). Você revisa, acrescenta tema e resumo e adiciona. Dá para editar e remover.
- Aviso quando a playlist parece **privada** (o player não toca para os visitantes).
- O Início mostra a playlist mais recente no cartão do Zona de Conforto.
- A apresentação do programa continua editável em **Páginas → Zona de Conforto**.

## 1.6 — 29/10/2026

Site adaptado ao computador (o app já estava desde a 1.4).

- **Início:** em telas largas, textos do blog e coberturas à esquerda; à direita, uma coluna fixa com a **Coluna Nas Quadras** (com a foto da mais recente), o **Zona de Conforto** e os links **Siga** (Threads, Bluesky, X, YouTube e a coluna no JB).
- **Página do jogo:** os posts à esquerda e o **placar fixo à direita**, sempre visível enquanto se rola a cobertura.
- **Coluna:** cards em duas colunas.
- **Blog e artigos:** cards maiores e texto com largura e tamanho de leitura confortáveis.
- Site inteiro mais largo (até 1200px), com letras um pouco maiores no computador.
- Rodapé com **X** e **YouTube**, além de Threads, Bluesky e RSS.
- No celular, nada muda: a coluna da direita vira o fim da página e o placar continua no topo do jogo.

## 1.5 — 29/10/2026

Ajustes a partir da primeira cobertura completa (Botafogo 84 x 82 Caxias do Sul, 28/10).

- **Hashtags no Threads:** o Threads aceita um tema por post. Agora a primeira hashtag fixa (ex.: #NBB) vai como **tema** e o texto sai limpo, sem o "#NasQuadras" solto no fim.
- **Hashtags no Bluesky:** saem no post solto, no **1º post do fio** e a partir do **fim de jogo**. As respostas do meio do fio ficam sem elas.
- **Site:** os posts da cobertura aparecem sem as hashtags.
- **Card de link no Bluesky:** um post sem foto ou vídeo ganha a prévia do primeiro link (título, descrição e miniatura), como o Threads já faz. Para links do YouTube, a prévia traz o título da transmissão.
- **Destaques sem repetição:** quando o mesmo jogador lidera mais de uma estatística, ele aparece uma vez só: "Vini Chagas 27 pts e 9 reb · Vithinho 8 ast".
- **Fim de quarto mais claro:** com o jogo vinculado à LNB, o placar mostra o relógio durante o quarto ("2º quarto · 05:32") e "Fim do 1º quarto", "Intervalo" ou "Fim do 3º quarto" quando o relógio zera. O atalho **Fim do quarto** já traz a parcial do quarto e os cestinhas.
- **Menções por rede** (botão **@ Menções**, ao lado das hashtags): cada apelido aponta para o perfil em cada rede. Escreva `@nbb` e o Threads recebe `@nbb`; numa rede sem o perfil, sai o nome ("NBB"). No Bluesky, menções a perfis existentes viram link.
- Linhas em branco repetidas no texto viram uma só.

## 1.4 — 28/10/2026

- **App no computador:** em telas largas, o Ao vivo tem duas colunas (compositor à esquerda; Agendados e Últimos posts fixos à direita). Blog, Coluna e Páginas ficam centralizados.
- **Atalho Ctrl+Enter** (⌘+Enter no Mac) para publicar.
- Correção: textos longos sem espaço (links) não alargam mais a página no celular.

## 1.3 — 28/10/2026

- **X pelo Buffer no botão Publicar:** novo destino **X**. O post sai na hora pela API do Buffer, com até 4 fotos ou 1 vídeo.
- **Versão para o X:** quando o texto passa de 280 caracteres, aparece uma caixa para encurtar só a versão do X.
- **Copiar** agora fica ao lado de **Agendar**, abaixo do Publicar.
- Verificação da chave do Buffer ao abrir o app.

## 1.2 — 28/10/2026

- **Agendamento** (botão **⏰ Agendar**): data, hora e o papel do post no fio: **abrir a cobertura** (1º post do fio, cria a página do jogo no site), **responder no fio** ou **post solto**.
- Uma rotina a cada minuto publica os agendados em ordem. A lista **Agendados** permite editar, cancelar e publicar agora.
- Com o X marcado, o post agendado também entra na fila do Buffer no mesmo horário. Cancelar ou editar no app atualiza o Buffer.

## 1.1 — 28/10/2026

- **Google Docs → blog:** o menu **Nas Quadras → Enviar para o blog…** no documento-modelo envia o texto (título, intertítulos, negrito, itálico, links, listas, citações e fotos) como rascunho ou publicado. Reenviar atualiza o mesmo artigo.
- Painel lateral no Docs com categoria, resumo, capa e divulgação no Threads e no Bluesky.
- Conexão por código gerado no app (**Blog → Publicar do Google Docs**), que pode ser trocado ou revogado a qualquer momento.

## 1.0 — 27/10/2026

Primeira versão completa.

- **Ao vivo:** um texto, com fotos e vídeos, publicado ao mesmo tempo no **Threads** e no **Bluesky**. Contadores por rede e fio numerado automático no Bluesky acima de 300 caracteres.
- **Placar** digitável ou com botões +1/+2/+3, período e atalhos de texto.
- **Fio da cobertura:** cada post responde ao anterior, nas duas redes.
- **LNB:** placar automático e atalhos com dados reais (Parciais, Cestinhas, Destaques, Do quarto, Última cesta).
- **Botão Copiar** para colar no X.
- **Site:** página por cobertura (posts, placar ao vivo, galeria de fotos), Início, Blog com editor visual, Coluna (cards a partir do link do JB), Zona de Conforto e Sobre, com RSS e mapa do site.
- Endereço próprio: **app.nasquadras.online**.
