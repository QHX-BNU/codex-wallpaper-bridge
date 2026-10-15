import assert from 'node:assert/strict';
import test from 'node:test';
import vm from 'node:vm';
import { rewriteWebResourceUrl, installWebResourceAliases } from '../bridge-runtime/src/web-resource-aliases.mjs';

const base = 'http://127.0.0.1:40123/' + 'a'.repeat(32) + '/files/project';
test('legacy file:/// aliases resolve only to the exact private project base, not disk, UNC, external or traversal paths', () => {
  assert.equal(rewriteWebResourceUrl('file:///' + base + '/one.png', base), base + '/one.png');
  assert.equal(rewriteWebResourceUrl('file:///defaults/a b.png', base), base + '/defaults/a%20b.png');
  assert.equal(rewriteWebResourceUrl('file:///', base), '');
  assert.equal(rewriteWebResourceUrl('data:image/png;base64,AA==', base), 'data:image/png;base64,AA==');
  for (const url of ['file:///C:/secret', 'file://server/share', 'file:///../secret', 'file:///%2e%2e/secret', 'file:///%252e%252e/secret',
    'file:///https://evil.test/a', 'file:///http://127.0.0.1:40124/a.png', 'file:///a%2fb.png', 'file:///a\\b.png', 'file:///a.png?token=x']) {
    assert.equal(rewriteWebResourceUrl(url, base), '', url);
  }
  assert.equal(rewriteWebResourceUrl("file:///a'b(c).png", base), base + '/a%27b%28c%29.png');
  assert.equal(rewriteWebResourceUrl('file:///one.png', 'http://evil.test/'), '');
});
test('resource aliases cover src/setAttribute/style/HTML assignments and restore only their own isolated patches', () => {
  class Element { setAttribute(name, value) { this[name + 'Attribute'] = value; } insertAdjacentHTML(_where, html) { this.inserted = html; } }
  Object.defineProperty(Element.prototype, 'innerHTML', { configurable: true, get() { return this.html; }, set(value) { this.html = value; } });
  class Image extends Element {}
  Object.defineProperty(Image.prototype, 'src', { configurable: true, get() { return this.url; }, set(value) { this.url = value; } });
  class Style { setProperty(name, value) { this[name] = value; } }
  class Html extends Element {}
  Object.defineProperty(Html.prototype, 'style', { configurable: true, get() { return this.styles ??= new Style(); } });
  const original = Element.prototype.setAttribute;
  const restore = installWebResourceAliases({ Element, HTMLImageElement: Image, HTMLElement: Html, CSSStyleDeclaration: Style }, rewriteWebResourceUrl, () => base);
  const image = new Image(), html = new Html();
  image.src = 'file:///' + base + '/one.png'; assert.equal(image.src, base + '/one.png');
  image.setAttribute('src', 'file:///one.png'); assert.equal(image.srcAttribute, base + '/one.png');
  html.style.backgroundImage = "url('file:///one.png')"; assert.equal(html.style.backgroundImage, "url('" + base + "/one.png')");
  html.style.setProperty('background-image', 'url(file:///one.png)'); assert.equal(html.style['background-image'], 'url(' + base + '/one.png)');
  html.innerHTML = '<img src="file:///one.png"><div style="background:url(\'file:///one.png\')"></div>';
  assert.equal(html.innerHTML, '<img src="' + base + '/one.png"><div style="background:url(\'' + base + '/one.png\')"></div>');
  html.insertAdjacentHTML('beforeend', "<img src='file:///C:/secret.png'>"); assert.equal(html.inserted, "<img src=''>");
  assert.equal(html.style, html.style, 'proxy is stable and native style methods keep their receiver');
  restore.forEach(fn => fn()); assert.equal(Element.prototype.setAttribute, original);
  image.src = 'file:///one.png'; assert.equal(image.src, 'file:///one.png');
});
test('resource rewrite/install functions serialize without module bindings', () => {
  const rewrite = vm.runInNewContext('(' + rewriteWebResourceUrl.toString() + ')');
  assert.equal(rewrite('file:///one.png', base), base + '/one.png');
  const install = vm.runInNewContext('(' + installWebResourceAliases.toString() + ')');
  assert.equal(install({}, rewrite, () => base).length, 0);
});
