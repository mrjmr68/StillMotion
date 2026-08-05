> **Note on the repo split:** the project spec (`WORKOUT_APP_V2_SPEC.md`) and
> planning docs live in the Google Drive folder alongside this repo — kept
> separate because Drive's sync client and `node_modules` don't get along.
> This repo (`workout-app/`) is the actual codebase, tracked in git.

# Workout App

A two-screen personal training system. Phone is the console (check-in,
controls). A smart TV browser is the stage (shows the current movement,
countdown, coaching cues). An LLM designs each workout once at check-in;
after that, the session runs entirely locally on the TV.

See [`docs/DECISIONS.md`](./docs/DECISIONS.md) for a log of non-obvious
implementation choices.

## Stack

- Next.js (App Router) + TypeScript, deployed on Vercel
- Supabase — Postgres, Auth (magic link), Storage, RLS on every table
- Anthropic API, server-side only

## Local setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create a Supabase project

1. Go to [supabase.com](https://supabase.com), create a new project.
2. In **Project Settings > API**, copy the **Project URL** and the
   **anon / publishable** key.

### 3. Configure environment variables

```bash
cp .env.example .env.local
```

Fill in:

| Variable | Where to find it |
|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase Project Settings > API |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase Project Settings > API (anon/publishable key) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase Project Settings > API (service role — keep secret) |
| `NEXT_PUBLIC_SITE_URL` | `http://localhost:3000` for local dev |
| `ANTHROPIC_API_KEY` | [console.anthropic.com](https://console.anthropic.com) |
| `ANTHROPIC_MODEL` | e.g. `claude-opus-4-6` |

### 4. Configure Supabase auth redirect

In the Supabase dashboard, under **Authentication > URL Configuration**, add
`http://localhost:3000/auth/confirm` (and your deployed URL's equivalent) to
the allowed redirect URLs.

### 5. Run the dev server

```bash
npm run dev
```

Visit `http://localhost:3000`, sign in via magic link, and you should land
on the protected `/app` route.

## Project structure

```
src/
  app/            # Next.js routes (console + auth pages)
  lib/supabase/   # Supabase client factories (browser, server, proxy)
  proxy.ts        # Session-refresh + route protection (Next 16's
                   # replacement for middleware.ts)
```

The `/stage` route (TV) will be its own lean bundle, built separately from
the console — see the spec for why.

## Deployment

Connected to Vercel. Set the same environment variables from `.env.example`
in the Vercel project settings (Production + Preview).
