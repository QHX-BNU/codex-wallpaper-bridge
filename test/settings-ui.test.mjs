import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';

const html = await readFile(new URL('../bridge-runtime/public/index.html', import.meta.url), 'utf8');
const css = await readFile(new URL('../bridge-runtime/public/styles.css', import.meta.url), 'utf8');
const settings = html.slice(html.indexOf('<aside class="settings'), html.indexOf('</aside>', html.indexOf('<aside class="settings')));

test('settings controls retain their data hooks, labels and native semantics', () => {
  for (const key of ['captureAudio', 'nowPlaying', 'allowControl', 'onlineLyrics']) {
    assert.match(settings, new RegExp(`<label class="effect-check">[\\s\\S]*?data-media="${key}" type="checkbox"`));
  }
  for (const [id, key] of [['transitionSelect', 'transition'], ['transitionDirectionSelect', 'transitionDirection'],
    ['videoFpsCap', 'fpsCap'], ['videoEncoder', 'encoder']]) {
    assert.match(settings, new RegExp(`for="${id}"`));
    assert.match(settings, new RegExp(`id="${id}" data-(?:effect|video)="${key}"`));
  }
  assert.match(settings, /id="systemLyricsInput" type="file" accept="\.lrc,text\/plain"/);
  assert.match(settings, /发送歌名 \/ 歌手查询，本地歌词优先/);
  assert.match(settings, /128 KiB/);
  assert.match(settings, /aria-live="polite"/);
});

test('transport buttons share a bounded four-column group, not the numeric range grid', () => {
  const transport = settings.match(/<div class="settings-actions media-transport"[\s\S]*?<\/div>/)?.[0];
  assert.ok(transport);
  assert.match(transport, /role="group" aria-label="系统媒体播放控制"/);
  assert.deepEqual([...transport.matchAll(/data-media-command="([^"]+)"/g)].map(match => match[1]),
    ['previous', 'play', 'pause', 'next']);
  assert.equal([...transport.matchAll(/<button[^>]+disabled>/g)].length, 4);
  assert.match(css, /\.settings \.media-transport\s*\{[^}]*grid-template-columns: repeat\(4, minmax\(0, 1fr\)\)/);
});

test('settings have shared, scoped control tokens and explicit keyboard/disabled states', async () => {
  for (const token of ['--control-bg', '--control-border', '--control-radius', '--control-height', '--settings-ring']) {
    assert.ok(css.includes(token));
  }
  assert.match(css, /\.settings input\[type="checkbox"\]:not\(\.switch-input\):focus-visible/);
  assert.match(css, /\.settings \.effect-advanced button:disabled/);
  assert.match(css, /\.settings input\[type="file"\]::file-selector-button/);
  assert.match(css, /\.settings > \* \{ flex-shrink: 0; \}/);
  assert.match(css, /prefers-reduced-motion: reduce/);
  assert.doesNotMatch(css, /var\(--text-muted,|var\(--border,/);
  const result = await transform(css, { loader: 'css', target: 'chrome130' });
  assert.deepEqual(result.warnings, []);
});
