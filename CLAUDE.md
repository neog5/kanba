# CLAUDE.md – Maxxortho Planner (fork of Kanba)

Internal project planner for Maxxortho, replacing MS Planner (main pain: one M365 group per project).
Projects are owned by users and shared per project by inviting colleagues by email.

## Repo
- `origin` = https://github.com/neog5/kanba (our fork). `upstream` = https://github.com/Kanba-co/kanba (MIT).
- **Never open PRs or push to Kanba-co.** PRs always target `neog5/kanba` (`gh pr create --repo neog5/kanba`).
- Keep custom changes small and isolated so `git fetch upstream && git merge upstream/main` stays easy.
  Mark our additions with a `// Maxxortho:` comment where it helps. Keep the MIT LICENSE.
- Line endings: upstream stores LF (README.md is the exception, stored CRLF). `core.autocrlf=true` locally.
  Diffs should only show real changes – if a diff shows whole files changed, it's a line-ending problem.
- Dev box is Windows (PowerShell). Branch per change, PR into `main` of the fork.

## Stack
Next.js 13 app router + TypeScript + Tailwind/shadcn + Supabase (Auth, Postgres+RLS, Storage, Realtime).
Stripe code exists but is dormant. Target hosting: Cloudflare Workers via `@opennextjs/cloudflare`.
Supabase Pro tier (free tier pauses). Migrations live in `supabase/migrations/` and are versioned in git.

## Self-hosted mode (done – branch `self-hosted-flag`)
- `NEXT_PUBLIC_SELF_HOSTED=true` → `lib/plan.ts` (`SELF_HOSTED`, `isPro()`): everyone is Pro.
- Billing UI hidden; `next.config.js` redirects `/` and `/dashboard/billing/*` → `/dashboard`;
  `/api/stripe/*` return 404. Build verified without any Stripe env vars.
- Use `isPro()` / `SELF_HOSTED` for any new plan-related check; don't delete Stripe code.

## Codebase facts (verified Oct 2026, upstream d5dfe82)
- Auth is **Supabase Auth only**, client-side via `lib/supabase.ts` (anon key, no `@supabase/ssr`).
  NextAuth env vars in README are dead config. No `middleware.ts`; dashboard guarded in `app/dashboard/layout.tsx`.
  Login/signup: `app/login/page.tsx`, `app/signup/page.tsx` (email+password, Google, GitHub).
- `handle_new_user()` trigger (migration `20250621152739_winter_tower.sql`) creates `profiles` rows.
- Prisma / plain-Postgres path (`prisma/`, `lib/database.ts`, `lib/adapters/postgres.ts`) is unused;
  all code imports `@/lib/supabase`. Build still runs `prisma generate`.
- Members: `project_members` (owner/admin/member). `components/team-management.tsx` "invite" only adds
  users who already have an account (via `search_users_for_collaboration` RPC); no email, no pending invites.
- Public read-only share: `projects.public_share_token` → `app/share/[token]`.
- API routes: `api/stripe/checkout`, `api/stripe/webhook`, `api/fetch-meta`.
- Many migrations drop/recreate the same RLS policies – replay all to know the final state.
- Known gap: policy `secure_profiles_update_own` (`20250722000001_check_and_fix_rls.sql`) lets users
  update any column of their own profile (incl. `subscription_status`). Tighten later.
- `app/layout.tsx` loads Inter from Google Fonts at build time (needs network).

## Roadmap
1. [x] SELF_HOSTED flag.
2. [ ] Microsoft (Azure / Entra ID) SSO via Supabase `azure` provider; remove email/password, Google, GitHub
       buttons; restrict to `@maxxortho.com` (enforce in DB, e.g. in `handle_new_user()` or a before-insert
       trigger on `auth.users`, not only in the UI). Needs an Entra app registration + Supabase provider config.
3. [ ] Pending invites: invite by email even if the person hasn't signed in yet (new table + claim on first
       login), so no group setup is ever needed.
4. [ ] Cloudflare Workers deploy (`@opennextjs/cloudflare`), CI: push to main → deploy + apply migrations; PR previews.
5. [ ] Cleanup: decide on dropping Prisma path; tighten profile update policy.

## Env vars
NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY, NEXT_PUBLIC_SITE_URL,
NEXT_PUBLIC_SELF_HOSTED=true. Put local values in `.env.local` (git-ignored); never commit secrets.
