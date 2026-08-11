# QQ 登录测试流程

## 前置条件

- 生产环境服务器已启动：`pnpm prod:status` 确认运行中
- 或开发环境：`pnpm dev:start` / `pnpm dev`
- 管理面板可访问（需管理员账户登录）
- QQ互联开放平台（connect.qq.com）已创建应用，有 appId 和 appKey

---

## 步骤 1：确认配置

1. 以管理员身份登录 Misskey
2. 访问 **管理面板 → 设置 → QQ Login**
3. 逐项检查：

| 配置项 | 预期值 | 不通过时 |
|--------|--------|----------|
| Enable QQ Login | ✅ 已开启 | 开启开关 |
| appId | 已填写（腾讯开放平台应用 ID） | 从 connect.qq.com "我的应用" 获取 |
| appKey | 已填写（腾讯开放平台应用密钥） | 从 connect.qq.com "我的应用" 获取 |
| Callback URI | `http://localhost:3000/api/qq/callback` | 确认与应用注册时的回调域一致 |

> ⚠️ 回调地址必须与 QQ 互联平台注册的回调域完全一致（协议、域名、端口、路径）。

---

## 步骤 2：测试 OAuth 授权重定向

### 2.1 直接访问授权端点

在浏览器中访问：
```
http://localhost:3000/api/qq/auth
```

**预期结果：** 浏览器自动跳转到：
```
https://graph.qq.com/oauth2.0/authorize?response_type=code&client_id=YOUR_APP_ID&redirect_uri=http%3A%2F%2Flocalhost%3A3000%2Fapi%2Fqq%2Fcallback&state=...
```

### 2.2 命令行验证

```bash
curl -v http://localhost:3000/api/qq/auth 2>&1 | grep -i location
```

**预期输出：** 状态码 `302`，`Location` 头指向 `https://graph.qq.com/oauth2.0/authorize?...`

### 2.3 检查 state 参数

观察重定向 URL 中的 `state` 参数：
- 应该是不可预测的随机字符串（非自增数字、非固定值）
- [ ] state 是否为随机值？
- [ ] 两次访问 `/api/qq/auth` 的 state 是否不同？

> 如果 state 是可预测的或固定不变，说明 CSRF 防护不完善。

### 判定

| 结果 | 含义 |
|------|------|
| ✅ 成功跳转到 `graph.qq.com` | appId、redirect_uri 配置正确，OAuth 流程实现正确 |
| ❌ 未跳转 / 停留在本地 | 检查 QqSigninApiService 是否正确注册，后端日志是否有报错 |
| ❌ 跳转但 URL 参数异常 | 检查管理面板中 appId 配置 |
| ❌ 跳转但 state 固定 | **安全缺陷**：state 需生成不可预测随机值 |

---

## 步骤 3：测试登录按钮

1. 退出当前登录（如果是登录状态）
2. 访问 `http://localhost:3000`
3. 点击右上角**登录**按钮
4. 在登录表单中查找 **"Sign in with QQ"** 按钮

**预期结果：**
- [ ] 按钮可见且可点击
- [ ] 点击后弹出新窗口
- [ ] 新窗口跳转到腾讯 QQ 授权页面（`graph.qq.com` 域名）

> 如果按钮不可见，检查管理面板是否已启用 QQ Login。

---

## 步骤 4：预期行为（应用未审核状态）

由于应用尚未通过腾讯审核，在步骤 2/3 中可能看到：

| 现象 | 是否为 Bug | 说明 |
|------|-----------|------|
| ✅ 成功跳转到 QQ 授权页面 | 正常 | OAuth 流程正确 |
| ⚠️ 页面显示"应用未上线"或类似提示 | **非 Bug** | 应用审核未完成 |
| ⚠️ 页面显示错误码 100005 (client_id 不合法) | **非 Bug** | "未上线"表现之一 |
| ⚠️ 页面显示错误码 100007 (redirect_uri 不合法) | **可能是 Bug** | 回调地址与平台配置不一致 |
| ❌ 用户点击"取消" → URL 带 `error_code=200015` | **非 Bug** | 用户主动取消，需在 UI 层面友好处理 |

> **关键判断标准**：只要能跳转到 `graph.qq.com` 域名下的页面，OAuth 实现即为正确。
> 后续的授权失败若由应用未上线导致，是腾讯侧的审核问题，不是代码问题。

---

## 步骤 5：安全校验清单

| 检查项 | 方法 | 通过标准 |
|--------|------|----------|
| State CSRF 防护 | 步骤 2.3 | state 随机且不可预测，后端校验 state 匹配 |
| AppKey 不泄露 | 检查前端代码和 Git 提交 | appKey 仅在服务端出现 |
| access_token 不持久化 | 检查数据库和代码 | access_token 不存入 DB |
| 回调地址一致性 | 对比管理面板 vs QQ 互联平台 | 完全一致（协议、域名、端口、路径） |
| JSONP 解析 | 检查 `/oauth2.0/me` 调用 | 使用 `?fmt=json` 或正则解析，不用 `eval()` |

---

## 步骤 6：完整 OAuth 流程验证（审核通过后可用）

审核通过后，完整流程如下：

1. 用户在 QQ 授权页登录并点击"同意"
2. 腾讯回调 `/api/qq/callback?code=CODE&state=STATE`
3. 后端校验 state → 用 code 换 access_token → 取 openid → 取用户信息
4. 后端创建/查找 Misskey 用户 → 生成登录 session
5. 返回登录成功页面 → `postMessage` 通知父窗口
6. 父窗口刷新 → 用户处于已登录状态

**审核通过后补充测试：**
- [ ] 新 QQ 用户首次登录 → 自动创建 Misskey 账户（昵称、头像正确）
- [ ] 已有 Misskey 账户绑定 QQ → 关联成功，可用 QQ 登录
- [ ] 同一 QQ 多次登录 → 登录同一 Misskey 账户（不会重复创建）
- [ ] 用户取消授权 → 优雅处理，显示友好提示
- [ ] access_token 过期 → 重新授权流程正常

---

## 步骤 7：测试报告模板

测试完成后，汇总以下信息：

```
QQ 登录测试报告
================
日期：YYYY-MM-DD
环境：production / development
应用审核状态：已审核 / 未审核

1. 配置状态：
   - Enable QQ Login: [✅ / ❌]
   - appId: [已填写 / 未填写]
   - appKey: [已填写 / 未填写]

2. OAuth 重定向：
   - /api/qq/auth 是否跳转到 graph.qq.com: [✅ / ❌]
   - state 参数是否随机: [✅ / ❌]
   - 腾讯页面显示内容: [授权页 / 应用未上线 / 其他错误码]

3. 前端集成：
   - "Sign in with QQ" 按钮可见: [✅ / ❌]
   - 弹窗是否正确打开: [✅ / ❌]

4. 安全校验：
   - State CSRF 防护: [✅ / ❌]
   - AppKey 未泄露: [✅ / ❌]
   - JSONP 解析方式: [fmt=json / 正则 / eval()]

5. 结论：
   - OAuth 实现: [正确 / 有问题]
   - 可上线状态: [等待审核 / 准备就绪]

6. 备注：
   （记录具体错误码、异常现象等）
```

---

## 参考来源

- QQ互联 Wiki: https://wiki.connect.qq.com
- 公共返回码说明: https://wiki.connect.qq.com/公共返回码说明
