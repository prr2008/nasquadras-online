import test from 'node:test';
import assert from 'node:assert/strict';
import { embedLoneLinks } from '../src/gdocs.js';

test('link sozinho do YouTube/Vimeo/Spotify vira player', () => {
  assert.equal(
    embedLoneLinks('<p><a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ&amp;t=3">x</a></p>'),
    '<iframe src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"></iframe>',
  );
  assert.equal(embedLoneLinks('<p><a href="https://youtu.be/abcdef12">x</a></p>'), '<iframe src="https://www.youtube-nocookie.com/embed/abcdef12"></iframe>');
  assert.equal(embedLoneLinks('<p><a href="https://vimeo.com/123456">v</a></p>'), '<iframe src="https://player.vimeo.com/video/123456"></iframe>');
  assert.equal(embedLoneLinks('<p><a href="https://open.spotify.com/intl-pt/episode/4rOoJ6Egrf8K2IrywzwOMk">s</a></p>'),
    '<iframe src="https://open.spotify.com/embed/episode/4rOoJ6Egrf8K2IrywzwOMk"></iframe>');
});

test('link no meio do texto continua link', () => {
  const html = '<p>Veja <a href="https://www.youtube.com/watch?v=dQw4w9WgXcQ">o vídeo</a> aqui.</p>';
  assert.equal(embedLoneLinks(html), html);
  const other = '<p><a href="https://lnb.com.br">LNB</a></p>';
  assert.equal(embedLoneLinks(other), other);
});
