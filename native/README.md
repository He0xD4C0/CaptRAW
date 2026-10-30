# Native 目录

`native/` 保存 CaptRAW 自有 C++ 实现，以及应用到固定 ART / XMP 源码的确定性构建期修改。

| 目录 | 内容 |
|---|---|
| `src/` | 原生引擎、适配器、进程入口和功能实现（`.cc`）。 |
| `include/` | 实现与探针共用的 CaptRAW 自有头文件（`.h`）。 |
| `cmake/` | 注入固定上游构建的 CMake 片段。 |
| `patches/` | 对固定上游源码执行的有序 JavaScript 补丁；不属于运行时代码。 |
| `config/` | 固定来源清单和第三方许可材料。 |

## 构建与测试

所有命令都在仓库根目录执行。原生构建仍令 `CAPTRAW_SOURCE_DIR` 指向
`native/`；CMake 的源码位于 `src/`，头文件搜索目录为 `include/`。

```sh
pnpm build:native
pnpm build:xmp
node scripts/build-segmentation-worker.mjs
node tests/native/geometry/geometry-reference-test.mjs
node tests/native/geometry/perspective-manual-test.mjs
```

新增生产实现放入 `src/`，对应声明放入 `include/`。修改固定上游源码时必须把补丁放入 `patches/`，并在
`scripts/build-native.mjs` 或 `scripts/build-xmp.mjs` 中明确执行顺序。

## 迁移映射

| 原路径 | 当前路径 |
|---|---|
| `native/*.cc` | `native/src/*.cc` |
| `native/*.h` | `native/include/*.h` |
| `native/patch-*.mjs`, `native/repair-patch.mjs` | `native/patches/` |
| 其他 `native/*.mjs` 检查脚本 | `tests/native/<domain>/` |
| `native/targets.cmake`, `native/xmp-files.cmake` | `native/cmake/` |
| `native/enhanced-profile-sources.json`, `native/enhanced-profile.LICENSE` | `native/config/` |

历史验收记录保留检查执行时的路径；当前源码、脚本和持续维护的文档统一使用本目录结构。
