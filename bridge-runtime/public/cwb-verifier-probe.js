/* Explicit isolated-verifier option only. No production dependency on these counters. */
(() => {
  'use strict';
  const stats = { updates: 0, cursors: 0, cursorScripts: 0, throws: 0, parseErrors: 0, draws: 0,
    cursorKinds: {}, cursorDefinitions: {} };
  window.__m2Probe = stats;
  const count = (key) => { stats[key] = Math.min(1e9, stats[key] + 1); };
  const Native = window.Function;
  window.Function = new Proxy(Native, { construct(target, args) {
    let fn;
    try { fn = Reflect.construct(target, args); }
    catch (error) { if (args[0] === 'scriptProperties') count('parseErrors'); throw error; }
    return new Proxy(fn, { apply(target, receiver, parameters) {
      const result = Reflect.apply(target, receiver, parameters);
      if (result && typeof result === 'object' && result.dummy_ === 0
        && Object.keys(result).some((key) => /^cursor/.test(key) && typeof result[key] === 'function')) count('cursorScripts');
      if (result && typeof result === 'object' && result.dummy_ === 0) for (const key of Object.keys(result)) {
        if (typeof result[key] !== 'function' || !(key === 'update' || /^cursor/.test(key))) continue;
        const original = result[key];
        if (/^cursor/.test(key)) stats.cursorDefinitions[key] = (stats.cursorDefinitions[key] ?? 0) + 1;
        result[key] = function (...values) {
          count(key === 'update' ? 'updates' : 'cursors');
          if (/^cursor/.test(key)) stats.cursorKinds[key] = Math.min(1e9, (stats.cursorKinds[key] ?? 0) + 1);
          try { return original.apply(this, values); }
          catch (error) { count('throws'); throw error; }
        };
      }
      return result;
    } });
  } });
  for (const type of [window.WebGLRenderingContext, window.WebGL2RenderingContext]) {
    for (const key of ['drawArrays', 'drawElements', 'drawArraysInstanced', 'drawElementsInstanced']) {
      const proto = type?.prototype;
      if (!proto || !Object.hasOwn(proto, key) || typeof proto[key] !== 'function') continue;
      const original = proto[key];
      proto[key] = function (...values) { const result = original.apply(this, values); count('draws'); return result; };
    }
  }
})();
