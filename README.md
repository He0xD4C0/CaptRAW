# CaptRAW

CaptRAW is a fork of [Misskey](https://github.com/misskey-dev/misskey) with enhanced enterprise-grade authentication and authorization capabilities.

*Read this in [Japanese](README_JP.md) | [简体中文](README_ZH-CN.md)*

## Key Features

### OIDC Provider

Full OpenID Connect 1.0 provider implementation:

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
- Optional mandatory phone requirement for signup (`phoneRequiredForSignup`)

Configure via admin panel at `/admin/sms-settings`.

### Admin Tools

- OAuth application management (`/admin/oauth-apps`) — list, create, delete
- Default language: Chinese (zh-CN)

## Requirements

- **Node.js** 22.x
- **PostgreSQL** 18
- **Redis** 7

This project does **not** support Docker deployment. Install the middleware directly.

## Quick Start

```bash
# Install dependencies
pnpm install

# Start PostgreSQL / Redis (macOS / Homebrew)
brew services start postgresql@18
brew services start redis
createdb misskey-dev

# Create config
cp .config/example.yml .config/default.yml
# Edit default.yml with your DB/Redis credentials

# Build
pnpm build

# Run database migrations
pnpm --filter backend migrate

# Start development server
pnpm dev
```

Visit `http://localhost:3000` and create an admin account using the setup password from `default.yml`.

## Configuration

```yaml
url: http://localhost:3000
port: 3000

db:
  host: localhost
  port: 5432
  db: misskey-dev
  user: <your-db-user>
  pass: ''

redis:
  host: localhost
  port: 6379

setupPassword: <your-setup-password>
```

## Development

```bash
pnpm dev         # Dev server (HMR)
pnpm lint        # Lint & typecheck
pnpm build       # Production build
```

## License

CaptRAW is based on Misskey and is licensed under [AGPL-3.0](LICENSE).

## Acknowledgements

Built on [Misskey](https://github.com/misskey-dev/misskey). Thanks to all Misskey contributors.

---

<div align="center">
CaptRAW — Enterprise-ready Misskey fork
</div>
