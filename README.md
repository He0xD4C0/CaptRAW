# Misskey — CaptRAW Community Edition

This is a customized distribution of [Misskey](https://github.com/misskey-dev/misskey), tailored for the CaptRAW community.

*Read this in [Japanese](README_JP.md) | [简体中文](README_ZH-CN.md)*

## What's Different

This distribution extends upstream Misskey with the following additions:

### OIDC Provider

Full OpenID Connect 1.0 provider — act as an identity provider for third-party applications.

- Authorization Code Flow with mandatory PKCE (S256)
- ID Token issuance (RS256 JWT signing)
- UserInfo endpoint (GET/POST)
- JWKS endpoint (multi-key, auto-rotation)
- OIDC Discovery (`/.well-known/openid-configuration`)
- OAuth 2.0 Authorization Server Metadata (RFC 8414)
- `nonce` parameter and `auth_time` claim support

Toggle via admin panel at `/admin/oidc-settings`.

### Phone SMS Verification

Phone number verification via SMS for registration and login:

- Extensible `ISmsProvider` interface for multi-provider support
- Alibaba Cloud SMS provider (HMAC-SHA1 signing)
- Verification code send and verify APIs
- Optional mandatory phone requirement for signup

Configure via admin panel at `/admin/sms-settings`.

### Other Changes

- OAuth application management page (`/admin/oauth-apps`)
- Default language: Chinese (zh-CN)
- Docker deployment not supported — use direct middleware installation
- Key persistence with automatic rotation

## Requirements

- **Node.js** 22.x
- **PostgreSQL** 18
- **Redis** 7

## Quick Start

```bash
pnpm install

# Start middleware (macOS / Homebrew)
brew services start postgresql@18
brew services start redis
createdb misskey-dev

# Configure
cp .config/example.yml .config/default.yml

# Build and migrate
pnpm build
pnpm --filter backend migrate

# Run
pnpm dev
```

Visit `http://localhost:3000` and create an admin account using the setup password from `default.yml`.

## Production Deployment

This project uses a **build-once, run-production** workflow (similar to Cloudflare Workers). All code is compiled to `built/`, then a single Node.js process serves the application.

### Commands

| Command | Description |
|---|---|
| `pnpm prod:build` | Full production build (all packages → `built/`) |
| `pnpm prod:start` | Start detached production server (with log file) |
| `pnpm prod:stop` | Gracefully stop the production server |
| `pnpm prod:restart` | Stop → Build → Start (single-command deploy) |
| `pnpm prod:deploy` | Alias for `prod:restart` |
| `pnpm prod:status` | Check if the server is running |
| `pnpm prod:logs` | View last 80 lines of server logs |
| `pnpm prod:logs-window` | Open live log viewer in a separate window |

### Typical Workflow

```bash
# First-time setup
pnpm prod:build
pnpm prod:start

# After code changes
pnpm prod:restart

# Monitor
pnpm prod:logs-window   # live tail in a separate window
pnpm prod:status         # quick health check

# Stop
pnpm prod:stop
```

### Development Mode

For development with hot-reload, use `pnpm dev` instead. This starts Vite dev servers, nodemon watchers, and all sub-package watch processes.

**Note:** Do not run `pnpm dev` and `pnpm prod:start` simultaneously — they will conflict on ports.

## Upstream

This distribution tracks the upstream Misskey repository. See [Misskey](https://github.com/misskey-dev/misskey) for the original project.

## License

Based on Misskey, distributed under [AGPL-3.0](LICENSE).

---

<div align="center">
Misskey — CaptRAW Community Edition
</div>
