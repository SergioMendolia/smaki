<script setup lang="ts">
import { useAuthStore } from '~/stores/auth'

const auth = useAuthStore()
const mode = ref<'login' | 'register'>('login')
const name = ref('')
const email = ref('')
const password = ref('')
const error = ref('')
const busy = ref(false)

useHead({ title: 'Sign in — smaki' })

async function submit() {
  busy.value = true
  error.value = ''
  try {
    if (mode.value === 'login') {
      await auth.login(email.value, password.value)
    } else {
      await auth.register(name.value, email.value, password.value)
    }
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
      <h1 class="text-2xl font-bold">
        {{ mode === 'login' ? 'Sign in' : 'Create your account' }}
      </h1>
      <p class="mt-1 text-sm text-muted">
        {{ mode === 'login'
          ? 'Welcome back to the family wiki.'
          : 'The first account created becomes the admin.' }}
      </p>

      <form class="mt-6 space-y-3" @submit.prevent="submit">
        <UInput
          v-if="mode === 'register'"
          v-model="name"
          icon="i-lucide-user"
          placeholder="Your name"
          size="lg"
        />
        <UInput
          v-model="email"
          type="email"
          icon="i-lucide-mail"
          placeholder="Email"
          size="lg"
          required
        />
        <UInput
          v-model="password"
          type="password"
          icon="i-lucide-lock"
          placeholder="Password (min. 8 characters)"
          size="lg"
          required
        />
        <UAlert v-if="error" color="error" variant="subtle" :title="error" />
        <UButton type="submit" block size="lg" :loading="busy">
          {{ mode === 'login' ? 'Sign in' : 'Create account' }}
        </UButton>
      </form>

      <button
        class="mt-4 w-full text-center text-sm text-muted hover:text-primary"
        @click="mode = mode === 'login' ? 'register' : 'login'"
      >
        {{ mode === 'login' ? 'No account yet? Create one' : 'Already have an account? Sign in' }}
      </button>
    </div>
  </div>
</template>