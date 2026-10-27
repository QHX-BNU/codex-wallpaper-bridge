import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import electron from 'electron';
import { buildCompatibilityRestoreScript, buildCompatibilityScript } from '../src/compatibility-script.mjs';

const exec = promisify(execFile);
let proof;
async function browserProof() {
  proof ??= (async () => {
    const temporaryRoot = path.resolve(os.tmpdir());
    const root = await mkdtemp(path.join(temporaryRoot, 'cwb-compat-surfaces-'));
    try {
      const input = path.join(root, 'input.json');
      await writeFile(input, JSON.stringify({
        root,
        safe: buildCompatibilityScript({ adaptive: false }),
        adaptive: buildCompatibilityScript({ adaptive: true }),
        restore: buildCompatibilityRestoreScript(),
      }));
      const env = { ...process.env };
      delete env.ELECTRON_RUN_AS_NODE;
      const { stdout } = await exec(electron, [fileURLToPath(new URL('../scripts/compatibility-surfaces-fixture.cjs', import.meta.url)), input], {
        env, windowsHide: true, timeout: 30_000, maxBuffer: 128 * 1024,
      });
      assert.match(stdout, /CWB_COMPAT_SURFACES_OK/);
      return JSON.parse(await readFile(path.join(root, 'proof.json'), 'utf8'));
    } finally {
      assert.equal(path.dirname(path.resolve(root)), temporaryRoot);
      assert.ok(path.basename(root).startsWith('cwb-compat-surfaces-'));
      await rm(root, { recursive: true, force: true });
    }
  })();
  return proof;
}

