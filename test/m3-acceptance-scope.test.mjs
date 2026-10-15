import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { parseM3AcceptanceOptions } from '../scripts/m3-acceptance-options.mjs';

test('M3 focused acceptance requires an explicit single host and bounded duration', () => {
  for (const scope of ['window', 'playback', 'web', 'soak']) {
    assert.throws(() => parseM3AcceptanceOptions([`--scope=${scope}`]), /single_host_required/);
    assert.deepEqual(parseM3AcceptanceOptions([`--scope=${scope}`, '--host=store', '--soak-seconds=60', '--allow-foreground']), { scope, host: 'store', soakSeconds: 60, foregroundAllowed: true });
    assert.throws(() => parseM3AcceptanceOptions([`--scope=${scope}`, '--host=store']), /foreground_requires_opt_in/);
  }
  assert.equal(parseM3AcceptanceOptions(['--scope=media']).scope, 'media');
  assert.equal(parseM3AcceptanceOptions(['--scope=media']).foregroundAllowed, false);
  assert.throws(() => parseM3AcceptanceOptions([]), /foreground_requires_opt_in/);
});

test('invalid scope, duplicate options and unbounded soak fail before side effects', () => {
  for (const args of [['--scope=other'], ['--host=daily'], ['--scope=media', '--scope=all'], ['--soak-seconds=29'], ['--soak-seconds=1801'], ['--soak-seconds=NaN']]) {
    assert.throws(() => parseM3AcceptanceOptions(args), /m3_/);
  }
});

test('background browser fixtures have no visible-window or foreground activation path', async () => {
  for (const file of ['m3-background-web.cjs', 'm3-acceptance-player.cjs']) {
    const source = await readFile(new URL(`../scripts/${file}`, import.meta.url), 'utf8');
    assert.match(source, /show: false/);
    assert.doesNotMatch(source, /\.show\(|\.focus\(|\.restore\(|bringToFront|show: true|disable-web-security/);
  }
  const runner = await readFile(new URL('../scripts/m3-live-acceptance.mjs', import.meta.url), 'utf8');
  assert.match(runner, /async function launchHost\([^)]*\) \{\s*if \(!options\.foregroundAllowed\)/);
  assert.match(runner, /async function hostWindow\([^)]*\) \{\s*if \(!options\.foregroundAllowed/);
});
