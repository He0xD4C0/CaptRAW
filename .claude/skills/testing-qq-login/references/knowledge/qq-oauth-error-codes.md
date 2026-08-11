# QQ互联错误码速查

## OAuth 2.0 公共返回码（授权/Token 阶段）

这些错误码在调用 `/oauth2.0/authorize`、`/oauth2.0/token`、`/oauth2.0/me` 时返回。

| 错误码 | 含义 | 排查方向 |
|--------|------|----------|
| `100000` | 缺少 `response_type` 或值非法 | 检查授权 URL 是否包含 `response_type=code` |
| `100001` | 缺少 `client_id` | 检查 appId 是否正确传入 |
| `100002` | 缺少 `client_secret` | 检查 Token 请求是否带 appKey（仅服务端） |
| `100003` | HTTP Header 缺少 `Authorization` | 检查请求头 |
| `100004` | 缺少 `grant_type` 或值非法 | Token 请求需 `grant_type=authorization_code` |
| `100005` | `client_id` 不合法 | appId 无效或未审核通过（应用状态非"已上线"） |
| `100006` | `client_secret` 不合法 | appKey 错误 |
| `100007` | `redirect_uri` 不合法 | 回调地址与 QQ 互联平台配置不一致（含协议、域名、端口、路径） |
| `100008` | `code` 不合法 | code 已过期（一次性，用完即失效）或被篡改 |
| `100009` | `access_token` 不合法 | token 过期或不正确 |
| `100010` | `refresh_token` 不合法 | refresh_token 过期或不正确 |
| `100011` | `openid` 不合法 | openid 格式错误 |
| `100012` | `state` 不合法 | state 参数校验失败 |
| `100013` | 用户取消授权 | 用户点击"取消"（回调 error_code=200015） |
| `100014` | `response_type` 不合法 | 必须为 `code` |
| `100015` | `grant_type` 不合法 | 必须为 `authorization_code` |
| `100016` | **access token check failed** | token 过期（常见）或 token 不正确 |
| `100030` | `openid` 与 `access_token` 不匹配 | — |
| `100031` | `openid` 与 `appid` 不匹配 | — |
| `100048` | companyid not set | 未申请 unionid 接口调用权限 |

---

## 用户取消授权

当用户在 QQ 授权页点击"取消"时，回调 URL 携带：

```
redirect_uri?error_code=200015&error_description=user cancel
```

**这不是 Bug**。后端应检测 `error_code` 参数，友好提示用户授权被取消。

---

## 网站验证失败返回码（与 OAuth 流程无关）

注意区分：QQ互联文档中还有一类"网站验证失败"返回码，其中 `100001` 指向"网站 url 格式不正确"，`100003` 指向"服务器连接超时"。定位问题时要确认错误属于哪个分类。

---

## OpenAPI 错误（get_user_info 等业务接口）

这些错误码在调用 `/user/get_user_info` 等 OpenAPI 时返回。

| ret 值 | 含义 | 说明 |
|--------|------|------|
| `0` | 成功 | 正常返回 |
| `-1` | 请求失败 | 通用错误 |
| `-2` | 参数错误 | 缺少必填参数或参数格式错误 |
| `100000` | access_token 不合法 | token 过期或不正确 |

业务接口返回 JSON 格式：
```json
{ "ret": 0, "msg": "" }         // 成功
{ "ret": -1, "msg": "error" }   // 失败
```

---

## 调试技巧

### 1. 检查重定向是否到达 graph.qq.com

```bash
curl -v http://localhost:3000/api/qq/auth 2>&1 | grep -i location
# 预期: Location: https://graph.qq.com/oauth2.0/authorize?...
```

如果 `Location` 指向 `graph.qq.com` → appId 和 redirect_uri 配置正确。
如果 `Location` 指向本地错误页 → 检查管理面板 QQ Login 配置。

### 2. 检查腾讯返回的具体错误

在授权页面 URL 中观察：
- 正常 → 显示 QQ 登录表单
- 显示错误信息 → 查看 URL 参数中的 `error` 和 `error_description`
- 显示"应用未上线" → 应用尚未通过腾讯审核（**正常**）

### 3. 用 Postman/curl 模拟完整 OAuth 流程

```
# Step 1: 获取授权 URL
curl -v http://localhost:3000/api/qq/auth

# Step 2: 手动访问授权 URL（浏览器），获取 code

# Step 3: 用 code 换 token
curl "https://graph.qq.com/oauth2.0/token?grant_type=authorization_code&client_id=APP_ID&client_secret=APP_KEY&code=CODE&redirect_uri=CALLBACK"

# Step 4: 用 token 取 openid
curl "https://graph.qq.com/oauth2.0/me?access_token=TOKEN&fmt=json"

# Step 5: 用 token + openid 取用户信息
curl "https://graph.qq.com/user/get_user_info?access_token=TOKEN&oauth_consumer_key=APP_ID&openid=OPENID"
```

---

## 参考来源

- QQ互联公共返回码说明: https://wiki.connect.qq.com/公共返回码说明
