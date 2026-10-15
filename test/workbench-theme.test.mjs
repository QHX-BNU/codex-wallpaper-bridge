import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { runInNewContext } from 'node:vm';
import { COMPILED_BRIDGE_UNPACKED_FILES } from '../src/package-layout.mjs';

const source = await readFile(new URL('../bridge-runtime/public/workbench-theme.js', import.meta.url), 'utf8');
const html = await readFile(new URL('../bridge-runtime/public/index.html', import.meta.url), 'utf8');
const key = 'cwb.workbench.theme';
function fixture({ saved, query = '', blocked = false } = {}) {
  const listeners = {}, events = [], storage = new Map(saved === undefined ? [] : [[key,saved]]);
  const buttons = ['light','dark'].map(theme => ({ dataset:{themeChoice:theme}, attrs:{},
    setAttribute(name,value) { this.attrs[name]=value; }, addEventListener(_name,handler) { this.click=handler; } }));
  const meta = new Map();
  const document = { documentElement:{dataset:{}}, querySelector:selector => ({setAttribute:(_key,value)=>meta.set(selector,value)}),
    querySelectorAll:() => buttons, addEventListener:(name,fn)=>{listeners[name]=fn;} };
  const window = { location:{href:`http://127.0.0.1:12345/fixture/${query}`},
    get localStorage() { if (blocked) throw Error('storage unavailable'); return {getItem:key=>storage.get(key),setItem:(key,value)=>storage.set(key,value)}; },
    addEventListener:(name,fn)=>{listeners[name]=fn;}, dispatchEvent:event=>events.push(event) };
  runInNewContext(source, {window,document,URL,CustomEvent:class {constructor(type,options){this.type=type;this.detail=options.detail;}}});
  return {window,document,buttons,meta,storage,listeners,events,ready:()=>listeners.DOMContentLoaded()};
}

test('theme is restored before DOM ready, including desktop first-paint seed and invalid defaults', () => {
  for (const [options,theme] of [[{},'dark'],[{saved:'light'},'light'],[{saved:'invalid'},'dark'],
    [{saved:'dark',query:'?workbenchTheme=light'},'light'],[{query:'?workbenchTheme=invalid'},'dark']]) {
    const f=fixture(options);
    assert.equal(f.document.documentElement.dataset.workbenchTheme,theme);
    assert.equal(f.meta.get('meta[name="color-scheme"]'),theme);
  }
});

test('native theme buttons update their pressed state, remember choice and send one local event', () => {
  const f=fixture(); f.ready();
  f.buttons[0].click(); f.buttons[0].click();
  assert.equal(f.buttons[0].attrs['aria-pressed'],'true');
  assert.equal(f.buttons[1].attrs['aria-pressed'],'false');
  assert.equal(f.storage.get(key),'light');
  assert.equal(f.events.length,1);
  assert.equal(f.events[0].type,'cwb-workbench-theme-change');
  assert.equal(f.events[0].detail.theme,'light');
  f.window.cwbWorkbenchTheme.restore('dark');
  assert.equal(f.events.length,1,'restoring parent state must not create a message loop');
  assert.equal(f.window.cwbWorkbenchTheme.current(),'light','late desktop state must not undo an explicit local choice');
});

test('unavailable storage does not break the workbench or theme toggle', () => {
  const f=fixture({blocked:true}); f.ready(); f.buttons[0].click();
  assert.equal(f.window.cwbWorkbenchTheme.current(),'light');
});

test('storage changes sync valid preferences; arbitrary values cannot become theme or CSS', () => {
  const f=fixture(); f.ready();
  f.listeners.storage({key,newValue:'light'});
  assert.equal(f.window.cwbWorkbenchTheme.current(),'light');
  f.listeners.storage({key,newValue:'url(script)'});
  f.window.cwbWorkbenchTheme.restore('__proto__');
  assert.equal(f.window.cwbWorkbenchTheme.current(),'light');
  f.listeners.storage({key,newValue:null});
  assert.equal(f.window.cwbWorkbenchTheme.current(),'dark');
});

test('theme bootstrap is synchronous, packaged, UI-only, and fallback picker has no inline/native styling', async () => {
  assert.ok(html.indexOf('<script src="workbench-theme.js"></script>')<html.indexOf('<link rel="stylesheet"'));
  assert.ok(COMPILED_BRIDGE_UNPACKED_FILES.includes('dist/bridge-runtime/public/workbench-theme.js'));
  const build = await readFile(new URL('../scripts/build-app.mjs',import.meta.url),'utf8');
  assert.match(build,/minifyAsset\(path\.join\(bridgeRoot, "public", "workbench-theme\.js"\)/);
  assert.match(html,/<label class="engine-fallback-control"[^>]+for="engineFallbackSelect"/);
  assert.doesNotMatch(html,/<select id="engineFallbackSelect"[^>]+style=/);
  assert.doesNotMatch(source,/fetch\(|api\(|postMessage|brightness|injected|location\.reload/);
});
