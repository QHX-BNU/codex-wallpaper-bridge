/** Typed producer seam for the Web shim. No OS capture or media controls here;
 * all values are data copies and no capability/path/command field is accepted.
 * Self-contained so the same validator can run in the private GPU receiver.
 */
export function validateWebWallpaperInput(input) {
  const object = value => value && typeof value === 'object' && !Array.isArray(value);
  const keys = (value, expected) => object(value) && Object.keys(value).length === expected.length
    && expected.every(key => Object.hasOwn(value, key));
  const optionalKeys = (value, required, optional) => object(value) && required.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => required.includes(key) || optional.includes(key));
  if (input?.op === 'audio' && keys(input, ['op', 'values']) && Array.isArray(input.values)
    && input.values.length === 128 && Array.from(input.values).every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1)) {
    return { op: 'audio', values: input.values.slice() };
  }
  const media = input?.value;
  if (input?.op === 'lyrics' && keys(input, ['op', 'value']) && keys(media, ['text', 'next'])
    && [media.text, media.next].every(value => typeof value === 'string' && value.length <= 512)) return { op: 'lyrics', value: { ...media } };
  if (input?.op === 'mediaCapabilities' && keys(input, ['op', 'value']) && keys(media, ['sessionId', 'commands'])
    && typeof media.sessionId === 'string' && (media.sessionId === '' || /^[a-f0-9]{32}$/.test(media.sessionId))
    && Array.isArray(media.commands) && media.commands.length <= 4 && media.commands.every(value => ['play', 'pause', 'previous', 'next'].includes(value))
    && (media.sessionId !== '' || media.commands.length === 0)) return { op: 'mediaCapabilities', value: { sessionId: media.sessionId, commands: [...new Set(media.commands)] } };
  if (input?.op === 'media' && keys(input, ['op', 'value'])
    && optionalKeys(media, ['state', 'title', 'artist', 'album', 'position', 'duration'], ['albumArtist', 'albumTitle', 'subTitle', 'genres', 'contentType'])
    && ['playing', 'paused', 'stopped'].includes(media.state)
    && ['title', 'artist', 'album'].every(key => typeof media[key] === 'string' && media[key].length <= 512)
    && [media.position, media.duration].every(value => typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 86400)
    && media.position <= media.duration
    && ['albumArtist', 'albumTitle', 'subTitle', 'genres'].every(key => !Object.hasOwn(media, key) || typeof media[key] === 'string' && media[key].length <= 512)
    && (!Object.hasOwn(media, 'contentType') || ['music', 'video', 'image'].includes(media.contentType))) {
    return { op: 'media', value: { state: media.state, title: media.title, artist: media.artist, album: media.album,
      position: media.position, duration: media.duration,
      ...Object.fromEntries(['albumArtist', 'albumTitle', 'subTitle', 'genres', 'contentType'].filter(key => Object.hasOwn(media, key)).map(key => [key, media[key]])) } };
  }
  if (input?.op === 'mediaStatus' && keys(input, ['op', 'value']) && keys(media, ['enabled']) && typeof media.enabled === 'boolean') {
    return { op: 'mediaStatus', value: { enabled: media.enabled } };
  }
  if (input?.op === 'mediaThumbnail' && keys(input, ['op', 'value'])
    && optionalKeys(media, ['thumbnail'], ['primaryColor', 'secondaryColor', 'tertiaryColor', 'textColor', 'highContrastColor'])
    && Object.entries(media).every(([key, value]) => key === 'thumbnail' || typeof value === 'string' && /^#[a-fA-F0-9]{6}$/.test(value))) {
    const value = media.thumbnail;
    if (value === '') return { op: 'mediaThumbnail', value: { ...media } };
    // Fits the existing 64 KiB action JSON limit. Only inline raster bytes,
    // never an arbitrary URL, SVG, file path or producer capability.
    const match = typeof value === 'string' && value.length <= 43720
      && /^data:image\/(png|jpeg|gif|webp);base64,([A-Za-z0-9+/]+={0,2})$/.exec(value);
    if (match && match[2].length % 4 === 0) {
      let bytes;
      try { bytes = atob(match[2]); } catch { throw TypeError('web_input_invalid'); }
      const n = bytes.length, u8 = offset => bytes.charCodeAt(offset);
      const u32 = offset => (u8(offset) * 16777216 + u8(offset + 1) * 65536 + u8(offset + 2) * 256 + u8(offset + 3));
      const le32 = offset => (u8(offset) + u8(offset + 1) * 256 + u8(offset + 2) * 65536 + u8(offset + 3) * 16777216);
      const positiveSize = (width, height) => width > 0 && height > 0 && width <= 2048 && height <= 2048;
      const valid = match[1] === 'png' ? n >= 45 && bytes.slice(0, 8) === '\x89PNG\r\n\x1a\n'
        && u32(8) === 13 && bytes.slice(12, 16) === 'IHDR' && positiveSize(u32(16), u32(20))
        && bytes.slice(-12) === '\0\0\0\0IEND\xaeB`\x82'
        : match[1] === 'jpeg' ? n >= 4 && bytes.slice(0, 3) === '\xff\xd8\xff' && bytes.slice(-2) === '\xff\xd9'
        : match[1] === 'gif' ? n >= 14 && ['GIF87a', 'GIF89a'].includes(bytes.slice(0, 6))
          && positiveSize(u8(6) + u8(7) * 256, u8(8) + u8(9) * 256) && bytes.slice(-1) === ';'
        : n >= 20 && bytes.slice(0, 4) === 'RIFF' && le32(4) + 8 === n && bytes.slice(8, 12) === 'WEBP'
          && ['VP8 ', 'VP8L', 'VP8X'].includes(bytes.slice(12, 16));
      if (n <= 32768 && valid) return { op: 'mediaThumbnail', value: { ...media } };
    }
  }
  throw TypeError('web_input_invalid');
}
