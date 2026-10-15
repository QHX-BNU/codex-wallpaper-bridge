/** Fixed native-frame protocol, not a codec/URL/configuration API. */
export function validateEngineVp8Frame(frame) {
  const bytes = frame?.vp8;
  if (!(bytes instanceof Uint8Array) || bytes.length < 11 || bytes.length > 2097152
    || frame.width !== 800 || frame.height !== 450 || !Number.isSafeInteger(frame.sequence)
    || frame.sequence < 1 || frame.sequence > 2147483647 || frame.timestamp !== frame.sequence * 100000) throw Error('invalid_native_frame');
  const tag = bytes[0] | bytes[1] << 8 | bytes[2] << 16;
  if (tag & 1 || (tag >> 1 & 7) > 3 || !(tag & 16) || (tag >>> 5) < 1 || (tag >>> 5) + 10 > bytes.length
    || bytes[3] !== 157 || bytes[4] !== 1 || bytes[5] !== 42
    || (bytes[6] | bytes[7] << 8) !== 800 || (bytes[8] | bytes[9] << 8) !== 450) throw Error('invalid_native_frame');
  return { vp8: Buffer.from(bytes), width: 800, height: 450, sequence: frame.sequence, timestamp: frame.timestamp };
}
