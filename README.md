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

## Upstream

This distribution tracks the upstream Misskey repository. See [Misskey](https://github.com/misskey-dev/misskey) for the original project.

## License

Based on Misskey, distributed under [AGPL-3.0](LICENSE).

---

<div align="center">
Misskey — CaptRAW Community Edition
</div>
