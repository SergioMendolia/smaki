/**
 * Minimal stubs for Nitro auto-imports so server/utils can be unit-tested
 * outside the Nuxt server runtime.
 */
;(globalThis as Record<string, unknown>).createError = (opts: {
  statusCode?: number
  statusMessage?: string
}) => {
  const err = new Error(opts.statusMessage ?? 'Error') as Error & { statusCode?: number }
  err.statusCode = opts.statusCode
  return err
}

// default content dir; filesystem tests override this per-test
;(globalThis as Record<string, unknown>).useRuntimeConfig = () => ({
  contentDir: process.env.SMAKI_TEST_CONTENT_DIR ?? 'content',
  dataDir: 'data',
})