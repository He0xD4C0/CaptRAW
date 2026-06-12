# CaptRAW

CaptRAW 是基于 [Misskey](https://github.com/misskey-dev/misskey) 的分支，增强了企业级认证与授权能力的社交平台。

*其他语言：[English](README.md) | [日本語](README_JP.md)*

## 主要功能

### OIDC 提供商

完整的 OpenID Connect 1.0 提供商实现：

- 授权码流程，强制 PKCE（S256）
- ID Token 签发（RS256 JWT 签名）
- UserInfo 端点（GET/POST）
- JWKS 端点（多密钥、自动轮换）
- OIDC Discovery（`/.well-known/openid-configuration`）
- OAuth 2.0 授权服务器元数据（RFC 8414）
- `nonce` 参数与 `auth_time` 声明支持

通过管理面板（`/admin/oidc-settings`）切换启用状态。

### 手机号短信验证

通过短信验证码实现手机号注册与登录：

- 可扩展的 `ISmsProvider` 接口，支持多服务商
- 阿里云短信服务商（HMAC-SHA1 签名）
- 验证码发送与校验 API
- 可选的注册手机号强制要求（`phoneRequiredForSignup`）

通过管理面板（`/admin/sms-settings`）配置服务商。

### 管理功能

- OAuth 应用管理（`/admin/oauth-apps`）— 列表、创建、删除
- 默认语言：简体中文（zh-CN）

## 环境要求

- **Node.js** 22.x
- **PostgreSQL** 18
- **Redis** 7

本项目**不支持** Docker 部署。请直接安装上述中间件。

## 快速开始

```bash
# 安装依赖
pnpm install

# 启动 PostgreSQL / Redis（macOS / Homebrew）
brew services start postgresql@18
brew services start redis
createdb misskey-dev

# 创建配置文件
cp .config/example.yml .config/default.yml
# 编辑 default.yml，填写数据库和 Redis 连接信息

# 构建
pnpm build

# 运行数据库迁移
pnpm --filter backend migrate

# 启动开发服务器
pnpm dev
```

访问 `http://localhost:3000`，使用 `default.yml` 中设置的初始化密码创建管理员账户。

## 配置文件

```yaml
url: http://localhost:3000
port: 3000

db:
  host: localhost
  port: 5432
  db: misskey-dev
  user: <数据库用户名>
  pass: ''

redis:
  host: localhost
  port: 6379

setupPassword: <初始化密码>
```

## 开发

```bash
pnpm dev         # 开发服务器（热更新）
pnpm lint        # 静态检查
pnpm build       # 生产构建
```

## 许可证

CaptRAW 基于 Misskey，遵循 [AGPL-3.0](LICENSE) 协议。

## 致谢

本项目基于 [Misskey](https://github.com/misskey-dev/misskey) 构建，感谢所有 Misskey 贡献者。

---

<div align="center">
CaptRAW — 企业级 Misskey 分支
</div>
