# Misskey – AI Agent Guide

This file is the single source of truth for AI coding agents (Claude Code / OpenAI Codex / GitHub Copilot etc.) operating in the Misskey repository. It collects **absolute prohibitions and minimum checks** shared across all three ingestion paths:

- **Claude Code**: pulled in via `@AGENTS.md` from the root `CLAUDE.md`. Detailed procedures and conventions live in `.claude/skills/` (auto-indexed by description).
- **OpenAI Codex**: reads the root `AGENTS.md` directly (skill entries are in `.agents/skills/`, pointing to `.claude/skills/`).
- **GitHub Copilot**: ingested via `.github/copilot-instructions.md` (a mirror of this file's rules for Copilot code review).

General contributor conventions (how to file Issues / PRs, ActivityPub extensions, etc.) are in [CONTRIBUTING.md](CONTRIBUTING.md). This file is scoped to what an AI must **not** get wrong when writing, fixing, or shipping code.

---

## Absolute Prohibitions

Violations will cause CI failures / production incidents / shared-environment corruption. Comply strictly.

### Code & Data

1. **Never add a new file to an AGPL-controlled directory without the SPDX header.**
   - Targets: new `.ts` / `.js` / `.cjs` / `.mjs` / `.vue` / `.scss` / `.html` files.
   - CI scope is determined by the `directories` array in [.github/workflows/check-spdx-license-id.yml](.github/workflows/check-spdx-license-id.yml) (`*.config.{ts,js,cjs,mjs}` and `*eslint*` are excluded).
   - Missing headers will fail the CI `spdx` job.
   - `packages/misskey-js` is an MIT-licensed sub-package; do **not** stamp the AGPL header on it (follow the sub-package's own `package.json` / `LICENSE` / existing file headers).

   `.ts` / `.js` / `.cjs` / `.mjs` / `.scss`:

   ```text
   /*
    * SPDX-FileCopyrightText: syuilo and misskey-project
    * SPDX-License-Identifier: AGPL-3.0-only
    */
   ```

   `.vue` / `.html` (HTML comment form):

   ```text
   <!--
   SPDX-FileCopyrightText: syuilo and misskey-project
   SPDX-License-Identifier: AGPL-3.0-only
   -->
   ```

2. **Do not manually edit any locale YAML other than `locales/ja-JP.yml`.**
   - All other language files (`en-US.yml` and everything except `ja-JP.yml`) are Crowdin auto-delivery targets. Manual edits will be overwritten on the next sync.
   - Basis: [locales/README.md](locales/README.md) and [crowdin.yml](crowdin.yml) (`ja-JP.yml` → `locales/%locale%.yml` sync config).

3. **Do not edit merged migration files.**
   - Target: `packages/backend/migration/{unixMs}-{name}.js` already merged into `develop` / `master`.
   - Altering history in production causes severe data inconsistency.
   - If a schema change is needed, create a **new file with a new timestamp** (`node -e "console.log(Date.now())"` to generate one).
   - New migrations must implement both `up()` and `down()`, and pass `pnpm --filter backend check-migrations` (TypeORM schema builder pending DDL check).

### Git / Repository Operations

4. **Do not `git push --force` / `--force-with-lease` to `main` / `develop` / `master`** (may destroy others' work).
5. **Do not bypass hooks with `git commit --no-verify`** (defeats lint / format / SPDX checks).
6. **Do not `git commit --amend` already-merged or already-pushed commits** (breaks history integrity).
7. **Do not `git reset --hard` / `git branch -D` someone else's branch.**
8. **Do not change `git config` without the user's explicit consent** (especially `user.name` / `user.email` / `commit.gpgsign`).

### Issues / PRs / External Communication

9. **Do not merge / close / force-push a PR without the user's explicit instruction.**
10. **Do not send to any external service (GitHub comments / Slack / email, etc.) without the user's explicit instruction.**
11. **Do not commit secrets or credentials** (production values in `.config/*.yml`, `.env` files, API tokens, private keys, etc.).
12. **Do not file vulnerability reports through normal Issues / PRs** (refer to the `creating-issues-and-prs` skill for the correct process).

### Skill Invocation

These are not waived by upstream skill execution, prior knowledge, or memory contents.

13. **Do not edit or add files under `packages/backend/` without consulting the `working-on-backend` skill.**
14. **Do not edit or add files under `packages/frontend/` without consulting the `working-on-frontend` skill.**
15. **Do not commit / create a PR / hand work back to the user without consulting the `shipping-misskey-change` skill.**
16. **Do not file an Issue / PR without consulting the `creating-issues-and-prs` skill** (includes vulnerability report rules).

### CaptRAW Fork-Specific Rules

17. **Do not add Docker / Dev Container / Kubernetes Chart files** (this project does not support Docker).
18. **Do not manually edit any locale YAML other than `locales/ja-JP.yml` and `locales/zh-CN.yml`.**
19. **If a phone-number-required registration flow is enabled, maintain consistency of dependent UI / API.**
20. **Record OIDC / SMS feature changes in CHANGELOG.md.**

---

## Minimum Checks Before Shipping

Each agent should consult the [shipping-misskey-change skill](.claude/skills/shipping-misskey-change/SKILL.md). Even when the skill is unavailable, the following checks are mandatory:

1. **Lint**: `pnpm lint` passes (typecheck + eslint, all packages).
2. **Backend API changes**: run `pnpm build-misskey-js-with-types` and include the diff under `packages/misskey-js/src/autogen/` in the commit.
3. **Entity / migration changes**: `pnpm --filter backend check-migrations` passes with 0 pending DDL; new migrations implement both `up()` and `down()`.
4. **New files**: SPDX header added (`.vue` / `.html` use HTML comment form; everything else uses TS comment form).
5. **User-facing changes**: add a line `- <Feat|Enhance|Fix>: <summary>` under the appropriate subsection (`### General` / `### Client` / `### Server`) in `## Unreleased` of `CHANGELOG.md`.
6. **Locale safety**: after editing `locales/`, verify `git diff --name-only develop -- 'locales/*.yml' | grep -v '^locales/ja-JP\.yml$'` is empty (no diff outside ja-JP.yml).

### Validation Commands

Use the most specific command first; widen to full-build if needed.

| Purpose | Command |
| --- | --- |
| Full lint (typecheck + eslint) | `pnpm lint` |
| Backend unit test | `pnpm --filter backend test` |
| Backend e2e test | `pnpm --filter backend test:e2e` |
| Backend federation test | `pnpm --filter backend test:fed` |
| Frontend unit test | `pnpm --filter frontend test` |
| Migration diff check (pending DDL) | `pnpm --filter backend check-migrations` |
| `misskey-js` regeneration (required after API changes) | `pnpm build-misskey-js-with-types` |
| Full build | `pnpm build` |
| Dev build (isolated, outputs to `built-dev/`) | `pnpm dev:build` |
| Dev server (backend + frontend watch, HMR) | `pnpm dev` |
| Dev server (built mode, like production) | `pnpm dev:start` |

**Note:** Backend tests (`test` / `test:e2e` / `test:fed`) require `.config/test.yml`. Create it with `ncp .github/misskey/test.yml .config/test.yml` (or `cp .github/misskey/test.yml .config/test.yml`) before running. Each test script internally calls `cross-env NODE_ENV=test pnpm compile-config`, so no separate compile-config step is needed once the file exists.

### Production Deployment Commands

CaptRAW uses a build-once / run-production workflow. Use `pnpm prod:*` commands (not `pnpm dev`) for production management.

| Purpose | Command |
| --- | --- |
| Production build | `pnpm prod:build` |
| Start production server (detached) | `pnpm prod:start` |
| Stop production server | `pnpm prod:stop` |
| Stop → Build → Start (single-command deploy) | `pnpm prod:restart` |
| Deploy (alias for restart) | `pnpm prod:deploy` |
| Check running status | `pnpm prod:status` |
| View last 80 lines of logs | `pnpm prod:logs` |
| Open live log viewer in a separate window | `pnpm prod:logs-window` |
| Self-daemon (auto-restart on crash + health check) | `pnpm prod:supervisor` |

**Operational workflow:**
1. After code changes → `pnpm prod:restart` (stop · build · start in one command).
2. Recommended for production → `pnpm prod:supervisor` (auto-restart master on death, exponential backoff, health checks).
3. Log monitoring → `pnpm prod:logs-window` (real-time tail in a separate window).
4. Status check → `pnpm prod:status`.
5. Stop → `pnpm prod:stop`.

**Note:** `pnpm dev` and `pnpm dev:start` now use separate infrastructure (port 3000, DB 5432, Redis 6379, output `built-dev/`) — they **can** run alongside the production server (port 2999, DB 5433, Redis 6380, output `built/`) without conflict.

### Development Build Commands (Isolated)

Dev builds output to `built-dev/` (controlled by `MISSKEY_BUILD_DIR=built-dev`), keeping production `built/` untouched.

| Purpose | Command |
| --- | --- |
| Full dev build (one-shot, minified) | `pnpm dev:build` |
| Start dev server (detached, built mode) | `pnpm dev:start` |
| Stop dev server | `pnpm dev:stop` |
| Stop → Build → Start | `pnpm dev:restart` |
| Check dev server status | `pnpm dev:status` |
| View last 80 lines of dev logs | `pnpm dev:logs` |
| Compile dev config only | `cross-env NODE_ENV=development pnpm compile-config` |
| Run migrations on dev DB | `cross-env NODE_ENV=development pnpm migrate` |
| Start dev Docker containers | `docker compose -f docker-compose.dev.yml up -d` |
| Stop dev Docker containers | `docker compose -f docker-compose.dev.yml down` |

**How it works:** The `MISSKEY_BUILD_DIR` env var selects the output directory (`built` vs `built-dev`). The build itself runs in production mode (minified, no debug code). At runtime, `NODE_ENV=development` enables `http://` support and verbose logging. The config file `.config/dev.yml` is auto-selected by `compile-config` when `NODE_ENV=development`.

---

## Dev Environment: HMR Mode & Port Management

`pnpm dev` starts the Vite HMR dev servers (frontend 5173, frontend-embed 5174) and backend watch mode (rolldown `--watch`). All output goes to `built-dev/` — production `built/` is never touched.

For a production-like dev experience without HMR, use `pnpm dev:build && pnpm dev:start` instead.

### Dev Script Reference

| Purpose | Command |
| --- | --- |
| HMR dev mode (watch + hot reload) | `pnpm dev` |
| Production-like dev build + start | `pnpm dev:build && pnpm dev:start` |
| Release Vite ports (5173, 5174) | `pnpm kill:ports` |
| Release Vite + backend ports | `pnpm kill:ports:all` |
| Release ports + restart HMR dev | `pnpm restart` |
| Nodemon auto-restart on crash | `pnpm dev:safe` |
| Custom port | `node scripts/kill-port.mjs 8080 9090` |

### Git Hook (Husky)

`.husky/post-commit` runs `node scripts/kill-port.mjs` after every `git commit`, cleaning up residual processes on ports 5173/5174. Restart manually with `pnpm dev` or `pnpm restart` afterward.

### Implementation Details

- `scripts/kill-port.mjs`: cross-platform script supporting Windows (PowerShell `Get-NetTCPConnection` + `taskkill`) and Unix (`lsof` + `kill -9`). SPDX header included.
- Husky 9.1.7 installed as a root devDependency. `core.hooksPath` is `.husky/_`.
- `packages/frontend/vite.config.ts` has `strictPort: true` and `port: 5173`. Port conflicts are reported immediately as errors.

---

## Production Environment: Auto-Deploy

Scripts for building, migrating, and restarting after code sync are provided.

### Deploy Script Reference

| Purpose | Command |
| --- | --- |
| Full deploy (pull + build + migrate + restart) | `pnpm deploy` |
| Dry run (show steps without executing) | `pnpm deploy:dry` |
| Skip git pull | `pnpm deploy -- --skip-pull` |
| Skip build | `pnpm deploy -- --skip-build` |
| Linux shell version (for cron) | `bash scripts/update-and-restart.sh` |

### Environment Variables

| Variable | Default | Description |
| --- | --- | --- |
| `MISSKEY_SERVICE_PORT` | `3000` | Backend port |
| `MISSKEY_LOG_FILE` | `./misskey.log` | Service log file path |
| `GIT_BRANCH` | current branch | Branch to pull |
| `SKIP_BUILD` | (unset) | Set to `1` to skip build |
| `MISSKEY_BUILD_DIR` | `built` | Build output directory (`built-dev` for dev, `built` for prod) |
| `NODE_ENV` | (unset) | `development` → `built-dev/` fallback + dev.yml selection + http:// support |
| `MISSKEY_CONFIG_YML` | (unset) | Override config YAML filename in `.config/` |

### Implementation Details

- `scripts/deploy.mjs`: Node.js cross-platform script. Runs `git fetch` + `git reset --hard origin/<branch>` for code sync, then `pnpm install` → `pnpm build` → `pnpm migrate` → port cleanup → `pnpm start` (detached). SPDX header included.
- `scripts/update-and-restart.sh`: Linux bash version. Lightweight script suitable for cron or systemd `ExecStartPost`. SPDX header included.
- Deploy scripts check for `.config/default.yml` before proceeding; abort safely if missing.
- `--dry-run` mode displays each step (git pull / build / migrate / restart) without executing.
