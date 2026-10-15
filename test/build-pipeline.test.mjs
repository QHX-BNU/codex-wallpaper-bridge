import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { transform } from 'esbuild';
import { runInNewContext } from 'node:vm';

test('normal builds minify without an obfuscator and preserve package integrity/layout checks', async () => {
  const read = relative => readFile(new URL(relative, import.meta.url), 'utf8');
  const [build, pack, packageText] = await Promise.all([
    read('../scripts/build-app.mjs'), read('../scripts/package-windows.mjs'), read('../package.json'),
  ]);
  const metadata = JSON.parse(packageText);
  assert.equal(Object.hasOwn(metadata.devDependencies, 'javascript-obfuscator'), false);
  assert.doesNotMatch(build, /JavaScriptObfuscator|createObfuscationOptions|\.obfuscate\(/);
  assert.match(build, /minify: true/);
  assert.match(build, /sourcemap: false/);
  assert.match(build, /stage: "compile-assets"/);
  assert.match(pack, /logTiming\("electron-builder"/);
  assert.match(pack, /logTiming\("package-total"/);
  assert.match(pack, /assertProtectedPackageEntries\(listPackage\(appAsar\)\)/);
  assert.match(pack, /assertProtectedUnpackedEntries/);
  assert.match(pack, /electronRuntimeVersion !== electronPackage\.version/);
  assert.match(pack, /electronVersion: electronRuntimeVersion,\s+electronDist,/);
  assert.doesNotMatch(pack, /编译产物仍暴露关键源码标识/);
  assert.equal(metadata.build.asar, true);
  assert.equal(metadata.build.electronFuses.enableEmbeddedAsarIntegrityValidation, true);
});

test('minified serialized functions remain self-contained without a code obfuscator', async () => {
  const source = `function rendererBootstrap(payload) { return payload.prefix + ':' + payload.value; }
    globalThis.result = (0, eval)('(' + rendererBootstrap.toString() + ')({prefix:"ok",value:42})');`;
  const result = await transform(source, { minify: true, loader: 'js', target: 'node22' });
  const context = {};
  runInNewContext(result.code, context);
  assert.equal(context.result, 'ok:42');
});
