# 参与 CaptRAW 开发

感谢你参与 CaptRAW。提交代码、文档、测试、翻译、设计或其他可纳入仓库
的作品前，请先阅读本指南。

## 许可与贡献认证

CaptRAW 以 `GPL-3.0-or-later` 发布。你提交的贡献默认以相同许可证提供。
项目采用 [Developer Certificate of Origin 1.1](DCO)，不要求版权转让。

每个普通提交都必须由提交者认证，并使用真实可识别的作者身份添加签署行：

```sh
git commit -s -m "feat: describe the change"
```

签署行必须与提交作者一致：

```text
Signed-off-by: Your Name <your-email@example.com>
```

忘记签署时可修正当前提交：

```sh
git commit --amend -s --no-edit
```

多个提交可交互式重排并逐个补充签署。不要替其他贡献者签署，也不要提交
无法确认来源或授权的代码、媒体、模型、字体和数据。

## 新增第三方内容

引入第三方代码或资源时，Pull Request 必须同时提供：

- 上游项目、固定版本或提交号，以及直链；
- 精确许可证和必要的版权、专利或 NOTICE；
- 文件校验值，以及测试或样本数据的来源；
- 若改动上游文件，清楚说明修改内容并保留已有声明。

同步更新 `THIRD_PARTY.md` 和打包清单。来源不明或许可证不兼容的内容不得合入。

新增 CaptRAW 自有源码文件应包含：

```text
SPDX-License-Identifier: GPL-3.0-or-later
```

现有文件的历史版权头不做批量改写。

## 开发与验证

环境、原生依赖和完整构建说明见 [README.md](README.md)。常用检查：

```sh
pnpm install --frozen-lockfile
pnpm ci:check
```

涉及原生核心、显示、导出或用户交互时，还应运行对应的集成、原生或 E2E
检查。测试必须使用临时目录并清理中间产物；提交中只保留可复现夹具和
明确交付物。

Pull Request 应保持范围集中，说明问题、行为变化、测试结果、许可证影响
和仍需人工确认的事项。界面改动需要实际打开并操作对应控件，不能只证明
内部函数可调用。

## 分支与合入

1. 从最新 `main` 创建分支，不使用主分支直接开发。
2. 保持提交可独立审查，并为每个普通提交添加 DCO 签署。
3. 提交 Pull Request，修复 CI、类型检查、测试和审查意见。
4. 维护者使用 **Rebase and merge** 合入，保留线性历史及提交签署。

主分支要求 Pull Request、CI、DCO 和代码所有者审查。禁止强推或删除
`main`。紧急绕行必须由维护者明确说明原因。

## 行为与安全

交流遵循 [行为准则](CODE_OF_CONDUCT.md)。安全漏洞不要公开披露，按
[安全政策](SECURITY.md) 私密报告。
