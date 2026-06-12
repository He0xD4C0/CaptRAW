# Misskey — CaptRAW 社区版

基于 [Misskey](https://github.com/misskey-dev/misskey) 定制，针对 CaptRAW 社区的使用场景进行了优化。

*其他语言：[English](README.md) | [日本語](README_JP.md)*

## 定制功能

### OIDC 提供商

完整的 OpenID Connect 1.0 提供商，可作为第三方应用的身份提供商。

- 授权码流程，强制 PKCE（S256）
- ID Token 签发（RS256 JWT 签名）
- UserInfo 端点（GET/POST）
- JWKS 端点（多密钥、自动轮换）
- OIDC Discovery（`/.well-known/openid-configuration`）
- OAuth 2.0 授权服务器元数据（RFC 8414）
- `nonce` 参数与 `auth_time` 声明

通过管理面板（`/admin/oidc-settings`）切换启用。

### 手机号短信验证

通过短信验证码实现手机号注册与登录。

- 可扩展的 `ISmsProvider` 接口
- 阿里云短信服务商（HMAC-SHA1 签名）
- 验证码发送与校验 API
- 可选的注册手机号强制要求

通过管理面板（`/admin/sms-settings`）配置。

### 其他变更

- OAuth 应用管理（`/admin/oauth-apps`）
- 默认语言：简体中文（zh-CN）
- 不支持 Docker，使用直接安装方式
- 密钥持久化与自动轮换

## 环境要求

- **Node.js** 22.x
- **PostgreSQL** 18
- **Redis** 7

## 快速开始

```bash
pnpm install

# 启动中间件（macOS / Homebrew）
brew services start postgresql@18
brew services start redis
createdb misskey-dev

# 配置
cp .config/example.yml .config/default.yml

# 构建与迁移
pnpm build
pnpm --filter backend migrate

# 启动
pnpm dev
```

访问 `http://localhost:3000`，使用 `default.yml` 中的初始化密码创建管理员账户。

## 上游

本版本跟踪 Misskey 上游仓库。原始项目请参阅 [Misskey](https://github.com/misskey-dev/misskey)。

## 许可证

基于 Misskey，遵循 [AGPL-3.0](LICENSE) 协议。

---

<div align="center">
Misskey — CaptRAW 社区版
</div>
