/** Install only on a dedicated, nonpersistent session. Never use the workbench/default session. */
export function protectEngineRenderer({ webContents, session, wrapperUrl, rendererOrigin }) {
  const loopback = (value) => {
    try {
      const url = new URL(value);
      return url.protocol === 'http:' && url.hostname === '127.0.0.1' && url.port
        && !url.username && !url.password && !url.hash ? url : null;
    } catch { return null; }
  };
  const wrapper = loopback(wrapperUrl), renderer = loopback(rendererOrigin);
  if (!wrapper || !renderer || renderer.origin !== rendererOrigin || wrapper.origin === rendererOrigin) {
    throw new TypeError('invalid isolated engine boundary');
  }
  let closed = false;
  const stats = { requestsRejected: 0, navigationsRejected: 0, popupsRejected: 0, downloadsRejected: 0, permissionsRejected: 0 };
  const count = (key) => { stats[key] = Math.min(1e9, stats[key] + 1); };
  const allowed = (value) => {
    const url = loopback(value);
    return url && (url.origin === rendererOrigin || url.href === wrapper.href);
  };
  // Electron re-runs this for redirects. Author CSP is an additional layer, not the network boundary.
  session.webRequest.onBeforeRequest({ urls: ['<all_urls>'] }, (details, callback) => {
    const document = ['mainFrame', 'subFrame'].includes(details.resourceType);
    const localBytes = !document && (details.url.startsWith(`blob:${rendererOrigin}/`)
      || /^data:(?:image|audio|video|font)\//i.test(details.url));
    const permit = !closed && (!details.method || ['GET', 'HEAD'].includes(details.method))
      && (allowed(details.url) || localBytes);
    if (!permit) count('requestsRejected');
    callback({ cancel: !permit });
  });
  const onNavigate = (details) => {
    const url = loopback(details.url);
    const permit = !closed && url && (details.isMainFrame === true
      ? url.href === wrapper.href : url.origin === rendererOrigin);
    if (!permit) { count('navigationsRejected'); details.preventDefault(); }
  };
  const navigationEvents = ['will-navigate', 'will-frame-navigate', 'will-redirect'];
  for (const name of navigationEvents) webContents.on(name, onNavigate);
  webContents.setWindowOpenHandler(() => { count('popupsRejected'); return { action: 'deny' }; });
  const noWebview = (event) => event.preventDefault();
  webContents.on('will-attach-webview', noWebview);
  session.setPermissionRequestHandler((_wc, _permission, callback) => { count('permissionsRejected'); callback(false); });
  session.setPermissionCheckHandler(() => { count('permissionsRejected'); return false; });
  session.setDisplayMediaRequestHandler((_request, callback) => { count('permissionsRejected'); callback({}); });
  const noDownload = (_event, item) => { count('downloadsRejected'); item.cancel(); };
  session.on('will-download', noDownload);
  return {
    status: () => ({ ...stats, closed }),
    release() {
      if (closed) return;
      closed = true;
      for (const name of navigationEvents) webContents.removeListener(name, onNavigate);
      webContents.removeListener('will-attach-webview', noWebview);
      // Session handlers intentionally remain deny-all after release until the owned session dies.
      // Removing webRequest/permission hooks here would reopen in-flight author requests.
    },
  };
}
