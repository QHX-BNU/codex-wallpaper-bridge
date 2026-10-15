import { createHash } from 'node:crypto';

export const SCENE_RENDERER_ASSET = 'assets/renderer-AJkjEL9i.js';
const PINNED_SHA256 = '7d4cf1bc13ce49153169d072772f22cd705467195d6cd1c5451d5af13269d566';
const COMPLETE = 'try{Js()}catch{}en.beginFrame();try{t.sceneTextUpdate&&t.sceneTextUpdate(R)}catch{}t.raf=requestAnimationFrame(eo)';
const ACK = ';try{window.__cwbSceneRenderComplete?.()}catch{}';

/** A transport-only overlay of the exact pinned MIT scene host glue. The
 * vendored bundle on disk remains untouched. This hook follows cursor dispatch,
 * input beginFrame/reset, text updates and scheduling the next engine frame.
 * It is an input-consumption acknowledgement, NEVER a trusted pixel proof.
 */
export function applySceneRenderCompletionOverlay(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length !== 1071482
    || createHash('sha256').update(bytes).digest('hex') !== PINNED_SHA256) throw Error('scene_renderer_overlay_mismatch');
  const source = bytes.toString('utf8'), first = source.indexOf(COMPLETE);
  if (first < 0 || source.indexOf(COMPLETE, first + COMPLETE.length) !== -1) throw Error('scene_renderer_overlay_mismatch');
  return Buffer.from(source.slice(0, first + COMPLETE.length) + ACK + source.slice(first + COMPLETE.length));
}
