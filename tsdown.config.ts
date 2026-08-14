import { clientBundle } from './vendor/tsdown.client.ts'

/**
 * Standalone build config for the role-router client plugin.
 *
 * Uses the vendored dsh client-bundle preset (vendor/tsdown.client.ts, copied
 * from the dsh checkout's packages/client/tsdown.client.ts): the node-half
 * lib/ plus the browser bundle lib/client.js (closure-factory artifact for the
 * GUI's __ModuleLoader__, CSS Modules inlined with auto-injected
 * <style data-plugin>).
 */
export default clientBundle('@SnowAmberX/dsh-role-router', ['src/index.ts'])
