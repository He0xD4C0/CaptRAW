# 安全政策

## 报告漏洞

请不要在公开 issue、讨论区或 Pull Request 中披露未修复漏洞、利用代码、
用户照片、路径、凭据或其他敏感信息。

通过 GitHub 仓库的 **Security → Advisories → Report a vulnerability**
私密报告。仓库所有者需要保持 GitHub Private Vulnerability Reporting 开启。

报告应尽量包含受影响版本、平台、复现步骤、影响和最小样本。收到报告后，
维护者会通过私密 advisory 确认接收、评估影响并协调修复与披露。响应时间
取决于问题严重程度和维护者可用性，不承诺固定 SLA。

## 支持范围

安全修复优先应用于 `main` 和最新发布版本。用户应验证下载文件的
`SHA256SUMS`，并仅从项目 GitHub Releases 或项目明确说明的镜像获取安装包。

## 不在范围内

- 已被第三方确认、但 CaptRAW 尚未采用或分发的上游漏洞；
- 需要攻击者已经控制本机账户、修改系统库或替换应用文件的场景；
- 仅影响已明确标记为实验性且没有安全边界声明的功能。
