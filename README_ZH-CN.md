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

## 生产部署

本项目采用 **一次构建、生产运行** 的工作流（类似 Cloudflare Workers）。所有代码编译到 `built/` 目录，然后由单个 Node.js 进程提供服务。

### 命令

| 命令 | 说明 |
|---|---|
| `pnpm prod:build` | 完整生产构建（所有包 → `built/`） |
| `pnpm prod:start` | 以守护进程方式启动生产服务器（带日志文件） |
| `pnpm prod:stop` | 优雅停止生产服务器 |
| `pnpm prod:restart` | 停止 → 构建 → 启动（一键部署） |
| `pnpm prod:deploy` | `prod:restart` 的别名 |
| `pnpm prod:status` | 检查服务器是否运行中 |
| `pnpm prod:logs` | 查看最近 80 行服务器日志 |
| `pnpm prod:logs-window` | 在新窗口中实时查看日志 |

### 典型工作流

```bash
# 首次部署
pnpm prod:build
pnpm prod:start

# 代码修改后
pnpm prod:restart

# 监控
pnpm prod:logs-window   # 在新窗口实时查看日志
pnpm prod:status         # 快速健康检查

# 停止
pnpm prod:stop
```

### 开发模式

如需热重载开发，请使用 `pnpm dev`。该命令会启动 Vite 开发服务器、nodemon 监听器及所有子包的 watch 进程。

**注意：** 不要同时运行 `pnpm dev` 和 `pnpm prod:start`，端口会冲突。

## 上游

本版本跟踪 Misskey 上游仓库。原始项目请参阅 [Misskey](https://github.com/misskey-dev/misskey)。

## 许可证

基于 Misskey，遵循 [AGPL-3.0](LICENSE) 协议。

---

<div align="center">
Misskey — CaptRAW 社区版
</div>
