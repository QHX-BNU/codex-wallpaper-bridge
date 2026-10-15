// Read-only, bounded GPU metadata from an identity-verified acceptance host.
// Never return target IDs, URLs, handles, author values or application text.
const documentExpression = `(()=>{const r=globalThis.__codexWallpaperBridgeRuntime,s=r?.status?.();return {
  hidden:document.hidden,runtimeReady:r?.ready===true,root:!!document.getElementById('codex-wallpaper-bridge-root'),
  width:innerWidth,height:innerHeight,mediaState:s?.state,switchState:s?.switch?.state,switchError:s?.switch?.error,
  frameCount:document.querySelectorAll('#codex-wallpaper-bridge-root [data-cwb-renderer="direct-gpu"] iframe').length}})()`;
const sceneExpression = `(()=>{const s=window.__cwbScene,c=document.querySelector('canvas');return {
  hidden:document.hidden,phase:s?.phase,paused:s?.paused,draws:s?.draws,renderCompletions:s?.renderCompletions,
  layers:s?.layers,width:c?.width,height:c?.height,hasScene:!!window.__scene}})()`;
function safeMetadata(value, scene = false) {
  const out = {};
  for (const key of scene ? ['hidden', 'paused', 'hasScene'] : ['hidden', 'runtimeReady', 'root']) {
    out[key] = typeof value?.[key] === 'boolean' ? value[key] : null;
  }
  for (const key of scene ? ['width', 'height', 'draws', 'renderCompletions', 'layers'] : ['width', 'height', 'frameCount']) {
    out[key] = Number.isSafeInteger(value?.[key]) && value[key] >= 0 && value[key] <= 1e9 ? value[key] : null;
  }
  if (scene) out.phase = ['loading', 'ready', 'failed', 'released'].includes(value?.phase) ? value.phase : null;
  else {
    out.mediaState = ['idle', 'loading', 'ready', 'error'].includes(value?.mediaState) ? value.mediaState : null;
    out.switchState = ['idle', 'preparing', 'ready', 'error'].includes(value?.switchState) ? value.switchState : null;
    out.switchError = ['Media load timed out', 'Media failed to load or decode', 'Media commit failed'].includes(value?.switchError)
      ? value.switchError : value?.switchError == null ? null : 'unknown';
  }
  return out;
}
export async function readOwnedGpuDocuments({ verifyOwner, listTargets, connect }) {
  await verifyOwner();
  const targets = await listTargets();
  const pages = targets.filter(t => t.type === 'page' && String(t.url).startsWith('app://-')
    && !/initialRoute=.*(?:avatar|pet|overlay)/i.test(t.url)).slice(0, 8);
  const observations = [];
  for (const [targetIndex, target] of pages.entries()) {
    const observation = { targetIndex, available: false, scenes: [] };
    observations.push(observation);
    let page;
    try {
      page = await connect(target);
      observation.document = safeMetadata(await page.evaluate(documentExpression));
      observation.available = true;
      const { root } = await page.call('DOM.getDocument', { depth: 0 });
      const { nodeIds } = await page.call('DOM.querySelectorAll', { nodeId: root.nodeId,
        selector: '#codex-wallpaper-bridge-root [data-cwb-renderer="direct-gpu"] iframe' });
      for (const nodeId of nodeIds.slice(0, 2)) {
        const { node } = await page.call('DOM.describeNode', { nodeId });
        const frame = targets.find(t => {
          if (t.type !== 'iframe' || t.id !== node.frameId) return false;
          try { const url = new URL(t.url); return url.protocol === 'http:' && url.hostname === '127.0.0.1'
            && url.pathname === '/wallpaper-engine/scene-live/index.html'; } catch { return false; }
        });
        if (!frame) { observation.scenes.push({ available: false }); continue; }
        let scene;
        try { scene = await connect(frame); observation.scenes.push({ available: true,
          ...safeMetadata(await scene.evaluate(sceneExpression), true) }); }
        catch { observation.scenes.push({ available: false }); }
        finally { scene?.close(); }
      }
    } catch { observation.available = false; }
    finally { page?.close(); }
  }
  return observations;
}
