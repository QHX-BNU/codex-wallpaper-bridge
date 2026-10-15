import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import test from 'node:test';

const script = await readFile(new URL('../bridge-runtime/public/cwb-verifier-probe.js', import.meta.url), 'utf8');
test('verification probe forwards real export functions and original draw, without creating pixel evidence', () => {
  let drawn = 0;
  class GL { drawArrays() { drawn++; return 'draw-result'; } }
  const window = { Function, WebGL2RenderingContext: GL };
  vm.runInNewContext(script, { window });
  const compile = new window.Function('return {dummy_:0,update:function(x){return x+1},cursorDown:function(x){return x}}');
  const exports = compile(); assert.equal(exports.update(4), 5); assert.equal(exports.cursorDown('same'), 'same');
  assert.equal(new GL().drawArrays(), 'draw-result'); assert.equal(drawn, 1);
  assert.equal(window.__m2Probe.updates, 1); assert.equal(window.__m2Probe.cursors, 1); assert.equal(window.__m2Probe.draws, 1);
  assert.equal(window.__m2Probe.firstFrame, undefined);
});
test('non-script generated functions are forwarded; thrown author exception is not swallowed', () => {
  const window = { Function }; vm.runInNewContext(script, { window });
  assert.equal(new window.Function('return 3')(), 3);
  const exports = new window.Function('return {dummy_:0,update:function(){throw Error("test")}}')();
  assert.throws(() => exports.update(), /test/); assert.equal(window.__m2Probe.throws, 1);
});
