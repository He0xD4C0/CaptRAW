---
name: e2e-testing
description: Use whenever adding, modifying, or debugging Cypress E2E tests under `cypress/`, or when adding a frontend feature that needs E2E coverage. Covers Cypress custom commands (visitHome / resetState / registerUser / login), test lifecycle stages (before setup → after setup → after signup → after signin → after user setup), `data-cy-*` selector conventions, test server prerequisites (`pnpm start:test` on port 61812), and the widget test flaky-disable pattern. Must be consulted before writing or modifying any Cypress test to avoid breaking the shared lifecycle contract.
---

# e2e-testing

`cypress/` (Misskey フロントエンド E2E テスト) を編集するとき、最初に参照するスキル。Cypress カスタムコマンド / テストライフサイクル / `data-cy-*` 命名規則 / テストサーバー前提条件 / flaky テストの無効化パターンをまとめている。

SKILL.md 本体は references への索引だけ。具体的な手順や規約は該当ファイルを Read すること (progressive disclosure)。

**他スキル実行後も免除されない。** `working-on-frontend` / `brainstorming` / `writing-plans` / その他アップストリームスキルを先に呼んでいても、Cypress テストに触れる実装フェーズに入る時点でこのスキルを呼ぶこと。

## 作業別ワークフロー (tasks)

タスク単位の完結したチェックリスト + チェックポイント。新しい何かを足すときに開く。

- 新規 Cypress テストを追加する → [references/tasks/adding-cypress-test.md](references/tasks/adding-cypress-test.md)

## 共通知識 (knowledge)

タスクに紐付かない参照リファレンス。複数のタスクから引かれる規約・背景説明。

- Cypress カスタムコマンド一覧 (`visitHome` / `resetState` / `registerUser` / `login`) → [references/knowledge/cypress-custom-commands.md](references/knowledge/cypress-custom-commands.md)
- テストライフサイクル段階 (5 つの describe ブロックと移行パターン) → [references/knowledge/cypress-lifecycle.md](references/knowledge/cypress-lifecycle.md)

## テスト実行方法

```bash
# テスト用 DB / Redis を起動
docker compose -f packages/backend/test/compose.yml up -d

# テスト設定を配置 (未作成なら)
cp .github/misskey/test.yml .config/test.yml

# 全体ビルド
pnpm build

# E2E 実行 (内部で pnpm start:test → Cypress run)
pnpm e2e

# 対話的デバッグ (サーバーは別途 pnpm start:test で起動)
pnpm cy:open
```

- 設定: ルート [cypress.config.ts](../../../cypress.config.ts) (`baseUrl: http://localhost:61812`)
- テスト本体: [cypress/](../../../cypress/) 配下
- テストサーバーは `pnpm start:test` で起動し、ポート `61812`、DB `54312`、Redis `56312` を使用 (すべて [.github/misskey/test.yml](../../../.github/misskey/test.yml) と一致)

## 関連

- frontend テスト全般の知識 → [working-on-frontend/references/knowledge/frontend-testing.md](../working-on-frontend/references/knowledge/frontend-testing.md)
- `data-cy-*` 命名規則は frontend 側の Vue コンポーネント実装と連動するため、[working-on-frontend](../working-on-frontend/SKILL.md) も参照
- Cypress テスト変更後の commit 前には必ず [shipping-misskey-change](../shipping-misskey-change/SKILL.md) を通す
