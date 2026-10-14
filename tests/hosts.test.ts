import { describe, expect, it } from 'vitest'
import { isHostAllowed } from '../server/utils/hosts'

describe('isHostAllowed', () => {
  it('allows everything when unset or blank', () => {
    expect(isHostAllowed('evil.com', '')).toBe(true)
    expect(isHostAllowed('evil.com', '  ')).toBe(true)
  })

  it('matches exact hosts, case insensitive, ignoring the port', () => {
    expect(isHostAllowed('wiki.example.com', 'wiki.example.com')).toBe(true)
    expect(isHostAllowed('WIKI.Example.COM:3000', 'wiki.example.com')).toBe(true)
    expect(isHostAllowed('evil.com', 'wiki.example.com')).toBe(false)
  })

  it('supports multiple entries and subdomain scopes', () => {
    expect(isHostAllowed('a.example.org', 'wiki.example.com, .example.org')).toBe(true)
    expect(isHostAllowed('example.org', 'wiki.example.com, .example.org')).toBe(false)
    expect(isHostAllowed('wiki.example.com', 'wiki.example.com, .example.org')).toBe(true)
  })

  it('ignores empty entries and whitespace', () => {
    expect(isHostAllowed('wiki.example.com', ' , wiki.example.com , ')).toBe(true)
  })

  it('does not fall for lookalikes', () => {
    expect(isHostAllowed('wiki.example.com.evil.io', 'wiki.example.com')).toBe(false)
    expect(isHostAllowed('notwiki.example.com', 'wiki.example.com')).toBe(false)
    expect(isHostAllowed('evilexample.com', '.example.com')).toBe(false)
  })
})