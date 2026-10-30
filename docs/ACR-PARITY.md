# ACR 18.7 对齐记录

当前执行范围和状态以[收尾账本](CLOSEOUT.md)为准。本文以下保留既有对齐调查与历史证据；其中同值算法、标准显影XMP写回及旧阶段门槛不再作为本轮任务。

## 历史执行范围（2026-10-29）

从 **CaptRAW 0.64** 起，以固定 **ACR 18.7（2743）** 为参照，完整对齐现有工具，**工作流优先**。本范围替换旧阶段 0–8 扩展计划；下方原始参考、能力矩阵、阶段编号与缺口保留为历史及后续追踪，不再作为本轮排期或全局入口门槛，也不自动获得新范围内的施工授权。完整对齐是目标，不能由控件存在、字段往返或 ART 自对照宣称完成。

| 本轮范围 | 施工与验收边界 |
|---|---|
| 工作流优先 | 先完成现有打开 / 多选 / 切图、编辑、预设 / 同步、保存 / 关闭及既有输出链路；活动图、可见选择与批目标一致，异步等待、取消 / 失败、撤销及保存重开闭环 |
| 整组 Done / Cancel | 面向整组照片处理完成 / 取消，不以当前单张“保存后关闭”代替；旧版按钮行为仍只算历史实现 |
| 源旁同名 XMP | 首次展示替换确认，确认后记住选择；RAW 不回写，未知字段、命名空间、限定符、数组及嵌套结构保留。现有另存 / 批量保存证据不等于此工作流已完成 |
| 既有工具完整对齐 | 按工具补齐 ACR 的参数语义、交互与工作流；分别验收 GUI、XMP、参数及画质 / 效率，不能只补滑杆或沿用近似映射的自对照 |
| 明确允许新增 | 连续 Heal / Clone、画笔 flow / density、ISO 自适应，以及常规预设 strength / hover / favorites / multitarget；连续修复不能用堆叠圆点冒充，预设强度与 Look 数量分开 |
| 默认值与内置包 | 默认预设内容 / Raw Defaults 本轮暂不完善，不以补齐内容或完整默认规则阻挡工作流；保留内置包更新接口。此要求不代表接口已经实现 |
| 受影响回归 | HDR / AI 仅在本轮改动影响既有能力时回归，不新增或扩展能力，也不作为完整对齐目标计数 |
| 平台 | 本轮只做 macOS 产品验收；Windows / Linux 仅作接口与构建风险铺路，不要求两平台产品安装 / 操作验收才能完成本轮 |

**不启动：** 全景、独立观察工具（含独立颜色取样 / Vectorscope）、红眼 / 宠物眼、图库、新的独立输出格式。旧矩阵的全景、SDR AVIF / JXL / PNG / PSD / DNG / OpenEXR 等扩展项继续留作后续；现有格式的工作流与受影响回归按本轮范围验收。旧计划中的合并 / 编码技术栈与三平台安装门槛不随文档保留而继续生效。

执行顺序为工作流闭环、既有工具完整对齐、macOS 产品验收；各项按实际依赖补取所需 ACR 证据。**不等待原阶段 0 全部入口 / 条件取证完成才开始工作流施工**；未见能力与未验证效果继续如实标记，不能据此猜测 API 或宣布通过。验收仍须实际可见、可操作的界面、持久化与像素证据，隐藏 E2E 不替代人工任务验收。

