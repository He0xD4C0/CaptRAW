# Misskey — CaptRAW コミュニティエディション

[Misskey](https://github.com/misskey-dev/misskey) をベースに、CaptRAW コミュニティ向けにカスタマイズしたディストリビューションです。

*Read this in [English](README.md) | [简体中文](README_ZH-CN.md)*

## 主な機能追加

### OIDC プロバイダ

完全な OpenID Connect 1.0 プロバイダとして、サードパーティアプリケーションの ID プロバイダとして機能します。

- Authorization Code Flow + PKCE (S256 必須)
- ID Token 発行 (RS256 JWT 署名)
- UserInfo エンドポイント (GET/POST)
- JWKS エンドポイント (マルチキー・自動ローテーション)
- OIDC Discovery (`/.well-known/openid-configuration`)
- OAuth 2.0 Authorization Server Metadata (RFC 8414)
- `nonce` パラメータ / `auth_time` クレーム

管理パネル (`/admin/oidc-settings`) で有効/無効を切り替え可能。

### 電話番号 SMS 認証

SMS 検証コードによる電話番号登録・ログインに対応。

- 拡張可能な `ISmsProvider` インターフェース
- 阿里雲短信（HMAC-SHA1 署名）
- 検証コード送信・照合 API
- 登録時電話番号必須オプション

管理パネル (`/admin/sms-settings`) でプロバイダ設定が可能。

### その他の変更

- OAuth アプリケーション管理 (`/admin/oauth-apps`)
- デフォルト言語: 中国語（zh-CN）
- Docker 非対応・ミドルウェア直接インストール方式
- キー永続化＋自動ローテーション

## 必要環境

- **Node.js** 22.x
- **PostgreSQL** 18
- **Redis** 7

## クイックスタート

```bash
pnpm install

# ミドルウェア起動（macOS / Homebrew）
brew services start postgresql@18
brew services start redis
createdb misskey-dev

# 設定
cp .config/example.yml .config/default.yml

# ビルド・マイグレーション
pnpm build
pnpm --filter backend migrate

# 起動
pnpm dev
```

`http://localhost:3000` にアクセスし、`default.yml` の初期セットアップパスワードで管理者アカウントを作成。

## アップストリーム

Misskey 本体を追従しています。オリジナルプロジェクトは [Misskey](https://github.com/misskey-dev/misskey) を参照してください。

## ライセンス

Misskey をベースとし、[AGPL-3.0](LICENSE) の下で公開されています。

---

<div align="center">
Misskey — CaptRAW コミュニティエディション
</div>
