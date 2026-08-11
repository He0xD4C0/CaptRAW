---
name: testing-qq-login
description: 在测试、调试或验证 QQ OAuth 登录集成时使用。覆盖后端 QqSigninApiService 端点 (/api/qq/auth, /api/qq/callback)、前端 MkSignin.vue 集成、OAuth 流程验证、QQ互联 API 参考、错误码速查以及应用审核状态的限制。测试 QQ 登录前必须查阅，避免将"应用未上线"等预期错误误判为实现缺陷。
---

# testing-qq-login

QQ 互联 (QQ OAuth 2.0) 登录集成测试与调试的入口技能。汇总了后端/前端实现状态、OAuth 2.0 授权码流程、QQ互联 API 参考、常见错误码、安全注意事项以及应用审核未完成时的限制。

SKILL.md 本身仅作索引，具体步骤和知识请 Read 对应的 reference 文件（渐进式披露）。

## 背景知识 (knowledge)

测试前应了解的架构、API 与错误处理。

- QQ 登录实现架构（后端 QqSigninApiService / 前端 MkSignin.vue）→ [references/knowledge/qq-login-architecture.md](references/knowledge/qq-login-architecture.md)
- QQ互联 API 参考（端点、参数、返回格式、JSONP 解析、隐私保护改造）→ [references/knowledge/qq-oauth-api-reference.md](references/knowledge/qq-oauth-api-reference.md)
- QQ互联错误码速查（OAuth 2.0 公共返回码 + OpenAPI 错误码）→ [references/knowledge/qq-oauth-error-codes.md](references/knowledge/qq-oauth-error-codes.md)

## 任务工作流 (tasks)

按步骤执行的测试清单与检查点。

- QQ 登录测试流程（配置确认 → OAuth 重定向 → 按钮集成 → 预期行为判定 → 安全校验 → 报告）→ [references/tasks/qq-login-test-flow.md](references/tasks/qq-login-test-flow.md)

## 快速调试

```bash
# 直接测试 OAuth 授权端点（观察重定向）
curl -v http://localhost:3000/api/qq/auth 2>&1 | grep -i location

# 预期：302 → https://graph.qq.com/oauth2.0/authorize?response_type=code&client_id=...&redirect_uri=...&state=...
```

管理面板配置确认：管理面板 → 设置 → QQ Login
- "Enable QQ Login" 已开启
- appId / appKey 已填写
- Callback URI: `http://localhost:3000/api/qq/callback`

## 关键事实速查

| 项目 | 说明 |
|------|------|
| OAuth 版本 | OAuth 2.0 授权码模式（Authorization Code Grant） |
| 授权端点 | `https://graph.qq.com/oauth2.0/authorize` |
| Token 端点 | `https://graph.qq.com/oauth2.0/token` |
| OpenID 端点 | `https://graph.qq.com/oauth2.0/me`（默认 JSONP 格式，可加 `?fmt=json`） |
| 用户信息端点 | `https://graph.qq.com/user/get_user_info` |
| access_token 有效期 | 约 30 天～3 个月 |
| 默认 scope | `get_user_info`（不传则默认仅此权限） |
| 2022 年隐私改造 | country/province/city/year 返回固定值（中国/广东/深圳/1990） |
| 生产环境要求 | HTTPS 回调地址 + 已备案域名 + 腾讯审核通过 |

## 当前限制

- 应用尚未通过腾讯审核时，仅 `get_user_info` API 可用
- 审核通过前出现"应用未上线"等提示属于**正常现象**
- 审核通过前：可验证 OAuth 流程正确性（能否跳转到 `graph.qq.com`），但无法完成完整登录闭环

## 相关技能

- QQ 登录后端实现 → [working-on-backend](../working-on-backend/SKILL.md)（QqSigninApiService）
- QQ 登录前端按钮 → [working-on-frontend](../working-on-frontend/SKILL.md)（MkSignin.vue）
