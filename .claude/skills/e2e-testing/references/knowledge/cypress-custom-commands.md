# Cypress カスタムコマンド一覧

[cypress/support/commands.ts](../../../../../cypress/support/commands.ts) で定義されている 4 つのカスタムコマンド。TypeScript 型宣言は [cypress/support/index.ts](../../../../../cypress/support/index.ts) にある。

## `cy.visitHome()`

```ts
Cypress.Commands.add('visitHome', () => {
    cy.visit('/');
    cy.get('button', { timeout: 30000 }).should('be.visible');
})
```

- ルート `/` に遷移し、任意の `<button>` が表示されるまで最大 30 秒待つ
- すべてのテストの最初のステップとして使われる
- ページ全体の読み込み完了を保証する安全策

## `cy.resetState()`

```ts
Cypress.Commands.add('resetState', () => {
    cy.request('POST', '/api/reset-db', {}).as('reset');
    cy.get('@reset').its('status').should('equal', 204);
    cy.reload(true);
});
```

- `POST /api/reset-db` を叩いて DB を完全リセット (HTTP 204 確認)
- その後 `cy.reload(true)` でハードリロード
- 全テストの `beforeEach` で呼ばれる前提。これにより各テストはクリーンな状態から始まる
- **注**: IndexedDB (`keyval-store`) の直接削除は Chrome のバグで使えないため、API 経由で DB をリセットする方式を採用している
  - 参考: https://github.com/misskey-dev/misskey/issues/13605#issuecomment-2053652123

## `cy.registerUser(username, password, isAdmin?)`

```ts
Cypress.Commands.add('registerUser', (username, password, isAdmin = false) => {
    const route = isAdmin ? '/api/admin/accounts/create' : '/api/signup';

    cy.request('POST', route, {
        username: username,
        password: password,
        ...(isAdmin ? { setupPassword: 'example_password_please_change_this_or_you_will_get_hacked' } : {}),
    }).its('body').as(username);
});
```

- API 経由でユーザーを作成
- `isAdmin: true` → `POST /api/admin/accounts/create` (要 `setupPassword`)
- `isAdmin: false` (default) → `POST /api/signup` (通常のサインアップ)
- レスポンス body をエイリアス `@<username>` に保存。後続テストで `this.<username>` としてアクセス可能 (例: `this.alice.token`, `this.alice.id`)
- `setupPassword` はテスト環境の固定値 `example_password_please_change_this_or_you_will_get_hacked`

## `cy.login(username, password)`

```ts
Cypress.Commands.add('login', (username, password) => {
    cy.visitHome();

    cy.intercept('POST', '/api/signin-flow').as('signin');

    cy.get('[data-cy-signin]').click();
    cy.get('[data-cy-signin-page-input]').should('be.visible', { timeout: 1000 });
    cy.get('[data-cy-signin-username] input').type(`${username}{enter}`);
    cy.get('[data-cy-signin-page-password]').should('be.visible', { timeout: 10000 });
    cy.get('[data-cy-signin-password] input').type(`${password}{enter}`);

    cy.wait('@signin').as('signedIn');
});
```

- **完全な UI フロー** でログイン (API 直叩きではなく)
- フロー:
  1. `visitHome()` でトップページ表示
  2. `POST /api/signin-flow` をインターセプト
  3. サインインボタン (`[data-cy-signin]`) をクリック
  4. ユーザー名入力欄が表示されるのを待つ (1s タイムアウト)
  5. ユーザー名を入力 + Enter
  6. パスワード入力欄が表示されるのを待つ (10s タイムアウト — signin-flow API のレスポンス次第で遅延あり)
  7. パスワードを入力 + Enter
  8. signin-flow API のレスポンスを待つ
- エイリアス `@signedIn` に signin-flow のレスポンスが保存される
- Enter キーによるフォーム送信確認を兼ねている

## 型宣言

```ts
// cypress/support/index.ts
declare global {
    namespace Cypress {
        interface Chainable {
            login(username: string, password: string): Chainable<void>;
            registerUser(username: string, password: string, isAdmin?: boolean): Chainable<void>;
            resetState(): Chainable<void>;
            visitHome(): Chainable<void>;
        }
    }
}
```

## 例外抑制

[cypress/support/e2e.ts](../../../../../cypress/support/e2e.ts) で以下の未キャッチ例外を無視:

| メッセージ | 原因 |
|---|---|
| `The source image cannot be decoded` | 画像読み込み失敗 (テストに関係なし) |
| `ResizeObserver loop limit exceeded` (Chrome) | Chrome の既知のバグ |
| `ResizeObserver loop completed with undelivered notifications` (Firefox) | Firefox の既知のバグ |

これらの例外はテストの成否に影響しないブラウザ内部のノイズであるため、`cypress.on('uncaught:exception', ...)` で `return false` して抑制している。
