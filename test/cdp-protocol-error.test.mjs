import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer } from 'node:http';
import test from 'node:test';
import { WebSocketServer } from 'ws';
import { CdpWallpaperInjector } from '../bridge-overrides/src/cdp-injector.mjs';

test('CDP socket preserves protocol error code for strict disposed-context classification', async (t) => {
  const server = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await once(server, 'listening');
  t.after(() => new Promise((resolve) => { for (const client of server.clients) client.terminate(); server.close(resolve); }));
  server.on('connection', (socket) => socket.on('message', (bytes) => {
    const request = JSON.parse(bytes);
    socket.send(JSON.stringify({ id: request.id, error: { code: -32000, message: 'Cannot find object with given id' } }));
  }));
  const port = server.address().port, injector = new CdpWallpaperInjector({ port });
  t.after(() => injector.close());
  await assert.rejects(injector.attach({ id: 'fixture', type: 'page', url: 'app://-',
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/fixture` }), (error) => error.cdpCode === -32000);
});

test('CDP handshake exposes a structured HTTP500 status without confusing it with renderer content failure', async t => {
  const server = createServer();
  server.on('upgrade', (_request, socket) => socket.end('HTTP/1.1 500 Internal Server Error\r\nContent-Length: 0\r\nConnection: close\r\n\r\n'));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => new Promise(resolve => server.close(resolve)));
  const port = server.address().port;
  const injector = new CdpWallpaperInjector({ port, verifyEndpoint: async () => ({ verified: true }) });
  injector.directSceneEnabled = true; injector.sceneDelivery = { close: async () => {} };
  t.after(() => injector.close());
  await assert.rejects(injector.attach({ id: 'fixture', type: 'page', url: 'app://-',
    webSocketDebuggerUrl: `ws://127.0.0.1:${port}/devtools/page/fixture` }), error =>
    error.cwbHandshakeStatus === 500 && error.cwbUntouchedTargetConnectionFailure === true);
});
