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

## 本番デプロイ

本プロジェクトは **ビルドしてから本番稼働** のワークフロー（Cloudflare Workers に類似）。全コードを `built/` にビルドし、単一 Node.js プロセスで配信する。

### コマンド

| コマンド | 説明 |
|---|---|
| `pnpm prod:build` | 本番ビルド（全パッケージ → `built/`） |
| `pnpm prod:start` | デタッチモードで本番サーバー起動（ログファイル付き） |
| `pnpm prod:stop` | 本番サーバー停止 |
| `pnpm prod:restart` | 停止→ビルド→起動（ワンコマンドデプロイ） |
| `pnpm prod:deploy` | `prod:restart` のエイリアス |
| `pnpm prod:status` | サーバー稼働状態確認 |
| `pnpm prod:logs` | 直近 80 行のログ表示 |
| `pnpm prod:logs-window` | 別ウィンドウでリアルタイムログ表示 |
| `pnpm prod:supervisor` | 自己守護モード: クラッシュ自動再起動 + ヘルスチェック |

### 一般的なワークフロー

```bash
# 初回デプロイ
pnpm prod:build
pnpm prod:start

# 本番環境推奨（自己守護モード）
pnpm prod:build
pnpm prod:supervisor    # フォアグラウンドで自動再起動 + ヘルスチェック

# コード変更後
pnpm prod:restart

# 監視
pnpm prod:logs-window   # 別ウィンドウでリアルタイム表示
pnpm prod:status         # 稼働確認

# 停止
pnpm prod:stop
```

### 開発モード

ホットリロード付きの開発には `pnpm dev` を使用。Vite 開発サーバー、nodemon watcher、全サブパッケージの watch プロセスが起動する。

**注意:** `pnpm dev` と `pnpm prod:start` を同時に実行しない（ポート競合）。

#### 開発ポート管理

| コマンド | 説明 |
|---|---|
| `pnpm kill:ports` | Vite ポート解放（5173、5174） |
| `pnpm kill:ports:all` | Vite + バックエンドポート解放（5173、5174、3000） |
| `pnpm restart` | ポート解放 + dev サーバー再起動（ワンクリック） |
| `pnpm dev:safe` | nodemon ラッパー — クラッシュ時に自動再起動 |
| `node scripts/kill-port.mjs 8080` | カスタムポート指定 |

Husky `post-commit` フックが `git commit` 後にポート 5173/5174 を自動解放。別ターミナルで `pnpm dev` または `pnpm restart` を実行。

#### ワンクリックデプロイ（コード同期後）

```bash
pnpm deploy              # フルデプロイ: git pull → build → migrate → restart
pnpm deploy:dry          # ドライラン（実行せず表示のみ）
pnpm deploy -- --skip-pull   # git pull スキップ
pnpm deploy -- --skip-build  # build スキップ
```

環境変数: `MISSKEY_SERVICE_PORT`（デフォルト 3000）、`MISSKEY_LOG_FILE`、`GIT_BRANCH`、`SKIP_BUILD`

## アップストリーム

Misskey 本体を追従しています。オリジナルプロジェクトは [Misskey](https://github.com/misskey-dev/misskey) を参照してください。

## ライセンス

Misskey をベースとし、[AGPL-3.0](LICENSE) の下で公開されています。

---

<div align="center">
Misskey — CaptRAW コミュニティエディション
</div>
