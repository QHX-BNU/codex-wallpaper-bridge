import assert from 'node:assert/strict';
import test from 'node:test';
import { validateWebWallpaperInput } from '../bridge-runtime/src/web-wallpaper-input.mjs';

test('Web inputs are typed bounded copies, not an arbitrary message tunnel', () => {
  const audio = { op: 'audio', values: Array(128).fill(0.5) };
  const copy = validateWebWallpaperInput(audio);
  assert.deepEqual(copy, audio); copy.values[0] = 1; assert.equal(audio.values[0], 0.5);
  const media = { op: 'media', value: { state: 'playing', title: 'Track', artist: 'Artist', album: '', position: 1, duration: 100 } };
  assert.deepEqual(validateWebWallpaperInput(media), media);
  const metadata = { ...media, value: { ...media.value, albumTitle: 'Album', subTitle: '', genres: 'Pop', contentType: 'music' } };
  assert.deepEqual(validateWebWallpaperInput(metadata), metadata);
  for (const value of [null, [], {}, { op: 'execute', path: 'file:///secret' },
    { ...audio, channel: 'secret' }, { op: 'audio', values: Array(129).fill(0) },
    { op: 'audio', values: Array(128) },
    { op: 'audio', values: Array(128).fill(NaN) }, { op: 'audio', values: Array(128).fill(-1) },
    { op: 'audio', values: Array(128).fill(1.1) },
    { ...media, value: { ...media.value, title: 'x'.repeat(513) } },
    { ...media, value: { ...media.value, path: 'file:///secret' } },
    { ...media, value: { ...media.value, state: 'unknown' } },
    { ...media, value: { ...media.value, position: 101 } },
    { ...media, value: { ...media.value, duration: 86401 } }]) {
    assert.throws(() => validateWebWallpaperInput(value), /web_input_invalid/);
  }
});

const thumbnail = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jfAAAAABJRU5ErkJggg==';
test('thumbnail/status/albumArtist use bounded data-only contracts and reject URL, capability and malformed content', () => {
  assert.deepEqual(validateWebWallpaperInput({ op: 'mediaStatus', value: { enabled: true } }), { op: 'mediaStatus', value: { enabled: true } });
  const cover = { op: 'mediaThumbnail', value: { thumbnail, primaryColor: '#abcdef', textColor: '#ffffff' } };
  assert.equal(validateWebWallpaperInput({ ...cover, value: { ...cover.value, highContrastColor: '#000000' } }).value.highContrastColor, '#000000');
  assert.deepEqual(validateWebWallpaperInput(cover), cover);
  assert.deepEqual(validateWebWallpaperInput({ op: 'mediaThumbnail', value: { thumbnail: '' } }).value, { thumbnail: '' });
  const media = { op: 'media', value: { state: 'playing', title: '', artist: '', album: '', albumArtist: 'Composer', position: 0, duration: 0 } };
  assert.deepEqual(validateWebWallpaperInput(media), media);
  const metadata = { ...media, value: { ...media.value, albumTitle: 'Album', subTitle: '', genres: 'Pop', contentType: 'music' } };
  for (const input of [{ op: 'mediaStatus', value: { enabled: 1 } }, { op: 'mediaStatus', value: { enabled: true, command: 'play' } },
    { ...cover, value: { ...cover.value, primaryColor: 'url(file:///secret)' } },
    { ...media, value: { ...media.value, albumArtist: 'a'.repeat(513) } },
    { ...metadata, value: { ...metadata.value, contentType: 'command' } },
    { ...metadata, value: { ...metadata.value, subTitle: [] } },
    { ...cover, value: { ...cover.value, textColorHighContrast: '#ffffff' } },
    ...['file:///secret', 'https://evil.test/a.png', 'blob:secret', 'data:image/svg+xml;base64,PHN2Zz4=',
      'data:image/png;base64,YQ==', 'data:image/png;base64,' + 'A'.repeat(50000), thumbnail + '\n'].map(thumbnail => ({ ...cover, value: { thumbnail } }))]) {
    assert.throws(() => validateWebWallpaperInput(input), /web_input_invalid/);
  }
});
