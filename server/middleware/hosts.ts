import { isHostAllowed } from '../utils/hosts'

/**
 * Reject requests whose Host header doesn't match NUXT_ALLOWED_HOSTS
 * (comma-separated; ".example.com" covers subdomains). No-op when unset,
 * so dev/local usage is unaffected. xForwardedHost is trusted because the
 * container should only be reachable by your reverse proxy.
 */
export default defineEventHandler((event) => {
  const allowed = useRuntimeConfig().allowedHosts as string
  if (!allowed) return
  const host = getRequestHost(event, { xForwardedHost: true })
  if (!isHostAllowed(host, allowed)) {
    throw createError({ statusCode: 400, statusMessage: 'Invalid Host header' })
  }
})