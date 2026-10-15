import assert from 'node:assert/strict';
import { gpuResourceDelta } from './m2-gpu-resource-sampler.mjs';

export const GPU_REMAINING_SAMPLES = Object.freeze([
  { id: '1778944028', type: 'scene', required: ['particles'] },
  { id: '3000932165', type: 'scene', required: ['particles', 'puppets', 'parallax', 'audio'] },
  { id: '3444535389', type: 'scene', required: ['puppets', 'scripts', 'cursorScripts', 'audio'] },
  { id: '3233141951', type: 'scene', required: ['particles', 'puppets', 'scripts', 'cursorScripts', 'parallax', 'audio'] },
  { id: '3553574985', type: 'scene', required: ['particles', 'scripts', 'cursorScripts'] },
  { id: '3785016842', type: 'web', required: ['live2d'] },
  { id: '895116177', type: 'web', required: ['web'] },
]);
const featureExpression = `(()=>{const layers=window.__sceneLayers??[],p=window.__particleStats?.(),s=window.__cwbScene;return {
  layers:layers.length, particles:p?{time:p.t,live:p.systems?.reduce((n,s)=>n+s.live,0),systems:p.systems?.length}:null,
  puppets:layers.filter(l=>l.puppet).slice(0,128).map(l=>({bones:l.puppet.bones?.length??0,animations:l.animationLayers?.length??0})),
  scripts:(window.__objScripts??[]).length, disabledScripts:(window.__objScripts??[]).filter(s=>s.sandbox?.disabled||s.disabled).length,
  calls:window.__m2Probe?{updates:window.__m2Probe.updates,cursors:window.__m2Probe.cursors,throws:window.__m2Probe.throws,parseErrors:window.__m2Probe.parseErrors}:null,
  pointer:window.__pointerStats?.(), audio:s?.audio, completions:s?.renderCompletions, paused:s?.paused
}})()`;

async function pointerSequence(ctx, frame) {
  await ctx.guard(); await ctx.focusOwnedHost();
  const before = await frame.evaluate(featureExpression);
  const point = await ctx.host().evaluate(`(()=>{for(const u of [.2,.5,.8])for(const v of [.3,.6,.8]){const x=innerWidth*u,y=innerHeight*v,e=document.elementFromPoint(x,y);if(e&&!e.closest('button,input,select,textarea,a,summary,[role="button"],[contenteditable]'))return{x,y}}return null})()`);
  assert.ok(point);
  for (const [type, buttons] of [['mouseMoved', 0], ['mousePressed', 1], ['mouseReleased', 0]]) {
    await ctx.host().call('Input.dispatchMouseEvent', { type, ...point, buttons, button: type === 'mouseMoved' ? 'none' : 'left', clickCount: type === 'mouseMoved' ? 0 : 1 });
  }
  const after = await ctx.until(async () => { const state = await frame.evaluate(featureExpression);
    return state.pointer?.counts.down > before.pointer?.counts.down && state.pointer?.counts.up > before.pointer?.counts.up ? state : false; }, 10000);
  assert.equal(after.pointer.leftDown, false); return { before, after };
}

