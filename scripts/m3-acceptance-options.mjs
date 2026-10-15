export function parseM3AcceptanceOptions(args) {
  const read = name => {
    const matches = args.filter(value => value.startsWith(`--${name}=`));
    if (matches.length > 1) throw Error('m3_option_duplicate');
    return matches[0]?.slice(name.length + 3);
  };
  const scope = read('scope') ?? 'all';
  const host = read('host');
  const seconds = read('soak-seconds') ?? '120';
  if (!['all', 'window', 'media', 'playback', 'web', 'soak'].includes(scope)) throw Error('m3_scope_invalid');
  if (host !== undefined && !['store', 'local'].includes(host)) throw Error('m3_host_invalid');
  if (['window', 'playback', 'web', 'soak'].includes(scope) && !host) throw Error('m3_single_host_required');
  const foregroundAllowed = args.includes('--allow-foreground');
  if (scope !== 'media' && !foregroundAllowed) throw Error('m3_foreground_requires_opt_in');
  if (!/^\d+$/.test(seconds) || !Number.isSafeInteger(Number(seconds)) || Number(seconds) < 30 || Number(seconds) > 1800) throw Error('m3_soak_duration_invalid');
  return { scope, host, soakSeconds: Number(seconds), foregroundAllowed };
}
