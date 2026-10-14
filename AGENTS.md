# AGENTS.md

## Commands

- `npm run dev` — Nuxt dev server (needs `.env` + Typesense running: `docker compose up -d`)
- `npm test` / `npm run test:watch` — Vitest (`tests/**/*.test.ts`, node env, `tests/setup.ts` stubs Nitro auto-imports like `createError`/`useRuntimeConfig`)
- Single test file: `npx vitest run tests/text.test.ts`
- `npm run lint` / `npm run lint:fix` — ESLint (flat config, `@nuxt/eslint`)
- `npm run typecheck` — `nuxt typecheck` (vue-tsc); run `lint` and `typecheck` before considering work done (CI runs both)
- DB schema changes: edit `server/database/schema.ts`, then `npm run db:generate` (drizzle-kit generates migrations in `server/database/migrations`); `npm run db:migrate` applies (server also auto-migrates on boot)

## Architecture

- Nuxt 4 (new layout: `app/` for frontend, `server/` for Nitro backend — no `pages/` at root).
- Single catch-all page route: `app/pages/wiki/[...slug].vue`; `/` redirects to `/wiki`.
- `server/utils/` holds the core logic (`content.ts` filesystem, `indexer.ts` Typesense sync, `typesense.ts`, `bootstrap.ts`, `auth.ts`); `server/plugins/ready.ts` bootstraps collections, `watcher.ts` re-indexes content changes in dev.
- Content = markdown + files on disk under `content/` (path = wiki URL); state in SQLite (`data/app.db`, better-sqlite3 + Drizzle); search in Typesense (collections `wiki_pages`, `wiki_chunks`); RAG is orchestrated in the app (`server/utils/rag.ts`): LLM query rewriting from client-sent history → hybrid retrieval → streamed friendly uncited answer (citation markers stripped; sources returned separately). `server/utils/llm.ts` is the OpenAI-compatible client (streaming + non-streaming, `/v1` fallback). AI page editing (`server/api/ai/edit.post.ts`) streams rewrites for the Crepe AI editor feature.
- Auth: email/password (argon2), session cookies; **all content endpoints require a session**. First registered user becomes admin.
- Pinia stores in `app/stores/`; `app/middleware/auth.global.ts` + `server/middleware/auth.ts` guard routes/API.

## Gotchas

- Requires Node >= 22.
- `.env` is gitignored but present locally; never commit it or print its keys. Typesense key must match in `NUXT_TYPESENSE_API_KEY` and `TYPESENSE_API_KEY` (container).
- Runtime config lives in `nuxt.config.ts` (`runtimeConfig`), all overridable via `NUXT_*` env vars.
- Switching embedding models requires recreating Typesense collections (`docker compose down -v`); they rebuild at next boot.
- Typesense enforces a hard 60s timeout per LLM call and must be able to reach `NUXT_LLM_URL` from inside its container (`localhost` there = itself).
- Images in markdown are stored as base64 data URLs; content files are referenced as `/api/raw/<content path>` (session required).
- Tests must not touch the real `content/` dir — filesystem tests override `SMAKI_TEST_CONTENT_DIR`.

## Reference

- `README.md` documents content semantics, indexing/search behavior, and deployment in detail — read it before changing content/search/chat features.