for (const theme of ['dark', 'light']) {
  test(`${theme}: long-chat footer and its opaque backing clear beyond the adaptive scan limit`, async () => {
    const p = (await browserProof())[theme];
    assert.ok(p.footerScanIndex > 3000);
    for (const surface of ['threadFooter', 'footerBacking']) {
      assert.notEqual(p.before[surface].background, 'rgba(0, 0, 0, 0)');
      for (const mode of ['safe', 'adaptive']) {
        assert.equal(p[mode][surface].background, 'rgba(0, 0, 0, 0)', `${mode}: ${surface}`);
        for (const property of ['border', 'outline', 'shadow', 'font', 'color', 'inlineStyle']) {
          assert.equal(p[mode][surface][property], p.before[surface][property], property);
        }
      }
      assert.deepEqual(p.afterRestore.styles[surface], p.before[surface]);
    }
    assert.equal(p.footerReplacement.background, 'rgba(0, 0, 0, 0)');
  });
  test(`${theme}: footer rules preserve controls, unrelated footers and dialogs`, async () => {
    const p = (await browserProof())[theme];
    for (const mode of ['safe', 'adaptive']) {
      for (const id of ['footerAction', 'unrelatedFooter', 'dialogFooter', 'dialogFooterBacking']) {
        assert.deepEqual(p[mode][id], p.before[id], `${mode}: ${id}`);
      }
    }
  });
  for (const surface of ['toolbar', 'spaceHeader']) {
    test(`${theme}: safe compatibility clears only the ${surface} background`, async () => {
      const p = (await browserProof())[theme];
      assert.notEqual(p.before[surface].background, 'rgba(0, 0, 0, 0)');
      assert.equal(p.safe[surface].background, 'rgba(0, 0, 0, 0)');
      for (const property of ['border', 'outline', 'shadow', 'font', 'color', 'inlineStyle']) {
        assert.equal(p.safe[surface][property], p.before[surface][property], property);
      }
    });
  }
  test(`${theme}: buttons, search input, editor, attachment and dialogs retain their styling`, async () => {
    const p = (await browserProof())[theme];
    for (const id of ['button', 'directButton', 'directRoleButton', 'search', 'editor', 'attachment', 'menuSurface', 'dialogSurface', 'overlap', 'unrelated']) {
      assert.deepEqual(p.safe[id], p.before[id], id);
    }
    assert.equal(p.safeInputFocused, true);
  });
  test(`${theme}: React replacement and attribute repurposing do not retain transparent backgrounds`, async () => {
    const p = (await browserProof())[theme];
    assert.equal(p.safe.legacyToolbar.background, 'rgba(0, 0, 0, 0)');
    assert.equal(p.replacement.background, p.before.composerBody.background);
    assert.equal(p.repurposed.background, p.before.composerBody.background);
    assert.equal(p.repurposed.inlineStyle, p.before.composerBody.inlineStyle);
  });
  test(`${theme}: compatibility reinjection is singular and restoration returns all original styles`, async () => {
    const p = (await browserProof())[theme];
    assert.equal(p.styleCount, 1);
    assert.equal(p.afterRestore.styleCount, 0);
    assert.equal(p.afterRestore.runtime, false);
    assert.equal(p.afterRestore.marker, false);
    for (const id of ['toolbar', 'legacyToolbar', 'spaceHeader', 'composerBody', 'button', 'directButton', 'directRoleButton', 'search', 'editor', 'attachment', 'menuSurface', 'dialogSurface']) {
      assert.deepEqual(p.afterRestore.styles[id], p.before[id], id);
    }
  });
  test(`${theme}: adaptive mode also handles narrow surfaces without mutating fonts or theme`, async () => {
    const p = (await browserProof())[theme];
    for (const id of ['toolbar', 'legacyToolbar', 'spaceHeader']) {
      assert.equal(p.adaptive[id].background, 'rgba(0, 0, 0, 0)', id);
    }
    for (const mode of ['safe', 'adaptive']) {
      assert.equal(p[mode].composerBody.background, p.before.composerBody.background, mode);
      assert.equal(p[mode].composerBody.image, p.before.composerBody.image, mode);
    }
    for (const id of ['button', 'directButton', 'directRoleButton', 'search', 'editor', 'attachment', 'menuSurface', 'dialogSurface']) {
      assert.deepEqual(p.adaptive[id], p.before[id], id);
    }
    assert.equal(p.themeUnchanged, true);
    assert.deepEqual(p.errors, []);
  });
  test(`${theme}: actual shared plugin/page header backing and inner row become transparent`, async () => {
    const p = (await browserProof())[theme];
    assert.notEqual(p.before.stickyHeader.before.background, 'rgba(0, 0, 0, 0)');
    assert.notEqual(p.before.stickyHeaderRow.background, 'rgba(0, 0, 0, 0)');
    for (const mode of ['safe', 'adaptive']) {
      assert.equal(p[mode].stickyHeader.before.background, 'rgba(0, 0, 0, 0)');
      assert.equal(p[mode].stickyHeaderRow.background, 'rgba(0, 0, 0, 0)');
    }
  });
  test(`${theme}: the actual 32px composer spacer gradient is removed in both modes`, async () => {
    const p = (await browserProof())[theme];
    assert.match(p.before.composerFade.image, /linear-gradient/);
    assert.equal(p.safe.composerFade.image, 'none');
    assert.equal(p.adaptive.composerFade.image, 'none');
  });
  test(`${theme}: ordinary gradients, unrelated sticky content, dialogs and plugin actions stay intact`, async () => {
    const p = (await browserProof())[theme];
    for (const mode of ['safe', 'adaptive']) {
      for (const id of ['contentGradient', 'unrelatedSticky', 'dialogStickyHeader', 'pluginAction']) {
        assert.deepEqual(p[mode][id], p.before[id], `${mode}: ${id}`);
      }
    }
  });
  test(`${theme}: restoration also brings back the native sticky pseudo-background and composer fade`, async () => {
    const p = (await browserProof())[theme];
    for (const id of ['stickyHeader', 'stickyHeaderRow', 'composerFade', 'dialogStickyHeader']) {
      assert.deepEqual(p.afterRestore.styles[id], p.before[id], id);
    }
  });
}
