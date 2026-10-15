import assert from "node:assert/strict";
import test from "node:test";
import { validateProcessCreation } from "../src/process-creation.mjs";

for (const creation of [
  "1601-01-01T00:00:00.0000000", "9999-12-31T23:59:59.9999999Z",
  "2026-10-09T07:00:00.1234567Z", "2026-10-09T07:00:00.1234568Z",
  "2026-10-09T15:00:00.1234567+08:00", "2026-10-09T03:00:00.1234567-04:00",
  "2026-10-09T07:00:00.0000000+14:00", "2026-10-09T07:00:00.0000000-14:00",
  "2026-10-09T07:00:00.0000000+13:59",
  "2024-02-29T00:00:00.0000000Z", "2000-02-29T00:00:00.0000000Z",
]) {
  test(`creation validates round-trip metadata without losing ticks or timezone (${creation})`, () => {
    assert.equal(validateProcessCreation(creation), creation);
  });
}

for (const [label, creation] of [
  ["three fractional digits", "2026-10-09T07:00:00.000Z"],
  ["six fractional digits", "2026-10-09T07:00:00.000000Z"],
  ["eight fractional digits", "2026-10-09T07:00:00.00000000Z"],
  ["missing fractional digits", "2026-10-09T07:00:00Z"],
  ["before supported year", "1600-12-31T23:59:59.9999999Z"],
  ["five digit year", "10000-01-01T00:00:00.0000000Z"],
  ["month zero", "2026-00-09T07:00:00.0000000Z"],
  ["month overflow", "2026-13-09T07:00:00.0000000Z"],
  ["day zero", "2026-10-00T07:00:00.0000000Z"],
  ["February overflow", "2026-02-30T07:00:00.0000000Z"],
  ["non leap February", "2026-02-29T07:00:00.0000000Z"],
  ["non leap century", "1900-02-29T07:00:00.0000000Z"],
  ["thirty day month overflow", "2026-04-31T07:00:00.0000000Z"],
  ["hour overflow", "2026-10-09T24:00:00.0000000Z"],
  ["minute overflow", "2026-10-09T07:60:00.0000000Z"],
  ["second overflow", "2026-10-09T07:00:60.0000000Z"],
  ["positive offset overflow", "2026-10-09T07:00:00.0000000+14:01"],
  ["negative offset overflow", "2026-10-09T07:00:00.0000000-14:01"],
  ["offset hours overflow", "2026-10-09T07:00:00.0000000+15:00"],
  ["offset minutes overflow", "2026-10-09T07:00:00.0000000-08:60"],
  ["offset missing colon", "2026-10-09T07:00:00.0000000+0800"],
  ["leading whitespace", " 2026-10-09T07:00:00.0000000Z"],
  ["trailing content", "2026-10-09T07:00:00.0000000Z private metadata"],
  ["trailing newline", "2026-10-09T07:00:00.0000000Z\n"],
  ["trailing carriage return", "2026-10-09T07:00:00.0000000Z\r"],
  ["lowercase timezone", "2026-10-09T07:00:00.0000000z"],
  ["null", null], ["missing", undefined], ["numeric", 1], ["object", {}],
]) {
  test(`creation rejects ${label} without echoing raw metadata`, () => {
    assert.throws(() => validateProcessCreation(creation), (error) => {
      assert.match(error.message, /^独立验收 creation (?:必须是 CreationDate 的 round-trip o 字符串|时间无效)$/);
      if (typeof creation === "string") assert.equal(error.message.includes(creation), false);
      return true;
    });
  });
}
