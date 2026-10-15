/** WE authors prepend file:/// to API results. Translate only safe private
 * resource aliases; never grant the iframe local/UNC/external file access.
 * Both functions are self-contained for browser-realm serialization. */
export function rewriteWebResourceUrl(value, base) {
  if (typeof value !== 'string' || !/^file:/i.test(value)) return value;
  if (!/^file:\/\/\//i.test(value) || typeof base !== 'string'
    || !/^http:\/\/127\.0\.0\.1:\d+\/[a-f0-9]{32}\/files\/project$/.test(base)) return '';
  const target = value.slice(8);
  if (!target) return '';
  const relative = target.startsWith(base + '/') ? target.slice(base.length + 1) : target;
  if (relative.length > 2048 || relative.startsWith('/') || /[\\\x00-\x1f:?#]/.test(relative)) return '';
  try {
    const parts = relative.split('/').map(decodeURIComponent);
    if (parts.some(part => !part || ['.', '..'].includes(part) || /[\\/\x00-\x1f:%?#]/.test(part))) return '';
    return base + '/' + parts.map(part => encodeURIComponent(part).replace(/['()]/g, character => '%' + character.charCodeAt(0).toString(16).toUpperCase())).join('/');
  } catch { return ''; }
}

export function installWebResourceAliases(window, rewrite, getBase) {
  const restores = [], url = value => rewrite(value, getBase());
  const css = value => typeof value === 'string' ? value.replace(/url\(\s*(['"]?)(file:\/\/\/[^'"\)]*?)\1\s*\)/gi,
    (_all, quote, target) => `url(${quote}${url(target)}${quote})`) : value;
  const html = value => typeof value === 'string' ? css(value).replace(/(\b(?:src|poster|href)\s*=\s*)(["'])(file:\/\/\/.*?)\2/gi,
    (_all, prefix, quote, target) => prefix + quote + url(target) + quote) : value;
  const setter = (prototype, name, convert) => {
    const descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, name);
    if (!descriptor?.set || !descriptor.configurable) return;
    const set = function (value) { return descriptor.set.call(this, convert(value)); };
    Object.defineProperty(prototype, name, { ...descriptor, set });
    restores.push(() => { if (Object.getOwnPropertyDescriptor(prototype, name)?.set === set) Object.defineProperty(prototype, name, descriptor); });
  };
  const method = (prototype, name, convert) => {
    const original = prototype?.[name]; if (typeof original !== 'function') return;
    const wrapper = function (...args) { return original.apply(this, convert(args)); };
    prototype[name] = wrapper;
    restores.push(() => { if (prototype[name] === wrapper) prototype[name] = original; });
  };
  for (const name of ['HTMLImageElement', 'HTMLMediaElement', 'HTMLSourceElement']) setter(window[name]?.prototype, 'src', url);
  setter(window.HTMLVideoElement?.prototype, 'poster', url);
  method(window.Element?.prototype, 'setAttribute', args => {
    const name = typeof args[0] === 'string' ? args[0].toLowerCase() : '';
    if (['src', 'href', 'poster'].includes(name)) args[1] = url(args[1]);
    else if (name === 'style') args[1] = css(args[1]);
    return args;
  });
  setter(window.Element?.prototype, 'innerHTML', html);
  method(window.Element?.prototype, 'insertAdjacentHTML', args => { args[1] = html(args[1]); return args; });
  method(window.CSSStyleDeclaration?.prototype, 'setProperty', args => { args[1] = css(args[1]); return args; });
  setter(window.CSSStyleDeclaration?.prototype, 'cssText', css);
  const prototype = window.HTMLElement?.prototype, descriptor = prototype && Object.getOwnPropertyDescriptor(prototype, 'style');
  if (descriptor?.get && descriptor.configurable && typeof Proxy === 'function') {
    const styles = new WeakMap(), get = function () {
      const style = descriptor.get.call(this);
      if (!styles.has(style)) styles.set(style, new Proxy(style, {
        get(target, name) { const value = Reflect.get(target, name, target); return typeof value === 'function' ? value.bind(target) : value; },
        set(target, name, value) { return Reflect.set(target, name, css(value), target); },
      }));
      return styles.get(style);
    };
    Object.defineProperty(prototype, 'style', { ...descriptor, get,
      ...(descriptor.set ? { set(value) { return descriptor.set.call(this, css(value)); } } : {}) });
    restores.push(() => { if (Object.getOwnPropertyDescriptor(prototype, 'style')?.get === get) Object.defineProperty(prototype, 'style', descriptor); });
  }
  return restores;
}
