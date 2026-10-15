/** Native clock of the dedicated hidden offscreen source, capped at the same
 * 30 FPS as the scene renderer. Regular hidden BrowserWindows can throttle
 * iframe rAF to 1 FPS even with backgroundThrottling=false. No timer pumps
 * input here; only exact engine completion callbacks can acknowledge input.
 * Paint images are not retained or accepted as decoded first-frame proofs.
 */
export function createEngineFrameClock(contents) {
  if (!contents || ['isOffscreen', 'setFrameRate', 'startPainting', 'stopPainting', 'isDestroyed', 'on', 'removeListener']
    .some((name) => typeof contents[name] !== 'function') || contents.isDestroyed() || !contents.isOffscreen()) throw TypeError('invalid_native_frame_clock');
  let released = false, presentations = 0;
  const paint = () => { if (!released) presentations = Math.min(1e9, presentations + 1); };
  const release = () => {
    if (released) return;
    released = true; contents.removeListener('destroyed', release); contents.removeListener('paint', paint);
    if (!contents.isDestroyed()) contents.stopPainting();
  };
  contents.setFrameRate(30); contents.on('paint', paint); contents.on('destroyed', release); contents.startPainting();
  return Object.freeze({ release, status: () => ({ released, presentations, frameRate: 30, offscreen: true }) });
}
