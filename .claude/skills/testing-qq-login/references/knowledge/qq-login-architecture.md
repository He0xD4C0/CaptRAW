# QQ 登录实现架构

## 后端实现

### QqSigninApiService（已完成）

| 端点 | 方法 | 用途 |
|------|------|------|
| `/api/qq/auth` | GET | 生成 state、构造授权 URL，302 重定向到 `https://graph.qq.com/oauth2.0/authorize` |
| `/api/qq/callback` | GET | 处理腾讯回调：校验 state → 用 code 换 access_token → 取 openid → 取用户信息 → 登录/注册 |

支持两种账户模式：
- **绑定已有账户**：已登录用户将 QQ 关联到当前 Misskey 账户
- **创建新账户**：使用 QQ 用户信息（nickname、avatar 等）自动注册新 Misskey 账户

### OAuth 2.0 授权码完整流程

```
1. 用户点击 "Sign in with QQ"
   │
2. 前端 window.open(/api/qq/auth)
   │
3. 后端生成 state（防 CSRF），存入 session
   │  302 重定向到:
   │  https://graph.qq.com/oauth2.0/authorize
   │    ?response_type=code
   │    &client_id={appId}
   │    &redirect_uri={URL 编码的回调地址}
   │    &state={随机字符串}
   │    &scope=get_user_info
   │
4. 用户在 QQ 授权页登录并同意授权
   │
5. 腾讯回调 /api/qq/callback?code={code}&state={state}
   │
6. 后端校验 state（必须与 session 中一致，防 CSRF）
   │
7. 后端用 code 换取 access_token（POST/GET）
   │  https://graph.qq.com/oauth2.0/token
   │    ?grant_type=authorization_code
   │    &client_id={appId}
   │    &client_secret={appKey}
   │    &code={code}
   │    &redirect_uri={回调地址}
   │  响应格式: access_token=xxx&expires_in=7776000&refresh_token=xxx
   │  ⚠️ access_token 有有效期，不可持久化存入数据库
   │
8. 后端用 access_token 获取 openid
   │  https://graph.qq.com/oauth2.0/me?access_token={access_token}
   │  默认响应为 JSONP 格式: callback( {"client_id":"...","openid":"..."} );
   │  可加 ?fmt=json 获取纯 JSON
   │  ⚠️ openid 是用户在特定应用下的唯一标识，不同应用的 openid 不同
   │
9. 后端用 access_token + openid 获取用户信息
   │  https://graph.qq.com/user/get_user_info
   │    ?access_token={access_token}
   │    &oauth_consumer_key={appId}
   │    &openid={openid}
   │  返回: nickname, figureurl, figureurl_1, figureurl_2, gender 等
   │  ⚠️ 2022年隐私改造后 country/province/city/year 返回固定值
   │
10. 后端查找或创建 Misskey 账户
    │  - 已有 openid 绑定 → 直接登录
    │  - 新 openid → 创建用户 + 绑定记录
    │
11. 返回登录成功页面 → postMessage 通知父窗口 → 父窗口刷新
```

### 数据库设计（建议）

```
third_party_users 表:
  - userId       → Misskey users 表外键
  - provider     → 'qq'
  - openid       → QQ openid（唯一索引）
  - unionid      → QQ unionid（可选，同一开发者下多应用打通用）
  - accessToken  → （不建议存储，有有效期）
  - createdAt
  - updatedAt
```

## 前端实现

### MkSignin.vue（已完成）

- "Sign in with QQ" 按钮位于登录表单下方
- 点击后通过 `window.open` 打开弹窗，URL 为 `/api/qq/auth`
- 弹窗完成登录后通过 `postMessage` 将结果发送给父窗口
- 父窗口监听 `message` 事件，接收登录结果后刷新页面

### 通信机制

```
父窗口 (MkSignin.vue)
  │ window.open('/api/qq/auth', 'qqLogin', 'width=600,height=600')
  │
  │ window.addEventListener('message', (e) => {
  │   if (e.origin === window.location.origin) {
  │     // 处理登录结果，刷新页面
  │   }
  │ })
  │
弹窗 (QQ 授权 → 回调 → 登录成功页)
  │ window.opener.postMessage({ type: 'qq-login', success: true }, origin)
  │ window.close()
```

## 实现状态矩阵

| 组件 | 状态 | 备注 |
|------|------|------|
| QqSigninApiService | ✅ 完成 | 含 state 校验、错误处理 |
| /api/qq/auth | ✅ 完成 | 正确构造授权 URL |
| /api/qq/callback | ✅ 完成 | code→token→openid→user_info→login |
| MkSignin.vue QQ 按钮 | ✅ 完成 | 弹窗 + postMessage |
| State CSRF 防护 | ⚠️ 需确认 | 后端是否在 session 中存储并校验 state |
| JSONP openid 解析 | ⚠️ 需确认 | `/oauth2.0/me` 默认返回 JSONP，需正确解析 |
| 腾讯应用审核 | ⚠️ 未通过 | 仅 get_user_info 可测试 |
| HTTPS 支持 | ⚠️ 需确认 | 生产环境 QQ 互联要求 HTTPS 回调地址 |

## 安全注意事项

1. **State 参数校验**：必须生成不可预测的随机字符串（如 UUID），存入 session，回调时校验匹配 —— 这是防 CSRF 攻击的关键
2. **AppKey 保护**：绝不出现在前端代码、Git 提交、日志中；仅在服务器端使用
3. **access_token 处理**：有有效期（30天～3个月），不应持久化存入数据库
4. **HTTPS**：QQ 互联要求回调地址使用有效 HTTPS 证书（审核通过后强制）
5. **回调地址一致性**：必须与应用注册时填写的回调域完全一致（协议、域名、端口、路径）

## 参考来源

- QQ互联 Wiki: https://wiki.connect.qq.com
- OAuth 2.0 授权码流程: https://wiki.connect.qq.com/oauth2-0简介
- 获取用户 OpenID: https://wiki.connect.qq.com/获取用户openid_oauth2-0
- API 列表: https://wiki.connect.qq.com/api列表
- 公共返回码: https://wiki.connect.qq.com/公共返回码说明