**证据边界：** 0.64 既有 DMG identity 与已登记回归仍有效；前轮追加 71 GUI checks、overlay workflow 1、native XMP mask 11 的真实报告集中见 [验收记录](ACCEPTANCE.md#追加报告待主线程封存)，尚待主线程总表封存。本次不更新 artifact 总表、release 或归档 hash，不将新计划或追加报告表述为新安装版完成。

## 固定证据与判定规则（原阶段 0 参考）

本地插件身份和真实设置已核对，直接 UI 证据现为 U1 / U2 / U3。已在 Photoshop 2026 宿主的本机 ACR 18.7（2743）中打开真实 RAW 与新受控 chart，取得十一个公共 TIFF16 sRGB 参考，并完成普通全景合并及继续编辑。输入身份、十一份 TIFF、修复与全景参考、实际 UI 文件及剩余项由 `artifacts/stage-0/acr-reference/{manifest,rendered-references,repair-reference,ui-index}.json` 和 `panorama/manifest.json` 登记；SDR文件与独立读回边界另见 `sdr-output-references.json`，0.64既有回归的逐能力部分映射见 `regression-coverage.json`；最终归档身份由主线程登记。不能据参考集已产生宣布全部入口、像素或产品对齐通过。

| 证据号 | 固定对象与本次核对结果 | 能证明什么 / 不能证明什么 |
|---|---|---|
| L1 | `/Library/Application Support/Adobe/Plug-Ins/CC/File Formats/Camera Raw.plugin`；`Contents/Info.plist`：`com.adobe.CameraRaw`，`CFBundleShortVersionString=18.7 (2743)`，`CFBundleVersion=18.7f2743` | 锁定本地对照版本；不证明任何具体工具可见或可操作 |
| L2 | `Contents/Info.plist` SHA-256：`ee1fe258170cf2bbbe08b41c0e3f1ca0d026d8a9a2cbf9a93d0f69c7e8902c54`；`Contents/MacOS/Camera Raw`：306156608 字节，SHA-256 `a2d6a7f2b7269256f29a0b17883348c7ff4511b6d397636c7cf3771a8a8f61d8` | 复测前比对版本与文件身份；文件改变后不能沿用本轮版本结论 |
| L3 | `~/Library/Application Support/Adobe/CameraRaw/Defaults/Previous.xmp`：历史预捕获快照 `crs:Version=18.7`、`crs:ProcessVersion=15.4`；当时 SHA-256 `f5cb4f6105a53138cec616972a1945d51a4edc145d8fe65924d443726f38a0a8` | 只证明当时设置的字段和结构；本轮 ACR 正常 Done 已更新 last settings，旧 hash 不是当前身份，不能写“未修改”；不证明未出现参数的范围、算法或入口，不随项目分发 |
| R1 | L1 下 `Contents/Resources/zh_cn.lproj/CameraRawStrings.txt`：302857 字节；SHA-256 `9596b6126d662dda174d2b4180f0a569b7fc5e78b692edde80f64b256aee0eed`；同目录树 `en.lproj/CameraRawStrings.txt` 为 0 字节 | 仅为待核实的本地名称线索；可能包含未发布、受条件限制或其他宿主共用内容，**资源存在不等于发布功能存在**；英文资源空也不等于功能缺失 |
| U1 | 用户原附件 `codex-clipboard-90aafee7-e636-4cbb-8c9c-1405ca2cfad1.png`（654×8882，完整编辑面板）已实际查看；已归档为 `artifacts/stage-0/acr-baseline/edit-panels.png`，SHA-256 `6a905673b432c523d5decc5b49db89d7524baa714c8879dbd9cbeffd48b1fe02` | 可直接证明截图中的配置文件、光 / 颜色 / 效果、发光、曲线 / 优化饱和度 / 点曲线菜单、混色器 / 点颜色标签、三轮颜色分级、传统细节、手动光学 / 去边、校准阴影色调及六原色控件**可见**；灰显子项也仅记可见，不推断启用条件或实际响应 |
| U2 | 用户原附件 `codex-clipboard-d09acea0-338e-4ce5-a681-2fa5c836d7d7.png`（18.7 Nikon Z5II 工作台）已实际查看；已归档为 `artifacts/stage-0/acr-baseline/workbench.png`，SHA-256 `d0275bd53052d509f67746dca89b40a9f5d3b0df2593703399a70ace2431b39f` | 标题 Camera Raw 18.7、`DSC_1520.NEF - Nikon Z 5 2`、相机曝光信息、直方图、胶片 / 评分 / 网格与筛选图标、适屏 / 100%、工作流程摘要、取消 / 完成 / 打开可见；不能由未打开的图标推断全部菜单、导出格式或过滤行为 |
| U3 | `artifacts/stage-0/acr-reference/ui/` 的本机操作截图与 `*.txt`，十一份公共 TIFF / 对应 XMP、SDR AVIF / JXL / EXR 输出，以及 `panorama/` 的合并前后 DNG / 编辑后 XMP；详见下方索引与参考清单 | 分别证明实际展开的入口、限定操作和输出；AX 文本多为增量且部分捕获于灰显 / 处理中，须结合截图。只有记录了操作及输出的子项记“已实测”；控件可见不等于所有效果、参数范围、像素或 CaptRAW 产品已通过 |
| U0 | **未在 U1 / U2 / U3 显示的具体入口仍为未知 / 待核实**；下表“候选”表示取证位置，R1 / 网页均不能把它升级为已见 | 已见同面板不证明未操作子项；补证须记录 RAW 对话框 / Camera Raw Filter、输入类型、选择数量、可见控件和操作结果。U1 的处理版本 UI 为“6 版（当前）”，不能与 L3 内部 `ProcessVersion=15.4` 直接混作一个值 |
| C0 | 本次读取的工作区：`package.json=0.64.0`，0.64 安装基线为引擎 27 / 基线 4；未发布的 `packages/contracts/index.ts` 已提升为 28、可读 20–28；Git HEAD `f986556be9efbc54c22d0585f6d7694196c708bd`，**有未提交改动** | 下表是工作区代码边界，HEAD 不是待发布候选身份；不能据源码、测试文件或旧报告宣称 0.64 安装通过 |

U3 索引：以下 `ui/`、`renders/`、`cases/`、`source/`、`panorama/` 均相对 `artifacts/stage-0/acr-reference/`；均来自本次实际原生 ACR 操作，部分 AX 文本为增量。

| 取证项 | 实际证据 | 判定边界 |
|---|---|---|
| 真实输入 / 默认显影 / 曝光 | `ui/01-nef-edit.png`、`04-cr3-edit.png`、`05-raf-edit.png`、`14-chart-accepted.png`、`15-chart-exposure.png`；对应六份输入／曝光参考及三份修复参考见下表 | NEF / CR3 / RAF 的 neutral 是各相机打开时默认，含相机配置与默认锐化等，不是数学线性或全部零设置；chart 是自制数学图，非实测商业色卡。旧 `synthetic.dng` 被拒绝；新 `tests/fixtures/generators/acr-reference-fixtures.py` 的 `source/acr-chart.dng` 已被真实 ACR 接受并导出默认 / +1 EV，接受不等于受控参考修复与跨引擎语义验收完成 |
| 点颜色 / 传统蒙版 / 局部面板 | `ui/07-point-color{,-panel}.png`、`08-masking-panel.png`、`09-brush-panel.png`、`10-local-scroll-panel.png`、`12-mask-top.png`、`13-local-exposure.png`、`80`–`86` 对应 TXT / PNG | 点颜色无样本时内部参数灰显；ui/81 颜色 / 亮度 / 深度范围菜单已见，无真实深度输入。ui/82→83 双向由0切为1、对称覆盖已截图，Done 保存 `cases/nikon-bidirectional-gradient.xmp` 含 `Bidirectional=true`、`Zero2X/Y`、`FullPointDistance`；这不是局部效果像素或完整参数语义验收。ui/85 实际为局部点颜色；ui/86 为局部曲线 / 优化饱和度及锐化 / 减少杂色 / 摩尔纹 / 去边。仅 RAF 画笔局部曝光 +0.50 有固定效果输出；其 XMP `LocalExposure2012="0.125"`、`CorrectionAmount="1"` 及 Paint / Dabs 已见，不能把 UI 数值直接当 XMP 标量 |
| 配置 / Look / RAW WB | `ui/47-profile-menu.{png,txt}`、`48-profile-browser-panel.png`、`49-profile-browser-menu.{png,txt}`、`50-profile-groups-panel.png`、`51-look-profiles-panel.png`、`52-look-amount.{png,txt}`、`53-look-amount150.{png,txt}`、`54-raw-whitebalance-menu.{png,txt}` | 下拉、浏览器、导入配置和预设 / 管理配置 / list-grid、分组及 Artistic Look 已见。Artistic 01 数量100→150 后原生 Done 保存 `cases/nikon-look-artistic01-amount150.xmp`，Look Amount实际为1.5；不外推完整范围 / Look 资产解析 / 质量。RAW WB 原照 / 自动 / 日光 / 阴天 / 阴影 / 白炽灯 / 荧光灯 / 闪光灯 / 自定菜单已见，逐模式效果未验 |
| 曲线 / 混色器 / 处理版本 | `ui/55`–`60`、`63-hsl-mixer.{png,txt}`、`64-mixer-modes.{png,txt}`、`66-black-white-mixer.{png,txt}`、`67-calibration-processing.{png,txt}`、`68-processing-versions.{png,txt}` | 点 / 参数曲线已展开；Linear / Medium / Strong / Custom 预设可见，TAT 右键含参数曲线 / 点曲线 / Hue / Sat / Lum / 黑白混合（彩色时灰显）。HSL / Color 模式菜单、实际黑白八色面板、处理版本1–6菜单已见；定点拖动、预设曲线点值、版本转换 / 同值效果未验 |
| 光学 / 晕影 / 颗粒 | `ui/69`–`74`、`76-vignette-active.{png,txt}`、`77-vignette-styles.{png,txt}`、`79-grain-enabled.{png,txt}` | 手动 / 配置标签已见；启用校正后自动匹配 Sigma 35mm F1.4 DG HSM A012，扭曲 / 晕影强度各100，Default / Auto / Custom 与保存默认值入口可见。晕影−25 后样式 / 中点 / 圆度 / 羽化 / 高光启用，三样式为高光优先 / 颜色优先 / 绘画叠加；颗粒25后大小25 / 粗糙度50可用。上述操作不等于独立输出或画质通过 |
| 裁切 / 几何 / 变形 / Trim | `ui/16-panel.png`、`17-warp-panel.png`、`18-trim-panel.png` 与 `16-crop-geometry.txt`、`17-warp.txt`、`18-trim.txt` | 翻转图标、几何投影 / 垂直 / 水平 / 旋转 / 长宽比 / 缩放 / 横纵补正可见；变形“关 / 1.33 / 1.6 / 2.0”、当前 1.00 可见；Trim 提示须先收进裁剪框、按钮禁用。均无非零几何输出证明 |
| 传统修复 / 红眼 / 宠物眼 | `ui/19-panel.png`、`20-heal.png`、`22-red-eye.{png,txt}`、`23-eye-types.txt`、`24-pet-eye-full.txt`、`45-clone-stroke.{png,txt}`、`89-heal-active-xmp.{png,txt}`、`91-heal-reopened.{png,txt}`；`heal-reference-seed.json` / `repair-reference.json` | 一条原生31 Dabs连续 Clone、自动选源、羽化50 / 不透明度100，较baseline改变596像素。传统 Heal 参考由该笔画构造活动XMP种子：SpotType clone→heal、AlreadyApplied True→False，经真实ACR读取 / 渲染 / Done / 重开，输出像素相同；`cases/acr-repair-heal-active.xmp` 仅一个 SpotType=heal。`renders/acr-repair-heal.tif` 较baseline改变510像素、较Clone改变596像素。只证明构造活动设置被原生处理并保存重开，不证明GUI创建Heal或复杂场景质量；`heal_patchmatch` 不计传统 Heal 成功，GUI选源试探 `ui/90-retouch-selection-trial.{png,txt}` 未通过。红眼 / 宠物眼已切换但无效果参考；灰尘可视化实际响应仍待 |
| 工作流 / 观察 / 默认值 | `ui/21-extra-tools.txt`、`25-histogram-menu.txt`、`26-scope-panel.png`、`27-vectorscope-options.txt`、`28-preferences.txt`、`29-raw-defaults.{png,txt}`、`30-camera-defaults-overrides.txt`、`33-panorama-context-menu.txt` | 创建快照 / 预设、复制选定编辑、同步、色标 / 排序、渲染为 DNG 等菜单可见；ui/33 明确有“显示自动对焦点 / 自动对焦叠加选项…”，未展开选项或验证叠加。匹配曝光两种入口在当前条件灰显。Vectorscope 已显示，肤色线 / 红色方向菜单可见；机型覆盖复选框启用后序列号 / 创建默认设置由灰显变可用，无持久规则或效果验收 |
| 输出 | `ui/02-format-menu.{png,txt}`、`03-tiff16-options.png`、`92-openexr-sdr-input.{png,txt}`、`93-jxl-sdr-options.{png,txt}`、`94-jxl-quality-menu.{png,txt}`、`95-avif-sdr-options.{png,txt}`、`96-sdr-output-color-spaces.{png,txt}`、`97` / `98` JXL TXT / PNG | 八种格式入口与十一份TIFF16 sRGB参考已见。92实选OpenEXR，HDR输出未勾、Linear ProPhoto RGB，实际文件 `renders/acr-repair-sdr.exr` 为HALF3 / ZIP / ProPhoto D50，独立ExifTool header已核，无独立像素decoder。JXL 16位、品质1–4 / 5–7 / 8–9 / 10–12 / 无损菜单已见；AVIF为10bit SDR、HDR未勾。AVIF在ui/96显式选择sRGB后Return保存，JXL在ui/98明确sRGB，实际文件为 `renders/acr-repair-sdr-srgb.{avif,jxl}`；两者经独立imagecodecs解码：AVIF实际nclx为BT.709原色 / sRGB传递函数 / BT.601矩阵 / full；JXL为uint16 RGB，单个中性灰取样与sRGB TIFF一致（有损品质9，不是全图颜色 / 逐像素相同声明）；ui/98明确sRGB。格式过渡时曾出现UI显示P3、文件实际Linear ProPhoto，根因未确认，不归因为Adobe bug；显式sRGB样本与过渡样本分开。其他格式及Alpha / 隐私 / 凭据效果仍待阶段6 |
| 真实 RAW 全景 | `ui/31-panorama-inputs.png`、`32-panorama-selection.png`、`33-panorama-context-menu.txt`、`34-panorama-lens-warning.png`、`35-panorama-preview.{png,txt}`、`36-panorama-merged.{png,txt}`、`37-panorama-continued-edit.{png,txt}`、`38-panorama-reopened.{png,txt}`；下方 DNG / XMP | 四张真实 ARW → 独立“全景合并预览”窗口 → 球面合并 → 回会话第 5 张 → 曝光 / WB 继续编辑并 Done 保存已实测；三投影和其他选项可见，圆柱 / 透视、非零 warp、填充 / 自动设置 / 自动裁剪、取消 / 失败 / 尺寸上限均未实测 |

十一个公共 TIFF 参考的精确身份由 `rendered-references.json` 登记：均为 RGB `uint16`，Software 为 `Adobe Photoshop Camera Raw 18.7 (Macintosh)`，sRGB ICC 为 3144 字节、SHA-256 `2b3aa1645779a9e634744faf9b01e9102b0c9b88fd6deced7934df86b949af7e`；清单另含逐像素 hash、尺寸、设置及对应 `cases/*.xmp`。以下为文件 SHA-256，尺寸按宽×高：

| `renders/` 文件 | 设置 / 尺寸 | 文件 SHA-256 |
|---|---|---|
| `nikon-d850-neutral.tif` | NEF 相机默认；8256×5504 | `83d7320246d329ec312a470cea7aac3ded27e2de501846c609690ffcd492ba22` |
| `canon-r5-neutral.tif` | CR3 相机默认；8192×5464 | `f4ee526a77db2191c0613fab4cf2ca07320056939eeef7240aae78bf7e21dd35` |
| `fuji-xt4-neutral.tif` | RAF 相机默认；6240×4160 | `e0439d8417736ce58c0c67c6ad218f1409b4dce233f8078581c95c1d5cc74bd9` |
| `fuji-xt4-brush-exposure-half.tif` | RAF 画笔局部曝光 +0.50；6240×4160 | `07344d592f177bd2525051333622f88e53d9906fd13a45c083264d0fdfdb5bcc` |
| `acr-chart-neutral.tif` | 新 chart 默认；1536×1024 | `1285eb9175f5a2a1a1c43a80a7aef24a09a801ddab868735f8bde7b7cb8e44cc` |
| `acr-chart-exposure-plus-one.tif` | 新 chart 全局曝光 +1.00；1536×1024 | `d5d9a46b561b719f7a080d3347bda78a2f4a436f84483ec7e5fc03d0d76345d4` |
| `acr-repair-baseline.tif` | 已渲染纹理默认；1024×768 | `29e092d7e4e9026f4291535bdfff68efefe04bb482b470710d9cb5120072fc09` |
| `acr-repair-clone.tif` | 连续仿制 / 自动选源；1024×768 | `1aa05e8e548244896e1d32d907262c21b747a74b96fbc329e3e85b942c8a2bb8` |
| `acr-repair-heal.tif` | 构造活动Heal XMP经原生ACR渲染、Done保存并重开像素相同；1024×768 | `bfc60a8d0d03ac045c3d705159393a2ca2835990c35bb4ac153549559c523276` |

另有本机私有 Nikon Z5II ISO 32000 参考，不计入上述十一份公共清单，不公开原片或参考图；相关 UI 取证不改变其私有属性。十一份 ACR 原生 TIFF 参考与另列的 SDR 格式输出只证明限定参考已产生，尚未完成 CaptRAW 像素 / 参数语义对照、质量盲评或产品验收。

受控 RAW / 已渲染输入由 `build/qa-venv/bin/python tests/fixtures/generators/acr-reference-fixtures.py --tiff --output-dir <独立临时目录>` 复现；依赖沿用 README 的 QA 虚拟环境。`fixture-verification.json` 记录本次两份输入与 ACR 实际接受版本逐字节一致；不运行旧 `tests/fixtures/generators/synthetic.py` 覆盖既有回归金标。

全景输入来自 Stefan Chirila 的 Stony path，CC-BY-SA-4.0，出处 / 许可 / 四张 ARW 原始 hash 见 `panorama/{manifest,source-evidence}.json`；四张源图 WB 不同，本次未先统一。人工镜头无法自动选中有效 profile 的警告已接受；此次为球面、Boundary Warp=0、Fill Edges / Auto Settings / Auto Crop 全关闭。**ACR 预览是独立新窗口；旧计划要求 CaptRAW 使用独立 Electron 窗口，此路线留待后续，本轮不启动全景。** `35-panorama-preview.txt` 捕获到灰显状态，不据此认定三个投影均操作通过。 用户补充的启用状态截图已归档为 `../acr-baseline/panorama-preview.png`（身份见同目录 manifest），与本次原生合并流程交叉核对。

`panorama/stony-path-spherical-acr187.dng` 为保留的原合并快照，SHA-256 `903c53003f0db0d79547475c0dbbc1b6260a33f61f7ccecdc996bca80f90afde`。真实主图 SubIFD 为 **9660×5901、Linear Raw、16 位×3 通道，DNG 1.7.0.0**，另有同尺寸 Transparency Mask；不能误取 IFD0 缩略图的 256×156 / YCbCr。返回胶片第 5 张后全局曝光 +1.00、WB=Custom / 6500 / +3，`ui/37-panorama-continued-edit.{png,txt}` 记录可编辑界面；Done 保存后的副本为 `panorama/stony-path-spherical-acr187-edited.dng`（SHA-256 `c6bafd64811cd5441e75a526027e65eb70a21ad8d0110730543664f12ebf7c79`）及同名 `.xmp`（SHA-256 `90bb4307720f57a7e813a3b4aa3d44b4ec3f0d3eafb633a85be601c25e174f9e`），嵌入 XMP 与旁车均有上述参数及 `panorama:Transformation="Spherical"`。重开仍为 +1 EV / 6500 K / +3（ui/38）。独立 tifffile / imagecodecs 解码原始与编辑后主图及透明遮罩，像素 hash 分别一致；透明像素 2943955、实像素 54059705，见 `panorama/linear-dng-inspection.json`。这证明该 ACR 线性 DNG 能继续调节、保存和重开，不证明所有 WB / 曝光余量、接缝质量或 CaptRAW 全景已实现。

官方 primary 网页只补行为背景，历史访问日期 2026-10-29；页面后续更新不扩大本轮范围，也不替代 L1 的实际操作：

- W1：[Create panoramas](https://helpx.adobe.com/camera-raw/desktop/hdr-and-advanced-output/create-panoramas.html)，页面标记更新于 2023-11-03；普通全景的胶片选择、三种投影、Boundary Warp、Fill Edges / Auto Crop 有历史说明。本机 18.7 已由 U3 确认独立预览窗口与球面合并路径；网页中的 HDR 分支不纳入。
- W2：[Set up raw defaults](https://helpx.adobe.com/lt/camera-raw/desktop/dng-and-file-formats/acr-raw-defaults.html)，ISO 自适应段明确追溯到 12.3 / 2020-06；作为 ISO 条件插值及默认值行为参考，不证明 18.7 当前对话框位置。
- W3：[HDR Optimization](https://helpx.adobe.com/ca/camera-raw/desktop/hdr-and-advanced-output/hdr-output.html)，页面标记更新于 2026-01-13；AVIF / JPEG XL 段说明也可用于其他类型照片，仅用于避免把格式整体误排除；SDR 可用选项和输出仍须本机验证，HDR 路径暂缓。

## 历史计划：阶段 0–8 与原完成门槛

以下保留旧计划原批次与门槛，供查证历史及后续缺口；其扩展范围、固定阶段顺序与全局阻塞规则均已由页首新范围替换，不用于阻止本轮工作流施工。

| 阶段 | 批次边界 | 完成门槛 / 当前结论 |
|---|---|---|
| 0 | 0.64 收口、两项缺陷、固定蒙版夹具、Nikon HE / HE★ 重验、ACR 入口清单与参考集 | 门槛为入口 / 条件清单＋代表性可复现参考＋既有回归 / 修复 / 归档。已有十一份公共TIFF、受控输入复现、真实全景 / 继续编辑及限定SDR输出；未见入口 / 条件、几何约束条件 / 输入坐标来源、逐能力回归映射及新清单 / 归档收口仍待，阶段未完成。全参数语义、画质、全部格式和全景分支闭环在后续所属阶段验收 |
| 1 | 输入语义、普通配置 / Look、全局影调与颜色、曲线 / HSL 定点、Point Color、完整效果 / 细节 / 光学 | 控件真实响应、版本转换、保存与 ACR 对照；高感 / 肤色 / 高光 / 饱和色 / 细纹无明确画质退化 |
| 2 | 翻转 / 裁切 / 全部透视 / Trim、单图几何投影、Anamorphic desqueeze、传统画笔 / 渐变 / 范围 / 完整局部调节 | 组合几何后位置正确；投影 / desqueeze 分项验证；流量 / 密度 / 组件 / 强度 / 透明度、历史与重开一致；透明输出验证实际 Alpha |
| 3 | 连续 Heal / Clone、自动 / 重新选源、源目标管理、灰尘可视化、红眼 / 宠物眼 | 连续笔画不能用堆叠圆点代替；复杂边缘、纹理和重复图案有 ACR 对照 |
| 4 | 快照、预设 / ISO 自适应、Raw Defaults、色标 / 排序 / 子集复制 / 自动同步、匹配曝光、观察工具 | 活动图 / 可见选择 / 批目标一致；固定复制与逐图重算有明确行为；取消、失败、撤销和重启闭环 |
| 5 | 普通全景：独立 Electron 预览窗口、配准、三种投影、自动裁切、边界变形、传统边缘填充、回到会话 | 预览不嵌工作台；输出为可继续调整白平衡 / 曝光 / 颜色的线性 DNG，不能把最终显影 TIFF 改封装；覆盖低纹理、手持、接缝、失败、取消和尺寸限制 |
| 6 | SDR JPEG / TIFF / PNG / 扁平 PSD / 三类 DNG / AVIF / JXL / OpenEXR、格式与工作流选项、元数据隐私 / Content Credentials | 外部解码正确，ICC / 方向 / 尺寸 / Alpha / 元数据匹配；DNG 内容类型真实、隐私过滤完整、未知字段及原资产受保护；OpenEXR已确认非HDR基线SDR输出，仍需产品实现与独立像素读回 |
| 7 | macOS 摄影任务回放、布局 / 快捷键 / 焦点、多显示器 SDR、性能与长期稳定 | 阶段 0–6 必需项无遗漏、占位或未验证；本机约 45 MP / 2048 预览首帧 ≤5 秒、基础调节 P95 ≤1 秒、输入反馈 ≤100 ms |
| 8 | Windows / Linux 安装、显示 / 输入 / 文件系统、依赖与进程部署 | 两平台各从离线安装包完成同一任务集；编译通过不能代替操作验收 |

原计划要求固定阶段顺序、阶段 0 不扩功能及后续每阶段交付完整安装版本，现不再执行这些排期限制。继续沿用 ART + 本地核心 + Electron / React、坐标 revision、取消与迟到结果淘汰；具体新增状态须经实现确认后再进入协议文档。原计划选定的 Hugin、传统图块填充、Rawler、libjxl、MagickCore 与 c2pa-cpp 仅保留后续技术路线记录，**尚非已接入声明，也不是本轮新增任务**。

## 验证协议与源码索引

下表供当前范围内项目复用，范围外项目的协议留待后续，不构成本轮门槛。每行验证方法均继承 V0；列出的测试是可复用入口，实际执行范围见 [验收记录](ACCEPTANCE.md)，不能把测试文件存在等同于已经执行。状态“已接入 / 部分”保留历史证据限定；“缺失”指已读产品契约 / 路径未接入；“未知”指 ACR 实际能力或参数尚未取证，两者不能互换。

| 方法 | 取证要求 |
|---|---|
| V0：共同闭环 | 四类证据分开记录：①真实 GUI 控件存在、可见、可操作；②文件 / XMP 往返；③参数范围、方向、默认值与稀疏语义；④画质 / 效率。每项覆盖操作、撤销 / 重做、前后对比、保存重开、预设 / 同步、输出、取消 / 异常；隐藏且不聚焦的 E2E 检查真实界面与像素，不代替最终可见人工验收 |
| V1：输入 / 色彩 | 固定 NEF / CR3 / RAF、Nikon HE / HE★、马赛克 / 线性 DNG、已渲染图像及色卡 / 灰阶；按输入类型对照固定 18.7 的非零参数、RAW 感光点 / TIFF16 / ICC；ART 自对照只证明接入一致 |
| V2：几何 / 局部 | 几何标记、边缘、渐变和细纹，遍历裁切 / 翻转 / 粗细旋转 / 镜头 / 透视组合；独立坐标与覆盖率 oracle，1:1 / 适屏及 TIFF16 / Alpha；不能只查内存参数 |
| V3：传统修复 | 纹理 / 重复图案 / 高反差边缘、灰尘及人眼 / 宠物眼；记录笔画轨迹、来源与最终像素，比较 ACR 效果和操作耗时 |
| V4：工作流 | 混合机型 / ISO / 评分，活动图被过滤、多选 / 单选 / 无选择；固定复制与逐图重算分开；取消、部分失败、逐图历史、重启、原片哈希和输出目标一致 |
| V5：普通全景 | 固定多图组、低纹理 / 手持 / 接缝；三投影、裁切、边界变形、传统填充、失败 / 取消 / 尺寸限制；检查 DNG 线性数据、白平衡余量与会话继续编辑 |
| V6：文件 / 输出 | 独立解码器与外部软件读回；验证格式 / 位深 / 压缩 / ICC / EXIF 方向 / 尺寸 / Alpha、EXIF / IPTC / XMP 隐私及 C2PA；DNG 分感光数据、渲染、全景线性三类，不以扩展名判定 |
| V7：产品验收 | 安装候选身份与依赖 / 离线性、真实摄影任务、最小窗口、焦点 / 修饰键 / 快捷键、多显示器 SDR；同硬件 / 缓存条件测首帧、基础更新 P95、输入反馈及长期资源占用。修复 / 全景 / 导出单列耗时并可取消 |

源码路径均相对仓库根；它们证明接线边界，不证明固定 ACR 的同级质量：

- C1：`packages/contracts/index.ts`、`native/src/core.cc`、`native/src/recipe.cc`；当前 RAW 判别包含扩展名路径，输入语义未完成分类验收。`CalibrationSettings` 仅六个原色值，`LocalMask` 无局部曲线 / 分级 / 去朦胧等完整字段，`RepairSpot` 是源 / 目标圆形点，`Point` 无流量 / 密度。
- C2：`apps/desktop/src/components/Panels.tsx`、`InputProfilePanel.tsx`、`ColorGradingPanel.tsx`、`LensPanel.tsx`、`CurveEditor.tsx`；当前已有基础滑杆 / 传统细节控制，没有以资源名称补出 Glow、Point Color 或定点工具。
- C3：`apps/desktop/src/components/CropControls.tsx`、`PerspectivePanel.tsx`、`RepairPanel.tsx`、`useGuidedPerspective.ts`、`useRepairGesture.ts`；当前自定义比例只能显示已有“当前比例”，不是新建比例入口；`flipCrop` 是横竖比例切换，不是照片镜像；手动透视 UI 仅垂直 / 水平 / 旋转 / 倾斜，结构里的 aspect 等不等于已开放控件。
- C4：`apps/desktop/src/app/App.tsx`、`useWorkbench.ts`、`useComparison.ts`、`PresetsPanel.tsx`、`RatingControls.tsx`、`packages/desktop-core/src/presets/presets.ts`；预设 `apply` 当前只传一个目标，前状态为会话引用，不等于持久快照；评分与当前曝光匹配不等于图库或场景光线分析。
- C5：`packages/desktop-core/src/documents/xmp.ts`、`documents.ts`、`packages/contracts/presets.ts`、`synchronize.ts`；标准参数稀疏合并与未知结构保留均需真实 Adobe 双向样本复核。未支持的组件会整组不应用；保留 AI 结构不算接入 AI。
- C6：`apps/desktop/src/components/ExportMenu.tsx`、`packages/contracts/export-options.ts`、`packages/desktop-core/src/export/batch-export.ts`、`native/src/hdr-avif.cc`；当前格式枚举仅 jpeg / tiff / avif，AVIF UI 和编码为 **Rec.2020 / PQ HDR 12 位**，不是 SDR AVIF。无 JXL / PSD / DNG 写入路径声明；有尺寸 / USM 不等于 PPI 或介质锐化。

## 原阶段 0 收口登记（历史与待封存项）

| ID / 阶段 | 能力 | 当前状态 | 实际 UI 证据 / 待核实 | 验证方法 / 完成门槛 |
|---|---|---|---|---|
| S0-01 / 0 | 0.64 安装版与对应源码归档 | 安装包通过；源码归档见发布校验表 | DMG、签名目录和安装副本 807 文件 / 14 链接一致；ad-hoc 签名，未公证 | V7；`artifacts/acceptance-0.64/installation.json`、`release/SHA256SUMS` 和 [验收记录](ACCEPTANCE.md)；依赖许可随包 |
| S0-02 / 0 | 无裁框自由角度 XMP / 预设不丢失 | 修复；安装核心 XMP 文档专项 54 项通过 | 无框角度保留在现有 ART 扩展，活动裁框才用标准 CropAngle；不伪造 fullcrop，不宣称 Adobe 自由角度等效 | V2 + V6；SDK 三次保存读回、Presets 导入 / 导出 / 更新、Synchronizer 的非零 / 零 / 稀疏角度及裁切状态；标准 Adobe 反向修改仍待证 |
| S0-03 / 0 | 筛选后单张导出目标 | 最终安装版 13 项 ratings GUI 通过 | 过滤后活动 A 与所选 B 不同，菜单显示 B，实际输出 B 的评分及曝光；空选择禁用；批量亦回归 | V4 + V6；`installed-gui/report.json`，所选 B 的 TIFF16 与独立 compose / export 全像素一致，原片和旁车不变 |
| S0-04 / 0 | 蒙版测试自行建立固定夹具 | 最终安装版 15 项通过 | 默认确定性 1024×768 图，不依赖旧 artifacts；支持外部夹具 | V2；`mask-interaction/latest.json` 指向本次记录，画笔 / 擦除 / 径向、异步事务和保存退出保护通过；成功清理图像临时目录 |
| S0-05 / 0 | 现有安装功能 / Nikon HE、HE★ 清单重验 | 原生 29 项沙箱通过；GUI / 性能见验收记录 | 实际压缩标签 13 / 14、感光点固定参考、源哈希；覆盖六机型和已有画幅样本，不是全型号保证 | V1 + V7；`nikon-native/report.json` 禁网络 / Homebrew；安装 GUI 独立测量，不沿用 0.63 数字；NEF / CR3 / RAF 的 TIFF16 与 ART 参考一致 |
| S0-06 / 0 | 逐能力 ACR 实际入口 / 固定参考集 | U3 已补十一份公共TIFF16 sRGB、Look / 双向渐变XMP、球面线性DNG及继续编辑保存、限定SDR格式输出；**阶段0未完成** | ui/47–110使对应入口与条件补证；新chart已接受并可复现，Heal为构造活动XMP经原生处理的参考，未见入口 / 条件、几何约束条件 / 输入坐标来源、回归映射及新清单 / 归档收口仍待，详见底部 | V0；阶段0逐ID登记版本 / 宿主 / 输入 / 路径 / 截图索引及入口条件，固定代表性非零XMP / 必要输出身份并完成既有回归 / 修复 / 归档；全部参数语义 / 画质 / 格式 / 全景分支留所属阶段，四层证据不合并，私有参考留本机 |

## 既有版本进展（历史，不代表阶段验收）

截至 2026-10-28 的旧记录以用户 ACR 18.7 截图及 CaptRAW 0.63 为依据；长期完整替代目标不变，本轮交付范围以页首新范围为准，尚未满足同级替代。

0.63 进展：胶片 / 网格增加评分、拒绝和筛选，以标准 `xmp:Rating` 保存并随 JPEG / TIFF 输出，保留小数评分。元数据独立于显影，支持逐图撤销和退出保护；筛选后的多选操作只处理可见照片。颜色标签编辑、排序、自动旁车更新与完整图库仍未完成。

0.62 进展：HSL、参数曲线、现代颜色分级与原色校准支持按字段稀疏合并；导出预设不制造未指定字段。附原生配方的稀疏文档保留原配置基值，参数曲线分界在目标上检查冲突。完整旧式五项 SplitToning 按 Adobe 公开规则重置新增控件并解释。文档版本 26、读取 20–25；这些证据仍不证明 Adobe 显影算法或最终画质等效。

0.61 进展：颜色分级改用真实 Adobe 的 14 个 SplitToning / ColorGrade 字段，修正此前五个误写名称。真实 ACR 18.7 设置和 Adobe 15.1 非零预设已只读核对；旧自有 XMP 保存迁移保持参数和 TIFF16 像素，未知外来属性保留。新文档版本 25，旧 24 安装版明确拒绝；现有 20–24 可读。分级算法及完整 ACR 画质等效仍未完成。

0.60 进展：真实本机 ACR 18.7 设置暴露的 AI 基础组件丢失 / 减去转添加错误已修复，不完整组明确不应用且原结构保留。删空全部蒙版后保存重开不再恢复旧 Adobe 选区，停用状态保留；画笔接入 RDF Dabs 的 d / r 指令。尚未验证半径单位、流量、笔压、笔尖边缘与 ACR 的等效性。

0.59 进展：部分导入 Adobe `MaskGroupBasedCorrections`，线性、无旋转径向、画笔和亮度范围成为可编辑蒙版，局部亮度范围扩为 ±4 EV；原 ACR 结构保留。安装版 6 项隐藏 GUI 与 6 项包内原生检查通过，导入后的 TIFF16 / ICC 与独立核心逐像素一致。该证据来自构造 XMP；真实 ACR 蒙版侧车、完整组件和像素等效仍需验证，不能据此宣布完整 Adobe 蒙版兼容。

0.58 安装版包含 Adobe 默认的 `⌘0` 适屏、`⌘⌥0` 100%、`⌘+` / `⌘-` 缩放和 `⌘⇧A` / `⌘D` 单图选择快捷键；对应快捷键使用 `Ctrl` 组合时面向 Windows / Linux。打包前的隐藏生产 GUI 已通过，完整快捷键、焦点行为和 ACR 操作耗时仍未全部复核。

当前工作区把已有 ART 控制提升为 Adobe `crs` 标准属性，覆盖 21 个基础标量、六项红 / 绿 / 蓝原色校准、锐化细节 / 边缘蒙版、四项降噪细节、裁切后晕影羽化 / 圆度、7 个参数曲线字段、八色 HSL 的 24 个字段、颜色分级的 14 个字段、黑白转换与八色 `GrayMixer*`、六项紫 / 绿色差去边、四条点曲线，以及 `tiff:Orientation`、`HasCrop`、裁切矩形和 `CropAngle`；文档版本为 26，引擎 20–25 仍可读取，旧版本 22 / 23 的私有控制或完整组会在下次保存迁移。字段参与显影和往返不等于 ACR 同值、同色或同算法，仍需逐项画质对照。

当前工作区另接入 ACR 18.7 的“按相机设置匹配曝光”：读取 ISO、光圈、快门和曝光补偿，批量更新目标缩略图与编辑，逐图撤销且主动照片不变。它不分析场景光线，不等同于“相机设置＋光线”模式。

当前工作区加入 ACR 18.7 的多行 Grid 视图：14 图真实窗口验证多选、切换、当前照片、关闭入口、最小窗口和 `Esc` 返回胶片；评分与筛选尚未接入。

当前工作区加入直方图阴影 / 高光裁剪切换和画面覆盖，真实适屏与 1:1 已验证；使用明确的本项目 sRGB 阈值，尚不能宣称与 ACR 警告算法完全一致。

0.58 进展：安装版带入引擎 24、用户 Logo、自动天空、主体 / 背景和人物部位；真实 D850 蓝天自动蒙版与独立人工提示参考 IoU 为 **0.9971**，44 项安装版隐藏 GUI 检查及 TIFF16 通过。自动天空仍是顶部颜色 / 平滑度提示加 SAM2.1，不是 ACR 场景语义或复杂枝线画质的同级证明。

0.57 进展：引导线松手后自动求解与显影，逐次撤销；取消只丢弃未完成操作。仍未实现按住拖动期间连续求解，也未证明 ACR 数值、画质及性能同级。

0.56 当时进展：引导透视增加原分辨率放大镜、Shift+L 开关与 Option 精细拖动。仍需显式应用，实时变换和 Adobe 参数 / 画质等效尚未完成。

0.55 进展：引导透视增加 2H+1V / 1H+2V，固定 shear 为零拟合三个参数，保留原有两条 / 四条与自动路径。仍缺画线后实时变换、放大镜和 Adobe 数值 / 画质等效。

0.54 进展：引导透视支持两条同向或水平 / 垂直各两条，引导线端点编辑、删除、单步应用和 XMP 恢复。源图定位跟随当前几何；仍缺三条混合线、画线后实时变换和放大镜，未完成 ACR 引导体验等效。

0.53 进展：自动水平 / 垂直 / 联合透视使用 ART 本地直线检测和拟合，独立进程可取消、单步撤销；补齐检测失败状态并修复边框未初始化读取导致的结果漂移。受控几何与真实 RAW 进程验证不能代替 ACR 场景画质评估，引导透视及 Adobe 同值映射仍未完成。

0.52 进展：手动垂直 / 水平透视、透视旋转和倾斜接入原生处理；独立开关、复位、撤销、XMP 恢复及预设 / 同步可操作。沿用 ART 的数值语义，自动 / 引导透视、比例 / 缩放 / 偏移入口和 Adobe `crs` 映射尚未完成。

0.51 进展：新颜色样本保存源图定位点，标记与 Option 删除共用原生几何映射；旧样本颜色保持，缺少定位信息时提示重新取样。处理算法不变，完整 ACR 画质 / 交互同级仍未完成。

0.50 当时进展：范围取样接入草稿和等待结果的保存 / 退出保护，视图或编辑状态变化取消并拒绝迟到结果；原生变换后取样通过受控图核查，颜色样本标记的后续几何跟随尚未完成。

0.49 进展：已接入画线拉直，按当前镜头 / 透视映射求取水平或竖直角，支持一步撤销、Esc / 视图变化取消、保存 / 退出保护。无根不会夹角。自动水平、约束裁切、Adobe CropAngle 和完整 ACR 等效仍未完成。

0.48 当时进展：裁切模式已开放 −45° 至 45° 的手动角度、0.01° 步进与独立重置，旧 XMP 投影实际 ART 角度，蒙版参考、前后构图、预设 / 同步包含角度。画线拉直、自动水平、约束裁切和 Adobe CropAngle 尚未完成；完整同级目标未达成。

0.45 当时进展：继 0.44 空间蒙版交互后，修复取样、拖动和源 / 目标完整轮廓使用细几何变换前的原生坐标映射；未提交修复也有保存 / 退出保护。处理版本仍为 22。任意角控件、范围取样 / 对象候选联动及 Adobe CropAngle 尚未完成，不能把既有角度配置中的交互修复视为完整拉直功能。

## 目标修订：直接对齐 Adobe XMP

用户于 2026-10-27 明确要求支持并直接对齐 Adobe XMP。以 XMP / Camera Raw `crs` 命名空间作为编辑参数、旁车和预设的互操作契约；不再将 CaptRAW 私有 JSON 作为长期格式边界。用户随后明确取消旧格式兼容：直接移除旧 JSON 配方 / 预设的文件读写、兼容与迁移代码，不维护双格式。已有用户文件不自动删除。进程 JSON Lines 和内存状态不属于旧文件格式，可继续使用。

优先复用 Adobe 官方 XMP Toolkit SDK。读写须保留未知命名空间、属性、限定符、数组及嵌套蒙版结构；未出现的属性表示未指定，不能替换为零或整组默认值。`ProcessVersion`、相机配置、坐标和参数语义须按实际 ACR 18.7 样本验证。能用标准 `crs` 表达的内容直接使用它；确属 CaptRAW / ART 专有的状态才使用独立扩展，不能将整块私有 JSON 包进 XML 后宣称 Adobe 兼容。

验收覆盖 Adobe XMP 导入、显影实际响应、编辑后导出、Adobe 读取、往返未知字段保留，以及旧格式代码清除。格式无损与像素 / 操作等效分别验收；未接入的字段保留并明确列出，继续补齐，不缩减完整替代目标。0.32 已完成 XMP 文件替换的本机阶段验收：曝光、色温和四条点曲线已接入标准字段；其余 Adobe 字段保留并披露未生效，ART 专有状态使用 RDF 扩展。完整字段、Adobe 应用读取和像素等效尚未验收。

依据：[官方 SDK 与 BSD 许可](https://github.com/adobe/XMP-Toolkit-SDK)、[Camera Raw 命名空间](https://developer.adobe.com/xmp/docs/xmp-namespaces/crs/)。L3 是只读预捕获的 `Defaults/Previous.xmp` 历史设置快照，包含 `crs:Version=18.7`、`crs:ProcessVersion=15.4`；本轮 ACR 正常 Done 已更新 last settings，不能宣称当前原文件未修改或仍匹配旧 hash，不作为开源资源再分发。

“已接入”表示 CaptRAW 有真实处理和本机证据，不表示达到 ACR 的画质、算法、数值或效率。“部分”表示只能完成子集；“缺失”表示产品不能完成；“未验证”不能算支持。没有使用外部闭源程序补齐运行能力。

## 能力基线矩阵：既有实现与缺口

每行 ID 固定；阶段及回归责任保留旧计划编号，**不再代表本轮交付范围或执行顺序**。下表状态为原登记快照，不因新计划或未封存报告自动升级；新增报告见验收记录。U1 / U2 仅证明标明的控件可见；U3 仅将有操作 / 输出证据的子项记已实测，其余仍限可见或未知。U0 表示相应子项没有直接 UI 证据。后续补齐项见下一矩阵，不因未知而删项。

原计划按 ID 行登记：**134 个追踪 ID**＝阶段 0 登记 6＋B01–B51 共 51＋阶段 1–8 补齐项 76＋D01 共 1；两张能力矩阵合计 128 行。补齐项分阶段为 14 / 18 / 5 / 13 / 6 / 15 / 3 / 2；保留 S2-17 / S2-18 / S6-14 / S6-15，新增 S4-13。总数含后续暂缓 7 行（B10 / B20 / B26 / B30 / B31 / B33 / D01）及范围待核实项；既有能力与补齐子项有交叠，不能将行数当独立功能数、可见数或通过数。

| ID | 阶段 | 能力 | 当前状态 | ACR 18.7 实际 UI 证据 / 待核实 | 验证方法（均含 V0） | 实现、历史证据或剩余缺口 |
|---|---|---|---|---|---|---|
| B01 | 1 | Nikon Bayer NEF、Canon CR3、Fujifilm X-Trans RAF | 已接入，样本有限 | U2 / U3：NEF / CR3 / RAF 已实际打开并各导出默认 TIFF16 sRGB；见 ui/01、04、05 与公共参考表 | V1；按样本独立解码 / TIFF16 / 源哈希 | 固定三种真实样本与 ART CLI 同配方输出完全一致；不能推及全部机型与模式 |
| B02 | 1（0回归） | Nikon Z5II HE / HE★ | 已接入，固定样本验证 | U2 / U3：Z5II NEF 与 ISO 32000 私有参考已见；此 UI 不证明 HE / HE★ 压缩模式，私有图不公开 | V1；HE / HE★ 感光点与默认构图分开 | 公开清单中的画幅 / 比例样本全部匹配上游及独立 Adobe 感光点；用户 HE★ 文件另有解码证据。0.9 默认构图匹配相机 CropArea，保留旧配方基线；不等于 ACR 默认显影色彩 |
| B03 | 1（0回归） | 其他 Nikon HE / HE★ 机型、比例及尺寸 | 已接入，安装版固定样本重验 | U0；候选：各机型原片打开 | V1；tests/integration/platform/nikon-he.mjs、nikon-he-e2e.mjs，固定清单 | 0.64 安装核心与真实隐藏 GUI 重新通过 **29 / 29** 清单样本：禁网 / Homebrew 禁读的原生核心及包内 LibRaw 工具匹配固定上游感光点校验值；界面预览、曝光、XMP 保存和源哈希通过。0.58 另有 Adobe DNG Converter 18.0 独立未压缩 DNG 的逐感光点零差异历史证据，本批未重跑该独立转换。覆盖 Z9、Z8、Z f、Z6III、Z5II、Z50II 清单所列画幅 / 比例；不能推及全部固件、额外比例或未来相机。当前证据见 `artifacts/acceptance-0.64/nikon-{native,gui}/report.json` |
| B04 | 1 | RAW 默认有效区与相机构图裁切 | Nikon 已接入，其他品牌未验证 | U2：当前构图可见；有效区 / 相机裁切控制 U0 | V1 + V2；默认 / 清除 / 恢复与方向、TIFF16 | 读取 Nikon CropArea 并在基线 4 默认裁切；旋转 / TIFF16 / 保存恢复已测。当前只接受基线 4，旧基线 2 / 3 已移除；可清除或恢复相机构图。尺寸一致不等于 ACR 显影色彩一致 |
| B05 | 1 | 其他相机、特殊压缩、像素位移及多帧 RAW | 未验证 | U0；按固定 18.7 的机型 / 输入可用性取证 | V1；按机型 / 固件 / 压缩逐项，不由库列表扩围 | 必须按机型、压缩模式和样本逐项登记，LibRaw 名称列表不作通过证据 |
| B06 | 1 | 曝光、对比、白平衡、自然饱和度、饱和度 | 已接入，语义部分对齐 | U1 控件可见；U3：chart 默认 / 全局曝光 +1.00 输出及全景曝光 +1.00、WB6500/+3 保存已实测；对比 / 饱和度等非零仍待 | V1；white-balance-reference、xmp-partial 与真实非零输出 | 0.33 全局白平衡改为 Adobe Temperature / Tint 坐标，通过当前 DCP / 相机矩阵生成系数；50 组独立白点与三组双光源 DNG 验证。当前工作区已将五个字段保存为 Adobe `crs` 标准属性并通过导入、真实 TIFF 像素、预设局部应用与引擎 22→23 迁移，但处理仍为 ART 语义，不代表 ACR 同值同色 |
| B07 | 1 | 高光、阴影、白色、黑色 | 已接入，语义部分对齐 | U1：光的四项滑杆可见 | V1；灰阶 / 高光 RAW 与 TIFF16，检查剪裁和参数方向 | ART ToneEqualizer 五频段映射，像素变化已测；当前工作区将 `Highlights2012` / `Shadows2012` / `Whites2012` / `Blacks2012` 提升为标准字段并接入标准导入，尚无 ACR 对照画质与操作等效性验收 |
| B08 | 1 | 白平衡原照 / 自动 / 相机预设 / 吸管 | 已接入，有限验收 | U3：ui/54-raw-whitebalance-menu.{png,txt} 已展开RAW原照 / 自动 / 日光 / 阴天 / 阴影 / 白炽灯 / 荧光灯 / 闪光灯 / 自定；吸管U1可见，逐模式效果未验 | V1 + V2；white-balance、white-balance-optics-e2e | 原生 ART 精确通道系数；D850 / X-T4 实际预设与图像变化，5 / 11 / 25 像素窗口，旋转 / 裁切位置及撤销恢复。0.36 修正镜头校正后的错位，已验证受控 RGB / Bayer、Lensfun 自动 / 手动配置、畸变 / 色差开关、四方向旋转、裁切及适屏 / 1:1 点击。预设库未覆盖的机型不显示预设；更多实拍镜头、EXIF / LCP 校正和光谱仍待验收 |
| B09 | 1 | 输入配置文件、相机匹配 | 部分 | U3：ui/47–53 已展开配置下拉 / 浏览器 / 分组 / 导入和管理菜单及Artistic Look；100→150后Done保存Look Amount=1.5，资产解析与完整效果未验 | V1 + V6；input-profiles / profile-assets / profile-import-e2e | 可选随包 DCP / ICC、相机矩阵和嵌入配置；0.34 已接入外部 DCP / ICC 导入、本地库、机型检查、能力控件及 XMP 随附资产。配置资产移动后的恢复有像素证据。Adobe 名称 / digest、增强 Look 和完整配置文件浏览体验仍未对齐 |
| B10 | 后续暂缓 | ACR 全局 Auto（AI；暂缓） | 暂缓；保留现有本地直方图启发式 | U1：Auto 按钮可见；策略与可用输入 U0 | 仅维护已有功能回归；不要求本轮对齐 ACR AI Auto | 固定 ART 的 AutoExp 回调没有实际计算调用，因此 CaptRAW 使用当前真实预览 RGB 直方图，在曝光、对比度、高光、阴影、白色和黑色上计算有界增量；Canon R5 可见 GUI 验证像素变化与单步撤销。它不是 ACR Auto 的复制，ACR 全局 Auto 明确为 AI，本轮不要求其同级；现有启发式不升级为已批准的 ACR Auto |
| B11 | 1 | RGB 总曲线和 R/G/B 多点曲线 | 已接入，安装版重验 | U1 / U3：ui/55–60 点曲线、RGB / R / G / B图标、输入 / 输出及预设 / TAT菜单可见；ACR非零曲线点值与效果未验 | V1；point-curve-e2e / curve-conformance；小数往返 | 2–128 点，自然三次样条；四组曲线各 513 采样与实际 ART 映射一致。0.64 安装版重新通过 **13 项**检查：多点 0–255 编辑、513 个显示采样、数值 / 方向键 / 拖动、单步撤销、小数 XMP、重启恢复，以及 Nikon RAW 主曲线与红通道曲线 TIFF16；已有小数 XMP 不取整；报告 `artifacts/acceptance-0.64/point-curve/report.json` |
| B12 | 1 | 参数曲线、曲线直方图 | 部分 | U3：ui/58-parametric-curve.{png,txt} 参数面板、四区域 / 三分界已展开；ui/60有参数 / 点曲线TAT菜单，定点拖动与非零效果未验 | V1；parametric-curve、curve-histogram-e2e；分界与采样 | 0.14 接入 ART 原生四区域参数曲线、三个分界及核心采样绘图；当前工作区把七个参数曲线字段写入标准 XMP，旧私有组可迁移，真实 TIFF16 验证通过。0.16 显示 ART 曲线输入明度直方图；定点工具、通道独立输入分布、裁切范围统计和 ACR 等效质量验收仍缺失 |
| B13 | 4 | 直方图阴影 / 高光裁剪警告 | 已接入，有限验收 | U2 图标；U3：ui/25-histogram-menu.txt 的高光 / 阴影剪切警告入口可见；覆盖和阈值未测 | V1 + V4；histogram-clipping-e2e，记录 ACR 实际阈值 | 当前工作区显示真实预览像素覆盖：阴影三通道 ≤3 为蓝色，高光任一分量 ≥252 为红色；适屏、1:1、关闭恢复、对比禁用和最小窗口通过。阈值为本项目 sRGB 规则，未验证与 ACR 的内部矩阵和阈值同级 |
| B14 | 1 | 八色 HSL 混色器 | 已接入，部分 | U1 / U3：ui/63、64 HSL / Color模式菜单、色相 / 饱和度 / 明亮度及八色控件可见，ui/60有Hue / Sat / Lum定点入口；非零效果未验 | V1；八色样本 + xmp-partial，稀疏字段不覆盖其他值 | ART hue 轴曲线，色相 / 饱和度 / 明亮度有实际像素证据；当前工作区把 24 个 HSL 字段写入标准 XMP，0.62 已支持稀疏字段合并，旧私有组可迁移；混色器点颜色及定点调整缺失，颜色范围蒙版另列 |
| B15 | 1 | 八色黑白混色 | 已接入，有限验收 | U3：ui/66-black-white-mixer.{png,txt} 实际黑白八色面板与灰度画面已见；八色逐项非零响应 / 质量未验 | V1；black-white / black-white-e2e，颜色与灰阶对照 | 原生 HSL 与黑白转换组合；八色中心按工作色域定位，近中性色按色度加权。彩色编辑保留，独立保存恢复；RAW、颜色样本、16 位参考输出通过。当前工作区以 `ConvertToGrayscale` 和八个 `GrayMixer*` 标准字段保存和导入，ART 原生基础参数保留在私有扩展，缺组不应用且旧版本 22 私有组可迁移；尚无 ACR 画质与效率对照，不等于 Adobe 算法 |
| B16 | 1 | 颜色分级、校准 | 部分 | U1：三轮 / 视图图标 / 混合 / 平衡及校准六原色可见 | V1；color-grading-e2e、xmp-color-grading，肤色 / 饱和色 | 0.17 接入阴影 / 中间调 / 高光 / 全局色轮、明度、混合和平衡；三轮 / 单轮视图、拖动修饰键、复制粘贴、撤销和持久化均连接原生核心。0.61 以实际 SplitToning / ColorGrade 的 14 个字段读写分级并迁移版本 24 的误写字段；当前工作区将其和六个 `Red/Green/BlueHue/Saturation` 校准字段写入标准 XMP；校准直接驱动 ART `PRIMARIES_CHROMA`，GUI、同步与 TIFF16 像素已验证。处理位于 ART 黑白后；使用本项目 SDR 适配，肤色、饱和色、宽色域与 ACR 画质等效性尚未证实，按住色轮旁路和混合强度辅助预览仍缺失。见 [颜色分级证据](COLOR-GRADING.md) |
| B17 | 1 | 去朦胧、晕影、颗粒 | 已接入，部分 | U1 / U3：ui/76、77 晕影−25后子项启用及三种样式菜单已见；ui/79颗粒25后大小25 / 粗糙度50可用，未据此验收输出 / 质量；75 / 78试探不计成功 | V1；纹理 / 暗角 / 高光样本，逐项非零与缩放对照 | 真实 ART 模块且实际像素改变；当前工作区以 `Dehaze`、`PostCropVignetteAmount`、`PostCropVignetteFeather`、`PostCropVignetteRoundness`、`GrainAmount` 标准字段保存和导入。晕影羽化和圆度直接驱动 ART，并通过 GUI 与 TIFF16；晕影中点、样式、高光保护及颗粒频率 / 粗糙度仍缺失 |
| B18 | 1 | 全局纹理、清晰度 | 部分 | U1：纹理 / 清晰度可见 | V1；local / global texture、全上下文 1:1 与 TIFF16 | 0.12 接入 ART TextureBoost 两尺度、全覆盖原生处理；真实正负响应、与局部独立复位、保存恢复、全上下文 1:1 和 TIFF16 已测。中性蒙版受控 RGB8 最大舍入差 1；当前工作区以 `Texture` / `Clarity2012` 标准字段保存和导入，未完成 ACR 画质和参数等效验收 |
| B19 | 1 | 锐化与传统明亮度 / 颜色降噪 | 已接入，部分 | U1：锐化四项、传统明亮度 / 颜色降噪三项各自可见 | V1；高感 RAW / 细纹 / 假色 / 边缘；1:1 与输出 | USM 与 ART RGB 传统降噪；当前工作区以 `Sharpness`、`SharpenRadius`、`SharpenDetail`、`SharpenEdgeMasking`、`LuminanceSmoothing`、`LuminanceNoiseReductionDetail`、`LuminanceNoiseReductionContrast`、`ColorNoiseReduction`、`ColorNoiseReductionDetail`、`ColorNoiseReductionSmoothness` 标准字段保存和导入。明亮度细节直接映射 ART denoise detail；颜色细节 / 平滑度组合映射 guided chroma radius，属于近似；完整细节阈值、蒙版叠加视图、RAW 域 AI 降噪和 ACR 质量验收仍未完成 |
| B20 | 后续暂缓 | RAW 域 AI 降噪、超分辨率、增强细节 | 暂缓；既有状态为缺失 | U1：去杂色 / 原始数据详细信息 / 超分辨率可见；可用条件 U0 | 仅必要回归；AI 不计本轮完成门槛 | 没有模型随包；可修改、再分发且画质达标的模型及 RAW 适配路径仍需验证 |
| B21 | 1 | 自动镜头配置 | 部分 | U3：ui/69–72 手动 / 配置标签、启用校正后自动Sigma 35mm F1.4 DG HSM A012、扭曲 / 晕影各100及Default / Auto / Custom菜单已见；LCP导入与校正质量未验 | V1 + V2；lens-profiles、white-balance-optics；LCP / 配置强度另补 | 0.24 显示实际匹配和当前拍摄参数下可用校正，支持手动相机 / 镜头搜索选择、畸变 / 暗角 / 色差独立开关及保存 / 同步；修正 RAW 暗角刷新与适屏色差遗漏。当前工作区增加 `LensManualDistortionAmount`、镜头 `VignetteAmount` 与六项 `Defringe*` 控制，分别驱动 ART 原生手动变换、RAW 暗角和 Lab 色差边缘抑制，并通过真实 TIFF16、XMP、同步及隐藏 GUI。紫色 / 绿色窗口是 ART 近似映射；ACR LCP 导入、内置配置强度和完整参数等效仍缺失 |
| B22 | 2（0修复） | 裁切、旋转 | 部分 | U3：ui/99–110 已用自产网格实际自定义13×9、角度+7.50°，导出924×640 TIFF16；XMP CropAngle=-7.5，不能直接混用正负号。右键裁切叠加样式 / 循环 / 对齐入口已见，按本项纳入阶段2；效果待验 | V2 + V6；crop-workflow / straighten / guided-perspective；S0-02 | 自由矩形、90° 旋转及坐标保持已测；0.13 增加比例预设 / 锁定、横竖切换、八个边角控制点、框内移动、一步撤销及保存恢复。实际 TIFF16 与旧核心同配方一致；0.42 验证共享几何正反映射并修复既有 ART 旋转 / 透视配置中的白平衡取样。0.43 核心已接入带参考角的蒙版重映射并通过安装版预览 / 导出验证；0.44 增加混合参考画布的预设 / 同步与空间蒙版交互；0.48 增加手动任意角、独立重置与撤销，保存恢复和 TIFF16 已验；0.49 接入按当前几何求解的画线拉直；0.52–0.57 增加透视、引导校正与放大镜。当前工作区使用 `tiff:Orientation`、`HasCrop`、四个裁切边和 `CropAngle`，90° 坐标往返、引擎 23 迁移、六份真实 ACR 侧车读取与 TIFF16 纵向裁切通过；约束裁切、扩展画布和完整引导体验仍未完成 |
| B23 | 2 | 手动画笔、擦除、线性、径向 | 已接入，部分 | U3：ui/08、09、12、13 画笔 / 擦除 / 线性 / 径向入口，RAF画笔曝光+0.50有XMP / TIFF；ui/82→83双向已勾选、对称覆盖及Done保存XMP已见，非零渐变效果未输出验证 | V2；mask-interaction / mask-reference，绘制、移动和羽化 | 羽化、坐标、移动中心 / 端点、单笔撤销、独立保存恢复；0.44 在已有细旋转 / 光学校正 / 透视配置中按原生映射处理笔画及完整形状轮廓，排空异步输入后单步提交，切换工具 / 照片取消草稿；覆盖范围见验收记录 |
| B24 | 2（0回归） | 蒙版组与组件管理 | 已接入，安装版重验 | U3：ui/12、13 的“蒙版 1”及对应 XMP 组 / Paint 组件已见；列表全部操作与组件运算未测 | V2；mask-groups / mask-interaction-e2e，全组合 / 历史 | 创建、改名、复制、排序、隐藏、删除、组反选；组件添加 / 减去 / 相交；真实覆盖像素与独立进程读回一致。0.64 安装版 **15 项**通过画笔、橡皮擦、径向手柄、组件运算、离开蒙版模式隐藏 Guides、快捷键隔离、真实异步映射取消，以及保存 / 关闭 / 导出 / 窗口关闭 / 退出保护；最多 73 个笔画的独立坐标误差为 **0**；`artifacts/acceptance-0.64/mask-interaction/latest.json` 索引本次 `report.json` |
| B25 | 2 | 最终蒙版覆盖率显示 | 已接入，有限验收 | U3：ui/12-mask-top.png 已见真实 RAF 画笔红色叠加；覆盖率数值、全部模式与阈值未测 | V2；mask-preview / mask-overlay-e2e，实际覆盖率与像素 | 直接取得 ART 生效的组覆盖率，含添加 / 减去 / 相交、羽化与反选；量化为透明度 PNG；适屏、1:1、平移和模式切换实测。详细区按羽化扩展邻域。全尺寸、全部蒙版组合及性能仍需扩大样本验证 |
| B26 | 后续暂缓 | 天空、主体、背景、对象、人物和部位蒙版 | 暂缓；已有部分 AI 选区保留 | U3：ui/08-masking-panel.png 的主体 / 天空 / 背景 / 物体 / 人物入口可见；人物正在查找，未测试 AI 效果，仍暂缓 | 仅必要回归；AI 选区不计本轮质量验收 | 0.30 使用随包 SAM2.1 Small / ORT，框选及点击正负提示、三候选、取消、栅格提交、画笔修正与保存恢复；真实 CR3 安装版及原生覆盖 / TIFF16 一致性已测。0.46 修正当前旋转 / 光学 / 透视的候选快照和新叶子细旋转参考。当前工作区另随包 Apache-2.0 MediaPipe Selfie Multiclass 六类模型，提供面部皮肤、身体皮肤、头发、衣物、附件蒙版，真实多人公有领域人像、隐藏 GUI、XMP 重开与 TIFF16 通过；所有人物同类区域会合并，不能指定某一个体。自动主体 / 背景使用本地 Apache-2.0 U²-Net 显著物体概率；自动天空从顶部颜色与平滑度生成 SAM2.1 提示。两者支持四向粗旋转、XMP / 资产恢复和 TIFF16；真实 D850 蓝天与人工参考 IoU 为 0.9971，无天空人像明确拒绝。阴天、晚霞、树冠细枝与 ACR 边界质量仍未验证，见 [记录](SEGMENTATION.md) |
| B27 | 2 | 局部调节参数 | 部分 | U3：ui/09、10、12、13 局部亮 / 颜色 / 效果 / 分级及数量可见；ui/85实际局部点颜色（无样本灰显），ui/86局部曲线 / 优化饱和度、锐化 / 减少杂色 / 摩尔纹 / 去边可见；仅画笔曝光+0.50有固定效果输出 | V1 + V2；local-white-balance、local-tone / texture / detail，覆盖内外 | 亮度、对比、饱和度、色相，以及 ART 纹理 / 较大尺度清晰度、亮度 NLMeans / 细节参数；真实覆盖与保存恢复、16 位参考及全上下文 1:1 验证。0.10 新增原生局部色温 / 色调，零值兼容、覆盖内像素、保存恢复与 TIFF16 已测；0.11 新增局部高光 / 阴影 / 白黑，复用 ART 明暗频段、完整上下文 1:1，零值与旧版兼容；局部锐化 / 去朦胧等全集仍缺失，数值与算法不等于 ACR |
| B28 | 2 | 颜色 / 亮度 / 深度范围蒙版 | 部分 | U3：ui/81-mask-range-menu.{png,txt} 颜色 / 亮度 / 深度范围菜单已见；未有真实深度输入，范围效果及深度可用条件仍未验 | V2；color-range、luminance-range、range-transaction-e2e；深度另列 | 0.19 接入 ART Lab L* 亮度范围，上下限、两侧平滑过渡及组件运算；后续纹理 / 降噪关联原选区，覆盖、像素和持久化已测。0.20 增加全分辨率点击 / 区域取样及适屏 / 1:1 灰度亮度图；0.23 接入原生色差颜色范围：点击 / 框选区域中值、五样本并集、精细度和组件运算，取样不受局部调整影响；0.50 补齐取样操作保护，并核查变换后的原生取样位置；0.51 已接入新样本标记的源图定位及几何跟随，旧样本需重新取样建立定位；深度范围及 ACR 算法 / 画质等效仍缺失 |
| B29 | 3 | 取样修复与仿制 | 部分 | U3：ui/45原生31 Dabs连续Clone / 自动选源，较baseline改变596像素；活动XMP种子Heal经原生渲染 / Done / 重开像素相同，较baseline改变510像素、较Clone改变596像素，见heal-reference-seed.json / repair-reference.json；不是GUI创建Heal或质量通过 | V3 + V2；repair / repair-geometry-e2e；圆形点不算连续修复 | ART 圆形取样点，源 / 目标、半径 / 羽化 / 不透明度及列表管理接入；旋转、详细区域和 16 位像素验证。修复顺序竞争已修正；0.45 接入细旋转 / 透视 / 镜头校正的拾取、拖动及完整轮廓，并保留源域像素中心和原配方语义。连续画笔、自动取样及 ACR 效率 / 画质对照未完成 |
| B30 | 后续暂缓 | Adobe 标注 AI 的内容识别移除 | 暂缓；缺失 | U0；候选：Adobe 标注 AI 的内容识别移除 | AI 移除暂缓；传统灰尘可视化移至 S3-04，不能一起排除 | 不计阶段 0–8 实施；传统 Heal / Clone 和灰尘可视化仍须完成，不能以此行排除。 |
| B31 | 后续暂缓 | 反射消除、AI 深度生成、镜头模糊与散景 | 暂缓；缺失 | U1 / U2 镜头模糊灰显；U3：ui/19-panel.png 反射折叠入口可见；深度生成及实际效果未知，仍暂缓 | 仅必要回归；已有深度范围见 S2-10，生成深度不纳入 | 本地开源处理 / 模型、权重许可及质量路径仍未证实；生成式移除不在本项目范围 |
| B32 | 5 | 普通全景 | 缺失 | U3：ui/33–37 已实测四张 ARW → 独立预览窗口 → 球面线性 DNG → 会话第 5 张 → 曝光 / WB 编辑并 Done；其他分支未测 | V5；三投影 / 线性 DNG / 继续显影 / 取消，子项另列 | 没有多图传统配准 / 投影 / 合并 / 线性 DNG 会话工作流；HDR 合并和 HDR 全景另列暂缓，不与普通全景混计。 |
| B33 | 后续暂缓 | HDR 编辑、真实屏幕显示、SDR 预览、HDR 输出 | 暂缓；工作区部分接入 | U1：HDR 按钮可见；HDR 其余工作流 U0 | 仅必要 SDR 回归；HDR 显示 / 编辑 / 输出独立后续验收 | 工作区引擎 27 的真实 HDR 开关、1–4 EV 余量、扩展直方图、WebGPU 适屏 / 1:1、几何与四种对比、历史和 XMP 重启恢复通过 15 项隐藏 GUI 检查；14 项原生编辑检查、7 组区域的独立 Float32 对照。分级使用显式峰值相对域，仍未验证 ACR 等效。完整曲线 / 工具、SDR 映射、真实亮度、性能及 HDR 输出未完成；整数输出会明确拒绝高白点配置，避免静默裁剪。详见 [HDR 接入验证](HDR.md)，不以数值超白或截图替代显示验收；0.64 最终安装包的既有 HDR 回归已在验收记录登记，仍不计本轮 HDR 同级验收。 |
| B34 | 4 | 多图会话、撤销重做、初始状态对比 | 已接入，部分 | U3：ui/135完整两图并排、ui/137垂直拆分已见；其他布局 / 交换菜单未证 | V4；comparison-e2e / revision-e2e；持久快照另列 | 真实 GUI、重启恢复和故障恢复通过；0.38 新增四种前后布局、Q / Shift+Q 循环及同步适屏 / 1:1；0.41 增加打开时参考、自定义前状态、前后交换、恢复参考及 P / Option+P / Shift+P；交换连同完整 ART 配置与两侧状态单步撤销。对比沿用当前构图，参考仅保留于会话；独立参考图、默认全部设置交换、持久快照与 ACR 操作耗时对照仍未完成 |
| B35 | 4 | Grid 多图视图 | 已接入，有限验收 | U3：ui/140–142已实际展开网格、两图多选及上下文操作菜单 | V4；grid-view-e2e，14 图 / 最小窗口 / 筛选 / Esc | 当前工作区在胶片工具条提供网格切换，可滚动多行显示缩略图并保留多选、活动照片、脏标记和关闭入口；真实 14 图、最小窗口和 Esc 返回通过。0.63 已加入评分 / 拒绝 / 星级筛选；颜色标签、排序和完整 Large Shoots 工作流仍未完成 |
| B36 | 7（0回归） | 首次预览与基础调节响应 | 本机有限实测 | U2：适屏 / 100% 控件可见；耗时不可由截图证明 | V7；45 MP / 2048 预览，输入反馈 / P95 分开 | 安装版 0.64 的 29 个 Nikon HE / HE★ 真实 GUI 样本首次可见预览 P95 为 **1407 ms**，曝光提交到画面稳定 P95 为 **379 ms**，均在 5 秒 / 1 秒目标内。数据来自 M4 Pro / 48 GB 和固定缓存样本，不代表冷磁盘、蒙版 / 降噪、Windows / Linux 或与 ACR 同场景耗时；报告 `artifacts/acceptance-0.64/nikon-gui/report.json` |
| B37 | 4（0回归） | 文件关闭 / 放弃 / 取消、保存后关闭、退出保护 | 已接入 | U3：全景继续编辑后 Done 保存已实测；取消 / 退出 / 丢弃分支仍待取证 | V4；revision-e2e，保存期间再次编辑 / 系统取消 | 文件名、胶片和底栏入口；系统对话框分支自动化验证；退出可返回编辑或放弃退出 |
| B38 | 4 | 多选与调整同步 | 已接入，部分 | U3：ui/144同步对话框含分类 / 默认值 / 全选 / 全不选，取消未执行；ui/145–146连续多选曝光及两张XMP已另证，不能替代显式子集同步 | V4；synchronize-e2e，子集 / 失败 / 取消 / 逐图撤销 | 0.21 支持活动来源、⌘ 增减 / Shift 连选 / 全选及 13 类调整选择；独立核心实际缩略图、整批取消 / 失败无部分提交、逐图撤销、保存恢复已验收。当前“镜头校正”组同时同步配置文件、手动扭曲和镜头暗角，真实 CR3 / X-Trans 的目标预览与独立当前进程一致。保留各自输入配置，白平衡按色温 / 色调；源值若为近似投影则明确提示。自动多图联动和 ACR 操作耗时对照未完成 |
| B39 | 4 | 按相机设置匹配曝光 | 已接入，有限验收 | U3：ui/142两图多选后按相机设置匹配启用，相机设置和光照匹配灰显；未实际执行 | V4 + V1；match-exposure-e2e，缺 EXIF / 超限不部分提交 | 使用当前照片与目标的 ISO、光圈、快门和 EXIF 曝光补偿计算 EV 差，在目标当前编辑曝光上应用修正；真实 D850 / R5 / X-T4 验证缩略图、像素、XMP、独立撤销和源 RAW 不变。缺少元数据或超出 -5–5 EV 时整批拒绝；场景光线匹配、同场景选择和 ACR 数值画质等效尚未完成 |
| B40 | 6（0/4目标） | 批量导出 | 已接入，有限验收 | U3：ui/02、03 存储选项与 ui/33 多选菜单可见；十一份公共 TIFF16 已输出，批量执行 / 取消未测 | V4 + V6；batch-export-e2e / ratings-e2e；实际选中源 | 0.22 对选中照片逐张独立核心输出 JPEG / TIFF16 和五种 SDR 色域；点击时的快照、同名保留、逐图进度 / 错误与取消已接入。0.25 增加按每张照片裁切 / 旋转的尺寸与输出锐化；命名模板、工作流程预设和完整 ACR 效率对照仍缺失 |
| B41 | 4 | 用户预设管理 | 部分 | U3：ui/118–126完整预设面板、管理分组、收藏入口、CN01强度150及原生crs:Preset Amount1.5 / Parameters已核；ISO单选灰显、多ISO双选启用，未实际创建ISO预设 | V4 + V6；presets-e2e、xmp-partial；完整强度 / ISO另列 | 创建、分组、搜索、重命名、更新、删除、当前照片应用与一步撤销；0.32 改用 XMP 导入 / 导出，缺失字段不重置目标同组其他参数。固定栅格蒙版使用 ART RDF 扩展和配套资产。强度、悬停预览、收藏、批量直接应用、ISO 自适应及完整 Adobe 参数映射仍缺失 |
| B42 | 4 | 批量保存、评分 / 筛选 | 部分 | U3：ui/33 的星级、拒绝、色标 / 排序菜单已见；过滤条件、批量保存行为未测 | V4；ratings-e2e、批量 XMP、隐藏活动图 / 非活动单选 | 0.37“保存所选”将当前快照批量另存为 XMP，随附蒙版 / ICC / DCP，保留未知元数据与同名文件，失败可单独重试，成功项才清除未保存标记。停止完成当前文件后生效，逐图结果可见。0.63 支持评分、拒绝和星级筛选，并随显式 XMP 保存和图像导出；自动更新原有旁车、颜色标签和排序未接入，完整图库另属后续产品 |
| B43 | 6（贯穿0–8） | 无损保存、处理版本 | 已接入，部分 | U1 / U3：ui/67、68处理版本1–6菜单已见，当前6；Save Options / XMP导出与全景Done后非零设置已见；版本转换和格式无损等效未验 | V6 + V4；xmp-documents / xmp-e2e / xmp-sdk，版本拒绝与资产恢复 | 0.32 删除 JSON 文件读写和旧格式迁移，使用 XMP 标准字段及 ART RDF 扩展。开发工作区引擎 27 / 基线 4，读取 20–27；0.63 历史安装版为引擎 26，0.64 安装版为引擎 27（见验收记录），原子保存；旧版本 22 / 23 的私有可映射控制下次保存迁移为标准字段。未支持的 ART 版本拒绝。外部资产内容校验、保存恢复和失败保护通过 |
| B44 | 2 / 6 | Adobe XMP 局部蒙版导入 | 部分，有限真实设置验证 | U3：RAF 画笔 +0.50 的真实 XMP / TIFF 已生成；LocalExposure2012=0.125、CorrectionAmount=1 与 Paint/Dabs 见上文；跨产品导入 / Adobe 读回未验 | V2 + V6；xmp-mask-import-e2e，真实组语义 / Adobe 读回 | 0.60 读取 Gradient / 无旋转 CircularGradient / RDF Paint / Type=2 亮度范围及组件运算、局部标量；保留停用状态。真实 ACR 18.7 设置验证 5 组中保留 1 个完整组，其余 4 个 AI 组合整组不应用，不改写为其他选区。空私有列表优先恢复，删空不会复活旧 Adobe 蒙版。AI、深度 / 颜色范围、旋转径向、旧版容器及部分 Local 字段仍未接入；原结构保留。RDF 笔画可读不证明笔尖或边界等效 |
| B45 | 1 / 4 / 6 | ACR XMP、预设、配置文件及调整导入 | 部分 | U1 / U3：ui/21载入 / 存储设置 / XMP导出、ui/49导入配置文件和预设菜单及原生ACR XMP已见；Look / 双向渐变Done保存与构造Heal活动设置原生读回已分别记录，完整跨产品往返仍未验 | V1 + V6；真实 ACR → 本产品修改 → ACR 读回，988 包不等于生效 | 官方 SDK 接入；本机 988 / 994 Adobe 包严格往返，6 个重复属性包明确拒绝。0.33 接入 Tint；0.35 完成曲线名称和部分预设语义。当前工作区将 21 个基础标量、6 个校准字段、2 个锐化细分字段、4 个降噪细分字段、2 个裁切后晕影形状字段、7 个参数曲线字段、24 个 HSL 字段、14 个颜色分级字段、9 个黑白字段、6 个色差去边字段、四条点曲线和 7 个裁切 / 旋转字段写入标准属性；六份本机 ACR 侧车只读导入且源哈希不变。未知结构、限定符、多语言名称与原文件保护通过。完整 Adobe 蒙版、修复、配置文件、同名调色语义、Adobe 应用读取和画质等效尚未验收 |
| B46 | 6 | SDR JPEG、ICC 16 位 TIFF | 已接入，受控样本验证 | U3：ui/02 JPEG / TIFF菜单；ui/03 TIFF16 sRGB无压缩、HDR未勾选，十一份公共TIFF16已输出；JPEG本轮未导出 | V6；export-colors / output-workflow-e2e，外部 ICC / uint16 读回 | 0.18 增加五种 SDR 色域并嵌入所选 ICC，原生 / 隐藏桌面与独立输出验证。0.15 修正白平衡系数重载与 1:1 高质量刷新。14 组原生 ROI、3 组安装版全尺寸 TIFF 对应详细区域，经 RGB8 量化与 PNG 完全一致，TIFF 为 uint16 且带 sRGB ICC。0.39 移除 2048 区域截断并保持高质量刷新后的细节。0.40 为含局部明暗的预览增加与导出相同的裁切内三阶段处理及蒙版上下文；原 D850 裁切案例从最大差 5 个 8 位级值降为 0，10 组裁切 / 旋转 / 重叠蒙版及 NEF、CR3、RAF 检查通过，导出与 0.39 不变。未将全部空间滤镜或所有参数组合宣布为一致。旧配方重新导出纠正旧版错误颜色；跨显示器、更多机型与 ACR 色彩等效仍未验收 |
| B47 | 6 | SDR 多色域、输出尺寸 / 锐化 | 部分 | U2 / U3：ui/03及92–98色域 / 位深 / 尺寸 / 300ppi / 锐化可见，ui/96输出配置列表已见；显式sRGB AVIF / JXL独立解码已核，PPI / 全色域 / 缩放锐化效果未验 | V6；output-workflow-e2e，按当前裁切 / 方向逐图计算 | 0.18 支持 sRGB / Adobe RGB / ProPhoto RGB / Display P3 / Rec.2020 SDR 输出；0.25 增加原尺寸 / 长边 / 短边 / 固定边界框、不放大及原生浮点缩放后 USM 锐化。其他格式与 PPI / 介质锐化 / 自定义输出配置另列；软打样 / 色域警告的固定 ACR 入口未知，水印不自动纳入，未证明 ACR 输出画质等效 |
| B48 | 4 / 6 | 元数据读取 / 保留 / 输出策略 | 部分 | U1 / U2 曝光信息；U3：ui/03 元数据“全部”及“删除位置信息”勾选可见；隐私过滤效果 / 只读信息面板未验 | V4 + V6；读回 EXIF / IPTC / XMP / GPS / 版权；不追加完整编辑器 | EXIF 相机与曝光信息可见，0.63 支持标准 xmp:Rating 读取 / 编辑 / 保存 / 导出，源文件不改；IPTC / XMP / GPS / 版权保留与输出隐私未验收；完整 IPTC 编辑器不自动纳入 |
| B49 | 7 | ACR 布局和快捷键 | 部分 | U2 / U3 工作台、首选项布局与独立全景窗口可见；完整快捷键 / 焦点 / 跨窗交互待验 | V7；真实焦点 / 输入框 / 修饰键 / 最小窗口与任务耗时 | 右工具轨、直方图、折叠调节、底部胶片及完成 / 关闭；B/E/K/G/J/C/H/R/L/Y 等对齐官方语义；0.47 修正预览刷新期间对象入口吞点击及空格拦截按钮激活，保留临时画布平移；0.58 安装版包含 `⌘0`、`⌘⌥0`、`⌘+/-` 和 `⌘⇧A` / `⌘D`，打包前真实 1:1 与胶片条选择通过隐藏生产 GUI；完整快捷键、焦点和操作耗时对照仍待完成 |
| B50 | 7 | macOS 产品质量 | 部分 | U2：macOS 18.7 工作台可见；CaptRAW 当前包需独立验收 | V7；macOS 离线安装 / 显示管理 / 稳定性 / 签名状态 | 当前代码与交付集中于 macOS 26+ ARM64；更多硬件、签名公证、无障碍、长期稳定性未完成。Windows / Linux 独立见 S8-01 / S8-02。 |
| B51 | 0–8 | 核心独立复用 | 已接入，边界有限 | 不适用：本产品复用核心，不是 ACR UI 功能 | V1–V7；无桌面服务独立进程调用及三平台依赖部署 | C++ 库与 JSONL 进程无显示服务即可读取、预览、蒙版、处理、输出；仍有 ART CLI 的 GLib / GTK 链接依赖 |

## 能力基线矩阵：旧计划补齐项与后续状态

本表保留旧计划未完整覆盖的能力，不重复既有实现的历史结果。新增施工范围仅按页首规则判定；S3-05 红眼 / 宠物眼、S4-11–12 独立观察、S5 全景、S6 新独立格式及 S8 产品验收留待后续，S4-06 Raw Defaults 暂不完善。每行均继承 V0；“缺失”是 CaptRAW 接入状态，“未知”只指相应 ACR UI / 参数证据。截图可见不能替代非零参数样本或原生参考输出。

| ID | 阶段 | 能力 | 当前状态 / 源码边界 | ACR 18.7 实际 UI 证据 / 待核实 | 验证方法（均含 V0） |
|---|---|---|---|---|---|
| S1-01 | 1 | 马赛克 RAW / 线性 RAW / 已渲染图像的处理与白平衡语义 | 部分；C1 / C2 尚未形成三类输入完整契约与验收 | U3：NEF / CR3 / RAF、新chart DNG与已渲染纹理均已实际打开输出；全景Linear Raw已继续曝光 / WB并保存；ui/54为RAW WB菜单，三类输入全部WB语义仍待阶段1 | V1；三类输入分别测色温坐标、原照 / 自动 WB、配置与输出；不得复用错误 RAW 语义 |
| S1-02 | 1 | 普通配置 / Look 完整导入与解析 | 部分；基础 DCP / ICC 已有，C1 / C5 无完整 Adobe Look / digest 解析 | U3：ui/47–53配置 / Look浏览、ui/49导入配置文件和预设菜单已见；Artistic 01经Done保存Look Amount=1.5；导入执行、digest / Look资产解析与完整效果未验 | V1 + V6；真实 DCP / ICC / XMP Look、相机限制、移动资产后重开；不按名称猜配 |
| S1-03 | 1 | 配置文件浏览与强度 | 部分；C2 有列表 / 基础开关，完整浏览器与强度缺失 | U3：ui/47下拉、48浏览器、49 list / grid与导入 / 管理、50分组、51 Artistic Look、52数量100、53数量150；Done保存cases/nikon-look-artistic01-amount150.xmp实际Look Amount=1.5；全范围 / 质量未验 | V1 + V4；缩略图、筛选、强度范围和默认值逐项对照，保存 / 同步 / 输出一致 |
| S1-04 | 1 | 曲线定点调整 | 缺失；C2 只有曲线编辑和直方图 | U3：ui/55–60点 / 参数曲线与TAT右键两种曲线入口已见；实际定点命中 / 拖动 / 修饰键 / 非零输出未验 | V1 + V2；灰阶 / RGB 定点拖动、焦点、撤销与非零曲线输出 |
| S1-05 | 1 | 曲线预设 | 部分；C5 可解释部分名称，C2 缺完整选择体验 | U3：ui/56-curve-presets.{png,txt} 线性 / 中对比度 / 强对比度 / 自定（Linear / Medium / Strong / Custom）已见；各预设点值 / 非零效果未验 | V1 + V6；各实际预设名称 / 点序列 / 参数曲线切换、重开与 TIFF16 |
| S1-06 | 1 | 曲线优化饱和度 | 缺失；C1 / C2 无对应全局控制 | U1 曲线下“优化饱和度 100”可见 | V1；灰阶 / 饱和色的端点和中间值、默认值、曲线联动；不凭同名 Local 字段代替 |
| S1-07 | 1 | HSL 定点调整 | 缺失；C2 为八色滑杆 | U3：ui/60-targeted-adjustment-menu.{png,txt} Hue / Sat / Lum入口已见，黑白混合在彩色时灰显；ui/63、64 HSL / Color菜单已见，定点命中 / 拖动效果未验 | V1 + V2；颜色命中、跨色段拖动、三模式、撤销与真实像素 |
| S1-08 | 1 | Point Color | 缺失；C1 / C2 无全局点颜色模型 | U3：ui/07-point-color-panel.png 内部取样器、色相 / 饱和度 / 明亮度 / 变量 / 范围可见，未取样时灰显；非零样本与效果未测 | V1；非零样本、颜色范围 / 精细度、多个样本及输出；不能用局部颜色范围蒙版冒充 |
| S1-09 | 1 | 校准阴影色调 / 处理版本转换 | 部分；C1 只有六原色，阴影色调缺失；版本已有保存契约 | U1 / U3：ui/67、68 阴影色调与处理版本1 / 2 / 3 / 4 / 5 / 6（当前）菜单已见；转换、内部ProcessVersion映射与效果未验 | V1 + V6；灰阶偏色、六原色独立响应；UI 版本与 L3 内部版本分别记录 |
| S1-10 | 1 | 完整颗粒：数量 / 大小 / 粗糙度 | 部分；C1 / C2 仅数量 | U3：ui/79-grain-enabled.{png,txt} 颗粒数量25后大小25 / 粗糙度50启用；75 / 78错控件试探不计证，三参数独立输出 / 质量未验 | V1；1:1 与不同输出尺寸、三参数非零及撤销 / 重开，细纹盲评 |
| S1-11 | 1 | 完整裁切后晕影：样式 / 中点 / 圆度 / 羽化 / 高光 | 部分；C1 / C2 已有数量 / 圆度 / 羽化，其余缺失 | U3：ui/76晕影−25后样式 / 中点 / 圆度 / 羽化 / 高光启用；ui/77菜单高光优先 / 颜色优先 / 绘画叠加已见；75错控件试探不计证，逐参数效果 / 输出未验 | V1 + V2；不同裁切 / 高光 / 样式，边缘渐变及 XMP / 预设恢复 |
| S1-12 | 1 | 全局 Glow | 缺失；C1 / C2 无处理契约 / 控件 | **U1 “发光 0”控制可见**；展开内容及交互待取证，不能只引 R1 | V1；固定 18.7 非零设置、子控件、肤色 / 高光 / 边缘质量和输出 |
| S1-13 | 1 | 完整光学参数 / LCP / 配置校正强度 / 暗角中点 | 部分；C1 / C2 的 Lensfun / 手动控制不覆盖全部 | U1 / U3：ui/69–72手动 / 配置标签，启用后Sigma 35mm F1.4 DG HSM A012自动匹配、扭曲 / 晕影各100，Default / Auto / Custom及保存默认值已见；LCP导入 / 范围 / 非零校正输出未验 | V1 + V2 + V6；真实镜头 / 焦段 / 光圈、LCP 与强度分项，畸变 / 暗角 / 去边及取样坐标 |
| S1-14 | 1 | 传统锐化 / 降噪完整语义与辅助预览 | 部分；已有字段存在近似映射，不证明 ACR 质量 | U1 传统参数可见；修饰键边缘蒙版 / 辅助显示 U0 | V1；高感、细纹、假色 / 光晕、100% 对照与输出，记录近似范围，不含 AI 去杂色 |
| S2-01 | 2 | 水平 / 垂直翻转 | 缺失；C1 方向只接粗旋转，镜像 XMP 会提示未应用 | U3：ui/16-panel.png 的水平 / 垂直翻转图标已见；实际镜像输出及坐标未测 | V2 + V6；四种镜像方向及非对称标记、样本 / 蒙版 / 修复坐标、Adobe 往返 |
| S2-02 | 2 | 新建 / 管理自定义比例 | 缺失；C3 只能显示已有当前比例；横竖比例切换不是镜像 | U3：ui/103–107 自定义两数输入、13×9应用及菜单保留已见；持久管理待验 | V2；自定义值 / 横竖切换 / 锁定与边角拖动、重开 / 同步 |
| S2-03 | 2 | 约束裁切 | 缺失；现有手动裁框不等同自动约束 | U1：ui/108 / 110无透视的0° / 7.5°灰显；ui/112垂直透视+20后启用，ui/113记录点击后裁框；完整边界语义待验 | V2；透视 / 旋转 / 镜头组合后的有效边界与实际输出尺寸 |
| S2-04 | 2 | 全部手动透视：比例 / 缩放 / X、Y 偏移等 | 部分；C3 UI 仅四参数，类型有 aspect 也不能算完整入口 | U3：ui/16-panel.png 的垂直 / 水平 / 旋转 / 长宽比 / 缩放 / 横向补正 / 纵向补正可见；投影另列 S2-18，范围 / 非零效果未测 | V2；逐参数标记网格、坐标正反映射、裁切 / 保存 / 同步与输出 |
| S2-05 | 2 | 完整 Upright | 部分；C3 有自动水平 / 垂直 / 联合和引导，不等于 ACR 模式全集 | U3：ui/16-panel.png 的 Upright 模式图标组已见；各模式名称 / 求解效果 / 失败条件未测 | V2；逐模式、检测失败 / 取消、建筑 / 低纹理与参考质量，不能推测模式名 |
| S2-06 | 2 | 连续引导反馈 / 放大镜 / 精细拖动 | 部分；C3 放大镜 / 松手求解已有，拖动期间连续求解未完成 | U0；候选：引导透视与放大镜 | V2 + V7；2 / 3 / 4 引导线、按住拖动、迟到结果、取消、逐步撤销及耗时 |
| S2-07 | 2 | Trim / 透明边界与 Alpha | 缺失；C1 / C6 尚无完整编辑 / 透明输出闭环 | U3：ui/18及99–110可见Trim面板，内缩裁框后按钮可用；右键明确“Trim and Expand (Render to DNG)”。只证明入口 / 条件，执行、DNG与Alpha未测 | V2 + V6；透明覆盖率与颜色分开；裁切 / 变换后独立读取 Alpha，不能用黑边或白边代替 |
| S2-08 | 2 | 画笔流量 / 密度 / 笔尖完整语义 | 缺失；C1 Point 无流量 / 密度，现有半径 / 羽化不代替 | U3：ui/09-brush-panel.png 的大小3 / 羽化63 / 流动100 / 浓度100可见；实际画笔样本已有，累积 / 笔压 / 范围语义未测 | V2；重复涂抹、擦除、笔压 / 采样与覆盖累积、单笔历史和重开 |
| S2-09 | 2 | 传统 Auto Mask / 双向渐变 | 缺失；C1 / C2 现有普通画笔 / 线性渐变未覆盖 | U3：ui/09、12、13自动蒙版未勾，效果未测；ui/82→83双向复选框0→1且实际对称覆盖，Done保存cases/nikon-bidirectional-gradient.xmp含Bidirectional=true、Zero2X/Y、FullPointDistance；像素效果 / 全语义仍待 | V2；颜色边缘 / 连通限制、双侧方向 / 中心 / 羽化，XMP / 预设恢复 |
| S2-10 | 2 | 已有深度数据的范围选择 | 缺失；C1 无 depth 类型，C5 Type=3 明确不应用 | U3：ui/81颜色 / 亮度 / 深度范围菜单明确可见；尚无真实深度输入，深度控件 / 可用条件 / 非零响应仍未核；不以U1模糊深度图替代 | V2 + V6；有 / 无深度输入、范围 / 过渡 / 单位和资产保留；禁止生成 AI 深度补齐 |
| S2-11 | 2 | 完整蒙版管理、整体强度与透明度语义 | 部分；B24 有组 / 组件管理，整体强度和完整面板语义未齐 | U3：ui/12、13 蒙版1、数量100、红色覆盖已见；完整管理、整体强度响应与处理透明度未测 | V2；增减相交、隐藏 / 反选 / 排序 / 复制、全部 / 单组强度、覆盖显示与处理透明度分开验证 |
| S2-12 | 2 | 局部曲线与优化饱和度 | 缺失；C1 LocalMask 未建完整曲线，C5 LocalCurveRefineSaturation 未等价应用 | U3：ui/86-local-detail-panel.png实际局部RGB / R / G / B曲线、输入 / 输出、点曲线预设及优化饱和度可见；优化饱和度当前灰显，非零效果未验；ui/85实际为局部点颜色 | V1 + V2；局部非零曲线、覆盖内外、重叠与整体强度、XMP / TIFF16 |
| S2-13 | 2 | 局部颜色分级 | 缺失；C1 无完整局部分级契约；旧 LocalToning 属性不等于四色轮 | U3：ui/10-local-scroll-panel.png 局部“颜色分级”及视图图标可见；完整参数 / 非零样本 / 处理顺序未测 | V1 + V2；真实 18.7 非零样本、颜色语义与处理顺序；只实现实际基线 |
| S2-14 | 2 | 局部去朦胧 / 锐化 | 缺失；C5 对 LocalDehaze / LocalSharpness 提示未等价应用 | U3：ui/10局部去朦胧、ui/86-local-detail-panel.png局部锐化程度已见；非零响应 / 独立输出未验，不能由零值推断效果 | V1 + V2；正负 / 零值、边缘 / 高光、全上下文 1:1 与导出 |
| S2-15 | 2 | 局部摩尔纹 / 去边 | 缺失；C5 LocalMoire / LocalDefringe 未应用 | U3：ui/86-local-detail-panel.png及对应86-local-detail-bottom.txt的局部细节 / 摩尔纹（波纹去除）/ 去边已见且为0；非零效果 / 质量未验 | V1 + V2；织物 / 假色 / 紫绿边样本与跨边缘蒙版，比较损伤和保色 |
| S2-16 | 2 | 局部颗粒 / Glow | 缺失；C1 无对应完整状态，LocalGrain 未应用 | U3：ui/10-local-scroll-panel.png 局部颗粒 / 发光均为0且可见；展开子项 / 非零效果未测 | V1 + V2；先取实际非零样本与参数，再测覆盖 / 缩放 / TIFF16；未知不伪造控件 |
| S2-17 | 2 | Anamorphic desqueeze / 变形 | 待接入 / 验收；需独立参数、几何组合与保存契约 | U3：ui/17-warp-panel.png“关 / 1.33 / 1.6 / 2.0”及当前倍率1.00可见；未应用非零变形 | V2 + V6；固定非对称网格 / 实拍，倍率 / 方向 / 范围、裁切 / 蒙版 / 修复坐标、重开 / 同步 / 输出逐项对照 |
| S2-18 | 2 | 单图几何投影 | 待接入 / 验收；与 S2-04 手动透视及 S5-02 全景投影独立追踪 | U3：ui/16-panel.png 几何“投影0”滑杆可见；范围、非零值及投影语义未知，不推定为全景三投影 | V2 + V6；实际非零设置 / XMP / 标记网格输出，检查与透视 / desqueeze / 裁切的处理顺序及坐标 |
| S3-01 | 3 | 连续 Heal / Clone | 缺失；C1 RepairSpot / C3 UI 为单个源目标圆点 | U3：ui/45原生31 Dabs连续Clone已有XMP / TIFF；同笔画构造活动Heal XMP（clone→heal、AlreadyApplied=False）经ACR渲染 / Done / 重开输出像素相同，active XMP仅一个SpotType=heal；不是GUI创建Heal通过；87 / 88已删除，ui/90-retouch-selection-trial仍待GUI修复工作流验收 | V3；连续轨迹 / 取样关系、羽化 / 不透明度、1:1 与导出，不能展开为独立点冒充 |
| S3-02 | 3 | 自动选源 / 重新搜索来源 | 缺失；C3 为手动取样 | U3：ui/45与Clone XMP已有SourceState=sourceAutoComputed和实际输出；Heal种子沿用此来源后经原生处理，不证明GUI重新选源；刷新 / 重新搜索来源入口仍U0 | V3；纹理 / 重复图案、排除目标、重新搜索与取消；不调用 AI 内容识别移除 |
| S3-03 | 3 | 连续修复的手动改源 / 源目标移动与管理 | 部分；B29 点列表可改源 / 移动，连续笔画关系未接入 | U0；候选：传统修复叠加 / 来源控制 | V3 + V2；先前修复依赖、排序 / 删除 / 停用、几何变化与历史、XMP 往返 |
| S3-04 | 3 | 灰尘可视化 | 缺失；与 AI 自动灰尘移除严格分项 | U3：ui/19、20“使位置可见”复选框及阈值条可见；与灰尘可视化的实际显示 / 阈值语义待测，不与 AI 污点移除混同 | V3；亮 / 暗背景、阈值、缩放、叠加开关不改输出；确认实际基线交互 |
| S3-05 | 3 | 红眼 / 宠物眼 | 缺失；C1 / C3 无对应工具 | U3：ui/22–24 红眼 / 宠物眼已切换；红眼自动 / 两个50值、宠物眼自动禁用 / 添加反射光可见；效果参考缺失 | V3；人 / 宠物闪光眼、瞳孔 / 高光、误检失败、撤销 / 重开 / 输出 |
| S4-01 | 4 | 持久快照 | 缺失；C4 before / opened 仅会话参考 | U3：ui/21-extra-tools.txt“创建快照…”可见，“应用快照”灰显；命名 / 持久化与重开未测 | V4 + V6；命名 / 更新 / 删除、完整配置和资产、重启、交换 / 撤销与 XMP |
| S4-02 | 4 | 预设强度 | 缺失；C4 / C5 无强度契约 | U3：ui/122–123传统CN01的数量100→150真实响应，原生保存crs:Preset Amount1.5及Parameters；零 / 全范围 / 不可缩放项待验 | V4 + V1；零 / 默认 / 极值、可缩放与不可缩放项、保存 / 同步 |
| S4-03 | 4 | 预设悬停预览 / 收藏 | 缺失；C4 只有显式应用和搜索 / 分组管理 | U3：ui/121已展开传统预设“添加到收藏夹”；未改变收藏，悬停预览与重启持久化仍未验 | V4；不提交历史的临时预览、移出 / 切图 / 取消、收藏重启恢复 |
| S4-04 | 4 | 预设多图直接应用 | 缺失；C4 / C5 apply 目标数组当前仅一张 | U0；候选：胶片多选后应用预设 | V4；可见目标 / 活动图一致、稀疏合并、失败 / 取消、逐图撤销 |
| S4-05 | 4 | ISO 自适应预设 | 缺失；PresetDocument 无 ISO 控制节点 / 插值路径 | U3：ui/124单选时创建ISO自适应预设灰显；ui/125–126选CanonISO100与NikonISO64后启用且默认勾选。未创建，不推断插值 / 同ISO / 缺ISO行为 | V4 + V1；至少两个 ISO 锚点、区间 / 边界 / 同 ISO / 缺 ISO，逐图计算而非复制；真实 XMP 往返 |
| S4-06 | 4 | Raw Defaults：全局 / 机型 / 序列号 | 缺失；已有默认配方不是用户可配置规则 | U3：ui/28–30 Raw Defaults 全局 / 机型覆盖 / 序列号 / 创建默认设置可见；启用机型覆盖后后三项可用，无持久规则创建 / 优先级效果验证 | V4 + V6；规则优先级、同机型不同序列号、ISO 预设、重置与移机资产；机型元数据缺失明确处理 |
| S4-07 | 4 | 颜色标签 / 完整基线筛选 / 排序 | 部分；C4 只有评分 / 拒绝 / 星级筛选，色标 / 排序缺失 | U3：ui/33 色标“选择 / 附议 / 已批准 / 审阅 / 待办事宜”、排序“拍摄日期 / 文件名 / 星级评定 / 色标”可见；ui/127筛选栏有星级 / 色标 / 状态图标与日期 / 文字 / 相机 / 镜头，ui/128相机菜单两型号及计数可见；全集行为未测 | V4；原索引 / 显示顺序、隐藏活动图、范围选中和批目标、保存 / 重启 |
| S4-08 | 4 | 复制粘贴调整子集 | 部分；已有选择组同步，独立复制 / 粘贴工作流缺失 | U3：ui/21、33 复制编辑 / 复制选定编辑 / 粘贴入口可见；ui/115–116复制子集对话框与分类选择已见；粘贴子集及稀疏值执行未测 | V4；字段子集与稀疏 / 空值、跨图保存与撤销，不以同步对话框替代完整工作流 |
| S4-09 | 4 | 自动同步 | 缺失；C4 显式批同步不等于多图持续联动 | U3：ui/140–146网格两图多选，曝光+0.50→+0.75连续作用于两缩略图，Open后两张XMP均为Exposure2012=+0.75，各自原照WB保留；未见独立Auto Sync开关，不推及所有字段 / 历史 / 失败语义 | V4；连续编辑、逐图重算 / 固定复制、处理中切图 / 筛选 / 取消与失败、各图历史 |
| S4-10 | 4 | 只读信息面板 | 部分；C4 顶栏展示少量信息，没有完整基线面板 | U3：ui/129多选显示混合值，ui/130单图展开相机 / 镜头 / 尺寸 / 文件大小 / 日期 / 文件名 / 创建程序 / 版权及Content Credentials状态；非完整IPTC编辑器 | V4；缺元数据 / 方向 / 文件身份、只读保护；不扩为完整 IPTC 编辑器 |
| S4-11 | 4 | 独立颜色取样与观察读数 | 部分；现有颜色范围取样服务于蒙版，不等于独立颜色取样器 | U3：ui/25“显示 Lab 颜色值”入口、ui/26-scope-panel.png RGB 读数可见；ui/147实际S工具、两个编号点及RGB读数已见；取样窗口 / 色域 / 坐标跟随与持久化未验 | V1 + V2 + V4；取样窗口 / 坐标 / 色域 / 几何跟随、重开，不能拿蒙版样本冒充 |
| S4-12 | 4 | Vectorscope | 缺失；C4 只有 RGB 直方图 | U3：ui/25–27 显示矢量范围已执行，ui/26-scope-panel.png 有实际图形；肤色指示器 / 红色3点钟方向菜单可见，数值 / 响应未验 | V1 + V4；先确认 18.7 可见入口，再测颜色方向 / 图像与蒙版范围 / 色域 / 更新耗时 |
| S4-13 | 4 | 自动对焦点显示 / 叠加选项 | 待接入 / 验收；不以已有蒙版覆盖代替AF点显示 | U3：ui/142两入口及ui/143独立选项窗口，颜色 / 亮度 / 不透明度 / 粗细可见；取消未改变设置，支持输入与实际AF点叠加未验 | V4 + V2；读取真实AF元数据，核对输入可用条件、点位 / 方向 / 几何跟随、叠加开关和选项，确认不改导出像素 |
| S5-01 | 5 | 普通全景多图预览 / 传统配准 | 缺失；C1 / C4 无合并会话契约 | U3：四张真实 ARW 从胶片菜单进入独立“全景合并预览”窗口并实际合并；ui/31–37；低纹理 / 配准质量及 CaptRAW 实现未验 | V5；输入顺序 / 低纹理 / 手持、预览与最终几何一致；依赖固定且不含模型辅助 |
| S5-02 | 5 | 球面 / 圆柱 / 透视投影 | 缺失 | U3：ui/35 三投影可见，捕获时灰显；球面已有 DNG / Spherical 标签，圆柱 / 透视未执行 | V5；三个投影各验宽幅 / 建筑 / 多行，参数语义、失效输入与输出 |
| S5-03 | 5 | 全景 Auto Crop / Boundary Warp | 缺失；不等于单图自动透视或裁切 | U3：ui/35 Boundary Warp=0、自动裁剪未勾选可见，零变形 / 不裁剪球面输出已产生；非零变形与自动裁剪未测 | V5 + V2；0 / 中间 / 最大变形、透明边界、裁切尺寸和接缝质量 |
| S5-04 | 5 | 传统全景边缘填充 | 缺失；批准采用传统图块匹配 | U3：ui/35“填充边缘”可见且关闭，本次未填充；效果与算法 / AI 分类未实测，批准的传统实现路径不变 | V5；纹理 / 重复图案 / 透明洞、与裁切 / 变形组合；实际取证后保持非 AI 路径 |
| S5-05 | 5 | 线性 DNG / 合并结果回会话继续显影 | 缺失；没有 Hugin → 线性数据 → DNG → 会话闭环 | U3：ui/36–38 返回第5张并保存重开；原合并及 edited DNG 为9660×5901 Linear Raw 16位3通道 / DNG1.7；曝光+1、WB6500/+3 后 Done，DNG嵌入设置 / XMP已核 | V5 + V6；检查 DNG 标签 / 线性数据 / 元数据、WB 和曝光余量；不能重封装最终 TIFF |
| S5-06 | 5 | 全景取消 / 部分失败 / 尺寸限制 | 缺失 | U3：ui/35 取消 / 合并按钮在捕获时灰显；成功单组已测，取消 / 部分失败 / 尺寸上限仍未知 | V5 + V7；取消清理临时资源、原图不变、失败可恢复，超限有实际门槛与耗时 |
| S6-01 | 6 | JPEG / TIFF 完整格式选项 | 部分；C6 固定现有编码路径，没有完整质量 / 压缩 UI | U3：ui/02 JPEG / TIFF 格式菜单已见；ui/03 TIFF 无压缩 / 16位 / sRGB 可见且已输出；JPEG质量、其他压缩 / 位深组合未测 | V6；逐个实际质量 / 位深 / 压缩选项，外部解码与 ICC / 尺寸 |
| S6-02 | 6 | 扁平 PSD | 缺失；C6 格式枚举 / 编码未接入 | U3：ui/02-format-menu.txt“Photoshop”格式可见；扁平编码 / 位深选项及实际输出未验 | V6；限定扁平编码，独立读取合成像素 / 位深 / ICC / Alpha / 元数据；不扩为图层合成 |
| S6-03 | 6 | 保留感光数据的 DNG | 缺失；DNG 输入解码不证明 DNG 输出 | U3：ui/02“数字负片”、ui/21 另存为DNG入口可见；马赛克保留 / 压缩选项与输出未测 | V6 + V1；感光点 / CFA / 黑白电平 / 相机矩阵、元数据 / 资产和独立 RAW 读回 |
| S6-04 | 6 | 渲染为 DNG | 缺失；C6 无写入路径 | U3：ui/21、33“渲染为 DNG”入口可见；未执行，不与已生成的全景线性 DNG混计 | V6；明确已渲染 / 非马赛克类型、色彩 / 白平衡含义；不宣称保留感光数据 |
| S6-05 | 6（依赖5） | 全景线性 DNG 文件互操作 | 缺失；S5-05 产生数据后本阶段收口文件选项 | U3：球面原合并 / edited DNG 标签及嵌入XMP、继续编辑后的旁车已核；跨软件解码 / 白平衡余量未验 | V6 + V5；外部软件读回线性数据、方向 / ICC 或相机颜色描述、可继续显影 |
| S6-06 | 6 | **SDR AVIF** | **缺失**；C6 已有 AVIF 只支持 Rec.2020 / PQ HDR 12 位 | U3：ui/95实选AVIF，10bit / HDR输出未勾；ui/96选择sRGB后Return保存renders/acr-repair-sdr-srgb.avif，实际nclx=BT.709原色 / sRGB transfer / BT.601矩阵 / full，经独立imagecodecs解码；过渡时UI P3 / 文件Linear ProPhoto的根因未确认，全部选项 / 质量仍待 | V6；真实 SDR 传递函数 / 色度 / 位深 / 压缩 / ICC、外部解码，不以现有 HDR 编码通过代替 |
| S6-07 | 6 | **SDR JPEG XL** | 缺失；C6 无 jxl 格式契约 / 编码 | U3：ui/93、94 JXL 16位、品质1–4 / 5–7 / 8–9 / 10–12 / 无损菜单；ui/98明确sRGB，renders/acr-repair-sdr-srgb.jxl经独立imagecodecs解码为uint16 RGB、单个中性灰取样与sRGB TIFF一致（有损9，非全图颜色 / 逐像素零差异）；无损 / 全选项效果未验 | V6；libjxl 固定源码、无损 / 有损与位深 / ICC / Alpha / 元数据，外部解码 |
| S6-08 | 6 | 尺寸方式 / PPI / 自定义 SDR 输出配置 | 部分；现有四种尺寸方式、五色域，PPI 与完整配置缺失 | U3：ui/03、92–98尺寸 / 不放大 / 像素 / 300ppi可见，ui/96含本机输出ICC列表；显式sRGB AVIF / JXL文件已核，其他ICC / 尺寸 / PPI响应未验 | V6；像素 / 长短边 / 边界框 / 不放大 / 分辨率各自语义，逐图裁切后尺寸与独立读取 |
| S6-09 | 6 | 介质锐化预设 | 缺失；C6 缩放后自定 USM 数量 / 半径不是屏幕 / 纸张策略 | U3：ui/03 输出锐化开关及介质 / 数量当前项可见，关闭时灰显；具体列表与不同介质效果未测 | V6 + V1；逐介质 / 强度和尺寸组合、细纹 / 光晕质量，不据名称猜核 |
| S6-10 | 6 | 命名模板 / 工作流程预设 | 缺失；C6 固定后缀 / 自动编号不等于模板 | U3：ui/03 预设下拉 / 文档名称组合字段 / 起始编号 / 扩展名已见；模板列表、编号 / 冲突 / 预设保存未测 | V4 + V6；多图计数 / 冲突保留 / 非法路径边界 / 预设重开及取消 |
| S6-11 | 6 | 既有元数据贯通 / 输出隐私策略 | 部分；C5 / C6 评级与部分元数据已有，完整过滤缺失 | U3：ui/03 元数据“全部” / 删除位置信息勾选已见；其他策略 / GPS实测过滤和未知字段保留未验 | V6；EXIF / IPTC / XMP / GPS / 版权逐项保留 / 过滤、嵌入旁车冲突与未知结构、原片哈希 |
| S6-12 | 6 | Content Credentials | 缺失；现有 XMP 保留不是签名凭据创建 / 验证 | U3：ui/03 Content Credentials 应用 / 云存储方法及包含信息灰显可见；启用条件、本地签名 / 云能力 / 输出未验 | V6；确认实际基线后 c2pa-cpp 本地写入 / 独立验证、编辑链 / 隐私；不据资源启用云发布 |
| S6-13 | 6 | 工作流程软打样 / 独立色域警告范围判定 | 软打样入口已确认、产品缺失；独立色域警告未知 | U3：ui/154固定18.7工作流程首选项已见意图字段及模拟纸墨；当前Rec.2020下不可用，ICC启用与效果未验。独立色域警告仍无入口证据，剪切警告不能替代 | V1 / V6；ICC配置、意图、纸墨模拟、SDR屏幕与输出区别；独立色域警告先核实固定18.7与宿主，不按其他产品印象追加 |
| S6-14 | 6 | SDR PNG 输出 | 待接入 / 验收；纳入阶段6，不能以预览PNG替代用户导出 | U3：ui/02-format-menu.{png,txt} 的 PNG 格式已见；实际位深 / ICC / Alpha / 元数据选项及输出未验 | V6；核实本机SDR选项后外部解码，检查像素 / 色彩 / 透明度 / 尺寸 / 隐私与批量取消 |
| S6-15 | 6 | SDR OpenEXR 输出 | 待实现 / 验收；已确认属于本轮非HDR基线SDR，不能继续标为范围未知 | U3：ui/92-openexr-sdr-input.{png,txt}实选OpenEXR、HDR输出未勾、Linear ProPhoto RGB / 16位浮点HALF / ZIP，实际输出renders/acr-repair-sdr.exr，独立ExifTool header为HALF3 / ZIP / ProPhoto D50；无独立像素decoder，像素 / 完整选项留阶段6 | V6；实现已确认的SDR Linear ProPhoto / HALF / ZIP路径，独立像素解码及线性颜色 / 位深 / 尺寸 / 元数据核对；header不代替像素，其他选项依实际基线逐项验收 |
| S7-01 | 7 | 摄影任务回放 / 全部缺口清偿 | 未完成；功能接入不等于本轮同级 | U1 / U2 / U3 已见工作台和独立全景窗口可作起点；未见入口、完整交互及产品同级仍待 | V7；逐 ID 汇总四类证据，阶段 0–6 必需项不得有缺失 / 占位 / 未验证，质量盲评与耗时单列 |
| S7-02 | 7 | 多显示器 SDR 色彩管理 | 未验证；五输出色域 / 嵌入 ICC 不是显示器管理证明 | U2 仅单张工作台截图；显示器 / ICC 切换 U0 | V7 + V1；不同 ICC 显示器、窗口跨屏 / 缩放 / 1:1、宽色域与导出一致性，不做 HDR 亮度验收 |
| S7-03 | 7 | 长期稳定性 / 无障碍 / 焦点与输入反馈 | 部分；历史短程 GUI 不代替长时任务 | U2 控件布局可见；焦点、快捷键和长时资源 U0 | V7；完整键盘 / 修饰键 / 输入框 / 最小窗口、连续开关图与取消、资源释放；反馈 ≤100 ms |
| S8-01 | 8 | Windows 产品安装与操作验收 | 未完成；共用源码不算产品可用 | ACR 参考仍为固定 18.7；Windows 对照入口差异 U0 | V7；离线安装包、路径 / 原子保存 / 取消 / 输入 / 显示 / 凭据与全任务回放 |
| S8-02 | 8 | Linux 产品安装与操作验收 | 未完成；原生 ART / GLib / GTK 链接依赖待部署核查 | ACR 非 Linux 对照应用；复用固定 18.7 行为基线，不虚构 Linux ACR UI | V7；离线安装包、显示服务器 / 色彩 / 输入、文件系统 / 取消、依赖与全任务回放 |
| D01 | 后续暂缓 | HDR 合并 / HDR 全景 | 缺失，暂缓；不与阶段 5 普通全景混计 | U3：ui/33“合并到 HDR / 合并为 HDR 全景”菜单可见；未执行，仍独立暂缓，不计普通全景实测 | 独立后续门槛；当前只检查必要 SDR 回归，不以普通全景完成代替 |

## 原阶段 0 剩余取证与后续验收（历史索引）

原阶段 0 的入口 / 条件清单、代表性参考与回归 / 修复 / 归档记录继续保留，**不再作为本轮工作流施工的前置总门槛**。0.64 既有安装身份、修复与回归见 [验收记录](ACCEPTANCE.md) 和 `release/SHA256SUMS`；追加报告尚待主线程总表封存，不能声称新清单、总数或归档 hash 已同步。产品回归、ART 自对照、ACR 原生参考分别判定；原登记 161 项 / 样本只表示既有证据快照。

代表性参考已有十一份公共TIFF16 sRGB、可复现chart / 已渲染纹理、原生Clone、构造活动XMP经ACR处理的Heal、Look数量 / 双向渐变XMP、一组真实球面全景及继续编辑保存重开，以及 `renders/acr-repair-sdr-srgb.{avif,jxl}` 与 `renders/acr-repair-sdr.exr` 的限定SDR输出。私有Z5II ISO32000仅留本机。89 / 91是已接受活动输入与重开的有效证据；Heal GUI创建、像素质量与全部参数并未通过。原阶段 0 的剩余入口 / 条件清单及现版回归映射仍待补证，但不再阻挡本轮施工；已核几何约束条件与原照 / 默认值 / 输入坐标来源不能替代完整几何质量验收，`regression-coverage.json`已提供逐能力到0.64报告的部分映射，未有充分当前安装版证据的ID仍须审查 / 补验，不能沿用0.63自动升级；参考与回归报告的身份由各manifest和发布校验值固定。

新增几何参考见 `geometry-reference.json`：自产1000×800 sRGB网格，原生默认与13×9 / 7.5°两份TIFF16完成独立像素、ICC、嵌入XMP和原输入哈希核验；导出分别1000×800与924×640。keystone已被原生ACR接受并取得垂直透视+20活动XMP；约束裁切在垂直透视+20后已启用；Trim / Expand渲染DNG仅确认入口，不能把普通裁框参考当作透视 / Alpha验收。

新增工作流参考见 `workflow-reference.json`：两张隔离公共RAW检查预设面板及强度、管理 / 收藏菜单、ISO自适应启用条件、筛选与信息面板。原生CN01强度150保存为 `crs:Preset/rdf:Description` 的 `Amount=1.5`，包含 `Parameters`；与早先Look数量参考分开。未创建用户预设、未改变收藏 / 管理设置；原始RAW哈希保持，工作副本已清理。

以下是真正尚无直接证据的入口或操作子入口；已见主入口不会因效果未测退回U0，灰显 / 无适用输入与完全未见分开登记：

| 对应ID / 所属阶段 | 尚未见的具体入口 / 子入口 | 已知边界 |
|---|---|---|
| S1-13 / S1-14 / 1 | LCP实际识别与传统锐化 / 降噪修饰键辅助预览 | 手动 / 配置校正、Sigma自动匹配及两强度已见；官方LCP路线为文件系统安装后在光学面板匹配 / 选择，不能把颜色配置导入菜单当作LCP UI导入；18.7实际识别仍待，辅助显示未见不等于参数控件未见 |
| S2-02 / S2-03 / S2-06 / 2 | 自定义比例管理、引导透视放大镜 / 精细拖动子入口 | 新建13×9及菜单保留已操作；约束裁切在垂直透视+20后启用，其他组合待验；不据图标推断启用条件 |
| S3-02 / S3-03 / 3 | 连续笔画手动改源 / 源目标管理子入口 | 原生Clone自动选源已由XMP与输出确认；ui/149仿制选区刷新 / 删除 / 不透明度 / 羽化已见，ui/150填充菜单含移去 / 修复 / 仿制；刷新实际效果与手动改源未通过 |
| S4-03–05 / 4 | 悬停临时预览、预设多图直接应用入口 | ui/118–126已确认传统预设强度、原生Preset结构、收藏入口、管理分组及ISO创建启用条件；收藏持久化与ISO资产 / 插值完整行为属于阶段4，不追加为阶段0门槛 |
| S4-07–11 / 4 | 各筛选细项、粘贴调整子集对话框 | ui/115–116复制子集对话框及全部 / 已修改 / 默认 / 无和分类选择已见；ui/127–130筛选栏 / 相机候选与完整单张 / 多张信息面板已见；ui/147独立多点颜色取样入口与两组读数已见，完整语义仍待阶段4 |
| B34 / B35 / 4 | 其余前后对比布局 / 交换菜单 | ui/135并排完整两图、ui/137垂直拆分，ui/140–142网格 / 两图多选及上下文菜单已操作；右键 / 长按未打开布局菜单，ui/139仅失败试探 |
| S6-13 / 6 | 独立色域警告入口及软打样ICC启用条件 | ui/154已确认工作流程意图 / 模拟纸墨控件，当前Rec.2020不可用；独立色域警告仍未知，不能混作整项缺失或存在 |

已见但条件或展开内容待补登记的项目：S1-12全局Glow子项；S2-05 Upright图标的各模式名称；S2-10真实深度输入后的可用条件 / 控件（ui/81深度菜单已见，不能继续称整个入口U0）；S4-06默认规则优先级的适用输入；S4-13自动对焦叠加的支持输入与点位（ui/142–143两入口及独立选项内容已见）；S6-12 Content Credentials当前灰显的启用条件。匹配曝光按相机设置入口在两图多选后启用，按光照匹配仍灰显、局部点颜色无样本、局部优化饱和度灰显等均保留实际条件。B04 / B05的其他输入 / 机型、S7显示器切换与焦点、S8平台差异保留矩阵原状态，不因本轮RAW取证推及全部条件。

条件依据（官方文档与固定18.7原生证据分开）：[LCP安装指南](https://www.adobe.com/special/photoshop/camera_raw/lensprofile_creator/lensprofile_creator_userguide.pdf#page=21)规定把`.lcp`放入用户或共享`CameraRaw/LensProfiles/1.0`，再由[光学面板匹配或选择](https://helpx.adobe.com/camera-raw/desktop/using/correct-lens-distortions-camera-raw.html)；不是已确认的“导入LCP”菜单。指南为2010年，18.7刷新 / 识别仍待实测。[深度范围文档](https://helpx.adobe.com/camera-raw/desktop/edit-and-enhance-images/masking-and-local-adjustments/masking.html)要求输入含深度信息；本机尚无许可与深度保留均核实的参考输入，不使用AI深度补齐。[Content Credentials文档](https://helpx.adobe.com/camera-raw/desktop/content-credentials/content-credentials-camera-raw.html)列出互联网、Creative Cloud订阅和身份服务访问条件，并称除Photoshop / OpenEXR外支持；本机TIFF灰显原因仍未定位，不按格式或账号状态推断。这些滚动文档不能代替固定18.7的全部条件实测。

以下保留旧阶段验收缺口，供历史与后续索引；其中旧范围的“纳入实现”“保留原门槛”等表述仅属当时计划。本轮按页首范围选择现有工具相关闭环，范围外项不启动，也不追加为施工前置门槛：

- **阶段1：输入 / 全局参数与质量。** 新chart被真实ACR接受且输入可复现，旧synthetic拒绝仅作历史。默认配置 / 原照WB / 参数坐标仍须三类输入对照；chart默认WB6500/+10、相机neutral各自默认不视作统一零基线。`input-readback.json`已登记CaptRAW chart为1528×1016、ACR为1536×1024，以及产品拒绝JPEG XL压缩全景DNG（-2）；独立解码不代替产品支持，不改参考编码规避。Look / RAW WB / 曲线预设与TAT / HSL / 黑白八色 / 版本1–6 / 光学 / 晕影 / 颗粒入口已补证，各自全范围、XMP映射、非零输出与质量仍待。
- **阶段2–4：几何 / 局部 / 修复 / 工作流。** 双向渐变勾选、对称覆盖及XMP已见，非零局部效果与完整语义待验；RAF UI曝光+0.50与XMP0.125映射单列。局部点颜色、曲线 / 优化饱和度、摩尔纹 / 去边和锐化已见，不能批量升级为效果通过。传统Heal仅是构造活动XMP的原生读回 / 渲染 / Done / 重开参考，GUI创建、重新选源、复杂场景质量，以及红眼 / 宠物眼 / 灰尘可视化、预设 / 默认值 / 同步 / AF叠加等各自V0闭环仍待所属阶段。
- **阶段5：全景完整分支。** 单组四张ARW已实测球面、warp0、noFill / noAutoSettings / noAutoCrop并继续编辑保存；圆柱 / 透视、非零变形、自动裁剪 / 传统填充、取消 / 失败 / 尺寸上限、低纹理 / 手持 / 接缝质量仍待。源WB未统一与镜头profile警告是本组条件；保存重开不代替其他软件读回、全参数余量或CaptRAW实现。
- **阶段6：完整输出。** TIFF16参考与显式sRGB AVIF / JXL的独立imagecodecs解码已具备；AVIF为10bit SDR，JXL为有损品质9的uint16 RGB，仅单个中性灰取样与sRGB TIFF一致，不能外推全图色彩、全选项或逐像素无损。非HDR SDR OpenEXR已确认纳入实现，Linear ProPhoto / HALF / ZIP实际文件有独立ExifTool header证据，独立像素decoder仍待。两份 `renders/acr-repair-format-transition.{avif,jxl}` 控制文件保留实际线性值；格式过渡UI P3 / 文件Linear ProPhoto的观察差异根因未证实，显式选择sRGB后文件正确，不归因为Adobe bug。JPEG、PNG、扁平Photoshop、感光数据 / 渲染DNG及所有格式选项、Alpha / PPI / 介质锐化 / 模板 / 元数据隐私 / Content Credentials仍按阶段6逐项验收。
- **阶段7–8：任务 / 性能 / 平台。** 摄影任务、人工可见GUI、全量画质与耗时、长期稳定、显示管理和Windows / Linux安装操作仍未验收，保留原门槛；本轮本机ACR取证不替代产品完成。

未见入口不能默认存在；批准计划内项目保留待核实。若固定 18.7 证实某项不存在，须用实际证据更正基线归属，不能依据最新 Adobe 网页、资源字符串、其他产品或已有处理库擅自扩围 / 删项。


尚无画质盲评、ACR 对照耗时和全部关键缺口的可信实现证明，因此完整同级替代可行性仍未证实。不会因版本迭代增加控件而降低目标或宣布完成。

依据：用户本机固定版本截图、`native/src/recipe.cc`、`native/patches/patch-art.mjs`、`apps/desktop/src/`、`tests/` 和本机 `artifacts/`；上游代码为 [ART 固定版本](https://github.com/artraweditor/ART/tree/1e0e12c62e4f329d30bb5624d62a23a663ffbe6b) 与 [LibRaw 解码分支固定版本](https://github.com/pdcgomes/redlamp-libraw/tree/3b20539d3faa766a370e93a529a3b87edffbf0f6)。交互参考 [Adobe 蒙版说明](https://helpx.adobe.com/camera-raw/desktop/edit-and-enhance-images/masking-and-local-adjustments/masking.html) 和 [Adobe 快捷键](https://helpx.adobe.com/camera-raw/desktop/get-started/overview-and-setup/default-keyboard-shortcuts.html)，网页后续更新不改变固定验收基线。

裁切交互参考 [Adobe 裁切说明](https://helpx.adobe.com/camera-raw/desktop/edit-and-enhance-images/crop-rotate-and-geometry/rotate-crop-retouch-images-camera.html) 的比例、横竖切换和控制点行为；页面其他新增能力不纳入已支持声明。

参数曲线交互参考 [Adobe 明暗与颜色调整说明](https://helpx.adobe.com/in/camera-raw/desktop/using/make-color-tonal-adjustments-camera.html) 的四区域与分界；核心使用固定 ART 参数曲线，不宣称数值可直接迁移。


### 0.34 配置文件资产进展

已接入显式 DCP / RGB ICC 导入、本地内容寻址库、机型检查、真实能力控件和 XMP 随附资产。独立 DCP 的机型取 50708；DNG 原片也使用其 UniqueCameraModel。重开、移动、重命名及移除原配置后恢复纳入本机验证。输入校验失败时保留原活动核心，后续调节仍可继续。

Adobe 配置的名称 / digest 自动解析、ProfileCalibrationSignature 与相机校准矩阵关系、增强 XMP Look 均未完成。不按名称猜测匹配，不把文件哈希当作 CameraProfileDigest，不以加载基础 DCP 宣称应用完整 Adobe Color。具体接口和限制见 [ENGINE](ENGINE.md#输入配置文件导入与随附资产034)。完整 ACR 同级目标仍未达成。
