# 新規 Cypress テストの追加

E2E テストを追加する際のチェックリストと手順。

## チェックリスト (上から順に)

1. [ ] テストをどのライフサイクル段階に置くか決める
2. [ ] `beforeEach` のセットアップコストを見積もる (既存 describe に追加 vs 新規 describe)
3. [ ] `data-cy-*` 属性が Vue コンポーネント側に実装されているか確認。なければ [working-on-frontend](../../working-on-frontend/SKILL.md) に従って追加
4. [ ] テストを書く
5. [ ] `pnpm e2e` で実行確認 (`docker compose` / `.config/test.yml` / `pnpm build` が事前に必要)
6. [ ] コミット前に [shipping-misskey-change](../../shipping-misskey-change/SKILL.md) を通す

## 1. ライフサイクル段階の選択

[cypress-lifecycle.md](../knowledge/cypress-lifecycle.md) の段階構成図を参照し、テストに必要な前提状態がどの段階で満たされるか判断する。

選択の目安:

| 必要な前提 | 推奨段階 | describe ラベル |
|---|---|---|
| 何もないクリーン状態 | Before setup | `'Before setup instance'` |
| admin アカウントが存在 | After setup | `'After setup instance'` |
| admin + 一般ユーザーが存在 | After user signup | `'After user signup'` |
| ユーザーがログイン済み | After user signed in | `'After user signed in'` |
| 全初期設定完了 (通常使用) | After user setup | `'After user setup'` |

### 既存 describe に追加 vs 新規 describe

- **既存の段階にそのまま乗る** → 既存の `describe` ブロック内に `it(...)` を追加 (推奨)
- **既存の段階だが独立性が高い** → 同じ段階内に新しい `describe` を追加 (`beforeEach` を共有できる)
- **新しい段階が必要** (例: "ノートを 100 件投稿した後の状態") → 新規 `describe` ブロックを追加。`beforeEach` に必要なセットアップを書く

## 2. セットアップコストの見積もり

各段階の `beforeEach` は毎テスト実行されるため、高コストなセットアップは避ける:

- `cy.resetState()` — API コール 1 回 + リロード (軽量)
- `cy.registerUser()` — API コール 1 回 (軽量)
- `cy.login()` — UI フロー全体を経由 (やや重い)
- ウィザード閉じ — UI 操作 2 クリック (軽量)

新規 `describe` を作る場合の `beforeEach`:
```ts
describe('After user setup', () => {
    beforeEach(() => {
        cy.resetState();
        cy.registerUser('admin', 'pass', true);       // admin
        cy.registerUser('alice', 'alice1234');          // 一般ユーザー
        cy.login('alice', 'alice1234');                 // UI ログイン
        cy.get('[data-cy-user-setup] [data-cy-modal-window-close]', { timeout: 30000 }).click();
        cy.get('[data-cy-modal-dialog-ok]').click();
    });

    afterEach(() => {
        cy.wait(1000);  // Cypress の状態引き継ぎバグ対策 (必須)
    });

    // ここにテストを追加
});
```

## 3. `data-cy-*` 属性の確認

Cypress テストの全セレクタは `[data-cy-*]` 属性に依存する。Vue コンポーネントに対応する属性が無ければ、[working-on-frontend](../../working-on-frontend/SKILL.md) に従って追加する。

命名規則: `data-cy-<component-or-feature>-<element>`

```html
<!-- 良い例 -->
<button data-cy-open-post-form>Post</button>
<input data-cy-signin-username />

<!-- 禁止: CSS クラスや ID に依存したセレクタ -->
cy.get('.post-button')        // ❌
cy.get('#username-input')     // ❌
```

既存の `data-cy-*` 一覧は [cypress-lifecycle.md](../knowledge/cypress-lifecycle.md) の各段階の説明を参照。

## 4. テスト記述の規約

### 基本構成

```ts
it('should do something', () => {
    cy.visitHome();

    // インタラクション
    cy.get('[data-cy-some-button]').click();

    // アサーション
    cy.get('[data-cy-result]').should('be.visible');
    cy.contains('Expected text');
});
```

### API インターセプト

```ts
it('api-dependent action', () => {
    cy.intercept('POST', '/api/some/endpoint').as('someAction');

    cy.get('[data-cy-trigger]').click();

    cy.wait('@someAction');
    // 必要ならレスポンス検証
    cy.get('@someAction').its('response.statusCode').should('eq', 200);
});
```

### タイムアウト

- デフォルトのタイムアウトでは足りない場合は明示的に指定
- 初回ログイン後のウィザード表示など、レンダリングに時間がかかるもの → `{ timeout: 30000 }`
- ノート投稿後の表示確認 → `{ timeout: 15000 }`

### 非同期の注意

- `cy.wait('@alias')` は必ず `cy.intercept()` の**後**に置く
- UI 操作 → API コール → `cy.wait` の順序を守る

## 5. 実行確認

```bash
# テスト用 DB / Redis 起動 (初回または停止後)
docker compose -f packages/backend/test/compose.yml up -d

# テスト設定が無ければコピー
cp .github/misskey/test.yml .config/test.yml

# 全体ビルド (ソースコード変更後)
pnpm build

# E2E 実行
pnpm e2e
```

## 6. flaky テストの扱い

テストが不安定 (flaky) な場合、以下の手順で対処:

1. **まず原因を特定** — タイムアウト不足 / 非同期待機漏れ / 環境依存 / Cypress の既知のバグ
2. **修正可能なら修正** — タイムアウト延長、`cy.wait` 追加、安定したセレクタに変更
3. **どうしても直らない場合のみ** — `/* flaky */` コメントでテスト全体を無効化 (widgets.cy.ts のパターン)

無効化パターン:
```ts
/* flaky
describe('...', () => {
    // 全テストをコメントアウト
});
*/
```

> **重要**: flaky 無効化は一時的な措置。対応する GitHub Issue を立てて追跡すること。

## 完了確認

- [ ] `pnpm e2e` がパスする
- [ ] 新規 `data-cy-*` 属性を追加した場合、[working-on-frontend](../../working-on-frontend/SKILL.md) に従っている
- [ ] コミット前に [shipping-misskey-change](../../shipping-misskey-change/SKILL.md) を実行
