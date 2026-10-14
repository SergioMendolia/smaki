# smaki — family wiki

A self-hosted family wiki: markdown pages on disk, hybrid full-text + semantic search over
pages **and** documents (PDF, docx…), and a RAG chat that answers questions from
your content with source links.

**Stack:** Nuxt 4 + Nitro · Nuxt UI v4 + Tailwind v4 · Pinia · Typesense (search) ·
SQLite + Drizzle · markdown with frontmatter on the filesystem.

## Quick start (dev)

```bash
cp .env.example .env        # set the typesense key, point at your LLM
docker compose up -d        # typesense + the app (dev, deps installed at boot)
npm install
npm run db:generate         # one-time: create the drizzle migration
npm run dev
```

Open http://localhost:3000 → the **first account you create becomes the admin**.

The full stack (typesense + app in a container) runs with a plain
`docker compose up -d`. Behind pontsun's traefik the app answers at
`smaki.docker.test` (labels in `docker-compose.yml`).

## Configuration (.env)

| Variable | Meaning |
| --- | --- |
| `NUXT_TYPESENSE_URL` / `NUXT_TYPESENSE_API_KEY` | Typesense endpoint and key (also used by the container via `TYPESENSE_API_KEY`) |
| `NUXT_LLM_URL` | OpenAI-compatible chat endpoint used for RAG answers (`/v1` may be included or not — the app tries both). The model just needs to answer within the app's 5-minute request timeout |
| `NUXT_LLM_MODEL` | plain model name — Typesense routes via the `openai/` prefix internally and **strips it before calling your endpoint**. Leave empty to disable chat (search still works) |
| `NUXT_LLM_API_KEY` | your key for the LLM provider |
| `NUXT_EMBEDDING_MODEL` | default `ts/e5-small` (built-in, runs inside Typesense, no API key). For OpenAI-compatible embeddings add `NUXT_EMBEDDING_URL` (+ `NUXT_EMBEDDING_API_KEY`) |
| `NUXT_PDF_VISION` | global default for VLM description of PDF pages (default `false` — text layer only); override per document from its document page (admin). See *Indexing & search* → *Optional PDF vision indexing* |
| `NUXT_PDF_VISION_MAX_PAGES` | pages described per PDF when vision indexing is on (default `20`) |
| `NUXT_VLM_URL` / `NUXT_VLM_MODEL` / `NUXT_VLM_API_KEY` | the vision model, fully separate from the conversational LLM: any OpenAI-compatible endpoint with image input (e.g. Infomaniak AI's Kimi, Apertus or Ministral). Required when `NUXT_PDF_VISION=true` |
| `NUXT_ALLOWED_HOSTS` | production: hostnames the server accepts (Host header check; unset = allow all). Comma-separated, port ignored; `.example.com` covers all subdomains |
| `NUXT_SECURE_COOKIES` | production: `true` marks session cookies as Secure — set when serving over HTTPS |

⚠️ Switching embedding models requires recreating the Typesense collections
(delete them or `docker compose down -v` — they are rebuilt automatically at next boot).

### Things worth knowing (learned the hard way)

- **The app calls the LLM itself for RAG** — Typesense only does retrieval. The LLM
  endpoint must be reachable *from the app* (`localhost` is fine now; it no longer
  needs to be reachable from inside the Typesense container).
- **Chat history lives in the browser** — the chat store sends the last 10 turns with
  each request; nothing is stored server-side, so reloading the page resets the
  conversation.

## How content works

```
content/
├── recipes/
│   ├── paella.md                 → /wiki/recipes/paella   (page)
│   ├── notes.txt                 → document, listed under recipes/ and indexed
│   └── plans/                    → folder (even when empty: it shows in the tree)
└── genealogy/grandparents.md     → /wiki/genealogy/grandparents
```

- **Tree follows folders.** Every folder (`/wiki/recipes`, `/wiki`, …) opens a generated
  folder page: a summary of its pages, subfolders and documents, plus an **Ask this
  folder** button that scopes the RAG chat to that folder (the wiki root scopes to
  everything). Every `.md` file is a page (including `index.md`, which has no special
  meaning), every other file is a document; folders are never pages. Empty folders are
  listed too — create them with the **New folder** button on any folder page.
- **Frontmatter:** `title`, `description`, `order` (sorting in the tree).
- **Editing:** there is no separate edit mode — every page opens directly in an inline
  [Crepe](https://milkdown.dev/docs/guide/using-crepe) WYSIWYG markdown editor (Milkdown)
  styled like the rendered page, with **auto-save** (~1.5s after the last change). Title
  and description are edited as borderless fields in the page header; every other
  frontmatter key in the file is preserved on save. **Images pasted or dropped into the
  editor are embedded in the markdown as base64 data URLs** (no upload, no extra files).
  Hand-editing files on disk works too; a dev watcher re-indexes changes within ~1s.
- **Files (documents):** files live anywhere in the content tree — there is no
  "attachment" concept, they belong to their folder and are never tied to a page.
  Text is extracted (`unpdf` for PDF, `mammoth` for docx), chunked (~1200 chars,
  overlapping), embedded and indexed — searchable, quotable by the chat, and listed in
  the sidebar and folder pages. Clicking one opens the document's own page at its
  content path (e.g. `/wiki/recipes/scan.pdf`) with inline preview, indexation
  status, indexed chunks and — for admins — reindex and per-document PDF vision.
  Hand-editing files on disk works; a dev watcher re-indexes changes within ~1s.
- **Moving things around:** pages, folders and files can be **moved from the UI**
  (hover a tree entry or use the Move button on pages/folders). Moving a page moves its
  `.md`; moving a folder moves everything inside it (nested pages and files follow);
  the target folder is created if missing, name collisions are refused.
- **Images in markdown:** reference content files as `/api/raw/<content path>`
  (requires a logged-in session).

## Indexing & search

- On boot the server ensures the Typesense collections (`wiki_pages`, `wiki_chunks`)
  exist (idempotent, retried every 30s if Typesense is down), then runs a
  **hash-diff sync** (content hash in SQLite vs disk). Also triggered by the dev watcher,
  after every save/move/delete, and from the user menu → *Re-index wiki*
  (`POST /api/admin/sync`).
- **Search** (`GET /api/search?q=`) is hybrid — typo-tolerant lexical + semantic embedding —
  across pages and document chunks, with highlighted snippets. ⌘K opens it anywhere.
  Quality rules:
  - **lexical hits are the signal:** when a query matches text directly, only those
    hits are returned — weak vector-only neighbors are dropped as noise;
  - semantic hits are only a fallback when nothing matched lexically, and only
    within `NUXT_SEARCH_VECTOR_THRESHOLD` (0.4, calibrated for bge-family
    multilingual models);
  - several matching chunks of the **same document collapse into one result**
    (with a "N passages" badge);
  - chunk content is indexed with **infix** search as a fallback, so queries still match
    inside words glued together by broken PDF text layers ("dudocument" → "document").
    Glyph-spaced extractions ("N u m é r o") are normalized at extraction time.
- **Optional PDF vision indexing:** with a vision-capable model configured
  (`NUXT_VLM_URL` / `NUXT_VLM_MODEL` / `NUXT_VLM_API_KEY`, any OpenAI-compatible
  endpoint with image input — separate from the conversational LLM), PDF pages can
  additionally be rendered to images and described by the VLM (visible text, tables,
  charts, diagrams, photos), making scans without a text layer searchable. By default
  this is **off** (`NUXT_PDF_VISION=false`, text layer only) and can be switched on
  **per document** from its document page (admin). Vision descriptions are cached in
  SQLite per file hash — reindexes and embedding-model changes reuse them instead of
  re-calling the VLM. Pages per PDF are capped at `NUXT_PDF_VISION_MAX_PAGES` (default
  20). Indexed chunks are persisted in SQLite (`file_chunks`) and shown on the
  document page and in the admin index overview.
- **Recommended for non-English content:** use multilingual embeddings from an
  OpenAI-compatible provider, e.g. set `NUXT_EMBEDDING_MODEL=<model>`,
  `NUXT_EMBEDDING_URL=<your-provider>/v1`, `NUXT_EMBEDDING_API_KEY=<your-key>`.
  The collections are recreated and reindexed automatically when the embedding
  model changes.
- **Chat** (`POST /api/chat`) orchestrates RAG in the app and streams the answer:
  on follow-up questions the LLM first rewrites the question into a standalone query
  using the conversation history, retrieval then runs the same hybrid search over
  both collections, and the LLM answers strictly from the assembled context in a
  warm, conversational style (NDJSON stream: `sources`, `delta`, `done` events;
  markdown rendered server-side in `done`). Citation markers are stripped from the
  answer text — sources are shown separately as clickable links. Conversations are
  multi-turn; the history is kept in the browser and sent with each request.
- **AI editing**: every page editor has a built-in AI assistant (Milkdown Crepe's
  AI feature, backed by `POST /api/ai/edit`). Select text and give an instruction —
  or type one with the cursor placed — and the rewrite streams in with a diff
  you accept or reject. Autosave persists the page only after you accept.

## Auth

Username/password (argon2), session cookies in SQLite. On first boot a default admin
account is created: username `admin`, password `SmakiAdmin` — change the password
after the first login. There is no self-registration; admins create users (with
username and role) in the Administration page, and can change usernames, passwords
and roles at any time. Usernames are 3–32 characters (letters, numbers, `.`, `_`,
`-`), passwords must be at least 8 characters. All content endpoints require a
session — nothing is public.

## Production

CI (`.github/workflows/docker.yml`) builds the production image on every push to
`main` (and on `v*` tags) and pushes it to GHCR as
`ghcr.io/sergiomendolia/smaki` (`latest`, `vX.Y.Z`, commit SHA; amd64 + arm64).
PRs only build, without pushing.

On the server you need **only Docker + two files** — no git checkout, no Node:

```bash
mkdir smaki && cd smaki
curl -fLO https://raw.githubusercontent.com/SergioMendolia/smaki/main/docker-compose.prod.yml
curl -fLO https://raw.githubusercontent.com/SergioMendolia/smaki/main/.env.example
mv .env.example .env        # then edit it (see below)
docker compose -f docker-compose.prod.yml up -d
```

The first login is `admin` / `SmakiAdmin` — change the password immediately.

### What to set in `.env`

| Variable | Required | Notes |
| --- | --- | --- |
| `TYPESENSE_API_KEY` | ✅ | random string; used by the Typesense container **and** the app (`NUXT_TYPESENSE_API_KEY` in `.env.example` must match it) |
| `NUXT_ALLOWED_HOSTS` | ✅ | your domain, e.g. `wiki.example.com` (or `.example.com` for all subdomains) — requests with any other Host header are rejected. Don't skip this: Nitro itself does no host validation |
| `NUXT_SECURE_COOKIES` | ✅ | set `true` — session cookies get the `Secure` flag behind HTTPS |
| `NUXT_LLM_URL` / `NUXT_LLM_MODEL` / `NUXT_LLM_API_KEY` | optional | RAG chat + AI editing; without them search still works. The endpoint must be reachable from the app container |
| `NUXT_EMBEDDING_*` | optional | defaults to Typesense's built-in `ts/e5-small`; use an external multilingual model for non-English content (see *Indexing & search*) |
| `NUXT_PDF_VISION` + `NUXT_VLM_*` | optional | vision indexing of PDF pages, off by default |

The compose file already points `NUXT_TYPESENSE_URL` at the Typesense container
and overrides the `.env` value — don't set it.

### Layout & TLS

- `./content/` (wiki markdown + documents) and `./data/` (SQLite, sessions)
  are mounted; everything is edited through the UI. The image's baked-in
  content is only a bootstrap and is shadowed by the mount.
- The app port is published on **localhost only**, on the unusual port `3977`
  (override with `APP_PORT` in `.env`) to avoid clashing with other services —
  put a reverse proxy (caddy, nginx, traefik…) in front for TLS and hostname
  routing.
- Typesense is not exposed at all; it lives on the compose network.

### Upgrades

```bash
docker compose -f docker-compose.prod.yml pull
docker compose -f docker-compose.prod.yml up -d
```

Migrations run automatically at boot; `content/` and `data/` survive upgrades.
⚠️ Switching embedding models still requires recreating the Typesense
collections (`docker compose -f docker-compose.prod.yml down -v` drops them —
they are rebuilt at next boot).

If you prefer building locally instead: `npm run build` +
`node .output/server/index.mjs`, or `docker build --target production .` — same
env vars and persistence rules apply (`content/` or `NUXT_CONTENT_DIR`, and
`data/` for SQLite).
