/** Real fixed-public-track network check. No OS player/capture, window or user track. */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { LyricsStore } from '../bridge-runtime/src/media-lyrics.mjs';
import { MediaMiddleware } from '../bridge-runtime/src/media-middleware.mjs';
import { ConfigStore } from '../bridge-runtime/src/config-store.mjs';
import { createMediaServer } from '../bridge-runtime/src/media-server.mjs';
import { createTestScratch, cleanupTestScratch } from './m3-test-artifacts.mjs';

if (!process.argv.includes('--approved-public-lyrics')) throw Error('public_lyrics_network_opt_in_required');
const root = path.resolve(import.meta.dirname, '../out', `m3-online-${Date.now()}`); await mkdir(root);
const scratch = await createTestScratch(root), report = { root, publicFixtureOnly: true, systemMediaRead: false, foregroundRequested: false, lyricBodySaved: false, checks: [], network: [] };
const files = ['bridge-runtime/src/media-lyrics.mjs', 'bridge-runtime/src/media-middleware.mjs', 'scripts/verify-m3-online-lyrics.mjs', 'scripts/m3-test-artifacts.mjs'];
const hashes = async () => Object.fromEntries(await Promise.all(files.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
report.sourceSha256 = await hashes();
const fixture = { title: 'Never Gonna Give You Up', artist: 'Rick Astley', album: 'Whenever You Need Somebody', duration: 213, position: 30, state: 'playing' };
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
let media, server, receive, queries = 0;
const lyrics = new LyricsStore({ root: path.join(scratch.directory, 'lyrics'), fetchLyrics: async (url, options) => {
  if (url.origin !== 'https://lrclib.net' || url.pathname !== '/api/get') throw Error('lyrics_endpoint_invalid');
  queries++; const item = { request: queries, started: Date.now(), status: null }; report.network.push(item);
  try { const response = await fetch(url, options); item.status = response.status; return response; }
  catch (error) { item.error = ['ENOTFOUND', 'ECONNRESET', 'ETIMEDOUT', 'UND_ERR_CONNECT_TIMEOUT'].includes(error.cause?.code) ? error.cause.code : error.name === 'AbortError' ? 'aborted' : 'transport_error'; throw error; }
  finally { item.elapsedMs = Date.now() - item.started; delete item.started; }
} });
async function check(name, ok, extra = {}) { report.checks.push({ name, ok: Boolean(ok), ...extra }); await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify(report.checks.at(-1))); }
async function until(fn) { const end = performance.now() + 8000; do { const value = await fn(); if (value) return value; await sleep(25); } while (performance.now() < end); throw Error('lyrics_state_timeout'); }
try {
  const off = await lyrics.lookup(fixture); await check('default_off_no_network', off.state === 'off' && queries === 0);
  const online = await lyrics.lookup(fixture, { online: true });
  await check('real_service_returns_bounded_synced_lyrics', online.state === 'ready' && online.source === 'online' && online.rows.length > 0 && online.rows.length <= 2000, { state: online.state, source: online.source, rows: online.rows.length });
  if (online.state !== 'ready') throw Error('online_service_not_available');
  const store = new ConfigStore({ filePath: path.join(scratch.directory, 'config.json') }); await store.load();
  await store.set({ selectedId: null, media: { nowPlaying: true, onlineLyrics: true } });
  media = new MediaMiddleware({ getConfig: () => store.get(), lyrics, createProvider: () => ({ onEvent: fn => { receive = fn; }, configure: async () => {}, close: async () => {}, status: () => ({ running: false, reason: 'fixture' }) }) });
  await media.configure();
  receive({ type: 'session', id: 'e'.repeat(32), commands: [] }); receive({ type: 'input', input: { op: 'media', value: fixture } });
  await until(async () => (await media.snapshot()).lyric.source === 'online');
  server = createMediaServer({ configStore: store, media }); await server.start();
  const request = async (route, body) => {
    const r = await fetch(new URL('api/' + route, server.baseUrl), body === undefined ? {} : { method: 'POST', headers: { Origin: server.origin, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    if (!r.ok) throw Error('lyrics_http_failed'); return r.json();
  };
  const view = await request('media'); await check('real_online_result_reaches_private_HTTP', view.lyric.state === 'ready' && view.lyric.source === 'online' && view.lyric.text.length > 0);
  await request('media/lyrics', { sessionId: view.sessionId, trackKey: view.trackKey, lrc: '[00:00.00]CWB local precedence fixture' });
  const local = await request('media'); await check('local_import_replaces_online_on_same_track', local.lyric.source === 'local' && local.lyric.text === 'CWB local precedence fixture');
  const before = queries; await store.set({ media: { onlineLyrics: false } }); await media.configure();
  await until(async () => (await media.snapshot()).lyric.state === 'ready');
  const disabled = await request('media'); await check('opt_out_keeps_local_and_sends_no_query', queries === before && disabled.lyric.source === 'local');
} catch (error) { report.failure = /^[a-z_]{1,90}$/.test(error.message) ? error.message : 'online_verification_failed'; await check('online_live_stage', false, { reason: report.failure }); }
finally {
  if (server) await server.close(); if (media) await media.close(); else lyrics.close();
  await check('source_bytes_unchanged', JSON.stringify(report.sourceSha256) === JSON.stringify(await hashes()));
  report.scratchCleanup = await cleanupTestScratch(scratch);
  report.passed = report.checks.filter(row => row.ok).length; report.failed = report.checks.filter(row => !row.ok).length;
  await writeFile(path.join(root, 'report.json'), JSON.stringify(report, null, 2)); console.log(JSON.stringify({ root, passed: report.passed, failed: report.failed, scratchRemoved: report.scratchCleanup.removed })); process.exitCode = report.failed ? 1 : 0;
}