async function webChecks(ctx, sample, frame, record) {
  const read = () => frame.evaluate('({phase:window.__cwbWeb?.phase,paused:window.__cwbWeb?.pausedRequested,animationFrames:window.__cwbWeb?.animationFrames,paintFrames:window.__cwbWeb?.paintFrames,draws:window.__m2Probe?.draws})');
  const before = await read(); assert.equal(before.phase, 'renderable');
  if (sample.required.includes('live2d')) assert.ok(before.draws > 0, 'gpu_web_live2d_no_submits');
  await ctx.api('config', { effects: { playing: false } }); await ctx.until(async () => (await read()).paused === true);
  await ctx.pause(250); const stopped = await read(); await ctx.pause(700); const paused = await read();
  assert.equal(paused.animationFrames, stopped.animationFrames);
  await ctx.api('config', { effects: { playing: true } }); await ctx.until(async () => (await read()).animationFrames > stopped.animationFrames, 15000);
  record.pause = { authorFramesFrozen: true, resumed: true };
  // A bounded test producer, explicitly NOT OS loopback/Now Playing. Callback
  // counts are read from this exact owned frame, not inferred from HTTP dispatch.
  await frame.evaluate(`(()=>{const counts={audio:0,properties:0,playback:0,timeline:0};window.__cwbInputCheck=counts;
    wallpaperRegisterAudioListener(v=>{if(v.length===128&&v.every(n=>n===.5))counts.audio++});
    wallpaperRegisterMediaPropertiesListener(v=>{if(v.title==='M2 test input'&&v.artist==='Fixture')counts.properties++});
    wallpaperRegisterMediaPlaybackListener(v=>{if(v.state===1)counts.playback++});
    wallpaperRegisterMediaTimelineListener(v=>{if(v.position===1&&v.duration===100)counts.timeline++});return true})()`);
  const audio = { op: 'audio', values: Array(128).fill(.5) };
  const a = await ctx.api('action', { action: 'web-input', projectId: sample.id, input: audio }); assert.ok(a.delivered > 0);
  const b = await ctx.api('action', { action: 'web-input', projectId: sample.id, input: { op: 'media', value: {
    state: 'playing', title: 'M2 test input', artist: 'Fixture', album: '', position: 1, duration: 100 } } }); assert.ok(b.delivered > 0);
  await ctx.until(() => frame.evaluate('Object.values(window.__cwbInputCheck).every(n=>n===1)'));
  await ctx.api('config', { effects: { playing: false } }); await ctx.until(async () => (await read()).paused === true);
  const pausedInput = await ctx.api('action', { action: 'web-input', projectId: sample.id, input: audio }); assert.equal(pausedInput.delivered, 0);
  await ctx.pause(200); assert.equal(await frame.evaluate('window.__cwbInputCheck.audio'), 1);
  await ctx.api('config', { effects: { playing: true } });
  for (const body of [{ action: 'web-input', projectId: 'not-selected', input: audio },
    { action: 'web-input', projectId: sample.id, input: { ...audio, path: 'file:///denied' } }]) {
    await assert.rejects(ctx.api('action', body));
  }
  record.input = { source: 'explicit-test-producer', actualCallbacks: await frame.evaluate('window.__cwbInputCheck'), pausedDelivery: 0, rejectedInvalid: true, osProducerTested: false };
  const properties = await ctx.api('author-properties/' + sample.id);
  if (Object.keys(properties.schema).length) { assert.equal(properties.live?.method, 'author-delivery'); assert.equal(properties.live?.source, 'codex-gpu'); }
  record.authorDelivery = properties.live?.method ?? 'unavailable';
}

const median = values => values.toSorted((a, b) => a - b)[Math.floor(values.length / 2)];
export function resourcePlateau(samples) {
  if (!Array.isArray(samples) || samples.length < 12) throw Error('gpu_soak_samples_missing');
  const metrics = ['rss', 'privateBytes', 'dedicatedBytes', 'sharedBytes'];
  return Object.fromEntries(metrics.map(key => {
    const first = samples.slice(0, 4).map(s => s[key]), last = samples.slice(-4).map(s => s[key]);
    if ([...first, ...last].some(n => typeof n !== 'number' || !Number.isFinite(n))) return [key, { available: false, pass: false }];
    const before = median(first), after = median(last), allowance = Math.max(128 * 1024 ** 2, before * .25);
    return [key, { available: true, before, after, allowance, growth: after - before, pass: after - before <= allowance }];
  }));
}

