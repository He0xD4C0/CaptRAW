# Copilot Instructions for Misskey

This file serves as the repository-wide instructions for GitHub Copilot. Because `AGENTS.md` may not be available in some Copilot code-review environments, this file alone must contain all rules needed for review and light implementation decisions.

The repository is a pnpm workspace monorepo. The primary implementations are in `packages/backend` (NestJS / TypeORM) and `packages/frontend` (Vue 3). A more detailed guide exists at the repository root in `AGENTS.md` — you may consult it, but you must not omit this file's requirements in favor of simply pointing there.

## Absolute Prohibitions

Violations will cause CI failures / production incidents.

### Code & Data

- **SPDX header required**: when adding new `.ts` / `.js` / `.cjs` / `.mjs` / `.scss` / `.vue` / `.html` files to AGPL-controlled, SPDX CI-targeted directories, the header is mandatory. See `.github/workflows/check-spdx-license-id.yml` for exact scope.

  ```text
  /*
   * SPDX-FileCopyrightText: syuilo and misskey-project
   * SPDX-License-Identifier: AGPL-3.0-only
   */
  ```

  New `.vue` / `.html` files use HTML comment form:

  ```text
  <!--
  SPDX-FileCopyrightText: syuilo and misskey-project
  SPDX-License-Identifier: AGPL-3.0-only
  -->
  ```

  `packages/misskey-js` is an MIT-licensed sub-package; do **not** stamp the AGPL header on it (follow the sub-package's own `package.json` / `LICENSE` / existing file headers).

- **Do not edit any locale YAML other than `locales/ja-JP.yml`.** All other language files are Crowdin auto-delivery targets; manual edits will be overwritten on the next sync.
- **Do not edit merged migrations.** Files under `packages/backend/migration/{timestamp}-*.js` that have already entered `develop` / `master` must never be altered. If a schema change is needed, add a new file with a new timestamp and implement both `up()` and `down()`.
- **Do not commit secrets or credentials** (production values in `.config/*.yml`, `.env` files, API tokens, private keys, etc.).

### Git / Repository Operations

- Do not `git push --force` / `--force-with-lease` to `main` / `develop` / `master`.
- Do not bypass hooks with `git commit --no-verify`.
- Do not `git commit --amend` already-merged or already-pushed commits.
- Do not `git reset --hard` / `git branch -D` someone else's branch.
- Do not change `git config` without the user's explicit consent (especially `user.name` / `user.email` / `commit.gpgsign`).

### Issues / PRs / External Communication

- Do not merge / close / force-push a PR without the user's explicit instruction.
- Do not send to any external service (GitHub comments / Slack / email, etc.) without the user's explicit instruction.

## Minimum Checks Before Shipping

1. `pnpm lint` passes (typecheck + eslint, all packages).
2. If you changed `meta` / `paramDef` / `res` in the backend → run `pnpm build-misskey-js-with-types` and include the diff under `packages/misskey-js/src/autogen/` in the commit.
3. If you changed entities / migrations → `pnpm --filter backend check-migrations` passes with 0 pending DDL; new migrations implement both `up()` and `down()`.
4. New `.ts` / `.js` / `.cjs` / `.mjs` / `.vue` / `.scss` / `.html` files → SPDX header added.
5. User-facing changes → add a line `- <Feat|Enhance|Fix>: <summary>` under the appropriate subsection (`### General` / `### Client` / `### Server`) in `## Unreleased` of `CHANGELOG.md`.
6. If you edited `locales/`, verify `git diff --name-only develop -- 'locales/*.yml' | grep -v '^locales/ja-JP\.yml$'` is empty (no diff outside ja-JP.yml).

## Validation Commands

- Full build: `pnpm build`
- Full lint / typecheck: `pnpm lint`
- Backend unit test: `pnpm --filter backend test`
- Backend e2e test: `pnpm --filter backend test:e2e`
- Backend federation test: `pnpm --filter backend test:fed`
- Frontend test: `pnpm --filter frontend test`
- Migration diff check: `pnpm --filter backend check-migrations`
- `misskey-js` regeneration (required after API changes): `pnpm build-misskey-js-with-types`

**Note:** Backend tests (`test` / `test:e2e` / `test:fed`) require `.config/test.yml`. Create it with `ncp .github/misskey/test.yml .config/test.yml` (or `cp .github/misskey/test.yml .config/test.yml`) before running. Each test script internally calls `cross-env NODE_ENV=test pnpm compile-config`, so no separate compile-config step is needed once the file exists.

Use the most specific command first; widen to full-build if needed.

## Production Deployment Commands

CaptRAW uses a build-once / run-production workflow. Use `pnpm prod:*` commands (not `pnpm dev`) for production management.

- Production build: `pnpm prod:build`
- Start production server (detached): `pnpm prod:start`
- Stop production server: `pnpm prod:stop`
- Stop → Build → Start (single-command deploy): `pnpm prod:restart`
- Deploy (alias for restart): `pnpm prod:deploy`
- Check running status: `pnpm prod:status`
- View last 80 lines of logs: `pnpm prod:logs`
- Open live log viewer in a separate window: `pnpm prod:logs-window`
- Self-daemon: `pnpm prod:supervisor` (auto-restart master on death, exponential backoff, health checks)

**Operational workflow:** After code changes → `pnpm prod:restart` (stop · build · start). Recommended for production → `pnpm prod:supervisor`. Do not run `pnpm dev` and `pnpm prod:start` simultaneously (port conflict).

## Dev Environment: Port Management & Auto-Restart

Process management scripts live in `scripts/`. `pnpm dev` starts frontend (5173), frontend-embed (5174), and backend (3000).

| Purpose | Command |
| --- | --- |
| Release Vite ports (5173, 5174) | `pnpm kill:ports` |
| Release Vite + backend ports | `pnpm kill:ports:all` |
| Release ports + restart dev server | `pnpm restart` |
| Nodemon auto-restart on crash | `pnpm dev:safe` |
| Custom port | `node scripts/kill-port.mjs 8080 9090` |

`.husky/post-commit` runs `node scripts/kill-port.mjs` after every `git commit`, cleaning up residual processes on ports 5173/5174. Restart manually with `pnpm dev` or `pnpm restart` afterward.

- `scripts/kill-port.mjs`: cross-platform script (Windows PowerShell + Unix lsof).
- Husky 9.1.7 installed as a root devDependency. `core.hooksPath` is `.husky/_`.
- `packages/frontend/vite.config.ts` has `strictPort: true` and `port: 5173`.

## Production Environment: Auto-Deploy

| Purpose | Command |
| --- | --- |
| Full deploy (pull + build + migrate + restart) | `pnpm deploy` |
| Dry run (show steps without executing) | `pnpm deploy:dry` |
| Skip git pull | `pnpm deploy -- --skip-pull` |
| Skip build | `pnpm deploy -- --skip-build` |
| Linux shell version (for cron) | `bash scripts/update-and-restart.sh` |

Env vars: `MISSKEY_SERVICE_PORT` (default 3000), `MISSKEY_LOG_FILE` (default `./misskey.log`), `GIT_BRANCH` (default current branch), `SKIP_BUILD` (set `1` to skip).

## Editing Hints

- Backend API / migration / TypeORM changes → look at `packages/backend`.
- Frontend Vue component and page changes → look at `packages/frontend`.
- Relative links in `AGENTS.md` are resolved from the repository root.

**Note:** `AGENTS.md` is the canonical detailed guide (read by Codex / Claude Code). This file is the primary entry point for Copilot code review. In environments where both are read, `AGENTS.md` may be used as supplementary material.
