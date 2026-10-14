/**
 * Host header validation (production hardening).
 *
 * `allowed` is a comma-separated list of hostnames. Matching is case
 * insensitive and ignores the port. An entry starting with "." allows
 * the whole subdomain scope (".example.com" covers a.example.com but
 * not example.com). Empty/unset config disables the check entirely.
 */
export function isHostAllowed(rawHost: string, allowed: string): boolean {
  if (!allowed.trim()) return true
  const host = rawHost.toLowerCase().replace(/:\d+$/, '')
  for (const entry of allowed.split(',')) {
    const pattern = entry.trim().toLowerCase()
    if (!pattern) continue
    if (pattern.startsWith('.')) {
      if (host.endsWith(pattern)) return true
    } else if (host === pattern) {
      return true
    }
  }
  return false
}