export async function runGpuRemainingSamples(ctx) {
  const { report } = ctx;
  const samples = ctx.webOnly ? GPU_REMAINING_SAMPLES.filter(sample => sample.type === 'web') : GPU_REMAINING_SAMPLES;
  const cycles = ctx.webOnly ? 1 : 3;
  report.matrix = { configuredCycles: cycles, configuredSampleIds: samples.map(s => s.id),
    configuredSwitches: cycles * samples.length, switches: [], samples: [], failedSamples: [] };
  if (!(await ctx.nativeState()).ready) {
    report.matrix.notRun = 'gpu-runtime-unavailable-after-prior-failure';
    report.notRun.push('sample matrix and soak blocked by unavailable GPU runtime');
    await ctx.progress(); return;
  }
  const failed = new Set();
  for (let cycle = 0; cycle < cycles; cycle++) for (const sample of samples) {
    if (failed.has(sample.id)) { report.matrix.switches.push({ cycle, id: sample.id, status: 'not-run-prior-failure' }); continue; }
    const record = { cycle, id: sample.id, type: sample.type, required: sample.required, status: 'running' };
    report.matrix.switches.push(record);
    await ctx.step(`GPU remaining matrix cycle ${cycle + 1} sample ${sample.id}`, async () => {
      await ctx.select(sample.id); await ctx.focusOwnedHost(); await ctx.gpuStatus(sample.id);
      record.state = await ctx.nativeState();
      if (cycle === 0) {
        const frame = await ctx.sceneConnection();
        try {
          const first = await ctx.captureGpu(`matrix-${sample.id}-a`); await ctx.pause(800);
          const last = await ctx.captureGpu(`matrix-${sample.id}-b`); assert.notEqual(first.sha256, last.sha256);
          record.pixels = { first, last, dynamicCroppedHostPixels: true, physicalScreenFps: null };
          if (sample.type === 'web') await webChecks(ctx, sample, frame, record);
          else {
            const state = await frame.evaluate(featureExpression); record.features = state;
            if (sample.required.includes('particles')) assert.ok(state.particles?.systems > 0 && state.particles.live > 0);
            if (sample.required.includes('puppets')) assert.ok(state.puppets.some(p => p.bones > 0));
            if (sample.required.includes('scripts')) { assert.ok(state.scripts > 0 && state.calls?.updates > 0); assert.equal(state.calls.parseErrors, 0); assert.equal(state.calls.throws, 0); }
            if (sample.required.includes('cursorScripts') || sample.required.includes('parallax')) {
              record.pointer = await pointerSequence(ctx, frame);
              if (sample.required.includes('cursorScripts')) assert.ok(record.pointer.after.calls.cursors > record.pointer.before.calls.cursors);
              // Pointer consumption is verified. This is not a separately
              // isolated measurement of the parallax shader contribution.
              record.parallaxContributionIsolated = false;
            }
            if (sample.required.includes('audio')) {
              try {
                await ctx.api('config', { effects: { audioEnabled: true, volume: 15 } });
                const before = await ctx.until(async () => { const s = await frame.evaluate('window.__cwbScene?.audio'); return s?.ready > 0 && s.playing > 0 ? s : false; }, 15000);
                await ctx.pause(700); const after = await frame.evaluate('window.__cwbScene.audio'); assert.ok(after.time > before.time);
                record.audio = { before, after, decodedClockAdvanced: true, humanAudibleConfirmation: false };
              } finally { await ctx.api('config', { effects: { audioEnabled: false, volume: 0 } }); }
            }
          }
          report.matrix.samples.push(record);
        } finally { frame.close(); }
      }
      record.status = 'pass';
    }).catch(() => { record.status = 'fail'; failed.add(sample.id); report.matrix.failedSamples.push(sample.id); });
    await ctx.progress();
  }
  if (ctx.webOnly) { report.notRun.push('full Scene sample matrix and resource soak (Web-only GPU acceptance)'); return; }
  await ctx.step('GPU ten-minute fixed-scene CPU RSS WDDM GPU and VRAM plateau observation', async () => {
    await ctx.select(GPU_REMAINING_SAMPLES[0].id); await ctx.focusOwnedHost(); await ctx.pause(20000);
    const frame = await ctx.sceneConnection();
    report.resourceSoak = { durationTargetMs: 600000, intervalMs: 30000, scope: 'ten-minute-fixed-scene-not-hours-or-universal-leak-proof',
      plateauAllowance: 'last-four median minus first-four median <= max(128 MiB, 25 percent baseline)', samples: [], rawFiles: [] };
    const started = Date.now(); let before = await ctx.sampleResources();
    try {
      let completions = await frame.evaluate('window.__cwbScene.renderCompletions');
      while (Date.now() - started < 600000 || report.resourceSoak.samples.length < 12) {
        await ctx.pause(30000); await ctx.guard();
        const after = await ctx.sampleResources(), delta = gpuResourceDelta(before, after);
        const next = await frame.evaluate('window.__cwbScene.renderCompletions'); assert.ok(next > completions);
        const state = await ctx.nativeState(); assert.equal(state.slots, 1); assert.equal(state.nativeSlots, 0);
        report.resourceSoak.samples.push({ ...delta, elapsedMs: Date.now() - started,
          rendererCompletedFps: (next - completions) * 1000 / delta.elapsedMs });
        completions = next; before = after; await ctx.progress();
      }
      report.resourceSoak.elapsedMs = Date.now() - started; report.resourceSoak.plateau = resourcePlateau(report.resourceSoak.samples);
      report.resourceSoak.allGpuCountersAvailable = report.resourceSoak.samples.every(s => s.gpuCountersAvailable);
      assert.ok(Object.values(report.resourceSoak.plateau).every(p => p.available && p.pass), 'gpu_soak_unavailable_or_growing');
    } finally { frame.close(); }
  }).catch(() => {});
}
