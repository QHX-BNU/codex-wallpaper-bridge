import { createEngineProviderClient } from '../../src/engine-provider-rpc.mjs';

/** No standalone Node fallback and no renderer/window IPC exposure.
 * The desktop sets this marker only after forking/binding its own utility.
 */
export function openNativeEngineProvider({ processContext = process } = {}) {
  if (processContext.env?.CWB_NATIVE_ENGINE_PROVIDER !== 'owned-parent-v1' || !processContext.parentPort) return null;
  return createEngineProviderClient({ port: processContext.parentPort });
}
