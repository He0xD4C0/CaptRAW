# CaptRAW

CaptRAW は [Misskey](https://github.com/misskey-dev/misskey) のフォークであり、エンタープライズ向けの認証・認可機能を強化したソーシャルプラットフォームです。

*Read this in [English](README.md) | [简体中文](README_ZH-CN.md)*

## 主な機能拡張

### OIDC プロバイダ

完全な OpenID Connect 1.0 プロバイダとして機能します。

- Authorization Code Flow + PKCE (S256 必須)
- ID Token 発行 (RS256 JWT 署名)
- UserInfo エンドポイント (GET/POST)
- JWKS エンドポイント (マルチキー・自動ローテーション対応)
- OIDC Discovery (`/.well-known/openid-configuration`)
- OAuth 2.0 Authorization Server Metadata (RFC 8414)
- `nonce` パラメータ / `auth_time` クレーム対応

管理パネル (`/admin/oidc-settings`) から有効/無効を切り替え可能です。

### 電話番号 SMS 認証

ユーザー登録・ログインに電話番号（SMS 検証）を使用できます。

- 拡張可能な `ISmsProvider` インターフェース
- 阿里雲短信対応（HMAC-SHA1 署名方式）
- 検証コード送信・照合 API
- 登録時電話番号必須オプション (`phoneRequiredForSignup`)

管理パネル (`/admin/sms-settings`) からプロバイダ設定が可能です。

### 管理機能

- OAuth アプリケーション管理 (`/admin/oauth-apps`) — 一覧表示・作成・削除
- デフォルト言語: 中国語（zh-CN）

## 必要環境

- **Node.js** 22.x
- **PostgreSQL** 18
- **Redis** 7

本プロジェクトは Docker デプロイを**サポートしていません**。必ず上記のミドルウェアを直接インストールしてください。

## クイックスタート

```bash
# 依存関係のインストール
pnpm install

# PostgreSQL / Redis の起動（macOS / Homebrew の場合）
brew services start postgresql@18
brew services start redis
createdb misskey-dev

# 設定ファイルの準備
cp .config/example.yml .config/default.yml
# default.yml を編集して DB / Redis の接続情報を設定してください

# ビルド
pnpm build

# データベースマイグレーション
pnpm --filter backend migrate

# 開発サーバー起動
pnpm dev
```

`http://localhost:3000` にアクセスし、`default.yml` に設定した初期セットアップパスワードで管理者アカウントを作成してください。

## 設定

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

## 開発

```bash
pnpm dev         # 開発サーバー (HMR 対応)
pnpm lint        # 静的解析
pnpm build       # プロダクションビルド
```

## ライセンス

CaptRAW は Misskey をベースとしているため、[AGPL-3.0](LICENSE) の下で公開されています。

## 謝辞

このプロジェクトは [Misskey](https://github.com/misskey-dev/misskey) をベースにしています。Misskey のコントリビューターの皆様に感謝します。

---

<div align="center">
CaptRAW — Enterprise-ready Misskey fork
</div>
