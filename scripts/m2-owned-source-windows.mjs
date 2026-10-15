/** Acceptance-only identities captured at the exact native constructor. Public
 * Electron preference snapshots need not serialize the original preload key.
 * This wrapper changes no BrowserWindow option and never discovers other apps.
 */
export function trackNativeOwnerWindows(BrowserWindow) {
  if (typeof BrowserWindow !== 'function') throw TypeError('native_window_constructor_required');
  const owned = [];
  function OwnedWindow(options) {
    const window = new BrowserWindow(options);
    owned.push({ window, source: !options?.webPreferences?.preload });
    return window;
  }
  return { BrowserWindow: OwnedWindow,
    sources: () => owned.filter(({ window, source }) => source && !window.isDestroyed()).map(({ window }) => window),
  };
}
