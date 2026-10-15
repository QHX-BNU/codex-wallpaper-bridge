import { randomBytes } from 'node:crypto';
import { ConfigStore, defaultConfigPath } from '../bridge-runtime/src/config-store.mjs';
import { projectPolicy } from '../bridge-runtime/src/library-policy.mjs';
import { scanWallpaperProjects } from '../bridge-runtime/src/scanner.mjs';
import { EngineFailureMemory } from '../bridge-runtime/src/engine-health.mjs';
import { EngineRendererOwner, engineProjectIdentity } from './engine-renderer-owner.mjs';
import { serveEngineProvider } from './engine-provider-rpc.mjs';

const failed = (code) => Object.assign(Error(code), { providerCode: code });

/** Desktop-owned resource host. Project paths are exclusively scanner-derived;
 * a fresh ConfigStore.load is readonly, preserving the utility's single writer.
 * IPC reservation bounds apply globally, including startup and closing peers.
 * It does not select wallpapers or replace the M1 prepare/commit/cancel state.
 */
export function createDesktopEngineHost({ electron, env = process.env, platform = process.platform, verifyEndpoint = null,
  scan = scanWallpaperProjects, createOwner = null } = {}) {
  const configPath = defaultConfigPath({ env: { ...env }, platform });
  const failures = new EngineFailureMemory(), peers = new Set(), reservations = new Map();
  let closed = false;
  const instantiate = createOwner ?? ((snapshot) => new EngineRendererOwner({ electron, ...snapshot, failures }));
  async function lookup(id, state) {
    const store = new ConfigStore({ filePath: configPath }); await store.load();
    const config = store.get(), inventory = await scan();
    if (closed || state.closed) throw failed('provider_closed');
    const matches = inventory.projects.filter((project) => project.id === id);
    const project = matches.length === 1 ? matches[0] : null;
    if (!project || project.eligible === false || project.hidden || !['scene', 'web'].includes(project.type) || !projectPolicy(project, config).eligible) return null;
    return { project, config, properties: config.authorProperties[id] ?? {} };
  }
  function attach(peer) {
    if (closed) throw failed('provider_closed');
    if ([...peers].some((state) => state.peer === peer)) throw failed('provider_busy');
    const state = { peer, closed: false, binding: null, closing: null }, leases = new Set();
    peers.add(state);
    let rpc;
    const forget = (lease) => { reservations.delete(lease.token); leases.delete(lease); };
    try {
      rpc = serveEngineProvider({ peer, verifyEndpoint,
        retryProject: async (id) => {
          const active = () => [...reservations.values()].some((lease) => lease.projectId === id);
          if (closed || state.closed) throw failed('provider_closed');
          if (active()) throw failed('provider_busy');
          const snapshot = await lookup(id, state);
          if (!snapshot) throw failed('unregistered_project');
          if (active()) throw failed('provider_busy');
          failures.retry(engineProjectIdentity(snapshot.project));
          return { cleared: true };
        },
        onClosing: () => {
          state.closed = true;
          // Seal pending lookup before awaiting it; it cannot create a late window.
          for (const lease of leases) if (!lease.owner) forget(lease);
          queueMicrotask(() => { void state.binding?.close().catch(() => {}); });
        },
        resolveProject: async (id) => {
          if (closed || state.closed) throw failed('provider_closed');
          if (reservations.size >= 2) throw failed('provider_capacity');
          const lease = { token: randomBytes(16).toString('hex'), projectId: id, owner: null };
          reservations.set(lease.token, lease); leases.add(lease);
          try {
            const snapshot = await lookup(id, state);
            if (!snapshot) { forget(lease); return null; }
            return { ...snapshot, __nativeReservation: lease.token };
          } catch (error) { forget(lease); throw error; }
        },
        createOwner: ({ __nativeReservation: token, ...snapshot }) => {
          const lease = reservations.get(token);
          if (closed || state.closed || !lease || !leases.has(lease)) throw failed('provider_closed');
          try {
            const owner = instantiate(snapshot, { failures }); lease.owner = owner;
            const release = owner.release.bind(owner);
            owner.release = async () => {
              await release();
              if (owner.status().resourcesClosed === true) forget(lease);
            };
            return owner;
          } catch (error) { forget(lease); throw error; }
        },
      });
    } catch (error) { peers.delete(state); throw error; }
    const onExit = () => { void binding.close().catch(() => {}); };
    const binding = {
      async close() {
        if (state.closing) return state.closing;
        state.closing = rpc.close().then(() => { peer.removeListener('exit', onExit); peers.delete(state); });
        state.closing.catch(() => { state.closing = null; }); return state.closing;
      },
      status: rpc.status,
    };
    state.binding = binding; peer.once('exit', onExit);
    return binding;
  }
  return {
    attach,
    close() { closed = true; return Promise.all([...peers].map((state) => state.binding.close())).then(() => {}); },
    status: () => ({ closed, slots: reservations.size, peers: peers.size }),
  };
}
