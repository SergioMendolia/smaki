<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'

const auth = useAuthStore()
const username = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

useHead({ title: 'Sign in — smaki' })

async function submit() {
  busy.value = true
  error.value = ''
  try {
    await auth.login(username.value, password.value)
    await navigateTo('/wiki')
  } catch (e: any) {
    error.value = e?.data?.statusMessage || e?.message || 'Something went wrong'
  } finally {
    busy.value = false
  }
}
</script>

<template>
  <div class="flex min-h-[calc(100vh-3.5rem)] items-center justify-center p-4">
    <div class="w-full max-w-sm">
      <h1 class="text-2xl font-bold">Sign in</h1>
      <p class="mt-1 text-sm text-muted">Welcome back to the family wiki.</p>

      <form class="mt-6 space-y-3" @submit.prevent="submit">
        <UInput
          v-model="username"
          icon="i-lucide-user"
          placeholder="Username"
          size="lg"
          autofocus
          required
        />
        <UInput
          v-model="password"
          type="password"
          icon="i-lucide-lock"
          placeholder="Password"
          size="lg"
          required
        />
        <UAlert v-if="error" color="error" variant="subtle" :title="error" />
        <UButton type="submit" block size="lg" :loading="busy">
          Sign in
        </UButton>
      </form>
    </div>
  </div>
</template>