# Build System & Environment Isolation

## Overview

The Misskey/CaptRAW build system produces a complete server bundle. Output directory is controlled by `MISSKEY_BUILD_DIR`:

- `MISSKEY_BUILD_DIR=built` (or unset) → `built/`
- `MISSKEY_BUILD_DIR=built-dev` → `built-dev/`

Both produce **identical artifacts** (minified, hashed). Only difference: output path.

## Build Pipeline

```
pnpm build (or pnpm dev:build)
  ├── pnpm build-pre        → <buildDir>/meta.json (version stamp)
  ├── pnpm -r build          → all workspace packages
  │   ├── i18n               → esbuild → packages/i18n/built/
  │   │                        └── writes locale JSONs to <buildDir>/_frontend_dist_/locales
  │   ├── misskey-js         → esbuild → packages/misskey-js/built/
  │   ├── backend            → rolldown → packages/backend/built/  (ALWAYS here)
  │   ├── frontend           → vite build → <buildDir>/_frontend_vite_/
  │   ├── frontend-embed     → vite build → <buildDir>/_frontend_embed_vite_/
  │   └── sw                 → esbuild → <buildDir>/_sw_dist_/
  └── pnpm build-assets      → copies fonts to <buildDir>/_frontend_dist_/fonts
```

## Central Path Switch

`packages/backend/src/config.ts`:
```ts
const projectBuiltDir = resolve(rootDir,
  process.env.MISSKEY_BUILD_DIR ||
  (process.env.NODE_ENV === 'development' ? 'built-dev' : 'built')
);
```

Exposed as `config.projectBuiltDir`. All runtime consumers (`ClientServerService`, `HtmlTemplateService`) resolve asset paths through it.

## Infrastructure Map

| Resource | Production | Development |
|----------|-----------|-------------|
| Build output | `built/` | `built-dev/` |
| Config YAML | `.config/default.yml` | `.config/dev.yml` |
| Compiled config | `built/.config.json` | `built-dev/.config.json` |
| Server port | 2999 | 3000 |
| PostgreSQL | `captraw-pg17:5433` | `captraw-postgres:5432` |
| Redis | `captraw-redis8:6380` | `captraw-redis:6379` |
| NODE_ENV (build) | `production` | unset (production mode) |
| NODE_ENV (runtime) | `production` | `development` |

## Key Commands

### Production
| Command | Description |
|---------|------------|
| `pnpm build` | Full build → `built/` |
| `pnpm prod:start` | Start (detached) |
| `pnpm prod:stop` | Stop |
| `pnpm prod:restart` | Stop → Build → Start |
| `pnpm prod:supervisor` | Auto-restart watchdog |

### Development
| Command | Description |
|---------|------------|
| `pnpm dev:build` | Full build → `built-dev/` |
| `pnpm dev:start` | Start (detached) |
| `pnpm dev:stop` | Stop |
| `pnpm dev:restart` | Stop → Build → Start |
| `pnpm dev` | HMR mode (Vite + backend watch) |

### Infrastructure
| Command | Description |
|---------|------------|
| `docker compose -f docker-compose.dev.yml up -d` | Start dev DB + Redis |
| `docker compose -f docker-compose.dev.yml down` | Stop dev DB + Redis |
| `cross-env NODE_ENV=development pnpm migrate` | Migrate dev DB |

## Clean Semantics

- `pnpm clean` — wipes package-level `built/` dirs + root `built-dev/`. **NEVER** touches root `built/`.
- `pnpm clean-all` — wipes everything including root `built/` and `built-dev/`.

## Pattern for New Build Scripts

```js
const buildDir = process.env.MISSKEY_BUILD_DIR
  || (process.env.NODE_ENV === 'development' ? 'built-dev' : 'built');
```

Use for **root-level** outputs only. Package-level outputs (under `packages/<name>/built/`) use the package-relative path directly.
