/**
 * Shared browser platform modules. Seeding, bundling externals, and Vite
 * aliases consume this list so their module identities cannot drift.
 *
 * Synced with the DSH 0.1.2-alpha.2 client platform list: `dsh-client-store`
 * is the snapshot-store engine (external), `dsh-client-ui-slots` /
 * `dsh-client-ui-primitives` are the shared UI module-table entries, and the
 * removed `dsh-client-runtime` / `dsh-client-web-react` / `ui-attachment` /
 * `client-schema-form` entries are gone.
 * @module @deepseek-ai/dsh-client-web/src/platform
 */

/** The module specifiers the shell shares into the frozen module table. */
export const PLATFORM_MODULES = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client', '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
] as const

/** One platform module specifier (a seed-table key). */
export type PlatformModule = (typeof PLATFORM_MODULES)[number]
