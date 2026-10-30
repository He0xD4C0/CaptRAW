# 测试目录

测试先按运行层级分组，再按主功能域分组。每个文件只放入一个主功能域；文件名保持不变。

| 目录 | 职责 |
|---|---|
| `unit/` | 不启动原生进程或 Electron 的纯 Node 单测。 |
| `support/` | EngineClient、Electron 启动器、XMP 与数值帮助器；`support/inspect/` 保存结果检查脚本。 |
| `fixtures/` | 固定清单与小型资源；`fixtures/generators/` 保存测试夹具生成器。 |
| `native/` | 需要原生核心、C++ probe 或原生专项构建的检查。 |
| `integration/` | 跨 package 服务、文件格式、像素与真实引擎集成检查，不操作 GUI。 |
| `e2e/` | 隐藏或可见 Electron/GUI 工作流；`e2e/workflows/smoke.mjs` 是根 E2E 入口。 |
| `probes/` | 研究、候选、诊断和性能探针，不作为默认 CI 门槛。 |

功能域统一为：

| 域 | 范围 |
|---|---|
| `geometry` | 坐标、裁切、旋转、拉直、透视、镜头和源画幅。 |
| `color` | 白平衡、效果、HDR、分级、曲线和配置文件。 |
| `masks` | 蒙版、画笔、修复、对象和分割。 |
| `documents` | XMP、原生文档、预设、同步、元数据和会话。 |
| `workflows` | 启动、视口、比较、批量、快捷键和窗口流程。 |
| `platform` | Nikon、源身份、平台进程和安装包检查。 |

## 迁移映射

| 原路径 | 当前路径 |
|---|---|
| `tests/*.test.mjs` | `tests/unit/` |
| `tests/*-e2e.mjs` | `tests/e2e/<domain>/` |
| `tests/*-native.mjs`、C++ probe | `tests/native/<domain>/` |
| `tests/inspect-*` | `tests/support/inspect/` |
| 夹具生成器与固定清单 | `tests/fixtures/` |
| 研究、候选和诊断脚本 | `tests/probes/<domain>/` |
| `native/tests/*.mjs` | `tests/native/<domain>/` |

常用入口：

```sh
pnpm test:unit
pnpm test:e2e
node tests/native/geometry/geometry-reference-test.mjs
node tests/integration/documents/xmp-documents.mjs
```

历史 `docs/ACCEPTANCE.md` 保留旧路径作为当时证据；当前测试、脚本和持续维护的文档使用本目录结构。
