# 日志和运维脚本改进总结

## 📋 改进概览

本次改进实现了开发/生产环境的完全隔离日志管理，将日志和PID文件从编译产物目录（`built/`、`built-dev/`）迁移到专门的 `logs/` 目录结构。

## 🎯 改进目标

1. **分离关注点**：编译产物目录只包含代码产物，运行时状态文件移到专门目录
2. **完全隔离**：开发/生产环境日志完全独立，避免相互干扰
3. **更好的组织**：统一的日志目录结构，便于管理和清理
4. **安全性**：`.gitignore` 排除 `logs/` 目录，避免敏感信息泄露

## 🗂️ 新目录结构

```
logs/
├── production/              # 生产环境日志
│   ├── server.log          # 主服务器日志
│   ├── server.pid          # 服务器进程ID
│   ├── supervisor.pid      # Supervisor进程ID
│   └── supervisor-launcher.bat  # Supervisor启动脚本（Windows）
├── development/             # 开发环境日志
│   ├── server.log          # 开发服务器日志
│   └── server.pid          # 开发服务器进程ID
└── README.md               # 日志管理文档
```

## 🔧 修改的文件

### 1. **scripts/prod-server.mjs**
- ✅ 日志路径：`built/prod-server.log` → `logs/production/server.log`
- ✅ PID路径：`built/prod-server.pid` → `logs/production/server.pid`
- ✅ Supervisor PID：`built/supervisor.pid` → `logs/production/supervisor.pid`
- ✅ Launcher路径：`built/supervisor-launcher.bat` → `logs/production/supervisor-launcher.bat`
- ✅ 自动创建日志目录：启动前 `mkdirSync(logsDir, { recursive: true })`

### 2. **scripts/dev-server.mjs**
- ✅ 日志路径：`built-dev/dev-server.log` → `logs/development/server.log`
- ✅ PID路径：`built-dev/dev-server.pid` → `logs/development/server.pid`
- ✅ 自动创建日志目录：启动前 `mkdirSync(logsDir, { recursive: true })`

### 3. **.gitignore**
- ✅ 添加 `/logs` 排除规则

### 4. **新增文件**
- ✅ `scripts/migrate-logs.mjs` - 日志迁移脚本（一次性运行）
- ✅ `scripts/clean-old-logs.mjs` - 清理旧日志文件脚本
- ✅ `logs/README.md` - 日志管理文档

## 🚀 使用方法

### 自动迁移（首次升级时）

迁移已在改进过程中自动完成。如果需要手动清理旧文件：

```bash
node scripts/clean-old-logs.mjs
```

### 查看日志

**生产环境：**
```bash
pnpm prod:logs              # 查看最后80行
pnpm prod:logs-window       # 在新窗口中实时查看
```

**开发环境：**
```bash
pnpm dev:logs               # 查看最后80行
```

**手动访问：**
```bash
# 生产日志
tail -f logs/production/server.log

# 开发日志
tail -f logs/development/server.log
```

## ✅ 隔离验证

### 完全独立的资源

| 资源类型 | 生产环境 | 开发环境 |
|---------|---------|---------|
| HTTP端口 | 2999 | 3000 |
| PostgreSQL端口 | 5433 | 5432 |
| Redis端口 | 6380 | 6379 |
| 编译输出 | `built/` | `built-dev/` |
| 日志目录 | `logs/production/` | `logs/development/` |
| 配置文件 | `.config/default.yml` | `.config/dev.yml` |

### 同时运行测试

开发和生产服务器现在可以**完全独立**同时运行：

```bash
# 终端1：启动生产服务器
pnpm prod:start

# 终端2：启动开发服务器
pnpm dev:start

# 检查状态
pnpm prod:status   # 生产环境状态
pnpm dev:status    # 开发环境状态
```

## 📊 改进效果

### 之前的问题
- ❌ 日志和编译产物混在一起
- ❌ PID文件散落在 `built/` 目录
- ❌ 难以区分开发/生产日志
- ❌ 日志文件可能被误提交到Git

### 改进后
- ✅ 清晰的目录结构
- ✅ 运行时状态文件统一管理
- ✅ 开发/生产完全隔离
- ✅ `.gitignore` 自动排除敏感日志
- ✅ 更容易实施日志轮转策略

## 🔒 安全性

- 日志目录已添加到 `.gitignore`
- 避免敏感信息（数据库错误、用户信息等）被提交到版本控制
- 每个环境的日志完全独立，降低泄露风险

## 📝 后续建议

### 日志轮转

生产环境建议配置日志轮转：

**Windows Task Scheduler:**
```powershell
# 每周保留最后10万行
Get-Content logs/production/server.log | Select-Object -Last 100000 | 
    Set-Content logs/production/server.log.tmp
Move-Item -Force logs/production/server.log.tmp logs/production/server.log
```

**Linux logrotate:**
```
/path/to/captraw/logs/production/server.log {
    weekly
    rotate 4
    compress
    missingok
    notifempty
    copytruncate
}
```

## ✨ 总结

本次改进实现了：
1. ✅ 日志与编译产物完全分离
2. ✅ 开发/生产环境完全隔离
3. ✅ 统一的日志管理策略
4. ✅ 更好的安全性和可维护性
5. ✅ 向后兼容（自动迁移旧文件）

所有运维脚本在设计时已充分考虑了开发和生产服务器的隔离运行，确保两个环境可以同时运行而不会产生任何冲突。
