# Cypress テストライフサイクル段階

[cypress/e2e/basic.cy.ts](../../../../../cypress/e2e/basic.cy.ts) のテストは **5 つのライフサイクル段階** に分割され、`describe` ブロックが段階的に積み上がる。各段階の `beforeEach` が前の段階の最終状態を再現する。

## 段階構成図

```
Before setup    →  DB リセットのみ。何もない状態から始まる
    ↓ (admin 初期セットアップ完了)
After setup     →  DB リセット + admin 作成済み
    ↓ (一般ユーザー signup 完了)
After signup    →  DB リセット + admin + 一般ユーザー作成済み
    ↓ (ユーザー login 完了)
After signin    →  DB リセット + admin + 一般ユーザー + ログイン済み
    ↓ (アカウント初期設定ウィザード完了)
After user setup → DB リセット + admin + 一般ユーザー + ログイン + ウィザード閉じ済み
```

## 各段階の詳細

### 1. Before setup instance

```ts
describe('Before setup instance', () => {
    beforeEach(() => { cy.resetState(); });
    afterEach(() => { cy.wait(1000); });
    // ...
});
```

- **状態**: DB のみリセット。admin アカウントも一般ユーザーも存在しない
- **テスト対象**:
  - `successfully loads` — ページが正常に読み込まれるか
  - `setup instance` — 初期セットアップウィザード (admin アカウント作成)
    - 初期パスワード入力 → `[data-cy-admin-initial-password] input`
    - ユーザー名入力 → `[data-cy-admin-username] input`
    - パスワード入力 → `[data-cy-admin-password] input`
    - 作成ボタン → `[data-cy-admin-ok]`
    - 次へ → `[data-cy-next]`
    - サーバー名設定 → `[data-cy-server-name] input`
    - 適用 → `[data-cy-server-setup-wizard-apply]`
  - インターセプト: `POST /api/admin/accounts/create`, `POST /api/admin/update-meta`

### 2. After setup instance

```ts
describe('After setup instance', () => {
    beforeEach(() => {
        cy.resetState();
        cy.registerUser('admin', 'pass', true);
    });
    afterEach(() => { cy.wait(1000); });
    // ...
});
```

- **状態**: DB リセット + admin アカウント (`admin` / `pass`) 作成済み
- **テスト対象**:
  - `successfully loads` — ページ読み込み
  - `signup` — 新規ユーザー登録フロー
    - サインアップボタン → `[data-cy-signup]`
    - 利用規約同意 (トグル + モーダル OK) → `[data-cy-signup-rules-notes-agree] [data-cy-switch-toggle]`
    - 続行ボタンの有効化確認 (disabled → not disabled)
    - ユーザー名入力 → `[data-cy-signup-username] input`
    - パスワード入力 → `[data-cy-signup-password] input`
    - パスワード再入力 → `[data-cy-signup-password-retype] input`
    - 招待コード入力 → `[data-cy-signup-invitation-code] input` (値: `test-invitation-code`)
    - ボタンの段階的有効化検証: **各フィールド入力ごとに `should('be.disabled')` → 全入力後に `should('not.be.disabled')`**
  - `signup with duplicated username` — 重複ユーザー名
    - 事前に `cy.registerUser('alice', 'alice1234')` で作成
    - 同じユーザー名でサインアップ → サブミットボタンが disabled のまま (`'be.disabled'`)

### 3. After user signup

```ts
describe('After user signup', () => {
    beforeEach(() => {
        cy.resetState();
        cy.registerUser('admin', 'pass', true);
        cy.registerUser('alice', 'alice1234');
    });
    afterEach(() => { cy.wait(1000); });
    // ...
});
```

- **状態**: DB リセット + admin + 一般ユーザー `alice` / `alice1234` 作成済み
- **テスト対象**:
  - `successfully loads` — ページ読み込み
  - `signin` — ログインフロー
    - サインインボタン → `[data-cy-signin]`
    - ユーザー名入力画面 → `[data-cy-signin-page-input]`
    - ユーザー名 + Enter → `[data-cy-signin-username] input`
    - パスワード入力画面 → `[data-cy-signin-page-password]` (最大 10s 待機)
    - パスワード + Enter → `[data-cy-signin-password] input`
    - インターセプト: `POST /api/signin-flow`
  - `suspend` — アカウント凍結時の UI
    - 管理者が `POST /api/admin/suspend-user` で alice を凍結
    - alice でログイン試行 → 凍結メッセージが表示されること
    - 日本語/英語両対応: `アカウントが凍結されています|This account has been suspended due to`

