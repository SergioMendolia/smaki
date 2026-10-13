// @ts-check
import withNuxt from './.nuxt/eslint.config.mjs'

export default withNuxt({
  rules: {
    // this codebase uses `any` deliberately for loosely-typed API payloads
    '@typescript-eslint/no-explicit-any': 'off',
  },
})