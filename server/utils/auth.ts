import crypto from 'node:crypto'
import { hash as argonHash, verify as argonVerify } from '@node-rs/argon2'
import { eq } from 'drizzle-orm'
import type { H3Event } from 'h3'
import { tables, useDb } from './db'

export const SESSION_COOKIE = 'smaki_session'
const SESSION_TTL_DAYS = 30

export interface SessionUser {
  id: string
  email: string
  name: string
  role: 'admin' | 'member'
}

export async function hashPassword(password: string) {
  return argonHash(password.normalize('NFKC'))
}

export async function verifyPassword(password: string, passwordHash: string) {
  try {
    return await argonVerify(passwordHash, password.normalize('NFKC'))
  } catch {
    return false
  }
}

export function getAuthedUser(event: H3Event): SessionUser | null {
  return ((event.context as Record<string, unknown>).user as SessionUser | undefined) ?? null
}

export function requireUser(event: H3Event): SessionUser {
  const user = getAuthedUser(event)
  if (!user) throw createError({ statusCode: 401, statusMessage: 'Not authenticated' })
  return user
}

export function requireAdmin(event: H3Event): SessionUser {
  const user = requireUser(event)
  if (user.role !== 'admin') throw createError({ statusCode: 403, statusMessage: 'Admin only' })
  return user
}

export async function createSession(event: H3Event, userId: string) {
  const token = crypto.randomBytes(32).toString('hex')
  const expiresAt = new Date(Date.now() + SESSION_TTL_DAYS * 86400_000)
  useDb()
    .insert(tables.sessions)
    .values({ token, userId, expiresAt })
    .run()
  setCookie(event, SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_DAYS * 86400,
    secure: false
  })
  return token
}

export async function destroySession(event: H3Event) {
  const token = getCookie(event, SESSION_COOKIE)
  if (token) {
    useDb()
      .delete(tables.sessions)
      .where(eq(tables.sessions.token, token))
      .run()
  }
  deleteCookie(event, SESSION_COOKIE, { path: '/' })
}