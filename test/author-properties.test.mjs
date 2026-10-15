import assert from 'node:assert/strict';
import test from 'node:test';
import { normalizeAuthorProperties, readAuthorProperties, validateAuthorPropertyPatch } from '../bridge-runtime/src/author-properties.mjs';

const schema = () => normalizeAuthorProperties({
  enabled: { type: 'bool', value: true, text: '<b>Enable</b>' },
  amount: { type: 'slider', min: -10, max: 100, value: 5, fraction: false },
  color: { type: 'color', value: '0.1 0.2 1' },
  mode: { type: 'combo', value: 'one', options: [{ label: 'One', value: 'one' }, { label: 'Two', value: 'two' }] },
  name: { type: 'textinput', value: 'name' },
  heading: { text: '<a href=file:///secret>heading</a>' },
});
test('author schema normalizes typed defaults and inert plain-text labels only', () => {
  const result = schema();
  assert.equal(result.schema.enabled.label, 'Enable');
  assert.equal(result.schema.heading, undefined);
  assert.deepEqual(result.values, { enabled: true, amount: 5, color: '0.1 0.2 1', mode: 'one', name: 'name' });
});
test('valid property patch preserves types and supports a partial update', () => {
  assert.deepEqual(validateAuthorPropertyPatch(schema().schema, { enabled: false, amount: 10, mode: 'two' }),
    { enabled: false, amount: 10, mode: 'two' });
});
for (const [name, patch] of Object.entries({
  bool: { enabled: 'false' }, overflow: { amount: 101 }, float: { amount: 1.2 }, nan: { amount: NaN },
  color: { color: '0 0 2' }, combo: { mode: 'missing' }, unknown: { file: 'file:///secret' },
  nested: { name: { value: 'x' } }, long: { name: 'a'.repeat(1025) }, array: [],
  prototype: JSON.parse('{"__proto__":{"polluted":true}}'),
})) test(`invalid property ${name} rejects entire patch`, () => {
  assert.equal(validateAuthorPropertyPatch(schema().schema, patch), null);
});
test('invalid ranges, defaults, dangerous property keys and unsupported types are not executable controls', () => {
  const result = normalizeAuthorProperties(JSON.parse('{"__proto__":{"type":"bool","value":true},"file":{"type":"file","value":"x"},"bad":{"type":"slider","min":20,"max":1,"value":5},"wrong":{"type":"bool","value":"false"}}'));
  // file is now supported, but its invalid path default becomes empty.
  assert.deepEqual(result.values, { file: '' }); assert.equal({}.polluted, undefined);
});
test('schema and patch are bounded; fractional sliders explicitly allow fractions', () => {
  const props = Object.fromEntries(Array.from({ length: 300 }, (_, i) => ['p' + i, { type: 'bool', value: false }]));
  assert.equal(Object.keys(normalizeAuthorProperties(props).schema).length, 256);
  const result = normalizeAuthorProperties({ n: { type: 'slider', fraction: true, min: 0, max: 1, value: 0.5 } });
  assert.deepEqual(validateAuthorPropertyPatch(result.schema, { n: 0.75 }), { n: 0.75 });
});

test('actual engine RGB array readback normalizes; malformed field does not erase unrelated controls', () => {
  const result = readAuthorProperties(schema().schema, { enabled: false, color: [.1, .2, 1], amount: 'invalid' }, validateAuthorPropertyPatch);
  assert.deepEqual(result.values, { enabled: false, color: '0.1 0.2 1' }); assert.equal(result.rejected, 3);
});

test('WebWallGL WEVector color readback normalizes without exposing object prototypes', () => {
  const actual = { color: Object.assign(Object.create({ method() {} }), { x: .1, y: .2, z: 1 }) };
  assert.deepEqual(readAuthorProperties(schema().schema, actual, validateAuthorPropertyPatch).values, { color: '0.1 0.2 1' });
});
