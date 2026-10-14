import { defineStore } from 'pinia'

export interface AuthUser {
  id: string
  username: string
  role: 'admin' | 'member'
}

export const useAuthStore = defineStore('auth', () => {
  const user = ref<AuthUser | null>(null)
  const checked = ref(false)

  async function fetchMe() {
    const fetcher = import.meta.server ? useRequestFetch() : $fetch
    try {
      user.value = await fetcher<AuthUser | null>('/api/auth/me')
    } catch {
      user.value = null
    }
    checked.value = true
  }

  async function login(username: string, password: string) {
    user.value = await $fetch<AuthUser>('/api/auth/login', {
      method: 'POST',
      body: { username, password }
    })
  }

  async function logout() {
    await $fetch('/api/auth/logout', { method: 'POST' })
    user.value = null
    await navigateTo('/login')
  }

  return { user, checked, fetchMe, login, logout }
})