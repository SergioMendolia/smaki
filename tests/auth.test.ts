import { describe, expect, it } from 'vitest'
import { hashPassword, verifyPassword } from '../server/utils/auth'

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct horse battery staple')
    expect(hash).not.toContain('correct horse')
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true)
    expect(await verifyPassword('wrong password', hash)).toBe(false)
  })

  it('handles unicode normalization consistently', async () => {
    const hash = await hashPassword('café')
    // NFKC-composed vs decomposed input should match
    expect(await verifyPassword('cafe\u0301', hash)).toBe(true)
  })

  it('returns false for malformed hashes instead of throwing', async () => {
    expect(await verifyPassword('x', 'not-a-hash')).toBe(false)
  })
})