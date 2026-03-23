# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm run setup        # First-time setup: install deps, Prisma generate, run migrations
npm run dev          # Start dev server with Turbopack
npm run build        # Production build
npm run lint         # ESLint check
npm run test         # Run all tests (Vitest)
npm run db:reset     # Reset the SQLite database
```

Run a single test file:
```bash
npx vitest run src/lib/__tests__/file-system.test.ts
```

## Environment

Set `ANTHROPIC_API_KEY` in `.env` to use Claude. Without it, the app falls back to a `MockLanguageModel` that generates sample components (Counter, Form, Card) — useful for development without API costs.

## Architecture

UIGen is a Next.js 15 (App Router) AI-powered React component generator. Users describe components in natural language; the AI generates and edits files in a virtual file system; a live preview renders the result in an iframe.

### Core Data Flow

1. User sends message → `POST /api/chat` (route handler)
2. Route handler calls Claude via Vercel AI SDK `streamText()` with two tools: `str_replace_editor` and `file_manager`
3. AI tool calls mutate a `VirtualFileSystem` instance (in-memory, no disk)
4. On stream completion, the serialized file system and messages are persisted to SQLite via Prisma
5. `PreviewFrame` renders generated files in an isolated iframe using Babel for JSX transform and an import map pointing to esm.sh for React/ReactDOM

### Key Abstractions

**`VirtualFileSystem` (`src/lib/file-system.ts`)** — All generated code lives here. Supports create/read/update/delete, serialization (`serialize()` / `deserializeFromNodes()`), and editor-style commands (`replaceInFile`, `insertInFile`, `viewFile`). The serialized form is stored as `Project.data` (JSON string) in the database.

**`/api/chat/route.ts`** — The core of the app. Receives messages + serialized file system, streams AI responses, executes tool calls against a `VirtualFileSystem`, then saves to the database. Allows up to 40 tool steps (4 for mock).

**`PreviewFrame` (`src/components/preview/PreviewFrame.tsx`)** — Renders an iframe with `srcdoc`. Auto-detects entry point (App.jsx, index.jsx, etc.), transforms JSX via Babel at runtime, and uses an import map to resolve React imports from CDN.

**Provider (`src/lib/provider.ts`)** — Returns Claude Haiku 4.5 if `ANTHROPIC_API_KEY` is set, otherwise returns `MockLanguageModel`.

### State Management

Two React contexts govern client state:
- **`ChatContext`** (`src/lib/contexts/chat-context.tsx`) — messages, input value, streaming status
- **`FileSystemContext`** (`src/lib/contexts/file-system-context.tsx`) — virtual FS state, selected file, refresh trigger

### Authentication

JWT-based sessions (7-day expiry) via `jose`. Passwords hashed with bcrypt. Server actions in `src/actions/index.ts` handle signUp/signIn/signOut. Projects support anonymous ownership (`userId` is optional in the schema). Anonymous user work is tracked in localStorage via `src/lib/anon-work-tracker.ts`.

### Database

SQLite via Prisma. The schema is defined in `prisma/schema.prisma` — always reference it when working on database models, migrations, or Prisma queries. Two models: `User` (email + hashed password) and `Project` (name, optional userId, messages as JSON string, data as JSON string for the serialized VirtualFileSystem).

### Path Alias

`@/*` maps to `./src/*` (configured in tsconfig.json).