### 4. After user signed in

```ts
describe('After user signed in', () => {
    beforeEach(() => {
        cy.resetState();
        cy.registerUser('admin', 'pass', true);
        cy.registerUser('alice', 'alice1234');
        cy.login('alice', 'alice1234');
    });
    afterEach(() => { cy.wait(1000); });
    // ...
});
```

- **状態**: DB リセット + admin + alice 作成 + **alice がログイン済み**
- **テスト対象**:
  - `successfully loads` — ユーザー設定ウィザードの続行ボタン表示 (30s タイムアウト)
    - `[data-cy-user-setup-continue]` — 初回ログイン時に表示されるアカウント設定ウィザード
  - `account setup wizard` — アカウント初期設定ウィザード完全走破
    1. プロフィール: 名前 `ありす` → `[data-cy-user-setup-user-name] input`、説明 `ほげ` → `[data-cy-user-setup-user-description] textarea`
    2. プライバシー設定 (スキップ)
    3. フォローおすすめ (スキップ)
    4. プッシュ通知設定 (スキップ)
    5. 完了
    - 各ステップで `[data-cy-user-setup-continue]` をクリック
    - TODO: アイコン設定テスト未実装

### 5. After user setup

```ts
describe('After user setup', () => {
    beforeEach(() => {
        cy.resetState();
        cy.registerUser('admin', 'pass', true);
        cy.registerUser('alice', 'alice1234');
        cy.login('alice', 'alice1234');
        // アカウント初期設定ウィザードを閉じる
        cy.get('[data-cy-user-setup] [data-cy-modal-window-close]', { timeout: 30000 }).click();
        cy.get('[data-cy-modal-dialog-ok]').click();
    });
    afterEach(() => { cy.wait(1000); });
    // ...
});
```

- **状態**: DB リセット + admin + alice 作成 + ログイン + **アカウント設定ウィザードを閉じた状態** (通常使用状態)
- **テスト対象**:
  - `note` — ノート投稿
    - 投稿フォームを開く → `[data-cy-open-post-form]`
    - テキスト入力 → `[data-cy-post-form-text]` に `Hello, Misskey!`
    - 投稿ボタン → `[data-cy-open-post-form-submit]`
    - タイムラインに表示されること → `cy.contains('Hello, Misskey!', { timeout: 15000 })`
  - `open note form with hotkey` — ホットキーでノート投稿フォームを開閉
    - `n` キー (`code: KeyL` — 非 QWERTY キーボードでも動くことの検証) でフォームが開く
    - `Escape` キーでフォームが閉じる

## 共通パターン

### `afterEach` の 1 秒待機

全 describe ブロックの `afterEach` に `cy.wait(1000)` が入っている。理由はコメントに明記:

> テスト終了直前にページ遷移するようなテストケース(例えばアカウント作成)だと、たぶんCypressのバグでブラウザの内容が次のテストケースに引き継がれてしまう。waitを入れることでそれを防止できる

### 新規テスト追加時の段階選択

| テストしたい機能 | 使うべき describe ブロック |
|---|---|
| 未セットアップ状態の UI | Before setup |
| サインアップフロー | After setup |
| ログインフロー / 凍結 | After user signup |
| 初回設定ウィザード | After user signed in |
| 通常使用 (投稿 / 設定 / etc.) | After user setup |

### インターセプト

API のレスポンス待ちには `cy.intercept().as()` + `cy.wait()` を使う:
```ts
cy.intercept('POST', '/api/signup').as('signup');
// ... UI 操作 ...
cy.wait('@signup');
```

### `data-cy-*` 命名規則

すべてのセレクタは `data-cy-<component>-<element>` 形式:
- `data-cy-signin`, `data-cy-signin-username`, `data-cy-signin-password`
- `data-cy-signup`, `data-cy-signup-username`, `data-cy-signup-submit`
- `data-cy-open-post-form`, `data-cy-post-form-text`, `data-cy-open-post-form-submit`
- `data-cy-user-setup`, `data-cy-user-setup-continue`
- `data-cy-modal-window-close`, `data-cy-modal-dialog-ok`
- `data-cy-switch-toggle`

入力要素には `[data-cy-xxx] input` / `[data-cy-xxx] textarea` の子孫セレクタを使う。
