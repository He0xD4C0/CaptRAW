# CaptRAW 本机验收记录

## 0.48 手动角度与旧配置恢复（2026-10-28）

从 `release/CaptRAW-0.48.0-arm64.dmg` 只读安装至 `~/Applications/CaptRAW-0.48.app`，保留 0.47。DMG SHA-256 为 `d6ffe1cf8dbf518cb4464e4d99963328991c6ef08a379d072d9116621c923004`。严格 ad-hoc 签名通过，未公证；789 个安装文件与签名后包一致，7 个 ASAR 文件与 Web 构建一致。新 Logo 保留；处理版本仍为 22 / 基线 4。

- 裁切模式新增 −45° 至 45° 手动角度，0.01° 滑杆步进、数值输入、Esc 撤回和独立重置。一次编辑形成一步历史；前后对比与交换保留当前角度，裁切预设 / 同步包含角度。1080×720 最小窗口中的角度输入、滑杆、重置和完成按钮均完整可见，已核对截图。
- 旧 XMP 未携带角度字段时从 ART 配置投影实际有效角，避免被新照片默认 0 覆盖。蒙版缺失的参考角先按原配置绑定，显式参考角不改写；保留关闭但储存非零角的完整配置。保存使用现有 ART RDF 扩展，不写尚未验证的 Adobe CropAngle。
- **31 项最终安装版隐藏 GUI 检查**通过：受控 DNG 与真实 Nikon Z5II HE★ 各 6 项角度流程、19 项关闭 / 保存 / 退出保护、曲线与蒙版管理回归。两组角度流程均包含 23° 新建径向蒙版、改为 −17°、撤销 / 重做、前状态构图、XMP 重启恢复与旧配置投影，源文件 SHA 未变。HE★ 为公开清单的 `Z5_2_3x2_HEstar_276ef4ad.NEF`，本轮不扩大机型 / 压缩模式覆盖声明。
- 两组 GUI TIFF16 与独立 0.47 核心按相同 ART 配置导出逐像素一致；HE★ 输出为 **3984×2656、RGB uint16、ICC 728 字节**。GUI 阻断 HTTP / HTTPS，窗口全程隐藏且不可聚焦，页面错误 0；不冒充整个 GUI 进程的系统级网络禁用。
- **9 组安装核心检查**通过：16 组受控图 TIFF16 对照覆盖四个粗旋转方向、0 / +23 / −17°、AutoFill 开关、旧配置启用 / 禁用和蒙版参考；旧核心直接设置 ART 参数作为独立对照。±45°边界、11 类非法输入及错误后恢复通过。另有 NEF / CR3 / RAF 三组 512px 零角度基线，uint16、ICC、像素均与旧核心一致。核心子进程禁止外部网络及 Homebrew / `/usr/local` 读取；Python 像素分析在宿主运行。
- 构建、类型检查和 **28 项单测**通过，含角度的预设捕获、分组同步及未选择时保留目标值。源码未 commit / push。

证据：`artifacts/acceptance-0.48/angle/run-3M523o/report.json`、`nikon-angle/run-4b9v29/report.json`、`revision-complete/report.json`；原生检查为 `artifacts/fine-rotation/run-Brr0Yn/report.json`；安装 / ASAR / 源码汇总见 `artifacts/release-0.48-evidence.json`。截图位于两组角度目录的 `angle-controls.png` 与 `angle-minimum-window.png`。

回归首次运行因磁盘 ENOSPC 中断，未计入成功；日志 `artifacts/revision-installed-0.48.log` 和已生成 XMP 保留。核对 789 文件后移除可由 DMG 恢复的解包副本，保留安装应用；历史验收图片的字节相同副本改为 APFS 写时复制，内容与路径不变，记录为 `acceptance-0.48/{package-cleanup,cache-clones}.json`。修正测试收尾，报告写入失败时仍关闭隐藏应用；完整重跑通过。

**边界：** 手动角度已可操作；画线拉直、自动水平、约束裁切入口、Adobe CropAngle、全部变换组合及 ACR 操作 / 画质对照仍未完成。HDR、完整非生成式 AI、更多压缩变体和三平台目标保持不变，不宣称完整 ACR 同级。

## 0.45 修复点几何与事务（2026-10-28）

最终 DMG 安装至 `~/Applications/CaptRAW-0.45.app`，保留 0.44。严格 ad-hoc 签名验证通过，未公证；ASAR 7 个构建文件与本次产物一致，508 个原生程序 / 资源文件与 0.44 逐字节相同。新 Logo 保留；处理版本仍为 22，XMP 参数定义和原有修复处理算法不变。

- 修复来源 / 目标拾取和拖动通过 `display → source` 原生映射；源域像素中心、W−1 / H−1 归一化及整数取整遵从旧配方。显示源点、目标点和各自完整半径 / 羽化轮廓，不用屏幕圆近似非线性形变。
- 修复手势只维护本地草稿，松手及全部映射完成后提交一步历史。保存、关闭、导出、原生关闭和退出保护覆盖未提交操作；Esc、换工具 / 照片取消迟到响应。单击现有手柄不改变参数或清空重做。
- **24 项安装版变换专项**通过：四个粗旋转方向叠加细旋转 23°、真实 Lensfun 畸变 / 色差与透视，验证实际点击、源 / 目标拖动、快速松手、无移动点击和八个延迟响应生命周期场景。样本中保存坐标对独立核心映射最大误差约 `1.42e-13` 源像素，完整轮廓采样最大偏差 `0.01249` CSS 像素。四组 GUI TIFF16 与由原始配置和独立计算位置组成的配方输出逐像素一致；克隆目标中心区域也与已知来源色块核对，不能只靠坐标往返证明图像正确。
- **14 项安装版修复回归、15 项共享蒙版事务回归**通过，共 53 项隐藏 GUI 检查，页面错误为 0。修复回归含 D850 RAW、参数 / 列表管理、旋转、1:1、保存重开及导出；另一个 1024×768 TIFF16 与独立安装核心逐像素一致，带 728 字节 ICC。窗口隐藏、不可聚焦，实际工作台截图已核对。
- 构建、类型检查及 **28 项单测**通过，包含 8 项修复几何单测。该专项的非线性密集采样与 null 断线 / 取消 / 预算检查不替代实际安装版测试。

证据：`artifacts/acceptance-0.45/geometry/run-raypoS/report.json`、`repair/{report,pixels}.json`、`mask/latest.json` 指向的报告；安装和 ASAR 记录为 `artifacts/{install,asar}-0.45.json`。开发失败及早期候选保留：最初测试在非线性映射后点击到画布外，调整受控样本位置；原修复脚本连续点击未等待异步来源取样；专项还发现无移动点击的浮点运算顺序清空重做，已修改为先求差再相加，最终安装版复验通过。`acceptance-0.45-pre-click-fix` 和带 `pre-click-fix` 的包 / 记录不是最终结果。

**边界：** 本轮变换像素专项为受控 RGB 图及 23° 配置，不能推及全部镜头、负角、自动畸变、RAW 自定义 border 或 EXIF 镜像组合；细旋转与裁切 / 1:1 的组合未纳入本专项，普通 1:1 回归单独计证。范围取样和对象候选联动、用户可见拉直 / 透视入口、Adobe CropAngle、连续修复画笔 / 自动来源仍未完成。未扩大 HE / HE★、HDR、AI 或完整 ACR 画质与操作等效的声明。

## 0.44 空间蒙版交互与保存保护（2026-10-28）

从最终 `release/CaptRAW-0.44.0-arm64.dmg` 只读、隐藏挂载并安装至 `~/Applications/CaptRAW-0.44.app`，保留 0.43。严格签名验证通过（ad-hoc、未公证）；ASAR 的 7 个构建文件与当前工作区逐字节一致，新 Logo 保留。XMP 写入处理版本 **22**，读取 20 / 21 / 22，基线为 4；旧 0.43 不能读取新写出的 22 文档。

- 画笔、擦除、线性 / 径向轮廓及手柄使用原生参考画布映射；完整轮廓按曲线细分，中心独立映射。已有手柄保留抓取偏移，单击不改变历史。单笔输入有序排空后提交一次，快速松手保留最终位置；取消或切换照片时丢弃迟到草稿。
- 未提交笔画纳入退出保护。映射未完成时，保存、关闭文件、导出及同步提示等待后重试，不更新 revision 或保存旧快照；原生关闭 / 退出可取消，随后完整笔画仍能保存并一步撤销。
- **30 项安装版蒙版专项检查**通过：0° 15 项，90°＋裁切、180°、270°＋裁切各 5 项。均含当前细旋转 23°、参考角 7°、实际 Lensfun 畸变 / 色差及透视；保存的笔画 / 擦除坐标与独立核心映射在这些样本上的最大像素误差为 0，实际显示像素变化及撤销重做一致。异步测试延迟真实 RPC 返回，不替代原生计算。
- **19 项安装版 GUI 回归、3 项跨照片预设工作流及 5 项请求生命周期检查**通过。覆盖关闭 / 放弃 / 保存 / 退出、模式隔离、多点曲线、蒙版管理、预设参考角和 XMP 重开。后者通过真实旧核心 SIGTERM 拒绝验证旧 viewport / update 不污染新文档，旧 revision 错误被忽略，当前真实 native 错误仍可见并可恢复。页面错误均为 0；窗口全程隐藏、不可聚焦，已核对实际工作台截图。
- 最终安装版 D850 完成 RAW → 调节 → 径向蒙版 → TIFF16 → 1:1 → XMP 重开。输出为 **8256×5504、RGB uint16、ICC 728 字节**，桌面与独立安装核心逐像素一致。自动化并行执行，不将首次打开耗时作为冷启动或 P95 达标证明。
- 构建、类型检查与 **20 项单测**通过。此前候选的 **8 组参考角核心工作流及 23 项 XMP 检查**通过；最终包内 508 个原生程序 / 资源文件与该候选逐字节一致。独立渲染核心还在禁止外部网络及 Homebrew 读取的条件下运行；此限制不冒充整个 GUI 进程的沙箱验收。

本轮保留失败证据：主流程曾错误要求未绘制蒙版已有覆盖图；回归脚本曾未等保存产生的新预览就操作旧手柄。均修正等待条件后通过。截图另发现了测试未检查的旧 1:1 请求退出误报，已修复会话 / revision 错误归属并增加无 alert 断言及真实原生错误专项；没有用吞掉所有错误掩盖故障。

最终 GUI / 像素证据位于 `artifacts/acceptance-0.44/`（`gui`、`rotation90`、`rotation180`、`rotation270`、`regression-verified`、`viewport`、`presets`、`main`）；蒙版专项由 `latest.json` 指向独立运行报告；本轮请求生命周期报告为 `viewport/run-PGnFmR/report.json`。核心 / XMP 证据为 `artifacts/mask-interaction-installed-0.44/{core,xmp}/report.json`；安装与源码核对为 `artifacts/{install,asar,release}-0.44*.json`。

**仍未完成：** 拉直 / 任意角用户入口、修复点和范围取样联动、对象候选几何、Adobe CropAngle、45 MP 多蒙版性能、完整 ACR 画质 / 操作等效。本批不扩大 Nikon 模式覆盖、HDR 或 AI 能力声明，不宣称完整替代完成。

## 0.44 组件参考角的前期开发验证（2026-10-28）

以下记录的是安装版尚为 0.43 时的开发验证快照：核心写入处理版本 **22**，继续读取 20 / 21 XMP，基线为 4。最终 0.44 安装版证据见上节。

- 空间蒙版叶子可保存独立参考角；组与关联覆盖图不重复变换。读取缺省参考角的文档按原配置绑定；新预设捕获来源参考角，同步保留来源角并采用目标照片几何。旧预设没有来源角时继续沿用目标画布，避免误当 0°。原 XMP 不自动改写。
- 原生探针四组 **1,256 项检查**通过，包含混合参考角、缓存淘汰、嵌套组合、区域和并行、关联蒙版、缺键清除及非法数据；19 个补丁 / 33 个文件从固定原始源码重放、重复应用及编译源码对照通过。
- **8 组核心工作流检查**通过：五个独立参考角与全局参考渲染的 RGB / 覆盖图完全一致；混合运算与分别生成后合成的 8 位覆盖图最大差 0.004375（阈值 3/255）。XMP 重开、预设导入应用、跨照片同步、旧预设目标画布兼容、非法值拒绝均通过。重开 TIFF16 为 1024×768 RGB，逐像素一致。
- **3 组隐藏 GUI 工作流检查**通过：实际按钮将独立蒙版转为组件、创建 / 应用预设到不同角度照片、撤销重做、关闭重开、导出 TIFF16。桌面与独立核心导出逐像素一致；页面错误 0。已检查工作台截图，自动化窗口始终隐藏且不可聚焦。
- 构建、类型检查、**13 项单测**与 **23 项 XMP 检查**通过。单测覆盖在来源参考角解析期间取消同步。首次检查暴露无变化同步意外启动原生进程的问题，修复后通过；失败日志保留。GUI 测试修正了错误按钮名称、过早把应用预设前的刷新当成完成帧，以及依赖短暂状态文本的问题；最终等待实际像素变化与撤销可用状态。

证据：`artifacts/mask-reference-verified/{report,coverage,pixels}.json`、`mask-reference-gui-accepted/{report,pixels}.json` 与 `workbench.png`、`mask-reference-probe*.json`、`mask-reference-fresh.json`、`mask-reference-ci-complete.log`、`mask-reference-xmp/report.json`。

**未完成：** 任意角控件、画布手柄 / 新笔画与修复点的坐标接入、对象与范围取样联动、Adobe CropAngle、安装版验收及完整 ACR 同级。这里的 GUI 验收不证明旋转后的手柄位置正确；该交互仍使用旧坐标逻辑。本批不扩大 Nikon 模式或画质等效声明。

## 0.43 蒙版精度与局部预览一致性

从 `release/CaptRAW-0.43.0-arm64.dmg` 只读、隐藏挂载并安装至 `~/Applications/CaptRAW-0.43.app`，保留 0.42。严格签名验证通过；ad-hoc、未公证。ASAR 的 7 个构建文件与工作区逐字节一致，新 Logo 保留。

- 修复 ART 半精度笔画打包造成的预览 / 独立导出边缘差异：新增完整 double 列表，保留添加 / 擦除顺序，并拒绝损坏列表。处理版本为 **21**、基线仍为 **4**；读取现有 20 / 21 XMP，写入 21，使旧核心拒绝新语义。没有恢复 JSON 兼容或基线 2 / 3 迁移。
- 镜头畸变 / 色差或有效透视的详细预览使用完整中间变换画布，避免源区域估计切掉二次采样所需像素。平移到无蒙版覆盖区域不再误报整幅蒙版为空。完整画布为空仍保留原提示。完整中间画布对大图耗时 / 内存的影响尚未测定，不宣称已达到滑杆 P95 目标。
- 参考角与坐标场缓存已接入适屏、详细区域和完整输出。安装版核心在限制外部网络、禁止 Homebrew / `/usr/local` 读取下通过 **6 组**受控图像：四方向粗旋转、±23°、填边开关、参考角非零而当前角归零、画笔 / 径向 / 组合、局部色调和细节、裁切、XMP 关闭重开。被摄物覆盖率为 255，关闭重映射的反例为 0；全部 1:1 与 TIFF16 的 8 位量化像素差为 **0**，**12 个局部区域**的 RGB / 蒙版与完整详细图对应区域完全一致。三种非法角度 / 笔画配置被拒绝，当前配方保留且可继续编辑，错误事件 0。
- 开发核心原生探针 **4 组、1,060 项检查**通过，覆盖生成器、两级尺寸缓存、参数失效、参考角持久化、完整笔画精度 / 损坏数据、局部空覆盖、错误回调和恢复。固定原始 ART 压缩包的 **19 个补丁 / 33 个文件**重放、重复应用及与实际编译源码字节对照通过。
- 安装版 **23 项 XMP 检查**与 **19 项隐藏 GUI 回归**通过：20 / 21 文件及预设读取、21 写出、未知元数据保留，关闭 / 放弃 / 保存 / 退出保护，多点曲线，蒙版管理及模式隔离。GUI 页面错误 0，窗口隐藏且不可聚焦，已检查实际截图。开发构建、类型检查和 12 项单测通过。
- 安装版真实 Nikon D850 主流程完成 RAW → 全局 / 蒙版调整 → 1:1 → XMP → TIFF16 → 重开。首次可见预览 **912 ms**，只代表一次隐藏窗口实测。桌面与独立安装版核心输出 **8256×5504、RGB uint16、ICC 728 字节**，逐像素一致。

证据：`artifacts/mask-geometry-installed-0.43/{core/report.json,gui/report.json,gui/workbench.png,xmp/report.json,main/e2e-report.json,main/pixels.json,main/recipe-restored.png}`；开发证据 `artifacts/mask-geometry-pipeline/{ci.log,fresh-patch.json,probe-*.json}`；安装与资源对照 `artifacts/{install-0.43,asar-0.43}.json`。失败夹具和修复前输出仍保留在开发证据目录。

**尚未完成：** 任意角 / 拉直前端、操作手柄与新笔画的参考坐标转换、修复点和范围取样联动、混合参考画布的预设 / 同步、Adobe CropAngle，以及完整 ACR 非生成式能力与跨平台验收。本批没有新增 Nikon HE / HE★ 模式或 ACR 画质等效结论。

## 开发阶段：蒙版几何映射基础（0.43 前）

这是开发核心的底层验证，未接入工作台拉直操作，未重新打包。安装版仍为下述 0.42；处理版本 20 / 基线 4 和已有配方语义未改。

- 原生构建通过。`GeometryMap` 新增预览处理尺寸，浮点实际渲染坐标检查由 80 扩至 **160 组**，覆盖缩小 4 倍时完整尺寸的取整；最大插值坐标差 **0.188 像素**。
- **12 组标量坐标场**覆盖 641×427、8256×5504、正负角、镜头与透视组合，每组 3000 个确定性随机点；采样最大映射差 **0.020585 像素**，实际采样无失败。标量蒙版解析参考最大差 **0.000160**；裁切偏移的 ROI 与全图对应区域、串行与并行结果一致。45 MP 坐标场建立约 **44–581 ms**，单次标量重采样约 **159–184 ms**；不含整套蒙版生成、羽化、额外缓冲复制或 GUI，不代表 P95。
- 直接调用 ART `generateMasks` 的 **四组、共 744 项检查**通过：±23°、自动填充开关、画笔添加 / 擦除、径向 / 渐变、多形状添加 / 减去 / 相交、外部 / CaptRAW 栅格及 90° 资产、递归组合、顶层关联、反选、羽化、裁切偏移、恒等及并行。无变换及恒等路径逐像素一致；羽化检查仅证明有限且产生效果，不是复杂边缘画质验收。异常坐标探针验证逆解失败显式报错，不把求解失败当背景；没有宣称已在普通照片参数中重现该数值失败。
- **32 组开发核心白平衡回归**通过，仍重现 0.41 的 14 处旧取样错误；代表配方 TIFF16 与旧核心逐像素一致。固定原始 ART 压缩包全套补丁重放及重复应用通过，早期生成代码被明确拒绝，避免静默保留旧实现。

证据：`artifacts/geometry-field/{integration-build,mask-build,regression}.log`、`fresh-patch.json`、四份 `masks-{angle}-{fill}.json`、`regression/{coordinates,wb,pixels}.json`。复跑命令见 README 的原生几何探针部分。本批无新增 GUI 验收；坐标参考角持久化、实际处理调度、前端交互、Adobe CropAngle 及安装版验收仍须继续。

## 0.42 几何映射与白平衡取样修复

从 `release/CaptRAW-0.42.0-arm64.dmg` 只读、隐藏挂载并安装至 `~/Applications/CaptRAW-0.42.app`。全应用严格签名检查通过，ASAR 的 7 个构建文件与工作区一致；ad-hoc、未公证。新 Logo、处理版本 20、基线 4 和已有 XMP 参数保持不变。

- 新增共享几何正反映射，复用 ART 的透视、独立镜头色差、组合畸变 / 任意角 / 填边阶段。正向求逆不裁边，失败显式返回；白平衡吸管使用同一映射，补齐继承 ART 透视和已关闭但保留数值的手动色差状态。固定配方的处理管线不变，已保存的白平衡系数不重新计算。
- **80 组开发核心坐标探针**使用 ART 浮点实际渲染的坐标渐变图，覆盖横竖画幅、-45/-17/0/13/45°、填边开关、Lensfun 畸变 / 色差、手动畸变 / 色差和透视组合。图像插值后的最大坐标误差为 **0.188 像素**；坐标正反映射最大误差 **0.00392 像素**，8256×5504 网格往返最大误差 **0.00226 像素**。图外点保留真实坐标而非压到边缘。该探针未随应用分发，不能称为安装版或所有镜头配置验证。
- **32 组安装版核心取样**在禁止网络、禁止 Homebrew / `/usr/local` 读取下通过。受控 RGB 图的任意角、四方向旋转、填边、镜头校正及透视组合，取样系数与未变换原色一致；同样测试在 0.41 重现 **14 个错误取样**。所有固定配方预览与旧版逐字节相同；代表组合输出 **983×737、RGB uint16、ICC 728 字节**，新旧 TIFF16 逐像素一致。另有开发核心 **48 组 RGB / Bayer 光学校正**回归通过，不能推及全部真实 RAW 的任意角与透视组合。
- **31 项最终安装版隐藏 GUI 检查**通过：白平衡光学与几何 12、关闭 / 曲线 / 蒙版 19，页面错误 0。新增从 XMP 加载真实 ART 几何配置后，在适屏和 1:1 点击屏幕中实际色块，验证取样、撤销 / 重做、保存和重开。OS 窗口隐藏、不可聚焦；检查了最终截图。早期 GUI 夹具把色块放在裁切外，已改用完整可见色块；原失败截图保留于 `artifacts/geometry-mapping/gui-cropped-target/`，不计入通过结果。
- 安装版真实 Nikon D850 主流程完成 RAW → 调整 / 蒙版 → 1:1 → XMP → TIFF16 → 重开；首次可见预览 **1218 ms**，仅为一次本机隐藏窗口实测，不代表 P95 或冷磁盘。桌面与独立核心 TIFF16 逐像素一致。构建、类型检查、12 项单测通过；本次 JavaScript 检查复用了已有缓存，原生编译、探针、安装包和 GUI 均实际执行。新补丁对原始 ART 源码应用及重复应用检查通过。

证据：`artifacts/{install-0.42,asar-0.42,release-0.42-evidence}.json`、`geometry-installed-0.42/{coordinates,wb,pixels}.json`、`wb-optics-installed-0.42/report.json`、`revision-installed-0.42/report.json`、`mainflow-installed-0.42/{e2e-report,pixels}.json`。截图为 `artifacts/wb-optics-installed-0.42/transformed-fit.png`，构建及测试日志位于 `artifacts/geometry-mapping/`。

此批完成共享映射基础及一个实际取样缺陷。任意角滑杆 / 拉直交互、蒙版与修复手柄映射、Adobe CropAngle、HDR、AI 全集和完整 ACR 等效验收仍未完成；没有将测试配置中可加载的 ART 参数称为已完成的用户功能。源码未 commit / push。

## 0.41 会话前状态与完整设置撤销

从 `release/CaptRAW-0.41.0-arm64.dmg` 只读、隐藏挂载并安装至 `~/Applications/CaptRAW-0.41.app`。最终包全应用严格签名检查通过，ASAR 的 7 个构建文件与工作区一致；仍为 ad-hoc、未公证。显影核心与 XMP worker 逐字节等于 0.40，处理版本 20 / 基线 4、新 Logo 和原生输出管线不变。

- 对比默认使用打开照片时的完整调整和 ART 配置，包括 XMP。底栏可保存当前设置为前状态、交换前后设置、还原打开时参考；交换保持当前裁切、锁定比例、旋转和镜头设置。前状态随会话照片保留，不写入 XMP。单图 P / 按住对比使用独立进程，保留 1:1；RGB 直方图跟随当前显示的参考。Option/Alt+P 保存前状态，Shift+P 打开预设。
- 撤销记录保存完整 ART 配置与调整。交换一次可同时撤销两侧状态；普通编辑撤销不撤回对比参考。保存状态按调整及配置身份检查，避免交换 / 预设 / 同步后漏记未保存设置；对比参考本身不标记未保存。
- **96 项最终安装版隐藏 GUI 检查**通过：前状态 12、四种对比 12、宽区域 1:1 共 7、关闭 / 曲线 / 蒙版 19、批量保存 9、对象选区 7、预设 13、Nikon 相机构图 7、同步 10。页面错误 0。OS 窗口隐藏、不可聚焦，原生对话框使用明确响应。实际检查最小窗口截图，底栏三项操作均可见。
- 新检查以 Nikon D850 RAW 加带隐藏 ART 第二曲线的 XMP 为夹具，验证打开参考、存储参考、真实像素交换、单步撤销 / 重做、保存标记、P / Option+P / Shift+P、1:1 和直方图、胶片切换、重启及构图保持。D850 桌面 TIFF 为 **8256×5504、RGB uint16、ICC 728 字节**；独立核心输出逐像素一致。跨机同步 Canon R5 TIFF 为 **8183×5455、RGB uint16、ICC 728 字节**，也与独立输出逐像素一致。
- 预设专项重新通过真实对象选择生成 XMP / 栅格资产，不读取旧 JSON 夹具；跨相机应用及删除预设后保存资产均通过。同步取消使用显示实际处理进度的 RAW 场景，确认目标保持先前值；移除无法可靠点击取消的小 PNG 重复场景。Nikon 相机构图专项验证已有 Z5 II HE 样本及 P 的同步构图语义，本轮没有重跑全部 HE / HE★ 矩阵。
- 构建、类型检查、**12 项单测**通过。测试脚本补齐独立对比事件等待、隐藏退出响应、XMP 夹具前置检查及失败诊断；早期失败日志和首次候选证据保留于 `artifacts/comparison-state/*-pre-histogram.log`、`synchronize-*.log` 及相应目录，未计入通过结果。

证据：`artifacts/release-0.41-evidence.json`、`install-0.41.json`、`asar-0.41.json`、各 `*-installed-0.41/report.json`、`comparison-state-installed-0.41/pixels.json`、`synchronize-installed-0.41/pixels.json` 和 `comparison-state/{ci,package}.log`。界面截图为 `artifacts/comparison-state-installed-0.41/saved-before.png`。

此批只补齐会话对比和完整配置历史。持久快照、独立参考图、反斜杠交换默认全部设置、ACR 操作耗时 / 盲评、HDR、非生成式 AI 全集、全机型压缩模式和三平台验收仍未完成，不宣称完整 ACR 同级。源码未 commit / push。

## 0.40 裁切与局部明暗的处理边界

从 `release/CaptRAW-0.40.0-arm64.dmg` 只读、隐藏挂载并安装至 `~/Applications/CaptRAW-0.40.app`。全应用严格签名验证通过，仍为 ad-hoc、未公证；ASAR 的 7 个构建文件与工作区一致。处理版本 20 / 基线 4、现有 XMP 参数和新 Logo 不变。

- 修复 0.39 发现的裁切局部明暗差异。预览的 Stage 1/2/3 在裁切内使用与导出相同的坐标、边界及顺序，裁切外继续显示用于构图的图像；链接蒙版缓存独立，覆盖率和范围取样按同一范围合并。输出管线没有改变。
- **10 组安装版核心检查**在禁止网络及 Homebrew / `/usr/local` 读取下通过：受控线性蒙版、双重叠蒙版的 0/90/180/270° 旋转、右下贴边裁切与反选、全局明暗 / 纹理叠加局部明暗，以及 Nikon D850 NEF、Canon R5 CR3、Fujifilm X-T4 RAF。每组详细 PNG 与 TIFF16 量化至 8 位后的像素完全一致；合成图适屏图的裁切范围也一致，缓存平移无错位。每组新旧核心 TIFF16 像素相同，原片校验值未变。
- 同一 D850 配方重新调用 **0.39 安装版**，旧预览仍复现最大差 **5/255**；0.40 的 **3101×2207** 对应区域最大差 **0**、差异样本 **0**。这是修复前后实际处理对照，不是仅比较同一条新路径。旧失败证据继续保留，最新对照为 `cropped-tone-offline-0.40/nikon-d850.NEF-pixels.json`。
- **44 项安装版隐藏 GUI 检查**通过：新增裁切明暗 6、关闭 / 曲线 / 蒙版 19、大窗口详细区域 7、前后对比 12，页面错误 0。实际鼠标缩小裁切框、绘制线性蒙版、调整亮度 / 高光、单步撤销重做、1:1、保存 XMP、关闭进程并重开均通过。检查实际截图，局部参数、覆盖层与文件关闭入口可见。原生对话框注入选择，OS 窗口始终隐藏、不可聚焦。
- 经 GUI 导出的 D850 为 **7017×4781、RGB uint16、ICC 728 字节**，与独立安装版核心输出逐像素相同；实际显示的原生详细区域与桌面 TIFF 对应区域最大差 0，Canvas 中心 16×16 像素直接绘制对照差 0。XMP 重开后适屏 PNG 字节一致。
- 既有 **6 组宽区域原生检查**也在离线安装版核心通过，补充验证未裁切局部明暗、旋转及 NEF / CR3 / RAF。大窗口 Canvas **4040×3016** 的单图、四种布局及平移仍与原生详细图完全一致。构建、类型检查、**12 项单测**通过；从固定 ART 原始压缩包重新应用补丁，与构建树的四个接口 / 调度文件一致，补丁重复执行不改文件。

证据：`artifacts/cropped-tone-offline-0.40/report.json` 及逐项 `*-pixels.json`、`cropped-tone-installed-0.40/{report,pixels}.json`、`revision-installed-0.40/report.json`、`wide-detail-installed-0.40/report.json`、`comparison-installed-0.40/report.json`、`wide-detail-offline-0.40/{report,pixels}.json`、`cropped-tone/{ci,package}.log`、`cropped-tone/fresh-patch.json`、`install-0.40.json`、`asar-0.40.json`、`release-0.40-evidence.json`。实际截图为 `artifacts/cropped-tone-installed-0.40/cropped-tone.png`。

此修复针对启用局部明暗的裁切处理，不构成全部滤镜、全部 ARP 组合或 ACR 像素等效验收。新增裁切内计算及浮点缓冲的 P95 / 峰值内存尚未测定；本轮未重新验证全部 Nikon HE 模式、HDR、非生成式 AI 或跨平台。完整非生成式 ACR 替代目标仍未完成，未提交、未推送。

## 0.39 大窗口原生 1:1 覆盖

从 `release/CaptRAW-0.39.0-arm64.dmg` 只读、隐藏挂载并安装至 `~/Applications/CaptRAW-0.39.app`。严格全应用签名验证通过，仍为 ad-hoc、未公证。ASAR 的 7 个构建文件与工作区一致；处理版本 20 / 基线 4 和新 Logo 不变。

- 移除前后端详细预览的 2048 像素上限，按实际可见区域请求原图像素，分别向下 / 向上取整两端，覆盖小数平移后的边缘。修复高质量适屏帧晚到时清除有效详细图、对比侧适屏图尚在解码时已有详细图却不绘制的问题；位图与对应区域 URL 一致后才绘制。
- **38 项安装版隐藏 GUI 检查**通过：大窗口 7、对比 12、关闭 / 蒙版 / 曲线 19，页面错误 0。2400×1800 窗口中的实际 Canvas 为 **4040×3016**；单图、四种对比布局、平移后全部 RGBA 样本与直接绘制原生详细 PNG 的参考一致，最大差 0。返回适屏清除详细层；实际查看安装版截图，控件和图像正常显示。此检查证明前端完整显示原生详细图，不代表所有配方的预览与导出均一致。
- **6 组独立安装版核心检查**在禁止网络及 Homebrew / `/usr/local` 读取下通过：Nikon D850 NEF、Canon R5 CR3、Fujifilm X-T4 RAF、90° 旋转、右下越界请求钳制，以及未裁切的局部明暗蒙版。详细图最大为 3101×2207（另有 3001×2503）；蒙版 / 亮度平面尺寸正确。各 PNG 与 TIFF16 量化至 8 位后的对应区域最大差 0，原片校验值未变。局部明暗案例使用完整未裁切导出作为参考，不包含下述裁切缺陷。
- 对比状态下的桌面导出为 **4184×5946、RGB uint16、ICC 728 字节**，与禁止网络和 Homebrew 读取的独立安装版核心输出逐像素相同。主流程另通过真实 RAW、全局 / 蒙版、XMP 保存恢复、TIFF16 和 1:1，页面及控制台错误 0；首帧约 **858 ms**，仅为单次实测，不是冷启动或 P95 验收。
- 构建、类型检查及 **12 项单测**通过，本次 `pnpm ci:check` 命中当前内容的本地缓存。新 Logo 的安装版标题栏、favicon、源 SVG 和 ICNS 一致，隐藏窗口验证通过。

**尚未解决：裁切＋局部明暗的预览 / 导出不一致。** 固定 D850 线性蒙版案例在 3101×2207 区域有 12,603,003 个通道样本不同，最大差 **5 / 255**。0.38 详细图与 0.39 对应重叠区域相同，问题早于本次覆盖修复。ART 导出在空间局部处理前裁切，详细预览则使用完整图像上下文；需要统一处理边界，不能用前端 Canvas 对照通过掩盖这一差异。失败图片、TIFF 和旧版重叠对照保留在 `artifacts/wide-detail/cropped-tone*`。

证据：`artifacts/wide-detail-installed-0.39/report.json`、`wide-detail-offline-0.39/{report,pixels}.json`、`comparison-installed-0.39/{report,detail-pixels,pixels}.json`、`revision-installed-0.39/report.json`、`main-installed-0.39/e2e-report.json`、`wide-detail-ci.log`、`install-0.39.json`、`asar-0.39.json`、`release-0.39-evidence.json`。大窗口截图为 `artifacts/wide-detail-installed-0.39/large-comparison.png`。OS 窗口全程隐藏、不可聚焦，文件对话框注入选择；不代替用户人工验收。本轮未重新验证全部 Nikon HE 模式、HDR、AI 或 Adobe 画质等效，完整非生成式 ACR 替代尚未完成。

## 0.38 前后对比视图

从 `release/CaptRAW-0.38.0-arm64.dmg` 只读、隐藏挂载并安装至 `~/Applications/CaptRAW-0.38.app`。全应用严格签名验证通过，仍为 ad-hoc、未公证。ASAR 的 7 个构建文件与工作区一致；显影与 XMP 程序逐字节等于 0.37，处理版本 20 / 基线 4 和新 Logo 不变。

- 新增左右、上下、左右分割、上下分割；底栏选择，Q 正向、Shift+Q 反向循环。使用独立显影进程生成初始侧，共用当前已接入的裁切、旋转、镜头校正及视图位置。当前侧仍可调参数、保存和导出，图像上的手形操作同步平移两侧。空画布禁用缩放 / 对比，百分比显示“—”；适屏百分比按物理像素计算，与 1:1 定义一致。
- **31 项安装版隐藏 GUI 检查**通过：新增对比 12，既有关闭 / 蒙版 / 曲线 19，页面错误 0。在 1100×760 窗口验证控件可见、四种布局、快捷键、真实 D850 初始与编辑图像、自定义裁切缩小、90° 旋转、撤销、保存与切换 Canon CR3。文件选择由测试注入，OS 窗口始终隐藏且不可聚焦。
- 四种适屏布局按原生图片、原图尺寸与保存的裁切边界独立合成参考，Canvas 最大像素差均为 **0**。1:1 两个原生详细区域的原图坐标 / 尺寸相同；平移后两侧各取 16×16 像素，共 **512 像素**，与原生详细预览直接绘制最大差 **0**。此项只证明实测区域，不是所有缩放率、超大窗口或所有显示器验收。
- 对比前后相同编辑的 XMP 调整与完整 ART 配置保持一致，撤销仍撤回调色操作；普通调色不替换初始侧。测试仅终止本次应用的对比核心，错误可见、返回单图后重试恢复，当前编辑仍可保存和导出；切换照片后确认旧对比进程退出。
- 对比中保存并导出的裁切旋转 D850 TIFF 为 **4184×5946、RGB uint16、ICC 728 字节**；与禁止网络、Homebrew / `/usr/local` 读取的独立安装版核心输出最大差 0、差异样本 0。源 NEF / CR3 校验值未变。
- 构建、类型检查及 **11 项单测**通过。安装版主流程另通过真实 RAW、全局 / 蒙版、保存、TIFF16、1:1 与重开，页面及控制台错误 0；首帧约 **1265 ms**，仅为单次实测，不代表冷启动或 P95 门槛验收。

证据：`artifacts/comparison-installed-0.38/{report,detail-pixels,pixels}.json`、`revision-installed-0.38/report.json`、`main-installed-0.38/e2e-report.json`、`comparison-ci.log`、`install-0.38.json`、`asar-0.38.json`、`release-0.38-evidence.json`。实际截图为 `artifacts/comparison-installed-0.38/{split,detail}.png`。

初始侧沿用当前镜头校正（含其暗角选项），不是打开 XMP 时的快照；未暴露的 ART 几何字段不保证对齐。没有自定义前状态、前后交换或独立参考图。1:1 沿用每次最多 2048×2048 的详细区域请求，超大窗口的完整覆盖仍需补齐。本轮没有重新验证全部 Nikon HE 模式、HDR、AI 或 ACR 画质等效；完整非生成式替代尚未完成。

## 0.37 所选照片批量保存 XMP

从 `release/CaptRAW-0.37.0-arm64.dmg` 只读、隐藏挂载并安装至 `~/Applications/CaptRAW-0.37.app`。严格全应用签名检查通过，仍为 ad-hoc、未公证。处理版本 20 / 基线 4 不变，安装包 ASAR 的 7 个构建文件与工作区 dist 逐字节一致；标题栏、favicon 和 ICNS 沿用新 Logo。

- **28 项安装版隐藏 GUI 检查**通过：批量保存 9，关闭 / 蒙版 / 曲线回归 19，页面错误 0。1100×760 窗口内，“保存所选…”入口、逐图失败原因和完成按钮均可见可操作。文件对话框注入选择，系统窗口始终隐藏且不可聚焦。
- 保存只使用点击时的所选照片快照，同名文件自动编号保留；取消文件夹选择不修改未保存状态。中间一张原片暂时移走时，其他照片仍能保存，失败项可恢复原片后单独重试；只有成功照片清除未保存标记，撤销历史保留。停止或保存中退出时完成当前原子文档后停止，剩余编辑仍在应用中。
- 修复重开已存在照片的 XMP 时胶片被移动至末尾的问题；现在保持原顺序和 Shift 连选锚点。重开后实际 Canvas 像素相同，真实 Nikon D850 经 GUI 导出 **8256×5504、RGB uint16、ICC 728 字节**，与离线独立安装版核心导出最大像素差 0、差异样本 0。
- **30 项宿主 / 安装版核心检查**在禁止网络及 Homebrew / `/usr/local` 读取下通过：批量保存 8，既有 XMP 22。真实 NEF / CR3 / RAF 验证当前参数覆盖旧 ART 配置、原片哈希和未知元数据保留；同名中文路径、并发占用目标文件、核心启动失败、取消和临时文件清理均通过。
- 栅格蒙版与 ICC 随附资产移动 / 重命名、删除原资产后恢复，**1016×760 RGB uint16** 输出像素一致；Nikon 裁切旋转快照的 **717×994 RGB uint16** 保存前后输出也一致。构建、类型检查和 **11 项单测**通过。

证据：`artifacts/batch-save-installed-0.37/{report,pixels}.json`、`revision-installed-0.37/report.json`、`batch-save-offline-0.37/{report,pixels}.json`、`xmp-offline-0.37/report.json`、`batch-save-ci.log`、`install-0.37.json`、`asar-0.37.json`、`release-0.37-evidence.json`。实际界面为 `artifacts/batch-save-installed-0.37/partial-save.png`，错误原因和重试方式已检查。

本批实现批量另存 XMP，不自动覆盖原旁车，也不是整批事务。随附资产须与 XMP 一起移动；只有当前格式可恢复，未恢复旧 JSON 兼容。本轮没有重新验证性能 P95、全部 Nikon HE 模式或 Adobe 像素等效。任意角度 / 透视、完整 Adobe 参数与资产语义、HDR、非生成式 AI、跨平台和完整 ACR 画质 / 效率对照仍未完成，完整替代目标继续保留。

## 0.36 镜头校正后的吸管定位

从 `release/CaptRAW-0.36.0-arm64.dmg` 只读、隐藏挂载并安装至 `~/Applications/CaptRAW-0.36.app`。严格全应用签名检查通过，仍为 ad-hoc、未公证。处理版本 20 / 基线 4 和新 Logo 不变，ASAR 的 7 个构建文件与工作区一致。

- 修复前，受控蓝色色块开启 10mm 镜头校正后从显示坐标约 `(79.5,79.5)` 移至 `(71.7,74.5)`，吸管误采背景，得到 2984 K；修复后与未校正时均为 11566 K，精确通道系数相同。原始复现记录保存在 `artifacts/wb-optics/{before-fix,after-fix}.json`。
- **48 组独立核心回归**在安装版、禁止网络及 Homebrew / `/usr/local` 读取条件下通过。RGB 和人工 Bayer DNG、自动 / 手动 Lensfun、四方向旋转、裁切及色差开关的实际预览目标取样均保持系数一致；同配方 PNG 与修复前 0.35 完全相同。修复前核心在对应开启校正的样本中仍能复现错采，测试不是只验证新代码自洽。
- **24 项安装版隐藏 GUI 检查**通过：新定位检查 10，既有白平衡检查 14，页面错误 0。实际点击目标，验证适屏、已经绘制的 1:1 detail、裁切、旋转、撤销与 XMP 重开；同时复查真实 D850 的自动 / 预设 / 手动白平衡、未保存保护、无效输入保护和 TIFF16 导出。
- 真实 Nikon D850 桌面与离线独立核心输出均为 **8256×5504、RGB uint16、ICC 728 字节**，最大像素差 0、差异样本 0。开发核心的 D850 / X-T4 预设和自动白平衡有实际像素变化，已有旋转取样与独立输出检查通过；构建、类型检查及 11 项单测通过。

证据：`artifacts/wb-optics-offline-0.36/report.json`、`wb-optics-installed-0.36/report.json`、`wb-installed-0.36/{report,pixels}.json`、`white-balance/{report,pixel-report}.json`、`wb-optics/ci.log`、`install-0.36.json`、`asar-0.36.json`。本轮没有重新验证性能 P95、全部 Nikon HE 模式或 Adobe 像素等效。受控 DNG 不是真实 Nikon 样本；更多实拍镜头、EXIF / LCP 定位、任意角度拉直与 Adobe 裁切坐标互操作仍待验收，完整 ACR 替代尚未完成。

## 0.35 点曲线输入与 XMP 一致性

从 `release/CaptRAW-0.35.0-arm64.dmg` 只读、隐藏挂载并安装至 `~/Applications/CaptRAW-0.35.app`。全应用严格签名检查通过，仍为 ad-hoc，未公证。处理版本 20 / 基线 4 不变，已有 XMP 不取整或迁移。新 Logo 沿用用户原 SVG，其源校验值和安装版 ICNS 校验值与 0.34 一致。

- 构建、类型检查、**11 项单测**通过。**41 项安装版隐藏 GUI 检查**通过：点曲线 13、关闭 / 蒙版 / 曲线回归 19、XMP 9，页面错误 0。所有操作都经实际可见且可用的控件完成，OS 窗口隐藏且不可聚焦；原生文件对话框注入选择。
- 点曲线的新操作采用 0–255 整数坐标，支持多点、端点输入与拖动、方向键 / Shift、删除。输入框清空不改成零，Escape 恢复；输入和多次拖动均可单步撤销 / 重做。选择、聚焦、保存已有小数点不改变坐标和像素；新进程恢复相同预览。
- 当前 GUI 的 513 个样条采样与真实 ART 采样对应，最大 SVG 坐标差 `2.842170943040401e-14`。既有四组常规 / 极端曲线的独立核心采样对照也通过 `<1e-12` 门槛。不是以光滑图形替代实际像素处理。
- 安装版 Nikon D850 总曲线及 R 通道曲线输出为 **8256×5504、RGB uint16、带 ICC**，桌面与独立无界面导出最大像素差 0、差异样本 0。
- **22 项 XMP / 核心检查**在禁止网络、禁止 Homebrew 与 `/usr/local` 读取下通过。新增覆盖曲线名称同步、仅 R 通道预设、无曲线预设、名称缺点或冲突的提示、非法空坐标拒绝、小数及接近整数坐标三次往返。外部标准曲线编辑改变真实 TIFF 像素；未知元数据与原片保护仍通过。
- 安装包 ASAR 的 **7 个构建文件**与当前工作区 dist 逐字节相同。没有重新宣称性能 P95、Adobe 往返或 ACR 画质等效；完整替代目标继续保留。

证据：`artifacts/point-curve-installed-0.35/{report,spline,pixels}.json`、`revision-installed-0.35/report.json`、`xmp-installed-0.35/report.json`、`xmp-offline-0.35/report.json`、`curve-conformance.json`、`curve-ci.log`、`install-0.35.json`、`asar-0.35.json`、`release-0.35-evidence.json`。实际安装版截图为 `artifacts/point-curve-installed-0.35/raw-point-curve.png`。用户人工体验及 Adobe 对小数坐标 / 冲突名称的处理仍未验收。

## 0.34 输入配置资产与新标识

从 `release/CaptRAW-0.34.0-arm64.dmg` 只读挂载并安装至 `~/Applications/CaptRAW-0.34.app`。处理版本仍为 20、基线 4；旧安装版和用户原片保留。完整应用 `codesign --verify --deep --strict` 通过，签名为 ad-hoc，没有 Developer ID 或公证。

- 使用用户提供的 `raw_tonecurve_icon.svg`，源字节 SHA-256 为 `046aca59db488e9e1139cdb35096adc201d509d0a3b75b2ba098484f71396850`。标题栏与 favicon 使用同一 SVG，macOS ICNS 由其生成；移除旧 Swift 图标绘制代码。安装版图标与构建结果一致，隐藏 GUI 验证图片已加载且可见。
- 构建、类型检查及 **11 项单测**通过。**54 项安装版隐藏 GUI 检查**通过：配置导入 / 标识 12、白平衡 14、XMP 9、关闭 / 曲线 / 蒙版回归 19，页面错误 0。另在当前开发构建完成既有配置文件 GUI 12 项检查。
- DCP / RGB ICC 显式导入、中文空格路径、重复内容复用、真实 DCP 控件、撤销 / 重做、保存、移动 / 重命名、全新进程恢复及导出均完成。删除原配置和本地库后，配套 XMP 资产仍能恢复。新旧引擎候选切换保证坏资产打开失败后仍可继续调曝光和撤销。
- 延迟 IPC 回复测试由可见导入按钮发起：期间手动改白平衡，返回后使用当前状态；切换工具面板和照片后，迟到结果不能改写新照片。此测试只延迟回复；真实文件导入路径另有前述 GUI 验收。
- **24 项宿主 / 安装版核心检查**在 OS 禁网及拒绝 Homebrew 路径读取下通过：配置资产 10、XMP 14。包含现有 **160 / 160 DCP**、错误机型 / 非 RGB / 损坏输入拒绝、ICC / ICM 去重、缓存已加载后资产篡改拒绝、绝对引用快照、移动恢复、原子保存、链接 / 越界 / 清单不一致拒绝和 DCP 随附限制。
- DCP 与 ICC 的移动恢复 TIFF 为 **1016×760、RGB uint16、带 ICC**，与原输出最大像素差 0。安装版桌面 DCP 输出与移动后输出、独立无界面进程导出也逐像素相同。既有 Nikon D850 / Canon R5 / Fujifilm X-T4 配置处理回归通过；D850 矩阵 TIFF16 与固定 ART CLI 参考输出一致。双光源白平衡独立参考回归通过。
- 安装版主流程完成真实 RAW → 全局 / 蒙版编辑 → 1:1 → XMP → TIFF16 → 重开，首帧 **1491.12 ms**，通过 5 秒门槛；仅为一次隐藏窗口实测，不代表冷磁盘或滑杆 P95。安装版 ASAR 的 **7 个构建文件**与工作区 dist 逐字节一致，应用元数据一致。

证据：`artifacts/profile-import-installed-0.34/{report,pixels}.json`、`profile-assets-offline-0.34/{report,pixels}.json`、`white-balance-installed-0.34/report.json`、`xmp-installed-0.34/report.json`、`revision-installed-0.34/report.json`、`xmp-offline-0.34/report.json`、`main-installed-0.34/e2e-report.json`、`input-profiles/pixel-report.json`、`white-balance-reference/{native,pixels}.json`、`install-0.34.json`、`asar-0.34.json`、`release-0.34-evidence.json`。所有 E2E 均隐藏、不可聚焦，未自动打开可见应用；用户人工验收、跨机器 Gatekeeper 和完整 ACR 同级仍未完成。`CameraProfileDigest` 自动确认、增强 Look、校准签名关系仍未实现，不按同名或文件 MD5 猜测替代。

## 0.33 XMP 白平衡与历史测试清理

从 `release/CaptRAW-0.33.0-arm64.dmg` 只读挂载并安装至 `~/Applications/CaptRAW-0.33.app`。原生处理版本 20、初始基线 4；不迁移旧处理版本或 JSON。旧安装版与用户原片保留。应用采用 ad-hoc 签名，`codesign --verify --deep --strict` 通过；没有 Developer ID 或公证。

- **11 项单测、构建、类型检查通过**。历史文档 / GUI 专项共 41 个脚本改用 XMP，并去除旧 JSON 恢复验收；这不表示 41 个专项都在新安装包完整运行。
- **42 项安装版隐藏 GUI 检查**：白平衡 14、XMP 9、关闭 / 曲线 / 蒙版回归 19，页面错误 0。新增验证只聚焦或 Tab 不改参数，Escape 撤回完整白平衡，切换 DCP / 相机矩阵保留精确系数并重新投影数值，单步撤销恢复；Tint -150–150 的实际像素响应、标准字段保存和全新进程恢复。
- 安装版主流程完成真实 RAW → 全局 / 蒙版编辑 → 1:1 → XMP → TIFF16 → 重开；本机首个显示帧 **1044.71 ms**，通过 5 秒门槛。此为单次隐藏窗口实测，不代表冷磁盘或基础滑杆 P95 验收。
- **14 项宿主 / 安装版核心检查**在 OS 禁网及拒绝 `/opt/homebrew`、`/usr/local` 读取下通过。新增外部 Tint 修改使旧系数失效、Tint 单项预设保留 Temperature / Exposure；未知字段、限定符、嵌套蒙版、资产及原文件保护继续通过。
- **50 组独立白点正反转换**与 Colour Science 0.4.6 一致（显式使用 ART 的历史表项）；3 个自产双光源 DNG 的预览 / compose 系数与独立矩阵参考一致，灰块 RGB 相对偏差最大 **0.058%**，独立 TIFF16 像素相同。另验证同一 DNG 同时包含 ICC 与 DCP 时，嵌入 ICC 选择进入正确的相机矩阵回退路径。
- 安装版 D850 输出 **8256×5504、RGB uint16、带 ICC**；与独立 0.33 进程及安装版 0.32 渲染器读取同一 ARP 后逐像素一致。这验证接入与持久化一致性，不是 Adobe 画质等效。

证据：`artifacts/white-balance-reference/{reference,native,pixels}.json`、`white-balance-installed-0.33/{report,pixels}.json`、`xmp-installed-0.33/report.json`、`revision-installed-0.33/report.json`、`main-installed-0.33/e2e-report.json`、`xmp-offline-0.33/report.json`、`asar-0.33.json`、`release-0.33-evidence.json`。所有 E2E 窗口隐藏、不可聚焦，原生对话框注入选择；未自动打开可见应用，也不代替用户人工验收。完整 ACR 语义、Adobe 读取、画质与跨平台缺口仍见 [能力表](ACR-PARITY.md)。


## 0.32 XMP 文件替换验收

安装 `release/CaptRAW-0.32.0-arm64.dmg` 至 `~/Applications/CaptRAW-0.32.app`，挂载始终只读、不浏览、不自动打开。删除运行时旧 JSON 配方 / 预设读写与迁移；没有删除或转换用户已有文件。当前仍是 macOS ARM64 / SDR 中间原型。

- **9 项 XMP 安装版 GUI + 19 项关闭 / 曲线 / 蒙版回归**：真实 Canon R5 CR3 调节、径向蒙版、中文空格路径 XMP 保存、全新进程恢复且预览像素一致；XMP 预设创建 / 导出 / 导入、曝光单项应用、单步撤销重做；同名 Adobe 旁车自动读取、未生效字段说明可见、TIFF 导出、关闭与放弃、旧 JSON 明确拒绝。所有窗口隐藏、不可聚焦；文件对话框注入选择，HTTP/HTTPS 拦截，页面错误 0。
- **12 项宿主 / 原生检查**在 OS 禁网及禁止 Homebrew / `/usr/local` 读取下通过：缺失字段不制造默认值；未知命名空间、嵌套 Adobe 蒙版、标量限定符和多语言名称保留；温度外部修改使旧相机通道系数失效并实际改变像素；选择性预设、栅格资产、事务失败保护和取消。此层使用当前宿主源码与安装包内程序。
- 固定合成 RAW 的完整 ART 状态往返，**813×608 RGB uint16** 逐像素一致。安装版真实 RAW 的输出 **8183×5455 RGB uint16、带 ICC**，与独立安装版 0.28 核心读取保存的 ART 配置重渲染逐像素一致；独立核心同样在 OS 禁网、Homebrew 禁读下运行。
- SDK 严格检查本机 **994** 份 Adobe 包：**988** 份往返通过，**6** 份含重复 `crs:Group` 属性明确拒绝，未静默丢弃。本机 ACR 18.7 / ProcessVersion 15.4 编辑记录通过；这些 Adobe 资源仅用于本机 QA，不随源码或安装包再分发。
- 原生显影核心和分割核心与 0.31 二进制相同；新增固定 BSD-3-Clause XMP SDK 工作进程，链接系统 Expat / CoreFoundation，无 Homebrew 运行路径。TypeScript、3 项几何测试与 diff 检查通过。安装包未公证；原生程序单独核查签名，不能将其表述为整个应用通过严格签名验证。

证据：`artifacts/xmp-installed-0.32/{report,pixels}.json`、`xmp-offline-0.32/report.json`、`revision-installed-0.32/report.json`、`xmp-sdk/{report,local-report}.json`、`release-0.32-evidence.json`。截图 `saved-xmp.png` 与 `adobe-import.png` 来自安装版隐藏窗口。

当前标准映射只有曝光、色温及四条点曲线；其他 Adobe 字段保留并提示未参与显影。ART 特有参数通过有类型的 RDF 扩展保存。未完成完整 Adobe 数值、蒙版 / 修复结构、配置文件、Adobe 应用重新读取和像素等效验收；UTF-16 / UTF-32 桌面文件输入未接入。以前版本的记录、旧 JSON 测试夹具及命令仅用于对应源码归档，不构成当前格式兼容承诺。

```sh
npm run build:xmp
CAPTRAW_XMP_LOCAL=1 node tests/xmp-sdk.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.32.app/Contents/MacOS/CaptRAW" CAPTRAW_XMP_BINARY="$HOME/Applications/CaptRAW-0.32.app/Contents/Resources/native/captraw-xmp" CAPTRAW_XMP_E2E_OUT=artifacts/xmp-installed-0.32 node tests/xmp-e2e.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.32.app/Contents/MacOS/CaptRAW" CAPTRAW_XMP_BINARY="$HOME/Applications/CaptRAW-0.32.app/Contents/Resources/native/captraw-xmp" CAPTRAW_REVISION_OUT=artifacts/revision-installed-0.32 node tests/revision-e2e.mjs
CAPTRAW_ENGINE="$HOME/Applications/CaptRAW-0.32.app/Contents/Resources/native/captraw-engine" CAPTRAW_RESOURCES="$HOME/Applications/CaptRAW-0.32.app/Contents/Resources/native/resources" CAPTRAW_XMP_BINARY="$HOME/Applications/CaptRAW-0.32.app/Contents/Resources/native/captraw-xmp" CAPTRAW_XMP_DOCUMENTS_OUT=artifacts/xmp-offline-0.32 sandbox-exec -f tests/offline-native.sb node tests/xmp-documents.mjs
```




## 0.31 用户预设验收

从 `CaptRAW-0.31.0-arm64.dmg` 只读、不浏览、不自动打开挂载，安装到 `~/Applications/CaptRAW-0.31.app`。使用最终重打包后的应用复验；所有 E2E 窗口隐藏、不可聚焦，文件选择框显式模拟。预设测试使用独立 userData，未改动用户真实预设库。没有新增运行依赖；引擎仍为 19 / 基线 4。

- 预设 GUI **13 项**：真实 CR3 的选择调整项 / 创建、分组 / 搜索 / 重命名、实际像素变化与未选参数保留、单步撤销重做、更新、取消和重试、导出 / 删除 / 导入、应用重启后预设与配方恢复、未知版本拒绝、TIFF16 输出、跨相机应用对象蒙版以及 1080×720 小窗口的操作可达性。预设对话框打开时测试系统菜单“关闭文件”，照片保持打开。
- 开发验证发现取消按钮位于被锁定的工作区内，实际无法点击；已改为工作区外的进度对话框。另在首个安装包复现系统菜单越过 Web 对话框关闭照片，日志与截图为 `artifacts/presets-modal-before*`；现在菜单事件与页面快捷键共同遵守对话框状态。最终包已重跑上述流程。
- 独立宿主 **8 组**通过 OS 禁网与 Homebrew 禁读：选择性保存 / 应用、独立期望参数渲染、相同设置跳过、改名 / 更新 / 迁移 / 删除、固定栅格资产的独立生命周期、非法输入、内容校验失败、资产恢复阶段取消。原始 NEF 与 CR3 校验值不变。该层使用当前宿主源码与安装版原生程序；GUI 使用安装版 ASAR，并拦截 HTTP/HTTPS。
- 最终安装版的关闭 / 曲线 / 蒙版回归 **19 项**通过，连同预设共 **32 项隐藏 GUI 检查**，页面运行时错误为 0。安装版保存配方的 **8183×5455 RGB uint16、带 ICC** 输出与独立 0.28 核心重渲染逐像素一致。
- GUI 之外的原生预设应用：从 CR3 获取光线 / 曲线，在保留目标 NEF 其他参数和裁切的条件下应用，输出 **662×441 RGB uint16、带 ICC**，与独立 0.28 核心显式构建期望参数的输出逐像素一致。
- 包内 503 个原生文件、13 个分割 / 模型文件与 0.30 完全相同；签名、相对库依赖、模型与许可、ASAR 的 5 个构建文件核对通过，0.30 应用及发布归档校验值不变。TypeScript、3 项几何测试及 diff 检查通过。

证据：`artifacts/presets-installed-0.31/`、`presets-offline-0.31/`、`presets-core/pixels.json`、`revision-installed-0.31/`、`bundle-0.31.json`、`release-0.31-evidence.json`。

```sh
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.31.app/Contents/MacOS/CaptRAW" CAPTRAW_PRESETS_E2E_OUT=artifacts/presets-installed-0.31 node tests/presets-e2e.mjs
CAPTRAW_NATIVE_ROOT="$HOME/Applications/CaptRAW-0.31.app/Contents/Resources/native" CAPTRAW_PRESETS_OUT=artifacts/presets-offline-0.31 sandbox-exec -f tests/offline-native.sb node tests/presets.mjs
CAPTRAW_PRESETS_E2E_OUT=artifacts/presets-installed-0.31 CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb node tests/inspect-presets.mjs
CAPTRAW_PRESETS_E2E_OUT=artifacts/presets-installed-0.31 build/qa-venv/bin/python tests/inspect-presets.py
```

复跑依赖已登记的公开 RAW 样本、0.30 对象蒙版验收配方及其资产；独立参考使用保留的 0.28 安装版。预设暂仅支持 CaptRAW 格式及当前照片应用；Adobe XMP、强度 / 悬停预览、收藏、直接批量应用和自适应选区未实现。未宣称完整 ACR 对齐或人工验收通过。

## 0.30 增量验收

`CaptRAW-0.30.0-arm64.dmg` 只读、不浏览、不自动打开挂载后安装到 `~/Applications/CaptRAW-0.30.app`。所有 E2E 隐藏、不可聚焦，系统对话框由测试提供明确响应；没有可见窗口或人工验收。引擎 19 / 基线 4、模型与原生程序保持不变；相比 0.29，两个原生 bundle 共 516 个文件仅 `native/licenses/README.md` 更新许可说明，其他文件逐字节相同。

- **34 项安装版 GUI 检查通过**：框选 8 项、原有点选 7 项、关闭 / 曲线 / 蒙版回归 19 项。框选使用真实 Canon CR3，覆盖裁切旋转后的反向拖动、三候选、负点与逐步撤回、整框一步撤回、提交 / 撤销 / 重做、1:1 坐标、取消、切换工具、关闭准备中的照片以及局部调整后的 TIFF16 导出。点选额外验证重启恢复的画布像素一致。
- **8 项独立宿主检查通过 OS 禁网与 Homebrew 禁读**：既有候选 / 过期结果 / 提交 / 取消检查，加上同一调用时段取消准备、四个旋转及裁切下的框选资产一致、反向两角、非法范围、总提示数限制和负点修正。使用安装版原生程序和当前宿主源码；GUI 另运行安装版 ASAR。GUI 拦截 HTTP/HTTPS，点选两次启动主动验证外部请求失败；不宣称整个 Electron 通过 OS 沙盒禁网，历史限制见 0.29。
- 框选候选 **2046×1364** 与提交保存的资产逐像素相同。含裁切、90° 旋转与局部亮度的输出 **4091×6137、RGB uint16、带 ICC**，与独立 0.28 核心读取保存配方的输出逐像素一致。点选候选与原生覆盖同样一致；其 **5455×8183** TIFF 与独立输出一致。没有把接入一致性当作边缘质量真值。
- CR3 SHA-256 保持 `21430c36387efe65bd09ac0fcd724bfd959d93dd391ec811a1b741c8663becb5`。TypeScript、3 项几何测试、diff 检查通过；包内签名、相对动态库依赖、模型 / 许可、ASAR 的 5 个构建文件与安装包资源核对完成。0.29 应用和发布归档校验值不变。

证据：`artifacts/object-box-installed-0.30/`、`object-selection-installed-0.30/`（各含 `pixels.json`）、`object-box-offline-0.30/`、`revision-installed-0.30/`、`bundle-0.30.json` 与 `release-0.30-evidence.json`。框选截图为 `cropped-rotated-box.png` 与 `one-to-one-box.png`；均来自隐藏窗口。

```sh
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.30.app/Contents/MacOS/CaptRAW" CAPTRAW_OBJECT_SOURCE="$PWD/build/samples/canon-r5.CR3" CAPTRAW_BOX_E2E_OUT=artifacts/object-box-installed-0.30 node tests/object-box-e2e.mjs
CAPTRAW_NATIVE_ROOT="$HOME/Applications/CaptRAW-0.30.app/Contents/Resources/native" CAPTRAW_SEGMENT_ROOT="$HOME/Applications/CaptRAW-0.30.app/Contents/Resources/segmentation" CAPTRAW_OBJECT_OUT=artifacts/object-box-offline-0.30 sandbox-exec -f tests/offline-native.sb node tests/object-selection.mjs
CAPTRAW_OBJECT_E2E_OUT=artifacts/object-box-installed-0.30 CAPTRAW_OBJECT_KIND=box CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb node tests/inspect-object-selection.mjs
CAPTRAW_OBJECT_E2E_OUT=artifacts/object-box-installed-0.30 CAPTRAW_OBJECT_KIND=box build/qa-venv/bin/python tests/inspect-object-selection.py
```

此批补充人工框提示，不包含自动主体 / 天空 / 人物部位、候选重新推理编辑、边缘细化或 ACR 画质等效；完整替代目标仍未完成。

## 0.29 增量验收

`CaptRAW-0.29.0-arm64.dmg` 只读、不浏览、不自动打开挂载后安装到 `~/Applications/CaptRAW-0.29.app`。全部 E2E 窗口隐藏、不可聚焦，不打开可见窗口；不是人工验收。ART 显影核心保持引擎 19 / 基线 4；原生显影 bundle 与 0.28 逐文件相同。新增独立 SAM2.1 Small / ONNX Runtime 包及完整许可文件。

- **26 项安装版 GUI 检查通过**：真实 Canon CR3 的对象点选 7 项，原有关闭 / 曲线 / 蒙版 / 历史工作流 19 项。点选、排除点、候选切换、撤回提示、创建 / 撤销 / 重做、局部亮度、旋转、取消、保存重开和 TIFF16 导出完整执行。提交为中性蒙版，不自动改变局部亮度；退出对象模式清除临时提示与覆盖。
- 安装版对象流程的两次应用启动都拦截所有 HTTP/HTTPS，并主动验证外部请求失败，随后完成真实 CR3 全流程。独立宿主 / 两个原生处理进程另在 OS 禁网、禁读 Homebrew / usr/local 下通过 **5 组**检查：隔离快照、三候选复制提交、非法提示 / 最新请求 / 过期提交、编辑变化失效、准备与推理取消及重试。两个层次分别证明，不混称全应用 OS 禁网通过。
- 嵌套 `sandbox-exec` 与 Chromium 沙盒冲突，GUI 无法启动，诊断为 `sandbox initialization failed: Operation not permitted`。未关闭 Chromium 沙盒，失败日志保留在 `artifacts/object-selection-offline-gui-debug.log`；失败配置保留为研究记录，不作为正式 E2E 命令。另一次独立测试早于应用复制完成导致 ENOENT，已在完成安装后重跑，通过；这是测试编排错误。
- 提交的 **2046×1364** 候选 PNG 与原生实际蒙版覆盖逐像素一致。旋转后 **5455×8183、RGB uint16、带 ICC** 的 GUI 输出与独立 0.28 引擎读取保存配方的 TIFF 完全一致。原 CR3 SHA-256 保持 `21430c36387efe65bd09ac0fcd724bfd959d93dd391ec811a1b741c8663becb5`。此处验证接入与持久化，不代表物体边界真值或 ACR 质量通过。
- 截图发现创建按钮文字对比度不足，已修正并在重打包后重新执行真实 RAW 全流程。TypeScript、3 项几何测试及 diff 空白检查通过。包内原生程序 / 动态库签名、相对依赖、Small 模型校验值、许可文件、ASAR 构建文件及 0.28 应用 / 发布归档未变均验证。

证据：`artifacts/object-selection-installed-0.29/`（含 `candidates.png`、`pixels.json`）、`object-selection-offline-0.29/`、`revision-installed-0.29/`、`bundle-0.29.json`、`release-0.29-evidence.json`。重现：

```sh
CAPTRAW_NATIVE_ROOT="$HOME/Applications/CaptRAW-0.29.app/Contents/Resources/native" CAPTRAW_SEGMENT_ROOT="$HOME/Applications/CaptRAW-0.29.app/Contents/Resources/segmentation" CAPTRAW_OBJECT_OUT=artifacts/object-selection-offline-0.29 sandbox-exec -f tests/offline-native.sb node tests/object-selection.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.29.app/Contents/MacOS/CaptRAW" CAPTRAW_HTTP_OFFLINE=1 CAPTRAW_OBJECT_SOURCE="$PWD/build/samples/canon-r5.CR3" CAPTRAW_OBJECT_E2E_OUT=artifacts/object-selection-installed-0.29 node tests/object-selection-e2e.mjs
CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb node tests/inspect-object-selection.mjs
build/qa-venv/bin/python tests/inspect-object-selection.py
```

当前仅对象点提示。框选、语义主体 / 天空 / 人物部位、边缘细化、复杂画质对照仍未完成；完整非生成式 ACR 替代目标保持不变。

## 0.28 增量验收

从 `CaptRAW-0.28.0-arm64.dmg` 只读、不浏览、不自动打开挂载，安装到 `~/Applications/CaptRAW-0.28.app`。引擎 19 / 基线 4；保留 0.27 应用与归档。没有新增运行依赖或随包模型。GUI 全程隐藏、不可聚焦，对话框显式模拟；不等于可见窗口人工验收。

- **34 项安装版 GUI 检查通过**：栅格组件 7 项、资产保存 8 项、原有关闭 / 蒙版 / 曲线 / 历史工作流 19 项。栅格选择后显示引擎覆盖率与羽化控件，无渐变控制柄；画笔减去保留原组件。旋转、复制、删除、撤销重做、保存重启像素恢复、独立 TIFF 输出均验证。离开蒙版模式隐藏覆盖与绘制工具。
- **25 组独立核心检查通过**：新栅格 7 组、原资产事务 10 组、外部蒙版故障保护 8 组，均使用安装包核心，禁网并禁止读取 Homebrew / usr/local。包含资产被替换后的哈希校验、尺寸 / 格式、停用组件、缺少完整核心响应、渲染中删除文件和恢复；原配方不会被失败结果替换。
- 新栅格两种分辨率 × 四种旋转 × 裁切开关的 **16 组**原生覆盖与 1:1 区域逐像素一致。TIFF16 / ICC 与独立 0.27、预先变换的 16 位蒙版参考比较：全尺寸资产完全相同，低分辨率资产最大差 1（参考文件的 16 位量化）。四种旋转的羽化覆盖也一致；缩小预览与大图区域的均匀图引导滤波和独立双重盒式均值参考一致。
- 安装版栅格导出与独立核心的 TIFF16 / ICC 逐像素相同；旧资产保存 / 移动 / 重开的 3 个输出仍与 0.26 相同，9 个外部蒙版输出仍与 0.25 相同。上述新栅格定位 / 羽化测试使用受控 PNG，不代表真实对象分割、发丝或 ACR 质量验收。
- 修复了测试发现的羽化问题：ART 根据处理区域尺寸选择滤波降采样，导致 fit/detail 覆盖最大差 50/255；新栅格固定滤波采样，并按处理分辨率计算半径。旧外部蒙版保持原算法。补丁从固定原版 ART 压缩包重放，四个相关文件与构建树逐字节相同，重复应用不变。
- TypeScript 与 3 项几何测试通过。61 个原生文件的签名 / 链接与安装包匹配；60 个动态库、11 个输出 ICC、56 个 Lensfun 文件与 0.27 相同，ASAR 内 5 个构建文件与本地一致。0.27 应用与发布物校验值保持不变。

证据：`artifacts/raster-masks-offline-0.28/`、`raster-masks-gui/`、`mask-assets-offline-0.28/`、`mask-assets-gui-0.28/`、`external-masks-offline-0.28/`、`revision-installed-0.28/`、`raster-masks/patch-replay.json`、`native-bundle-0.28.json`、`release-0.28-evidence.json`。

本批是对象蒙版的组件接入：已有栅格配方可编辑，不提供对象选择创建工具。SAM2 工作进程、提示 UI、模型部署与质量验收仍未接入；完整 ACR 目标未完成。

复现新增核心测试：先 `build/qa-venv/bin/python tests/inspect-raster-masks.py --prepare`，再设置 `CAPTRAW_ENGINE` / `CAPTRAW_RESOURCES` 指向安装包，运行 `node tests/raster-masks.mjs` 和 `build/qa-venv/bin/python tests/inspect-raster-masks.py`。`CAPTRAW_RASTER_OUT` 可隔离结果目录，`CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb` 启用离线限制。GUI 设置 `CAPTRAW_APP` 指向安装版可执行文件，运行 `node tests/raster-masks-e2e.mjs`；旧资产 GUI 检查当前默认引擎 19，验证历史 0.27 时需设置 `CAPTRAW_EXPECT_ENGINE=CaptRAW-18`。

## 0.27 增量验收

从 `CaptRAW-0.27.0-arm64.dmg` 只读、不浏览、不自动打开挂载，安装到 `~/Applications/CaptRAW-0.27.app`。保留 0.26 应用和发布归档；引擎 18 / 基线 4。没有新增运行依赖或随包模型。所有 GUI 验收使用安装版真实 Chromium / Canvas / 包内核心，窗口隐藏、不可聚焦，对话框显式模拟；不等于可见窗口人工验收。

- **36 项安装版后台 GUI 检查通过**：资产保存 / 迁移 8、外部蒙版失败保护 9、关闭 / 曲线 / 蒙版回归 19；renderer 错误 0。真实保存按钮生成配方与资产文件夹；删除最初临时文件及原配方位置，移动文件夹、重命名配方、重启应用后显示像素完全相同。打开文档后删除配套文件，仍能继续编辑、另存和输出；再次从缺失 / 损坏的配套文件打开则报错并保留当前照片。恢复资产后可重新打开。
- 包内核心在禁网、禁读 Homebrew 下完成 **10 组资产保存检查**：原生枚举与重绑定、临时文件移除后的迁移、另存 / 去重、缺失 / 修改、未知版本 / 重复 / 尺寸 / 路径 / 引用集合、目录与文件符号链接、复制后故障与已有内容冲突、缺失源资产、四种工具及停用递归分量、普通与旧版配方。保存失败保留之前的 JSON 和冲突文件，不删除用户其他文件。
- 外部蒙版核心失败保护的 **8 组**回归继续通过，含预检查后处理过程中删除资产、同大小同时间戳替换、1:1 与输出；错误结果不发布。GUI 回归在恢复配方后针对实际私有资产副本注入删除，避免只删除已脱离运行路径的原文件而形成假测试。
- **12 组 TIFF16 / ICC 像素对照通过**：资产原生保存 / 移动和安装版恢复导出的 3 个结果与独立 0.26 输出逐像素相同；原有 9 个蒙版 / 反选 / 基础结果与独立 0.25 相同。来源是固定 RAW 的既有预览 JPEG，不扩大为完整 RAW 分辨率的分割质量结论。
- 退出回归复现旧的未等待异步清理留下缓存目录，记录在 `artifacts/mask-assets-cache-regression.log`。改为退出前同步清理本次私有目录后，三次新进程的目录都实际消失。保留其他实例及历史缓存。第一次 GUI 测试还修正了测试替身对 Electron 双参数对话框签名的误用；这不是产品保存错误。
- TypeScript 检查及 3 个几何测试通过。61 个原生文件的签名 / 链接及安装包匹配检查通过；60 个动态库、11 个输出 ICC、56 个 Lensfun 文件与 0.26 相同。安装 ASAR 与本地 5 个构建文件一致。原图、旧配方及 0.26 发布物的校验值保持不变。

证据：`artifacts/mask-assets-offline-0.27/`、`mask-assets-gui/`、`external-masks-offline-0.27/`、`external-masks-gui-0.27/`、`revision-installed-0.27/`、`native-bundle-0.27.json`、`release-0.27-evidence.json`。

```sh
npm run typecheck
npm test
npm run package
CAPTRAW_ENGINE="$HOME/Applications/CaptRAW-0.27.app/Contents/Resources/native/captraw-engine" CAPTRAW_RESOURCES="$HOME/Applications/CaptRAW-0.27.app/Contents/Resources/native/resources" CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb CAPTRAW_ASSETS_OUT=artifacts/mask-assets-offline-0.27 node tests/mask-assets.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.27.app/Contents/MacOS/CaptRAW" node tests/mask-assets-e2e.mjs
CAPTRAW_ASSETS_OUT=artifacts/mask-assets-offline-0.27 build/qa-venv/bin/python tests/inspect-mask-assets.py
CAPTRAW_ENGINE="$HOME/Applications/CaptRAW-0.27.app/Contents/Resources/native/captraw-engine" CAPTRAW_RESOURCES="$HOME/Applications/CaptRAW-0.27.app/Contents/Resources/native/resources" CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb CAPTRAW_EXTERNAL_OUT=artifacts/external-masks-offline-0.27 node tests/external-masks.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.27.app/Contents/MacOS/CaptRAW" CAPTRAW_EXTERNAL_OUT=artifacts/external-masks-offline-0.27 CAPTRAW_EXTERNAL_E2E_OUT=artifacts/external-masks-gui-0.27 node tests/external-masks-e2e.mjs
CAPTRAW_EXTERNAL_OUT=artifacts/external-masks-offline-0.27 build/qa-venv/bin/python tests/inspect-external-masks.py
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.27.app/Contents/MacOS/CaptRAW" CAPTRAW_REVISION_OUT=artifacts/revision-installed-0.27 node tests/revision-e2e.mjs
node scripts/source-release.mjs
```

对象选择 UI、源图坐标、正式栅格组件及手工修正尚未接入；常驻 SAM2 仍是独立源码验证。保存已有资产不需要模型，但不能据此声称对象蒙版产品闭环已经完成。源 RAW 关联仍依赖原路径，不包含丢失原片重定位。完整 ACR、HDR 和三平台目标仍未完成。

## 0.26 增量验收

从 `CaptRAW-0.26.0-arm64.dmg` 只读、不浏览、不自动打开挂载，安装到 `~/Applications/CaptRAW-0.26.app`。保留 0.25 应用和发布归档；处理版本仍为 17 / 基线 4。没有新增模型或运行依赖，不 commit / push。所有 E2E 窗口隐藏、不可聚焦，对话框显式模拟；没有可见窗口人工验收声明。

修复外部蒙版文件缺失后跳过覆盖率、错误作用于全图的问题。更新、compose、详细区域、保存和导出预先解码检查有效资产；渲染中读取失败通过独立错误通道阻止结果发布。缓存使用内容 SHA-256；恢复后重新处理，并在重试时清除旧错误提示。此批是对象蒙版接入前的故障保护，没有加入对象选择 UI、模型推理或可移植栅格配方。

- 最终安装版 38 项隐藏 E2E：资产故障与恢复 9、关闭 / 蒙版 / 曲线回归 19、输出流程回归 10；renderer 错误 0。验证损坏配方保留当前照片、保存重启像素相同、文件丢失后保留最后有效预览和待处理参数、拒绝覆盖现有配方与输出、主进程无法绕过验证、恢复后提示消失并成功导出。
- 包内核心在禁网及 Homebrew 禁读下通过 8 项场景：缺失 / 损坏 / 空引用，同大小同时间戳损坏替换，停用工具 / 区域 / 外部分量，递归添加 / 减去 / 相交分量，恢复后的相同像素，以及预检查后渲染期间删除文件。后者在预览和全尺寸 D850 导出中分别实测；错误预览不发布、已有输出不改写。不是只检查文件是否存在。
- 9 组有效外部蒙版 / 反选 / 基础 TIFF16 与独立安装版 0.25 逐像素一致，ICC 存在；来源为既有 NEF / CR3 / RAF 的固定预览 JPEG。此处不扩大为完整 RAW 分辨率的 AI 蒙版质量结论。另验证安装版恢复导出的 TIFF16 / ICC，以及输出工作流 7 个 GUI 文件的尺寸、色彩配置和真实 RAW 独立参考。
- 9 个相关上游文件从原始 ART 归档重新应用补丁，与实际构建源码逐字节一致。61 个原生文件的签名 / 链接通过；60 个动态库、11 个输出 ICC、56 个 Lensfun 数据文件与 0.25 相同。安装 ASAR 与本地 5 个构建文件一致；旧应用、发布归档及测试源文件校验值不变。

证据：`artifacts/external-masks-offline-0.26/`、`external-masks-gui/`、`external-masks/patch-replay.json`、`revision-installed-0.26/`、`output-installed-0.26/`、`native-bundle-0.26.json`、`release-0.26-evidence.json`。新测试复用 `docs/SEGMENTATION.md` 的固定探针输入，不重新生成它们。

```sh
npm run typecheck
npm test
npm run package
CAPTRAW_ENGINE="$HOME/Applications/CaptRAW-0.26.app/Contents/Resources/native/captraw-engine" CAPTRAW_RESOURCES="$HOME/Applications/CaptRAW-0.26.app/Contents/Resources/native/resources" CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb CAPTRAW_EXTERNAL_OUT=artifacts/external-masks-offline-0.26 node tests/external-masks.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.26.app/Contents/MacOS/CaptRAW" node tests/external-masks-e2e.mjs
CAPTRAW_EXTERNAL_OUT=artifacts/external-masks-offline-0.26 build/qa-venv/bin/python tests/inspect-external-masks.py
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.26.app/Contents/MacOS/CaptRAW" CAPTRAW_REVISION_OUT=artifacts/revision-installed-0.26 node tests/revision-e2e.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.26.app/Contents/MacOS/CaptRAW" CAPTRAW_OUTPUT_E2E_OUT=artifacts/output-installed-0.26 node tests/output-workflow-e2e.mjs
node scripts/source-release.mjs
```

## 0.25 增量验收

从 `CaptRAW-0.25.0-arm64.dmg` 只读、不浏览、不自动打开挂载，安装到 `~/Applications/CaptRAW-0.25.app`。处理版本仍为 17 / 初始基线 4；保留 0.24 应用和归档，不 commit / push。所有 E2E 窗口隐藏、不可聚焦，原生对话框由测试显式模拟，没有可见窗口人工验收声明。

新增单张与批量导出的原尺寸、长边、短边、固定宽高边界框、“不放大”和输出锐化数量 / 半径。原生浮点 Lanczos 缩放后执行 ART USM，之后才转换输出 ICC 和编码 JPEG / TIFF16；不使用 8 位预览作输出源。设置只作用于导出任务，保留本会话选择，重启恢复默认；不进入编辑配方。旧 API 未传 options 时仍保留完整 ART 参数中的输出字段。

- 最终安装版 45 项隐藏 E2E：输出工作流程 10、关闭 / 蒙版 / 曲线回归 19、五色域输出 8、批量导出回归 8，renderer 错误 0。验证小窗口控件可见、非法 / 空数值提示、Escape / 焦点恢复、横竖图尺寸、逐图批量处理、取消保留已有文件、真实 RAW 和配方不变。
- 最终包内核心在禁网及 Homebrew 禁读下通过 7 项场景；26 组 TIFF16 与独立 0.24 核心通过显式 ART ARP 输出逐像素一致。覆盖三种 RAW、旋转裁切、局部蒙版、全局锐化、原尺寸、长短边、边界框、放大限制、输出锐化和批量不可变快照。源文件校验值不变；非法参数、过大输出、极端比例舍入为零均拒绝创建文件。
- 输出锐化对灰阶渐变最大响应 20/65535、RAW 角落区域 6/65535，二者细节较少；补充自生成受控纹理，最大响应 2606/65535，且与旧核心相同处理精确一致。数量为 0 与关闭完全相同。RAW TIFF 的有效层级超过 256，存在非 257 倍数值，排除 8 位预览扩展成 16 位。
- 安装版 7 个新工作流程输出的尺寸 / ICC 检查通过，含真实 D850 缩放到 512×341，与独立 0.24 参考一致。另回归五种色域 TIFF、JPEG、全尺寸 D850 8256×5504 和批量快照输出的像素 / ICC 检查。
- 61 个原生文件的签名 / 链接及 44 项依赖清单通过；60 个动态库、11 个输出 ICC、56 个 Lensfun 数据文件与 0.24 字节相同。上游补丁、配方映射、构建接入和颜色分级代码与 0.24 源码归档一致；没有新运行依赖或模型。安装 ASAR 的 5 个构建文件与本地构建逐字节一致。

证据：`artifacts/output-offline-0.25/`、`output-installed-0.25/`、`revision-installed-0.25.json`、`export-colors-installed-0.25/`、`batch-installed-0.25/`、`native-bundle-0.25.json`、`release-0.25-evidence.json`。复现：

```sh
npm run typecheck
npm test
npm run package
build/qa-venv/bin/python tests/inspect-output-workflow.py --generate
CAPTRAW_ENGINE="$HOME/Applications/CaptRAW-0.25.app/Contents/Resources/native/captraw-engine" CAPTRAW_RESOURCES="$HOME/Applications/CaptRAW-0.25.app/Contents/Resources/native/resources" CAPTRAW_OUTPUT_OUT=artifacts/output-offline-0.25 CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb node tests/output-workflow.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.25.app/Contents/MacOS/CaptRAW" CAPTRAW_OUTPUT_E2E_OUT=artifacts/output-installed-0.25 node tests/output-workflow-e2e.mjs
CAPTRAW_OUTPUT_OUT=artifacts/output-offline-0.25 CAPTRAW_OUTPUT_E2E_OUT=artifacts/output-installed-0.25 build/qa-venv/bin/python tests/inspect-output-workflow.py
```

仍缺少 PPI / 物理单位、JPEG 质量、纸张 / 屏幕锐化预设、持久工作流程预设和水印。边界框固定宽高、保持比例；不宣称等于 ACR 的自动方向、参数或算法。照片画质盲评、性能 P95 / 峰值内存、完整 ACR 操作效率、三平台、HDR、AI 和 Adobe 资产迁移仍未完成。

## 0.24 增量验收

从 `CaptRAW-0.24.0-arm64.dmg` 只读、不浏览、不自动打开挂载，安装至 `~/Applications/CaptRAW-0.24.app`。处理版本 17 / 初始基线 4；保留 0.23 应用与发布文件，不 commit / push。全部 E2E 窗口隐藏且不可聚焦，原生对话框由测试显式模拟，不作可见窗口人工验收声明。

新增光学面板的自动 / 手动配置、镜头搜索、相机 / 镜头匹配状态，以及畸变 / 暗角 / 色差独立开关。状态来自当前拍摄参数下实际 Lensfun modifier flags；没有配置或焦距时明确提示，缺失的校正不可选。配方、撤销、同步及重启保留选择。

- 核心 7 项场景覆盖固定 NEF / CR3 / RAF、旧版默认参数与 PNG、开关往返 / 重新打开、三个独立校正、匹配失败 / 手动选择、非法参数、缺少元数据、旋转裁切、保存与同步字段。最终包内核心在禁网及 Homebrew 禁读下运行；独立 0.23 参考进程同样在该沙箱内。
- D850 的三个独立校正对适屏 RGB8 最大响应分别为畸变 82、暗角 22、色差 12，关闭后与无校正照片最大差 0。R5 样本的自动镜头匹配失败，手动选择 Sigma 50mm Art 可实际校正；X-T4 样本的匹配仅有畸变 / 色差，不能将数据库存在误写成暗角通过。
- 三种 RAW 的 512×384 TIFF 均为 uint16 且带 sRGB ICC，与独立 0.23 核心读取同一完整 ART 配方的输出逐像素一致；对应 1:1 PNG 经 RGB8 量化也完全一致。安装版 R5 全尺寸输出 8183×5455，与独立旧核心和详细区域分别比较。
- 已保留 0.23 的 D850 热更新 / 重开不一致证据。根因为镜头暗角在 RAW 预处理阶段应用，原刷新只覆盖 `ALLNORAW`；当前改为 `FIRST`。适屏转换此前因质量分支跳过镜头色差，现按实际可用且选中的色差校正启用高质量路径。有效完整配方的全质量导出算法不变；不把旧版错误预览当作应保留画质。
- 固定 ART 全部补丁从干净归档重放，二次应用幂等，26 个修改文件与实际编译源码一致（包括 2 个 GUI 参数支持文件）。包内 61 个原生文件签名 / 链接路径和 44 项依赖检查通过；60 个动态库、11 个输出色彩文件及 56 个 Lensfun 数据文件与 0.23 字节一致。没有新增运行依赖或模型。

最终安装版共 38 项隐藏 E2E 通过，renderer 错误 0；计数与原始报告见 `artifacts/release-0.24-evidence.json`。光学 8 项涵盖真实图像响应、暗角撤销重做、手动匹配、中文配方 / 重启、小窗口、模式隔离、1:1、TIFF16 与无元数据提示；另回归关闭文件 / 蒙版 / 曲线 19 项、颜色范围 11 项。所有测试保持隐藏窗口。

证据：`artifacts/optics/023-refresh-diagnostic.json`、`optics-offline-0.24/`、`optics-installed-0.24/`、`revision-installed-0.24.json`、`color-range-installed-0.24/`、`patch-audit-0.24.json`、`native-bundle-0.24.json`。复现：

```sh
npm run package
CAPTRAW_ENGINE="$HOME/Applications/CaptRAW-0.24.app/Contents/Resources/native/captraw-engine" CAPTRAW_RESOURCES="$HOME/Applications/CaptRAW-0.24.app/Contents/Resources/native/resources" CAPTRAW_OPTICS_OUT=artifacts/optics-offline-0.24 CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb node tests/optics.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.24.app/Contents/MacOS/CaptRAW" CAPTRAW_OPTICS_E2E_OUT=artifacts/optics-installed-0.24 node tests/optics-e2e.mjs
CAPTRAW_OPTICS_OUT=artifacts/optics-offline-0.24 CAPTRAW_OPTICS_E2E_OUT=artifacts/optics-installed-0.24 build/qa-venv/bin/python tests/inspect-optics.py
```

镜头标定仍采用随包 Lensfun；没有校正强度、手动畸变 / 暗角数值、去边、内置镜头信息与 ACR LCP 导入，也未验收所有焦距 / 光圈、器材和边缘画质。手动同步复制所选机身和镜头，用户需确认实际器材一致；自动模式则逐目标匹配。性能 P95、峰值内存与 ACR 质量 / 操作耗时对照仍未完成。其他平台、HDR、AI 和 Adobe 资产迁移保持未完成。

## 0.23 增量验收

新增颜色范围蒙版，安装包为 `CaptRAW-0.23.0-arm64.dmg`，本机安装至 `~/Applications/CaptRAW-0.23.app`。处理版本 16、初始基线仍为 4，支持恢复引擎 15 及此前已支持版本。旧应用及归档保留，无 commit / push；所有 GUI 验证均隐藏、不聚焦窗口，原生对话框由测试模拟。

最终安装版共 40 项隐藏 E2E 通过：颜色蒙版 11 项、亮度取样 10 项和原有编辑流程 19 项；没有 renderer 错误。原有亮度范围核心 6 项及独立像素检查也通过。

- 颜色蒙版 GUI 11 项：仅在蒙版模式出现、点击 / 框选、Shift 最多五色、Option 删点、撤销重做、精细度 / 实际局部调整、离开模式隐藏、完整保存与重启恢复、1:1 取样与适屏一致、小窗口可见、TIFF16、Escape 取消、迟到取样丢弃及真实 NEF 取色。
- 核心 7 项在最终包内、无网络且 Homebrew 禁读下通过：浮点样本 / 缓存、局部调整隔离、全局变化失效、非法参数、组件组合、旋转 / 裁切 / 1:1、持久化、NEF / CR3 / RAF 输出。三种 RAW 的 TIFF16 与独立 0.22 核心读取同一完整 ART 配方的输出逐像素相同。
- 独立 ICC 转换的量化 Lab 参考与取样最大差约 0.497（参考为 8 位量化）；LittleCMS CIEDE2000 独立计算与覆盖 PNG 最大差约 0.198/255。受控样本局部亮度产生 39/255 的最大响应，未选中区域最大差 0；细节关联选区、反选、添加 / 减去 / 相交及空间变换通过。
- 初次 45MP 左右 RAW 全质量颜色取样在开发核心中测得 D850 约 1097ms、R5 约 1024ms、X-T4 约 778ms；安装版原始测量另见报告。不是 P95 或全工作流性能保证。重复取样复用约 12 字节/像素的缓存，退出模式释放。

矩形取样采用各 Lab 通道中值作为代表色，五个样本按最大覆盖率合并。该实现复用 ART 色差模块，未证明复杂区域选择、肤色、混合光与 ACR 的算法或画质等效；不把新增控件视为完整平替完成。

证据：`artifacts/color-range-offline-0.23/`、`color-range-installed-0.23/`、`luminance-picker-installed-0.23/`、`revision-installed-0.23.json`、`patch-audit-0.23.json`、`native-bundle-0.23.json`、`release-0.23-evidence.json`。

```sh
npm run build
build/qa-venv/bin/python tests/inspect-color-range.py --generate
node tests/color-range.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.23.app/Contents/MacOS/CaptRAW" CAPTRAW_COLOR_RANGE_E2E_OUT=artifacts/color-range-installed-0.23 node tests/color-range-e2e.mjs
CAPTRAW_COLOR_RANGE_OUT=artifacts/color-range-offline-0.23 CAPTRAW_COLOR_RANGE_E2E_OUT=artifacts/color-range-installed-0.23 build/qa-venv/bin/python tests/inspect-color-range.py
```

## 0.22 增量验收

从最终 DMG 只读、不浏览、不自动打开挂载安装至 `~/Applications/CaptRAW-0.22.app`。保留 0.21 发布文件与应用；处理版本 15 / 基线 4。全部 E2E 使用隐藏、不可聚焦窗口，原生对话框由测试明确模拟；无 commit / push。

本批增加多选照片的批量 JPEG / TIFF16 导出。每张照片使用点击时的完整配方快照和独立核心；输出同名自动编号、原子发布。结果清单展示实际路径与逐文件错误，取消保留已完成文件，失败后继续下一张。单张导出的保存文件流程保留。

- 原生批量 11 项：NEF / CR3 / RAF 参数合成与 0.21 一致，包含旧 profile、新调整、裁切旋转、曲线、局部蒙版、修复及未暴露 ART 字段；同名来源、输入错误、进行中取消、异常退出、启动失败、快照不可变和原子不覆盖均通过。最终包内核心在禁止网络及 Homebrew 读取条件下再次通过；旧版参考进程不在该沙盒内。
- 安装版批量 GUI 8 项：多选范围、中文及空格路径、同名保留、取消文件夹选择、JPEG 色域、取消任务、失败后继续、快照与后续编辑独立；8 项单张导出和 19 项原有编辑流程回归通过，所有报告无 renderer 错误。
- 7 对 TIFF 均为 uint16、带 ICC、像素最大差 0。其中三种 RAW 的裁切导出对照独立 0.21 核心；安装版真实 NEF 为 8256×5504，对照独立全分辨率输出；其他为灰阶快照及桌面参数对照。4 个批量 JPEG 检查出嵌入 Display P3 ICC。
- 61 个包内原生文件校验和及签名通过，44 个依赖记录；60 个动态库及输出 ICC 与 0.21 字节一致。新增核心接口及初始化改动仅在 `native/core.cc`，ART 处理补丁不变。安装 ASAR 的 5 个构建文件与本次 dist 字节一致。

退出测试发现上游可选 ExifTool 会从 PATH 启动并在强制停止核心后残留。现明确禁用外部 ExifTool、使用包内 Exiv2 / LibRaw；重跑测试自然退出。依赖外部 ExifTool 的未验证元数据兜底不作支持承诺。输出目录原子发布目前只在本机 APFS 验收，其他文件系统和其他平台待测。

证据：`artifacts/batch-export-offline-0.22/`、`batch-export-installed-0.22/`、`export-colors-installed-0.22/`、`native-bundle-0.22.json`、`release-0.22-evidence.json`。复现：

```sh
npm run build
node tests/batch-export.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.22.app/Contents/MacOS/CaptRAW" CAPTRAW_BATCH_E2E_OUT=artifacts/batch-export-installed-0.22 node tests/batch-export-e2e.mjs
build/qa-venv/bin/python tests/inspect-batch-export.py artifacts/batch-export-offline-0.22/report.json artifacts/batch-export-installed-0.22/report.json
```

批量配方保存、输出尺寸 / 锐化与完整 ACR 效率对照尚未完成；HDR、本地 AI、Adobe 显影资产迁移及另外两个平台继续保留为未完成目标。

## 0.21 增量验收

从最终 DMG 只读、不浏览、不自动打开挂载安装至 `~/Applications/CaptRAW-0.21.app`，随后卸载。保留 0.20 应用与发布归档；引擎 15 / 基线 4，未 commit / push。

- 新增胶片条多选及同步设置：活动照片作为来源，⌘ 增减、Shift 连选、⌘A 全选，Option+S 打开同步对话框。提供 13 类已接入调整，包括可选的裁切、蒙版及修复；默认不选这三项。目标相机配置分别保留，白平衡复制色温 / 色调，不跨相机复制感光通道系数；来源投影近似时明确提示。
- 独立核心串行准备目标完整 ART 配置及实际预览，全部成功后才更新会话。每张目标一步撤销，相同设置不添加历史；取消和后续目标失败均不部分提交，失败显示照片名称。来源画布和活动处理进程不切换；缩略图从实际渲染生成。
- **11 项安装版同步 E2E**通过：选择、空设置拒绝、对话框取消、原生菜单快捷键隔离、对比时同步快捷键禁用、小窗口控件、实际缩略图、未选择参数 / 照片保持、独立撤销 / 重做、无变化同步、中文 / 空格路径、重启恢复、处理中取消和后续目标失败。真实 D850 → R5 / X-T4 同步、键盘入口、RAW 工作进程已报告进度后的取消、CR3 全尺寸导出也通过。加上关闭 / 蒙版 / 曲线回归 19 项和亮度取样回归 10 项，共 **40 项检查，页面错误 0**。全程隐藏、不可聚焦，未作可见窗口人工验收。
- 6 项原生接入场景使用固定三种 RAW；同步工作核心及当前独立导出核心由 `sandbox-exec` 禁止网络和 Homebrew 读取，参照核心来自保留的 0.20。所有可选组的目标参数和 PNG 与明确构造的预期配置完全一致，并保留目标输入配置和不在界面中的 ART 参数。源文件哈希不变。
- 两组 RAW 裁切 TIFF16 与 0.20 独立导出逐像素一致；安装版同步后的 R5 **8183×5455** TIFF16 带 sRGB ICC，与独立核心完全一致。亮度图开启时的桌面 TIFF16 也继续通过独立比较。以上是接入与回归证据，不是 ACR 画质等效验证。
- 诊断曾在已有预览状态的同进程导出中观察到间歇性 **1/65535** 通道差异，随后复测未稳定重现，原因未定。保留 `warm-export-diagnostic.json` 与本批 warm / fresh 输出记录；未放宽独立进程导出逐像素比较。本次实际桌面导出使用全新进程，通过精确比较。
- 包内原生核心哈希与 0.20 完全一致：`ca40a52cbd4a04cf2db3fe86bede89bec03e5074ed440a42b0590a5ca56413fc`。61 个原生文件 / 44 项依赖、加载路径与签名验证通过；60 个动态库和输出 ICC 不变。10 个原生源码 / 构建文件与 0.20 源码归档逐字节一致，22 个上游补丁文件也未改变。本批没有增加原生算法或运行依赖。TypeScript、3 个单元测试及打包通过。

证据：`artifacts/synchronize/`、`synchronize-installed-0.21/`、`revision-installed-0.21.json`、`luminance-picker-installed-0.21/`、`native-source-0.21.json`、`native-bundle-0.21.json`、`release-0.21-evidence.json`。日志：`build/installed-0.21-*.log`、`sync-offline-0.21.log`。

复现（需要固定三种 RAW、灰阶样本、QA Python 和保留的 0.20 独立参考核心）：

```sh
npm run package
CAPTRAW_ENGINE="$HOME/Applications/CaptRAW-0.21.app/Contents/Resources/native/captraw-engine" CAPTRAW_RESOURCES="$HOME/Applications/CaptRAW-0.21.app/Contents/Resources/native/resources" node tests/synchronize.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.21.app/Contents/MacOS/CaptRAW" CAPTRAW_SYNC_E2E_OUT=artifacts/synchronize-installed-0.21 node tests/synchronize-e2e.mjs
CAPTRAW_SYNC_E2E_OUT=artifacts/synchronize-installed-0.21 build/qa-venv/bin/python tests/inspect-synchronize.py
```

离线验收的本机 `build/sync-offline-engine` 是指向安装核心的只读沙箱启动脚本，其原文及哈希列入发布证据；上述普通复现命令自身不启用沙箱。同步仍需显式保存每张配方；自动多图联动、批量保存 / 导出、相机配置同步和大量照片吞吐尚未验收。颜色 / 深度范围、AI、HDR、Adobe 资产与其他平台继续未完成。Nikon 解码库未变，29 模式证据仍来自 0.9。

交互依据：[Adobe 多图选择与同步说明](https://helpx.adobe.com/camera-raw/desktop/get-started/overview-and-setup/navigate-open-save-images-camera.html)；同步使用 CaptRAW / ART 参数，不承诺 Adobe 参数数值或色彩等效。

## 0.20 增量验收

从最终 DMG 只读、不浏览、不自动打开挂载安装至 `~/Applications/CaptRAW-0.20.app`，随后卸载。保留 0.19 安装版及发布归档。引擎仍为 15、初始基线 4；本批增加只读取样和显示接口，不改变配方处理版本。未 commit / push。

- 亮度范围支持照片点击及拖框取样。单击读取原图全分辨率 5×5 像素，边缘 / 裁切处截断；范围使用局部调整前的 ART Lab L* 浮点数据。拖动显示选框，一次完成一步撤销；Escape 取消，离开工具或编辑变化后忽略迟到结果。
- “显示亮度图”在适屏及真正的 1:1 显示相同处理阶段的灰度数据，包含全图上下文缓存平移。局部曝光不会改变该图及取样值；开关不成为历史或配方内容，缩略图及输出保持实际照片。照片取样默认提供两侧各 10 L* 过渡，后续保留用户过渡宽度。
- **39 项安装版隐藏 GUI 检查**通过：取样 10 项、范围 10 项、关闭 / 蒙版管理 / 点曲线回归 19 项。覆盖真实 RAW 点击、拖框、一步撤销、模式隔离、小窗口、1:1、中文 / 空格路径、重启恢复与 TIFF16。另用受控延迟回复确认退出工具后不会发生迟到编辑。页面错误 0。全部 E2E 窗口隐藏、不可聚焦，原生对话框显式响应；不是可见窗口人工验收。
- 禁网且禁止 Homebrew 读取条件下，新增原生 6 项场景、既有范围 7 项场景通过。灰阶点 / 区域取样与独立 sRGB→CIE L* 计算最大误差 **0.000701 L***；灰度 PNG 最大量化误差小于 **0.5/255**。旋转、裁切、详细区域及缓存平移位置正确；局部曝光不污染取样，前置全局曝光使缓存失效。
- D850 / R5 / X-T4 首次全质量 5×5 取样分别约 **1149 / 1066 / 821 ms**，本机重复缓存请求均小于 **0.1 ms**。这是本次核心请求耗时，不包含首次打开、UI 排队或整套性能 P95；首次全图处理有额外内存开销，尚无峰值内存验收。
- 新显示接口开启前后与 0.19 独立核心的默认 PNG / 原生配置完全相同。12 组范围 TIFF 与保留的 0.18 核心读取同一完整配置后的结果逐像素一致；安装版取样后、显示亮度图时导出的 TIFF16 也与独立核心一致，带 sRGB ICC，原片字节未变。此项验证接入和回归，不代表 ACR 等效画质。
- 包内 61 个原生文件签名 / 加载路径及 44 项依赖清单核查通过；60 个动态库（含 Nikon 解码库）和输出 ICC 与 0.19 相同。固定 ART 源码累计重放、二次应用幂等、22 个补丁文件与实际编译源码一致；本批仅改变 `rtengine.h`、`ipcolorcorrection.cc` 两个上游文件。TypeScript、3 个单元测试和安装包构建通过。

证据：`artifacts/luminance-picker/`、`luminance-picker-installed-0.20/`、`luminance-range/`、`luminance-range-installed-0.20/`、`revision-installed-0.20.json`、`native-bundle-0.20.json`、`source-patch-audit-0.20.json`、`release-0.20-evidence.json`。所有原生与 GUI 测试日志位于 `build/*0.20*.log`。

复现本批（准备三种固定 RAW、自制灰阶样本和 QA Python；保留 0.19 / 0.18 安装版作独立参考）：

```sh
npm run package
build/qa-venv/bin/python tests/inspect-luminance-range.py --generate
CAPTRAW_ENGINE="$PWD/build/bundle/native/captraw-engine" CAPTRAW_RESOURCES="$PWD/build/bundle/native/resources" CAPTRAW_SANDBOX_PROFILE="$PWD/tests/offline-native.sb" node tests/luminance-picker.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.20.app/Contents/MacOS/CaptRAW" CAPTRAW_PICKER_E2E_OUT=artifacts/luminance-picker-installed-0.20 node tests/luminance-picker-e2e.mjs
CAPTRAW_PICKER_E2E_OUT=artifacts/luminance-picker-installed-0.20 build/qa-venv/bin/python tests/inspect-luminance-picker.py
```

取样与范围沿用 ART 语义，尚无 ACR 数值、画质及操作效率等效证明。颜色 / 深度范围、非生成式 AI、HDR、Adobe 资产导入及其他平台仍未完成。29 个 Nikon HE 模式未在本批重跑，其独立验证仍来自 0.9，不能将库文件未变视为新的模式验收。

## 0.19 增量验收

安装包以只读、不浏览、不自动打开的方式挂载，安装到 `~/Applications/CaptRAW-0.19.app` 后卸载映像。引擎 15、初始显影基线 4；保留 0.18 安装版与归档，未 commit / push。

- 新增 ART 原生 Lab L* 亮度范围组件：四个边界控制、软过渡 / 硬边、添加 / 减去 / 相交、反选及完整配方恢复。新建调整中性，立即显示真实覆盖；Shift+L 新建，编辑模式隐藏范围控件与覆盖层。
- **10 项安装版隐藏 GUI 检查**通过：数值 / 拖动 / 键盘一步撤销、Escape 取消草稿、重置、组件运算、中文及空格路径、重启恢复像素、最小窗口、1:1、TIFF16 和引擎 14 配方恢复。旧配方由保留的 0.18 独立核心生成，不依赖开发服务器或预先保存的测试状态。
- **19 项安装版回归**通过：关闭 / 保存 / 放弃 / 取消、蒙版管理与工具隔离、多点曲线和退出保护。另复测实际覆盖层开关、1:1、平移与编辑模式隐藏。页面错误 0；所有 E2E 窗口隐藏、不可聚焦，原生对话框由测试显式响应。后台截图检查控件布局，不宣称可见窗口人工验收。
- 原生套件在禁网、禁止读取 Homebrew 路径下完成 7 项场景。自制带 ICC 灰阶 / 纹理图检查范围、过渡、覆盖、旋转与 1:1；NEF / CR3 / RAF 均完成范围显影与 16 位输出。12 组输出与 0.18 独立核心直接读取同一 ART 配置后的结果逐像素一致，均为 uint16、带 sRGB ICC。桌面与独立输出也一致。这验证接入，不是 ACR 画质等效证明。
- 组合测试曾证实后续纹理 / 清晰度 / 降噪重新选择亮度，导致原覆盖区外 RGB8 最大变化分别为 40 / 29 / 19。已复用 ART LinkedMaskManager，保留色彩校正前的选区，三者在该回归样本中均降为 **0**；区内仍有实际效果。半精度关联覆盖是 ART 原生机制。普通范围的中性、覆盖区外、旋转及 1:1 像素最大差也为 0；组件运算受透明度量化影响，最大误差小于 2/255。
- 包内 61 个原生文件与依赖加载路径、签名验证通过，44 项依赖清单保留；60 个动态库（含 Nikon 解码器）和输出 ICC 与 0.18 相同。22 个 ART 补丁文件未变，本批只扩展接入层；未重跑 29 个 Nikon HE 模式，其证据仍来自 0.9。3 个单元测试、TypeScript 和打包通过。

证据：`artifacts/luminance-range/`、`luminance-range-installed-0.19/`、`revision-installed-0.19.json`、`mask-overlay-installed-0.19.json`、`native-bundle-0.19.json`、`release-0.19-evidence.json`。自制样本由 `tests/inspect-luminance-range.py --generate` 生成，来源为本项目程序化灰阶 / 纹理；原片与旧配方哈希未变。

复现本批（先准备固定 RAW 样本，并保留 0.18 安装版作为独立核心参考）：

```sh
npm run package
build/qa-venv/bin/python tests/inspect-luminance-range.py --generate
CAPTRAW_ENGINE="$PWD/build/bundle/native/captraw-engine" CAPTRAW_RESOURCES="$PWD/build/bundle/native/resources" CAPTRAW_SANDBOX_PROFILE="$PWD/tests/offline-native.sb" node tests/luminance-range.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.19.app/Contents/MacOS/CaptRAW" CAPTRAW_RANGE_E2E_OUT=artifacts/luminance-range-installed-0.19 node tests/luminance-range-e2e.mjs
CAPTRAW_RANGE_E2E_OUT=artifacts/luminance-range-installed-0.19 build/qa-venv/bin/python tests/inspect-luminance-range.py
```

照片点击 / 区域取样、灰度亮度图、颜色和深度范围蒙版仍缺失；当前范围尺度与处理次序不等于 ACR。完整 ACR 目标、非生成式 AI、HDR、Adobe 资产导入及其他平台继续保留为未完成项。


## 0.18 增量验收

从最终 DMG 只读、隐藏挂载安装到 `~/Applications/CaptRAW-0.18.app`，随后卸载映像；保留 0.17 安装版与发布归档，哈希未变。引擎版本仍为 14、基线 4；本批仅扩展可选输出请求，不改变显影配方。未 commit / push。

- 导出可选 sRGB、Adobe RGB (1998)、ProPhoto RGB、Display P3、Rec.2020，JPEG 为 8 位，TIFF 为 16 位。复用 ART 自带的五个 Public Domain ICC，转换走 ART 高精度输出管线，再嵌入同一配置文件原字节；不是对预览改标签。使用相对色度及黑点补偿。默认 sRGB 输出与 0.17 相同，原生调用省略色域时保留完整配置中的输出设置。
- 原生核心在禁网、禁止 Homebrew 读取下通过四组验证。五种 TIFF 输出都与 0.17 独立核心按相应原生配置生成的参考逐像素一致，五种 JPEG / TIFF 均嵌入正确 ICC；默认及显式 sRGB 输出一致。NEF、CR3、X-Trans 三种 RAW 的 512×384 ProPhoto TIFF 也与该参考一致，源文件不变。它验证接口接入与原生处理，不是 ACR 画质对照。
- 人工生成的 17³ ProPhoto 色块共 117,912 个通道样本，sRGB 输出有 37,304 个通道到达 0 / 65535，ProPhoto 输出为 0。各色域输出像素不同，证明保留了受控输入中超出 sRGB 的颜色。这是有意包含宽色域颜色的测试图，不能推广为任意照片的画质指标。
- 新增 **8 项安装版隐藏 E2E**：五种输出选择、键盘焦点 / Escape、外部点击关闭、配方和预览不变、JPEG、小窗口、无效请求、取消保留已有文件、真实 RAW 重试。五种桌面 TIFF 及 Adobe RGB JPEG 与独立核心输出一致；D850 的 **8256×5504** ProPhoto TIFF 为 uint16，ICC 原字节正确，与独立安装核心输出逐像素一致。
- 回归关闭 / 蒙版 / 点曲线 19 项、颜色分级 13 项，总计 **40 项安装版隐藏 GUI 检查、页面错误 0**。分级后的 sRGB TIFF16 仍与独立导出完全一致，1:1 对应区域 RGB8 量化差为 0。全部窗口隐藏、不可聚焦，原生对话框由测试提供响应；后台截图已检查，不等于人工可见窗口验收。
- 核心与 60 个包内动态库的哈希 / 加载路径核查通过，44 项依赖清单保留。所有库和输出 ICC 与 0.17 相同；Nikon 解码库未改，29 模式证据仍来自 0.9。本批还从固定 ART 源码累计重放全部补丁，22 个文件与实际编译源码一致，重复应用不变。三个单元测试、TypeScript 和安装包构建通过。

输出选择只在当前应用会话保留，重启恢复 sRGB；不写入显影配方。预览和直方图仍为 sRGB SDR，没有所选输出色域的软打样、色域警告或 HDR 显示。自定义 ICC、输出尺寸 / 锐化 / 水印与其他格式仍未接入；完整 ACR 画质、操作效率、非生成式 AI、资产迁移与其他平台仍有缺口。

证据：`artifacts/export-colors/`、`export-colors-installed-0.18/`、`color-grading-installed-0.18/`、`native-bundle-0.18.json`、`source-patch-audit-0.18.json`、`release-0.18-evidence.json` 与 `build/installed-0.18-*.log`。输出色域功能参考 [Adobe 的 Camera Raw 色彩空间说明](https://helpx.adobe.com/x-productkb/multi/camera-raw-color-spaces.html)，不将其当作本产品画质证据。

复现新测试需现有三种公开 RAW、QA Python 环境和保留的 0.17 参考安装版：

```sh
npm run build
node scripts/bundle-native.mjs
build/qa-venv/bin/python tests/inspect-export-colors.py --generate
CAPTRAW_ENGINE="$PWD/build/bundle/native/captraw-engine" CAPTRAW_RESOURCES="$PWD/build/bundle/native/resources" CAPTRAW_SANDBOX_PROFILE=tests/offline-native.sb node tests/export-colors.mjs
CAPTRAW_APP="$HOME/Applications/CaptRAW-0.18.app/Contents/MacOS/CaptRAW" CAPTRAW_EXPORT_E2E_OUT=artifacts/export-colors-installed-0.18 node tests/export-colors-e2e.mjs
CAPTRAW_EXPORT_E2E_OUT=artifacts/export-colors-installed-0.18 build/qa-venv/bin/python tests/inspect-export-colors.py
```

## 0.17 增量验收

0.17 从最终 DMG 只读、隐藏挂载安装至 `~/Applications/CaptRAW-0.17.app`，随后卸载映像。保留 0.16 安装版和四个发布归档，哈希未变。引擎版本更新为 14，初始基线仍为 4；未 commit / push。

- 颜色分级增加阴影 / 中间调 / 高光 / 全局四色轮，三轮总览与单轮视图，独立 H/S/L、混合和平衡。支持 Shift 锁色相、⌘ / Ctrl 锁饱和度、Option / Alt 微调、方向键、双击 H/S 复位、复制粘贴、三轮与全部复位。一次拖动一步历史，Escape 取消；旧配方中性旁路，中文 / 空格路径和重启恢复完整参数与像素。
- 原生处理在 ART 共享 Stage 3 黑白转换后、预览锐化及输出 ICC 前执行；参数保存于版本化原生配置。使用本项目 SDR 分级适配，复用 ART HSL 与矩阵；没有新增 darktable / OCIO 运行依赖。肤色、饱和色、宽色域及 ACR 等效性尚未验证，不能称为最终同级算法。
- 安装版新增 **13 项隐藏 GUI 检查**，复跑关闭 / 放弃 / 保存、蒙版隔离与管理、多点曲线 19 项，旧 RAW 配方 / 白平衡 / 1:1 / 导出 7 项，共 **39 项，页面错误 0**。所有窗口隐藏、不可聚焦、不激活；系统对话框由测试提供响应，缺省调用会报错。后台截图已检查控件布局；这不是可见窗口人工验收。
- D850 分级后的全尺寸 TIFF 为 uint16、含 sRGB ICC，桌面与独立安装核心输出逐像素一致；对应 1528×998 详细预览与 TIFF 量化到 RGB8 后最大差 0。保留旧配方、自动和手动白平衡三组完整输出与详细区域回归。所有源文件及原配方哈希不变。
- 安装核心与已通过禁网 / 禁止 Homebrew 读取的原生候选二进制哈希相同。该候选验证了中性兼容、四色轮、黑白后染色、重载 / 复位、非法参数，以及 NEF / CR3 / RAF 的 1:1 / TIFF16 一致性；同一补丁 ART CLI 也一致。这验证接入与持久化，不是独立 ACR 画质对照。固定上游补丁首次和重复应用通过。
- 包内核心和 60 个动态库哈希与加载路径检查通过，44 项依赖清单保留。动态库包括 Nikon 解码库均与 0.16 相同；本批未重跑 29 个 HE 模式，覆盖证据仍来自 0.9。三个单元测试、TypeScript 与安装包构建通过。

证据：`artifacts/color-grading-installed-0.17/`、`color-grading-integration/`、`preview-output-gui/`、`native-bundle-0.17.json`、`release-0.17-evidence.json` 与 `build/installed-0.17-*.log`。源码与安装包见 `release/`。按住色轮旁路、混合辅助预览、完整 ACR 操作方式和画质、校准、HDR、非生成式 AI、Adobe 资产及其他平台仍未完成；完整替代目标保持不变。

## E2E 无窗口保护补充

2026-10-27：共享启动器继续使用隐藏、不可聚焦的窗口，后台绘制开启。新增对八种原生对话框入口的默认拦截：测试必须显式提供响应，遗漏时抛出错误，避免文件选择框或确认框意外显示。安装版验证了全部八种入口被拦截、显式测试响应可用、窗口不可见 / 无焦点 / 不可聚焦；证据为 `artifacts/background-dialog-check.json`。

随后在 0.16 安装版复跑关闭 / 放弃 / 保存、蒙版隔离与管理、多点曲线等 19 项检查，全部通过，见 `build/background-dialog-regression.log`。此补充仅修改测试启动器，安装版及四个发布归档哈希未变，不等于可见窗口人工验收。

## 0.16 增量验收

0.16 从最终 DMG 只读、隐藏挂载安装至 `~/Applications/CaptRAW-0.16.app`，随后卸载映像。保留 0.14 / 0.15 安装版与发布归档，哈希未变。本批只增加曲线统计显示及计数修正，显影引擎版本仍为 13、基线 4；未 commit / push。

- 参数曲线、RGB 及 R/G/B 点曲线背后显示 ART 曲线输入明度直方图。256 桶直接来自工作色域、曲线处理前的全图适屏数据；高度采用 ART 原有对数统计，再归一化显示。不是最终成片 RGB 直方图，也不是各通道独立分布或裁切框统计，尚不宣称 ACR 图表等效。
- 修正 ART OpenMP 循环内对共享直方图桶的非原子递增。单线程、并行和四次重新计算的桶值完全一致；此统计只读图像，不改显影参数或像素。直方图和对应 PNG 同轮发布，按原有 session / revision 规则过滤，避免显示前一轮统计。
- 安装核心在禁网、禁止 Homebrew 读取下通过 **5 组原生检查**：有效统计与旧版默认一致；点曲线 / 参数曲线改变像素但输入统计不变；曝光改变上游分布；单线程 / 多线程及重复计算确定性；NEF / CR3 / X-Trans 预览与完整参数和 0.15 完全一致，源文件哈希不变。
- 新增 **11 项安装版隐藏 GUI 检查**：原生桶与 SVG 路径完全对应、各曲线通道显示、背景不阻挡打点、参数曲线、曝光与撤销重做、初始对比、重启、不跨文档残留、模式隔离、小窗口可达、关闭清空。后台截图已检查图表实际可见。显示数据不写入配方。
- 回归预览 / 输出 7、关闭 / 蒙版 / 点曲线 19、参数曲线 13、工作台 19，共 **69 项隐藏 GUI 检查，页面错误 0**。重新生成的旧配方 / 自动 / 手动三组全尺寸 TIFF，对应 1:1 预览经 RGB8 量化后最大差 0。三个单元测试、TypeScript 和安装包构建通过；工作台基础调节 P95 约 273 ms，输入反馈 P95 约 13.9 ms，非全场景性能保证。
- 固定 ART 新打补丁、从 0.15 增量升级及重复应用，19 个文件与编译源码一致。61 个包内原生文件及 44 项依赖清单核查通过；全部动态库与 0.15 相同，包括 Nikon 解码库。本轮未重跑 29 个 Nikon HE 模式；其证据仍为 0.9。

证据：`artifacts/curve-histogram/`、`curve-histogram-gui/`、`preview-output-gui/`、`source-patch-audit-0.16.json`、`native-bundle-0.16.json`、`release-0.16-evidence.json` 及 `build/installed-0.16-*.log`。全部窗口隐藏、不可聚焦、不激活；对话框由测试提供，不等于人工可见窗口验收。曲线定点工具、通道独立 / 裁切统计、颜色分级、完整局部参数、HDR、AI、Adobe 资产、其他平台与完整 ACR 画质 / 效率对照仍未完成。

## 0.15 增量验收

0.15 从最终 DMG 只读、隐藏挂载安装到 `~/Applications/CaptRAW-0.15.app`，随后卸载映像。保留 0.13 / 0.14 安装版、源码与安装包，哈希核对未改变。引擎版本 13、初始基线仍为 4。未 commit / push，完整 ACR 替代仍未完成。

- 修正 0.14 调查发现的 RAW 预览 / 导出色差。此前 CaptRAW 双精度白平衡补丁调用 ART 通用 double 列表读取，内部把通道系数当曲线校验，导致导出重载成 `[1,1,1]`。现在直接读取双精度数值列表；没有修改原文件、旧配方或用前端颜色补偿掩盖错误。旧配方重新导出将纠正错误颜色，因此不与旧版错误 TIFF 保持像素一致。
- 补上 ART 高质量详细预览握手：首次 1:1 及白平衡失效后重新处理高质量 RAW 数据；只有系数变化时也触发白平衡更新。同轮适屏刷新保留匹配 session / revision 的详细区域，避免新图被清掉。
- 安装核心在禁网、禁止 Homebrew 读取条件下完成 **14 组**用例：D850 NEF、R5 CR3、X-T4 RAF、两种合成输入、自动 / 预设 / 吸管 / 手动 / 仅系数白平衡、矩阵、点与参数曲线、Z5II HE / HE★。所有同坐标 512×384 详细 PNG 与独立进程 TIFF16 量化后的 RGB8 像素最大差 **0**，TIFF 为 uint16 且含 sRGB ICC，源文件哈希不变。D850 的 CustomMult 与独立 Camera 模式参考 16 位最大差也为 0；其他机型两模式差异独立记录，不宣称模式等价。
- 新增 **7 项安装版隐藏 GUI 检查**：0.14 配方参数与原生配置原样恢复、首次 1:1、自动白平衡与全尺寸输出、撤销重做、跨进程重启像素恢复、手动色温、源文件与旧配方不变。旧配方 / 自动 / 手动三种全尺寸 TIFF 的对应 2048×1398 区域与详细 PNG 量化最大差均为 **0**。
- 复跑关闭 / 蒙版 / 点曲线 19、工作台 19、参数曲线 13、白平衡 11，合计 **69 项，页面错误 0**。三个单元测试通过，TypeScript 检查与安装包构建通过。全部 E2E 窗口隐藏、不可聚焦、不激活；后台绘制与截图继续启用，系统对话框返回由测试提供，不代表可见窗口人工验收。
- 原始 ART 新打补丁、从 0.14 增量升级和重复应用，19 个源码文件均与实际编译源码一致。包内核心及 60 动态库哈希 / 加载路径检查通过，44 项依赖清单保留。Nikon 解码库未改，本批只重测两种 Z5II 模式的白平衡 / 输出，29 样本完整解码证据仍为 0.9。

证据：`artifacts/preview-output-acceptance/`（含 `pixel-report.json`）、`preview-output-gui/`、`source-patch-audit-0.15.json`、`native-bundle-0.15.json`、`release-0.15-evidence.json` 与 `build/installed-0.15-*.log`。本批未完成跨显示器色彩、所有机型、ACR 画质 / 效率盲评；颜色分级、曲线定点与直方图、完整局部参数、HDR、AI、Adobe 资产与其他平台仍有缺口。下方 0.14 的未解决记录为当时结论，其已识别白平衡缺陷由本批修正。

## 0.14 增量验收

0.14 从最终 DMG 只读、隐藏挂载安装至 `~/Applications/CaptRAW-0.14.app`，随后卸载映像。保留 0.12 / 0.13 安装版、源码归档与安装包，哈希核查未改变。引擎更新为 12，初始显影基线仍为 4。未 commit / push，完整 ACR 替代未完成。

- 接入独立参数曲线：高光 / 亮调 / 暗调 / 阴影四区域，三个递增分界，鼠标、键盘与数值输入。与 RGB 点曲线、继承的第二曲线同时生效；参数复位不清除点曲线。完整原生参数保存 `CaptRAWParametric`，图形直接采用核心返回的 513 个采样，Web 不另算近似函数。
- 安装核心在禁网、禁止 Homebrew 读取条件下通过七组检查：32 组极端区域 / 分界采样有限且端点正确、零值与旧版默认配方和预览完全一致、四区域正负实际像素响应、点曲线组合 / 复位 / 重载、继承曲线保留、错误数据拒绝、NEF / CR3 / X-Trans 输出。受控灰阶上全部正向变亮、负向变暗，没有反向像素变化。
- 三种 RAW 的全尺寸 TIFF 为 uint16，含 sRGB ICC，与补丁 ART CLI 同配方逐像素一致。桌面 D850 TIFF 与独立安装核心输出最大差 0。D850 1:1 与适屏同一区域低通后 RGB8 平均差约 0.327；此项只比较两种预览，不证明输出色彩一致。
- 新增参数曲线 **13 项隐藏 GUI 检查**，包括控件可见、真实像素、独立撤销、分界拖动 / 键盘、原生采样图、独立复位、初始对比、重启恢复、模式隔离、RAW 导出及固定 0.13 配方恢复。复跑关闭 / 蒙版 / 点曲线 19、工作台 19、裁切 12，共 **63 项，页面错误 0**。所有窗口隐藏、不可聚焦，截图后台捕获；系统对话框返回由测试提供，不等于人工窗口验收。
- 修正 Radix 键盘提交早于数值回调的历史顺序，避免把一次键盘调整与下一次拖动合成一条历史；补齐公共滑杆的可访问名称。测试保存后等待真实预览完成，45 MP 全尺寸导出采用独立的长任务超时，不使用默认五秒断言。
- 固定原始 ART 归档打补丁及重复应用后，19 个文件与实际编译源码一致。安装包 61 个原生文件与 44 项依赖的哈希、加载路径核查通过；Nikon 解码库与 0.13 相同，29 HE 模式证据仍来自 0.9，本轮未重跑整个 HE 清单。

**新发现、未解决：预览与导出颜色差异。** D850 同一原图坐标区域（x=3000、y=2000、512×384；TIFF 按相机构图偏移 x=12、y=4 对齐）经 RGB8 量化后，0.13 点曲线配方的预览 / TIFF 平均差约 5.536、最大差 75；0.14 点曲线加参数曲线配方平均差约 5.849、最大差 78。低通后差异仍存在，因此不是仅有细节采样误差。已确认旧版可重现，根因尚未定位；不能据此认定预览或导出哪一方正确，也不能以同源 CLI 一致替代色彩验收。下一步优先检查 ART 预览 / 输出管线及色彩转换，保留这组证据作为回归样本。

证据：`artifacts/parametric-curve/`（含 `preview-output-investigation.json`）、`parametric-curve-gui/`、`source-patch-audit-0.14.json`、`native-bundle-0.14.json`、`release-0.14-evidence.json` 与 `build/installed-0.14-*.log`。定点工具、曲线直方图、颜色分级、HDR、非生成式 AI、Adobe 资产导入、三平台及完整 ACR 画质 / 效率对照仍未完成。

## 0.13 增量验收

0.13 从最终 DMG 只读挂载安装至 `~/Applications/CaptRAW-0.13.app`，随后卸载映像。保留 0.11 / 0.12 安装版及归档。显影处理版本仍为 11、基线仍为 4；本批只扩展裁切交互和约束元数据检查，不改 ART 显影算法。未 commit / push，完整 ACR 同级目标未完成。

- 裁切增加原照、1:1、4:3、3:2、5:4、7:5、16:9 比例预设、锁定当前比例、X 横竖切换；八个控制点调整边角，框内拖动移动、框外重新绘制。选择比例尽量保留面积和中心，触及图像边界时缩小并限制位置。框外变暗和完整三分线辅助构图，鼠标指针提示移动 / 缩放。
- 所有裁框仍写入原有 canonical crop，新增 cropAspect 仅记录未旋转图像的比例约束。四种旋转、五种输出比例、全部边角、越界、移动及反向切换的坐标测试通过。锁定状态随撤销 / 重做和配方恢复；相机构图 / 清除裁切同时解除锁。输出像素尺寸沿用 ART 整数舍入，可能有不足一个像素的比例舍入。
- 新增 **12 项安装版后台 GUI 检查**：模式隔离、实际 RAW 预设、八控制点、固定对角 / 一步撤销、移动、边界约束、X 切换、旋转缩放、自由与自定义锁定、相机构图 / 清除 / 重画、重启及蒙版坐标保持、16 位输出和 1100×760 小窗口。另回归相机构图 8、关闭 / 曲线 / 蒙版 19、工作台 19，共 **58 项，页面运行时错误 0**。窗口始终隐藏、不可聚焦；系统对话框返回由测试提供，不等于可见窗口人工验收。
- 隐藏窗口检查发现并修正旧居中样式导致控件移出屏幕的问题。裁切工具条改为画布上方的固定布局，不遮挡控制点。相机构图测试在结束裁切后等待 Canvas 完成尺寸同步，避免拿布局变化前后的不同大小截图做像素比较；没有放宽同一显示状态的像素一致性检查。
- 安装核心在禁止网络和 Homebrew 读取下通过三组检查：比例锁定元数据不改变完整 ART 配置或相同裁切像素；非法元数据拒绝；当前和 0.12 独立核心都能导出同一完整配方。实际 4223×3167 TIFF 为 uint16、含 sRGB ICC；后台桌面与两个独立输出最大通道差均为 **0**。已有蒙版参数 / 坐标和 RAW 源哈希保持不变。
- 包内核心及 60 个动态库的哈希和加载路径、44 项依赖清单通过检查；全部动态库与 0.12 相同。18 个 ART 补丁文件仍与 0.12 审计一致，本批没有新增上游补丁。Nikon 29 样本沿用 0.9 的历史解码证据，不宣称在本版重测。

证据：`artifacts/crop-workflow-gui/`、`crop-workflow/`、`native-bundle-0.13.json`、`release-0.13-evidence.json`，以及 `build/installed-0.13-*.log`。正常人工入口为安装版裁切工具 C，本轮不自动显示窗口。任意角、拉直、透视、完整 ACR 操作效率 / 画质对照，以及 HDR、AI、资产导入和其他平台仍未完成。

## 0.12 增量验收

0.12 从 DMG 只读挂载安装到 `~/Applications/CaptRAW-0.12.app`，随后卸载映像。处理版本为 11，基线仍为 4。保留 0.10 / 0.11 安装版与原归档；未 commit / push，完整 ACR 同级目标未完成。

- “效果”面板增加全局纹理、清晰度（-100–100），复用 ART TextureBoost 的两种尺度；完整图像覆盖，局部纹理和全局纹理独立保存、复位与撤销。保留继承的原生区域；停用但非中性的继承模块继续拒绝合并，避免意外激活。
- 安装核心在禁网、禁止 Homebrew 读取下通过八组检查。受控纹理区标准差由 8.506 变为纹理增强 11.068 / 柔化 7.792、清晰度增强 16.531 / 柔化 5.669；两侧无局部蒙版区域也产生变化。正负处理、组合、旋转、1:1 和缓存平移的对应区域最大差 0。新字段为零时与旧默认像素一致；中性蒙版叠加全局细节时，受控 RGB8 预览最大差为 **1 / 255（21 个通道值）**，不宣称全场景恒等。
- 修正 ART 第二条恒等曲线模式的保存遗漏。第一条 Standard、第二条 Neutral 时，现在明确保存 CurveMode2；避免读回误选合并曲线路径。新默认像素与 0.11 一致，完整参数文本只增加明确的第二曲线模式。旧文件缺失字段仍按原有规则读取，没有强制改成新默认值。
- 合成输入、D850 的全分辨率 TIFF 为 uint16 并含 sRGB ICC；独立核心与补丁 ART CLI 最大差 0。后台桌面混合全局 / 局部配方的 TIFF16 与独立核心输出最大差 0。D850 NEF、R5 CR3、X-T4 RAF 的默认 TIFF16 也与参考一致，源文件哈希保持不变。
- 全局细节新增 **12 项后台 GUI 检查**，涵盖可见控件、真实像素、一步撤销、负向处理、初始对比、局部 / 全局独立复位、重启恢复、1:1、TIFF16、0.11 配方迁移和真实 D850。复跑局部明暗 11、局部白平衡 10、局部细节 10、关闭 / 曲线 / 蒙版 19、相机构图 8、全局白平衡 11、工作台 19，共 **100 项，页面运行时错误 0**。所有窗口隐藏、不可聚焦，截图在后台捕获；系统对话框返回由测试提供，不等于可见窗口人工验收。
- 全局细节 E2E 修正保存后的等待条件：配方文件落盘不代表异步预览已经完成，必须等保存预览绘制完成后再验收撤销。中性蒙版精度读取原生 PNG；避免测试主动读取显示 Canvas 像素而改变 Chromium 的绘制路径。
- 安装核心的单张约 45 MP D850 全局细节适屏更新约 **211 ms**，首次全上下文 1:1 **1.79 秒**，五次缓存平移 P95 **3.21 ms**；这是缓存输入上的一个配方，不是全场景性能保证。工作台回归基础调节 P95 约 215 ms、输入反馈 P95 约 13.7 ms。含多个局部滤镜的首次详细预览成本仍需优化。
- 固定 ART 原始归档重复打补丁、从 0.11 已打补丁源码升级，两条路径的 18 个文件均与编译源码一致；包内核心、60 个动态库、44 项依赖清单核查通过。Nikon 解码库未改变，沿用 0.9 的 29 样本证据，本批未重跑完整 HE 清单。

证据：`artifacts/global-details/`、`global-details-gui/`、`native-acceptance/report.json`、`source-patch-audit-0.12.json`、`native-bundle-0.12.json`、`release-0.12-evidence.json` 与 `build/installed-0.12-*.log`。颜色分级、局部锐化 / 去朦胧、HDR、AI、Adobe 资产导入、三平台以及 ACR 画质 / 效率对照仍未完成。正常人工入口为安装版“编辑 → 效果”，本轮不自动打开窗口。

## 0.11 增量验收

0.11 从最终 DMG 只读挂载安装到 `~/Applications/CaptRAW-0.11.app`，随后卸载映像。处理版本为 10，初始基线仍为 4；保留 0.10 安装版和归档。没有 commit / push，也未达到完整 ACR 同级。

- 蒙版增加局部高光、阴影、白色、黑色，复用 ART Tone Equalizer 的五频段和边缘保持滤波。它按区域顺序计算明暗增益，然后进行当前区域白平衡 / CDL 并只混合一次覆盖率；后续重叠区域看到前面的处理结果。零值不保存新字段，不改变旧路径。
- 安装核心在禁网、禁止 Homebrew 读取下通过八组原生检查。受控等 EV 灰阶坡道中，四个控件的最强响应分别位于不同亮度区间，正向提亮、负向压暗；蒙版外最大差 **0**。黑色负向的最大变化为 2 / 255，其余项为 8–61 / 255；这是接入证据，不是 ACR 画质等效或效果强度保证。
- 四个正负方向、组合以及 90° 旋转后的 1:1 与全图对应区域逐像素一致。关闭、复位、删除副本和反复更新无残留；重叠蒙版顺序生效。已有全局明暗 / 局部白平衡及零值蒙版与安装版 0.10 的完整参数和预览像素一致。
- 合成输入和 D850 的全分辨率 TIFF 为 uint16、含 sRGB ICC；独立核心、补丁 ART CLI 和后台桌面同配方导出最大差 **0**。D850 NEF、R5 CR3、X-T4 RAF 的默认 TIFF16 也与参考一致；源哈希未改变。
- 修正原生白平衡矩阵载入误用曲线整理函数：矩阵首项等于曲线类型编号时不再被改写。首项为 2 和 2.000000001（转换到处理 float 后相同）的合法矩阵导出一致；保留九个有限值和范围验证。常规局部白平衡像素与保存恢复另行回归。
- 新增局部明暗 **11 项后台 GUI 检查**，涵盖四个控件真实像素、撤销、停用 / 复位、复制 / 删除、模式隔离、重启恢复、1:1、TIFF16、旧版基线及真实 45 MP D850。另复跑局部白平衡 10、局部细节 10、关闭 / 曲线 / 蒙版 19、相机构图 8、全局白平衡 11、工作台 19，共 **88 项，页面运行时错误 0**。四个明暗控件同时处于视口内，后台截图已检查。所有窗口隐藏、不可聚焦；系统对话框返回由测试提供，不等于用户可见窗口人工验收。
- 安装核心的 D850 局部明暗更新约 310 ms，首次全上下文 1:1 **3.29 秒**，五次缓存平移 P95 **5.70 ms**。这是一张本机缓存输入、一个局部组的测量；不代表多组、冷磁盘、其他设备或全场景性能。常规工作台基础调节 P95 约 216 ms，输入反馈 P95 约 14.6 ms；常规回归有并行测试负载，分别记录。
- 固定 ART 干净归档重复应用补丁、从 0.10 已打补丁源码升级，两条路径的 18 个文件与编译源码一致。包内核心、60 个动态库及 44 项依赖清单逐项核查。Nikon 解码库与 0.9 / 0.10 相同，本批沿用历史 29 样本证据，没有重新宣称本版完成全部 HE 样本验收。

证据：`artifacts/local-tone/`、`local-tone-gui/`、`native-acceptance/report.json`、`source-patch-audit-0.11.json`、`native-bundle-0.11.json`、`release-0.11-evidence.json` 和 `build/installed-0.11-*.log`。蒙版明暗首次 1:1 仍有等待；局部锐化 / 去朦胧、颜色分级、HDR、AI、Adobe 资产导入、跨平台及 ACR 盲评 / 效率验收仍未完成。正常人工入口为安装版蒙版面板，本轮不自动打开窗口。

## 0.10 增量验收

0.10 从最终 DMG 只读挂载安装到 `~/Applications/CaptRAW-0.10.app`，随后卸载映像。处理版本为 9，初始基线仍为 4；0.9 安装核心、ASAR 和归档保持原哈希。未 commit / push，未完成完整 ACR 同级目标。

- 蒙版新增局部色温和色调，采用 ART 光源模型及 LittleCMS Bradford 适应，在当前线性工作 RGB 中执行完整 3×3 变换。正色温趋暖、正色调趋洋红；全局白平衡不变，蒙版覆盖只混合一次。中性值不写入扩展矩阵，旧版完整参数和像素保持一致。
- 安装版核心在禁止网络和 Homebrew 读取下通过七组检查，包括中性兼容、色偏方向、停用与复位、反选 / 裁切 / 旋转、参数拒绝、保存恢复、三种真实 RAW。受控样本蒙版外像素最大差 0；完整 detail 与 fit 同分辨率像素一致，局部 ROI 与全图最大差为 **1 / 255**，不声称 ROI 完全一致。
- sRGB / AdobeRGB / ProPhoto 的矩阵还原至 XYZ 后最大差 1.63e-7。合成输入和 D850 的 TIFF 为真实 uint16、含 ICC，独立进程及补丁 ART CLI 最大像素差均为 0；后台桌面导出与同配方独立核心也完全一致。保存的是完整矩阵，不依赖屏幕 RGB8 缓存导出。
- 新增 10 项局部白平衡后台 GUI 检查通过：模式隔离、真实像素、一步撤销、停用 / 复位、复制 / 删除、重启恢复、1:1、TIFF16，以及旧引擎 8 的配方和基线保护。另复跑局部细节 10、关闭 / 曲线 / 蒙版 19、相机构图 8、全局白平衡 11，共 **58 项，页面运行时错误 0**。
- 所有 E2E 窗口创建时隐藏、不可聚焦，后台绘图正常；启动器检查实际状态，旧版不支持则拒绝启动。对话框返回由测试提供；没有执行用户可见窗口人工验收。正常用户启动仍显示工作台。
- 0.9 的 29 / 29 Nikon HE / HE★ 证据保留，0.10 解码库哈希不变；本批未复跑全部 29 项，不将历史验证表述为本批验证。固定 ART 重新应用补丁两次的 17 个文件与编译源码一致；安装核心和 60 个动态库的哈希、加载路径及 44 项依赖记录已核查。

证据：`artifacts/local-white-balance/`、`local-white-balance-gui/`、`native-bundle-0.10.json`、`source-patch-audit-0.10.json`、`release-0.10-evidence.json`，以及 `build/installed-0.10-*.log`。截图由隐藏窗口捕获。

局部高光 / 阴影 / 白黑等参数仍缺失；相对局部白平衡不是 RAW 域第二次白平衡，也不等于 Adobe 数值。混合光、肤色、极端颜色及 ACR 盲评未完成。局部细节首次 1:1 的性能缺口、三平台、HDR、AI、Adobe 资产导入及签名公证等限制继续保留。人工入口为安装版的蒙版面板“局部白平衡”，本轮不自动打开窗口。

## 0.9 增量验收

0.9 从最终 DMG 只读挂载并复制到 `~/Applications/CaptRAW-0.9.app`，随后卸载映像。0.8 的安装核心、ASAR、DMG 和源码归档哈希保持不变。处理版本为 8，新文档初始基线为 4；旧基线 2 / 3 保留。未 commit / push，完整 ACR 同级目标未完成。

- **29 / 29 Nikon HE / HE★ 固定样本通过**。覆盖 Z9、Z8、Z f、Z6III、Z5II、Z50II 的清单所列画幅 / 比例。安装版核心和直接链接包内 LibRaw 的感光点工具在禁止网络、Homebrew 读取下运行，全部解码匹配固定上游参考、生成正常预览且源哈希不变；没有下载或验证失败。具体机型、模式、来源、许可、SHA-256 见 `artifacts/nikon-he-0.9/report.json`。
- 29 个样本还与本机 Adobe DNG Converter **18.0 (2389)** 生成的独立未压缩 DNG 逐感光点比较，全部尺寸相同、最大差 0、差异感光点数 0。`artifacts/nikon-he-independent/report.json` 记录参考文件及所链接安装库哈希。Adobe 仅是独立测试工具，未随产品分发或用于产品解码；这不代表 ACR 18.7 的色彩、降噪或完整功能同级。
- 29 个样本分别通过安装包后台界面的打开、照片绘制、曝光实际变化、保存配方和源哈希检查，见 `artifacts/nikon-he-gui-0.9/report.json`。样本仅覆盖清单中的实际文件，不扩展为所有机型、固件和压缩变体支持声明。28 个样本为 CC0，Fenny 的附加 Z6III HE★ 样本为 CC BY-SA 4.0；参考转换器、参考 DNG 和测试 RAW 不进入产品或源码包。
- 修复 Nikon CropArea 在 ART 释放 LibRaw 缓冲后丢失：提前复制四个整数，映射活动区边距、去马赛克边界和 EXIF 方向。29 张 HE 样本加 D850 共 30 张的默认输出尺寸与相机标签一致；90° / 180° / 270° 元数据副本也验证通过。用户 `DSC_1520.NEF` 的可用区仍为 6056×4032，默认构图为 **6048×4032**，原片不改写。
- 基线 3 与安装版 0.8 的控件投影、完整 ART 配置和预览像素完全一致。新基线 4 只通过同一配方 crop 应用相机构图；裁切可清除 / 恢复，蒙版、修复和存储坐标不变。相机构图按钮只在有效数据存在时出现；对比同时切换初始像素与构图。
- 新增 8 项安装包后台检查：默认尺寸、清除裁切、初始对比、一步撤销重做、恢复构图 / 旋转、重启恢复、TIFF 导出、旧版本推断 / 切换 / 重置。连同局部细节 10、修复 15、黑白 13、配置文件 12、白平衡 11、关闭 / 曲线 / 蒙版 19、工作台 19，共 **107 项通过，页面运行时错误 0**。另有上述 29 个 Nikon 文件工作流检查。
- **按用户要求，全部后续 E2E 隐藏窗口运行**。每次启动都检查窗口 `visible=false`、`focused=false`、`focusable=false`，保持后台绘图；旧包不支持该模式则在启动前拒绝，避免弹窗。测试仍执行真实 Chromium、Canvas、原生核心、保存和输出，对话框返回由测试提供。后台截图 / 控件检查与人工可见窗口验收分开，不能称用户已经验收。
- 相机构图的横向和旋转 TIFF 为实际 uint16、含 ICC，与 0.8 核心使用同一完整配方的输出逐像素一致。后台桌面旋转导出与独立核心也完全一致。D850 / R5 / X-T4 默认 TIFF16 与固定补丁 ART CLI 最大差 0；白平衡旧基线、输入配置文件的桌面 / 核心 / 参考像素回归通过。
- 包内核心与 60 个动态库的哈希和加载路径逐项核对，44 项原生依赖记录随包。固定原始 ART 重复应用补丁后，17 个引擎文件与编译源码一致。证据为 `artifacts/native-bundle-0.9.json`、`source-patch-audit-0.9.json` 和 `release-0.9-evidence.json`。

本批未改动局部细节全图重算算法，0.8 记录的首次 1:1 性能缺口仍在；本轮存在并行测试，不以其耗时替代独立性能验收。其余平台、HDR、非生成式 AI、Adobe 资产导入、ACR 画质和效率对照仍未完成。人工入口为 `~/Applications/CaptRAW-0.9.app`：打开 Nikon RAW，按 C 查看“相机原始构图” / “清除裁切”，检查 P 对比、保存重开与导出。

## 0.8 安装版追加 Nikon 验收

发布后追加的原 0.8 安装版未修改二进制或默认构图。完整 29 项样本在其包内解码库 / 核心通过固定感光点参考和预览验证，见 `artifacts/nikon-he-expanded/report.json`；当时完成 22 个可见窗口工作流检查，见 `artifacts/nikon-he-gui/report.json`。0.9 使用同一解码库，继续完成全部 29 个独立 Adobe 对照和后台工作流检查。下方 0.8 发布时的 3 / 29 记录保留为历史事实。

复跑先运行 `tests/nikon-he.mjs` 下载 / 校验，再运行 `tests/nikon-adobe-reference.mjs` 和 `tests/nikon-he-e2e.mjs`；独立对照及后台工作流只使用完整且哈希正确的文件。下载采用 `.part`，哈希正确后才重命名；各下载或验证失败独立记录。报告的 complete 仅表示该次运行结束，是否通过还必须检查 failures 与 results 数量。

## 0.8 增量验收

0.8 从最终 DMG 只读挂载并复制到 `~/Applications/CaptRAW-0.8.app`，随后卸载磁盘映像，保留所有旧版。当前处理版本为 7，初始显影基线仍为 3，旧基线 2 保留。用户人工验收尚待执行，完整 ACR 同级目标尚未完成。

- 蒙版新增局部色相、纹理、清晰度、亮度降噪和降噪细节；支持单独复位局部调整而保留几何。色相使用 ART YUV 旋转；纹理 / 清晰度为 TextureBoost 的两种尺度，亮度降噪为 NLMeans。它们不等于 Adobe 同名算法和数值，局部白平衡及完整明暗参数仍缺失。
- 旧蒙版的中性预览与完整 ART 参数文本和 0.7 一致。可选 details 为零时也一致。停用、删除、撤销、复制后删除和反复更新均无额外残留；独立启用的原生纹理设置可保留。停用但非中性的独立原生设置拒绝合并，避免新增区域时激活隐藏参数。
- 受控样本中，每项实际改变蒙版内像素。蒙版外纹理 / 清晰度 / 降噪最大差 0；色相区域的 8 位转换最大差 1。固定区域标准差由 8.506 变为纹理增强后的 11.136、降噪后的 7.737；这是接入和噪声响应证据，不是高感、肤色、复杂纹理或 ACR 质量盲评通过证明。
- 发现裁块邻域不能复现纹理的全图最小值约束；含新局部细节的 1:1 改为全图 skip=1 处理后只返回请求窗口。受控样本四种调整、90° 旋转后的详细区域与全图同坐标像素完全一致。缓存平移图像一致，覆盖率与全图同坐标量化差不超过 1；参数、蒙版显示状态、初始状态对比及文件切换时失效 / 释放缓存。
- 新增 10 项安装版局部细节窗口检查通过：真实控件及图像变化、一步撤销重做、停用、局部复位、复制 / 删除、模式隔离、重启恢复、1:1 和平移图像 / 覆盖率、16 位导出。加上修复 15、黑白 13、输入配置文件 12、白平衡 11、关闭 / 曲线 / 蒙版 19、工作台 19，共 **99 项通过，页面运行时错误 0**。对话框返回由测试提供；实际控件、Canvas、核心、保存及导出执行。
- 局部调整的桌面 TIFF16 与保存配方的独立核心输出逐像素一致。合成输入及真实 D850 全分辨率局部纹理 / 清晰度 / 降噪输出与含固定补丁的 ART CLI 最大通道差均为 0；独立进程保存恢复也一致。TIFF 为 uint16、sRGB ICC，未由屏幕 RGB8 缓存生成。
- 安装版核心在禁止网络、Homebrew 读取和没有显示服务下通过。D850 / R5 / X-T4 的常规默认 TIFF16 与 ART CLI 一致；三种 RAW 也完成局部细节预览。三个公开 Nikon HE / HE★ 样本再次通过，覆盖仍为 3 / 29，源哈希不变。
- 独立性能测量（没有其他项目测试并行）使用本机缓存的约 45 MP D850、一个局部纹理 / 清晰度 / NLMeans 组和 512×384 视口：适屏核心更新 467 ms，首次全上下文 1:1 为 **8.32 秒**，随后五次缓存平移 P95 为 **7.23 ms**。100 ms 采样的核心 RSS 峰值约 **6.76 GiB**，不包含 Electron 或整机。首次处理和参数改变后的 1:1 重算仍是明确性能缺口，缓存平移速度不代表其已解决。
- 常规回归的首个核心预览约 780 / 716 / 1196 ms，D850 曝光更新 P95 195 ms；GUI 基础调节 P95 232 ms、输入反馈 P95 20 ms。该回归有并行测试负载，与上面的单独局部性能记录分开，不能推广到全部工具、冷磁盘或其他设备。
- 安装核心及 60 个动态库的清单哈希和包内 / 系统加载路径已核查，44 项原生依赖记录随包。固定原始 ART 重复应用补丁的 12 个文件仍与编译源码一致；本批没有修改这些上游算法文件。0.7 的 ASAR 与核心保持交付哈希；未覆盖旧版。

证据：`artifacts/local-details/pixel-report.json`、`performance.json`、`artifacts/local-details-gui/`、`artifacts/release-0.8-evidence.json`、其余 GUI 回归报告和 `build/installed-0.8-*.log`。未完成其他平台、Developer ID 签名、公证、全场景性能与 ACR 画质 / 效率对照。

人工入口：打开 `~/Applications/CaptRAW-0.8.app`，创建或选择蒙版，滚动到“局部细节”，调节纹理、清晰度与降噪；检查局部复位 / 撤销、停用、保存重开与导出。大 RAW 第一次进入含局部细节的 1:1 会等待完整处理，随后平移使用缓存。

## 0.7 增量验收

0.7 从最终 DMG 只读挂载安装到 `~/Applications/CaptRAW-0.7.app`，与所有旧版并排。处理版本为 6，初始显影基线仍为 3；旧基线 2 保留。此次不宣称完整 ACR 同级，用户人工验收仍待执行。

- 新增 ART 圆形取样修复与仿制。来源 / 目标、半径、羽化、不透明度、修复精细度、保留目标细节，以及修复点选择、改名、开关、排序和删除均连接实际处理。B 进入，Option 单击重新取样，拖动两端重定位；Esc 即使焦点停在复选框也能退出。修复引导只在对应模式显示。
- 安装版新增 15 项修复 GUI 检查：选源不创建编辑、原生仿制的图像变化、一步撤销重做、两端拖动、滑杆及停用、命名 / 新建 / Option 取样、排序、引导显隐、删除恢复、重启还原、旋转坐标 / 真 1:1、16 位桌面导出、旧配方原生点迁移及真实 D850 操作。加上黑白 13、配置文件 12、白平衡 11、关闭 / 曲线 / 蒙版 19、工作台 19，共 **89 项通过，页面运行时错误 0**。系统对话框返回值由测试提供，实际控件、Canvas、核心、保存和输出执行。
- 原生像素检查验证：仿制中心与来源完全一致，远离目标区域无变化；不透明度零或停用完全恢复。受控灰阶灰尘样本中，修复比仿制更接近目标周围亮度；尚未做复杂纹理、肤色和 ACR 盲评。该样本 90° / 180° / 270° 输出与原输出旋转逐像素一致；视口外来源的详细区域与适屏同坐标最大差 0。中性预览和完整 ART 参数与 0.6 一致。
- 发现并修正 ART Laplace 修复迭代的相邻行 OpenMP 读写竞争。原有多线程输出相对参考最大差为 9 / 65535，限于修复区域。补丁只让依赖相邻新值的迭代按原顺序运行。修正后 D850 的 1 / 2 / 8 OpenMP 线程、独立进程、含相同补丁的 ART CLI 和旧 0.6 单线程输出全部逐像素相同。旧多线程修复配方的像素可能因缺陷修正改变；不承诺保留不确定输出。
- 修复 / 仿制桌面导出与保存配方的无界面导出完全一致；独立核心与 ART CLI 的 TIFF16 一致，实际为 uint16、sRGB ICC。含旧原生点的配方反投影到控件，重复载入不叠加；越界几何明确报错，载入后出错会释放新图像，可重新载入当前编辑，避免操作错图。
- 安装版核心在无显示服务、禁止网络和 Homebrew 读取条件下，通过修复和常规显影检查。D850 / R5 / X-T4 默认 16 位输出与 ART CLI 最大通道差均为 0。三个公开 Nikon HE / HE★ 样本再次匹配感光点参考，源哈希不变，覆盖仍为 3 / 29。
- 本次缓存读取的三种 RAW 首个核心预览约 973 / 772 / 1362 ms，D850 曝光更新 P95 217 ms。GUI 基础调节 P95 487 ms、输入反馈 P95 15.5 ms；核心采样 RSS 峰值约 3.37 GiB。原生与 GUI 回归有并行负载，数值不能用于纯净环境版本性能比较，也不是修复、全部工具或其他硬件的性能保证。
- 固定 ART 原始归档重新应用补丁两次，12 个引擎文件与编译源码一致。安装核心、60 个动态库与清单哈希 / 加载路径一致，44 项原生依赖记录随包。0.6 ASAR 与核心哈希仍匹配其交付记录；未覆盖旧应用。

证据：`artifacts/repair/`、`artifacts/repair-gui/`、`artifacts/source-patch-audit.json`、`artifacts/release-0.7-evidence.json`、其余 GUI 回归报告，以及 `build/installed-0.7-*.log`。连续修复画笔、自动选源、内容识别移除、灰尘检查、HDR、人物蒙版及其他缺口仍见对齐表；未完成 Developer ID 签名、公证或跨机器验收。

人工入口：打开 `~/Applications/CaptRAW-0.7.app`，按 B，选择来源后单击目标；选择修复点并拖动两端，修改半径 / 羽化 / 不透明度，检查撤销、停用、保存重开和 TIFF16。不要把圆形点工具当作已完成的 ACR 修复工作流全集。

## 0.6 增量验收

0.6 从最终 DMG 安装到 `~/Applications/CaptRAW-0.6.app`，与旧版并排。0.5 的 ASAR 与核心哈希仍与其交付记录相同。本版处理版本为 5，初始显影基线仍为 3，旧基线 2 保留。

- 新增彩色 / 黑白切换和八色黑白混色，全部由 C++ 处理。八色色相中心经 sRGB 到工作色域转换后按 ART 的 YUV 色相定位；独立曲线在黑白转换前复用 HSL 明亮度处理，不覆盖彩色 HSL。近中性色按色度 / 亮度比例加权，避免不稳定残余色相引起灰阶变化。
- 三张真实 RAW 的默认预览 PNG 和完整 ART 参数文本与 0.5 一致；开启黑白后实际成为中性灰阶，返回彩色逐像素恢复。单独调整八色样本时，对应颜色响应最大，灰色样本在本次 8 位预览中均无变化；这不是全部色域、光谱、肤色或高感场景的质量通过证明。
- D850 黑白全分辨率 TIFF 与本项目含相同补丁的独立 ART CLI 逐像素一致，实际为 uint16、sRGB ICC。保存配方交独立核心导出也一致，GUI 黑白 16 位输出与该配方的无界面输出一致。旧黑白滤镜 / gamma 配方与 0.5 核心输出逐像素一致。
- 安装版黑白 GUI 13 项检查通过：可见切换、八色控件、实际灰阶图像、一步撤销 / 重做、保留彩色编辑、切回彩色、重启恢复、混色复位、取消关闭 / 放弃更改、旧配方迁移、多图切换和真实 D850 RAW 窗口。另通过输入配置文件 12 项、白平衡 11 项、关闭 / 曲线 / 蒙版 19 项、工作台 19 项，共 74 项，无页面运行时错误。对话框选择由测试提供；用户人工验收仍待执行。
- 安装版核心在禁止网络、Homebrew 读取、没有显示服务的条件下，通过黑白、白平衡、输入配置文件及三格式输出检查。D850 / R5 / X-T4 彩色默认 16 位输出与固定 ART CLI 最大通道差均为 0；三个公开 Nikon HE / HE★ 样本再次通过，覆盖仍为 3 / 29。所测源文件哈希保持不变。
- 本机缓存读取：三种 RAW 首个核心预览约 963 / 852 / 1396 ms，D850 曝光更新 P95 为 228 ms；工作台基础调节 P95 为 247 ms、输入反馈 P95 为 34.3 ms。核心采样 RSS 峰值约 3.42 GiB；不是全部工具或其他设备的性能保证，也没有把该数值当作黑白完整输出的峰值。
- 核心及 60 个动态库的哈希、包内 / 系统加载路径已核查，44 项原生依赖记录随包。固定原始 ART 重新应用补丁两次，11 个引擎文件与编译源码一致。新 `CaptRAWLuminanceCurve` 为本项目扩展，原版 ART / 旧核心不识别；旧宿主拒绝新引擎配方，避免静默丢失黑白混色。

证据：`artifacts/black-white/`、`artifacts/black-white-gui/`（含 `raw-monochrome.png`）、`artifacts/source-patch-audit.json`、`artifacts/native-acceptance/`、`artifacts/nikon-he/`、各 GUI 报告和 `build/installed-0.6-*.log`。黑白算法、参数与效率尚未完成 ACR 对照。自动 / 自适应调色仍未选定实现路线，颜色分级、修复、AI、HDR 等继续见 [对齐表](ACR-PARITY.md)，完整同级目标未完成。

## 0.5 增量验收

0.5 安装到 `~/Applications/CaptRAW-0.5.app`，从最终 DMG 只读挂载复制后卸载；旧版保留。0.4 应用的 ASAR 与核心哈希仍与上次交付记录一致。当前处理版本为 4，初始显影仍使用基线 3；旧基线 2 继续保留。

- 输入配置文件面板显示真实匹配的 DCP / ICC、相机矩阵和检测到的嵌入配置。DCP 控件按真实能力显示；所测 D850 / R5 / X-T4 均包含 2850 K / 6500 K 双光源和基础颜色表，没有的曲线 / 风格表 / 基准曝光控件不显示。
- 三种真实 RAW 的默认预览 PNG 和完整 ART 参数文本与 0.4 完全相同。改为矩阵、关闭基础颜色表或指定光源，都有实际像素变化；此结论不表示相同参数或显影效果等于 ACR。
- D850 矩阵模式全分辨率 TIFF 与独立 ART CLI 逐像素一致；安装版桌面导出也与该核心输出逐像素一致，实际为 uint16 并包含 ICC。合成 DNG 的嵌入配置可选；带 ICC 的普通 PNG 显示嵌入配置，没有 RAW 矩阵选项。
- 12 项配置文件 GUI 检查通过，包含可见控件、撤销 / 重做、独立新进程恢复、0.4 配方迁移、旧外部引用保存恢复、缺失输入文件保留当前画面、嵌入 DNG / ICC 和实际导出；白平衡 11 项、关闭 / 曲线 / 蒙版 19 项、工作台 19 项回归也通过，合计 61 项，无页面运行时错误。另通过新进程恢复裁切、三个蒙版与完整调整。系统对话框选择由测试提供；用户人工验收仍待执行。
- 缺失或无效的外部输入引用在检查和导出时明确失败，避免静默改用矩阵。缓存探针复现了“读取 ICC 后移走文件，原检查仍接受”的问题；增加实际文件检查后，缓存不再掩盖失效。测试只移动自己在 build 下复制的临时文件，没有移动用户资产。
- 安装版核心在禁止网络、Homebrew 读取且没有显示服务的环境下，通过配置文件、白平衡、三格式输出和三个公开 HE / HE★ 样本回归。D850 / R5 / X-T4 默认 16 位输出与 ART CLI 最大通道差均为 0，ICC 为 sRGB V4。Nikon 覆盖仍为 3 / 29；源哈希保持不变。
- 本机缓存读取：三种 RAW 首个核心预览约 962 / 782 / 1326 ms；D850 曝光更新 P95 为 194 ms，GUI 基础调节 P95 为 269 ms、输入反馈 P95 为 30.2 ms；核心采样 RSS 峰值约 3.60 GiB。这些不是全部工具、冷磁盘或其他设备的性能保证。
- 安装包的核心及 60 个动态库哈希与清单一致，加载路径已审计；44 项原生依赖记录随包。ART 的 9 个补丁文件仍与此前从原始归档重复应用补丁的结果相同。本批未修改这些上游算法文件。

证据：`artifacts/input-profiles/`、`artifacts/input-profiles-gui/`、`artifacts/white-balance/`、`artifacts/revision/`、`artifacts/workbench/`、`artifacts/restart-report.json`、`artifacts/native-acceptance/`、`artifacts/nikon-he/` 和 `build/installed-0.5-*.log`。外部配置文件导入 / 复制、资产封装、Adobe 风格、自动 / 自适应调色及完整 ACR 对齐仍未完成。外部引用必须保留在原位置；本版不宣称其跨机器可移植，也未完成 Developer ID 签名、公证或跨机器验收。


## 0.4 增量验收

0.4 增加原照设置、自动白平衡、按机型匹配的 ART 预设和 RAW 吸管；新基线使用精确相机通道系数。色温 / 色调为显示投影，不能完整表示时明确提示；手动调节转为自定义色温。

- D850 的 12 个、X-T4 的 7 个白平衡预设从固定 ART 数据读取。所测预设系数与源数据一致，自动 / 预设会改变实际像素；没有预设的机型不显示虚构数据。
- 对同一合成 RAW 位置取样，在 90° / 180° / 270° 旋转及裁切后系数最大差 ≤ 5.56e-16。实际窗口验证 I 吸管、25×25 像素窗口、Esc 退出、撤销 / 重做、保存恢复、手动色温切换。
- 配方保存 baselineVersion。旧引擎配方进入基线 2，迁移保存、再次打开、胶片切换和初始状态对比均保留该基线。Bayer 旧基线导出与 0.3 旧核心逐像素一致；精确白平衡保存后交独立新核心导出也一致。
- 参数验证在替换当前图像前完成；无效配方保留当前图像。显式配方若指向有未保存编辑的原片，要求先保存或关闭，避免覆盖会话编辑。白平衡异步返回后若发生编辑 / 撤销等操作，丢弃旧结果。

本批发现并修正 ART X-Trans 三遍插值的尾块未初始化读：原代码把同质性求和范围扩大到尚未初始化的数据。实验把分块缓冲初值设为 0 / 10000，旧代码输出最大差 5412；修正范围并用现有 11 像素边缘插值补齐后，初值对输出无影响。该单独边缘修正实验中，距可见图边缘 8 像素以外与原算法输出一致。生产版本没有加入缓冲填充。

修正后，X-T4 在 1 / 2 / 8 OpenMP 线程、堆内存扰动和两次独立 CLI 运行中逐像素一致；D850 / R5 / X-T4 同配方的核心与 ART CLI 输出再次全部一致。另修正 WB 通道系数载入的 float 中转，保持 double 精度。历史 X-Trans 配方的边缘可能随缺陷修正改变，不能声称所有旧输出仍逐像素不变。

最终 DMG 已只读挂载并复制到 `~/Applications/CaptRAW-0.4.app`，保留旧版应用，测试后卸载 DMG。下列检查实际使用此安装路径：

- 白平衡窗口 11 项、关闭 / 曲线 / 蒙版回归 19 项、工作台回归 19 项全部通过，页面运行时错误为 0；另通过新进程离线恢复和桌面导出闭环。对话框选择由测试提供，控件、预览、保存和处理实际执行。用户人工验收仍待执行。
- D850 / R5 / X-T4 安装版核心在禁止网络、禁止 Homebrew 读取且显示服务为空时通过；同配方 ART 参考输出最大通道差均为 0，TIFF 为 uint16、sRGB ICC V4。桌面新基线配方和无界面核心导出逐像素相同，三张源文件校验值保持不变。
- D850 首个核心预览 942 ms、曝光更新 20 次 P95 为 157 ms；GUI 打开到可见画面 1096 ms，5 类基础调节 P95 为 245 ms，输入反馈 P95 为 14.4 ms。核心采样 RSS 峰值约 3.59 GiB；均为本机缓存读取记录，不推及其他设备、所有工具或冷磁盘。
- 白平衡安装版检查再次验证实际像素变化、取样坐标和精确配方读回；旧 Bayer 导出与 0.3 逐像素相同。上文 X-Trans 线程 / 堆扰动实验使用同一编译源码的开发核心，未冒充安装版实验；安装版 X-T4 与修正后的 CLI 已逐像素比较通过。
- 三个缓存的 Nikon HE / HE★ 公开样本在安装版离线核心再次生成预览，感光点匹配固定参考且源哈希不变。覆盖仍为清单 3 / 29，未扩大为全机型支持声明。
- 安装核心、白平衡数据和依赖清单的哈希与打包输入一致；核心与 60 个动态库的依赖路径均为系统或包内路径。固定 ART 原始归档重新应用补丁两次，9 个引擎文件与编译源码完全一致。

证据：`artifacts/white-balance/`、`artifacts/white-balance-gui/`、`artifacts/revision/`、`artifacts/workbench/`、`artifacts/restart-report.json`、`artifacts/desktop-pixel-report.json`、`artifacts/xtrans-stability/`、`artifacts/native-acceptance/`、`artifacts/nikon-he/`、`artifacts/source-patch-audit.json` 和 `build/installed-0.4-*.log`。完整 ACR 画质、配置文件选择、自动 / 自适应调色及其他未决能力仍见对齐表；本次没有完成 Developer ID 签名、公证或跨机器验收。

## 0.3 增量验收

本节为 0.3 的新增验收；后面的 0.2 记录保留作已交付基线。0.3 安装到 `~/Applications/CaptRAW-0.3.app`，与正在运行的 0.2 并排，不替换其文件。

- 红色覆盖层直接取得 ART 用于局部调整的组覆盖率，包含组件组合、羽化、反选；几何控制柄仅用于操作。前端不再用圆形 / 椭圆填充模拟最终覆盖层。
- `tests/mask-preview.mjs` 与像素检查验证添加、减去、相交、反选及羽化；合成样本的详细区域与适屏同坐标覆盖率在 1 个透明度档内一致，旋转区域 IoU 0.9935。三个独立 8 位覆盖图的乘法比较允许至多 1.5 档量化误差。
- 修正固定 32 像素处理边界在大羽化时缺少邻域数据的问题：根据 ART 几何 / 画笔滤波范围扩大详细区域邻域。可见覆盖图只返回请求区域，避免把邻域大图送入 Web。该修正不改变全分辨率导出算法。
- 覆盖层开 / 关的 16 位导出像素一致；同一羽化蒙版配方交给 0.2 核心重新导出，像素也一致。编辑配方和处理版本不变，显示选中状态不写进配方。
- 安装版窗口验证覆盖图实际加载、Y 开关、1:1、平移、退出蒙版模式后隐藏。截图对比发现 277,344 个像素出现明显红色覆盖，85.5% 视口像素保持不变；该统计只针对固定窗口与样本，不是所有场景的阈值。
- 安装版核心在禁止网络、显示服务为空、禁止 Homebrew 读取条件下通过覆盖率、保存 / 导出相关检查。详细区域图及覆盖率的坐标、宽高一致。
- D850、羽化 15 的本次安装版 1:1 平移处理约 1.05 秒；宽羽化的额外邻域会提高内存和耗时。这不是全部图像、全部羽化参数的性能通过证明。
- Nikon 增加 Z9 HE 真实样本：45,705,600 感光点与独立 Adobe 参考完全一致。连同 Z5II HE / HE★ 两张公开样本，现已验证清单中的 3 / 29；三者均在离线安装版核心生成预览并保持源哈希不变。其余 26 个公开样本尚未完成，不能据此声称所有 Nikon 模式支持。

证据：`artifacts/mask-preview/report.json`、`pixel-report.json`、`artifacts/mask-overlay-gui/`、`artifacts/revision/report.json`、`artifacts/nikon-he/report.json`、`artifacts/nikon-z9-adobe-reference/comparison.json`；安装版日志为 `build/installed-0.3-*.log`。ART 的覆盖率回调和详细区边界补丁可从固定原始源码重复应用，8 个相关引擎文件与本次编译源码一致。

用户人工验收仍待执行。人物选择、修复、HDR、反射消除、默认裁切和其他 ACR 缺口继续见 [能力对齐表](ACR-PARITY.md)。

## 0.2 交付基线

日期：2026-10-26。环境：M4 Pro / 48 GB，macOS 26.6.2（25G83），ARM64。固定 ART 1.26.10，提交 `1e0e12c62e4f329d30bb5624d62a23a663ffbe6b`。Electron 45.0.0，React 19.3.1。

已通过安装版自动化实机验证，**用户人工验收尚待执行**。这些结果证明首批显影和手动蒙版原型可运行，不证明完整 ACR 替代或跨平台产品级成熟度。

## 安装与独立运行

从 `release/CaptRAW-0.2.0-arm64.dmg` 只读挂载，复制应用到 `~/Applications/CaptRAW.app`，随后卸载 DMG。GUI 测试启动的是这个安装后的可执行文件，不是 Vite、开发服务器或源码目录里的 Electron。

应用资源携带原生核心、60 个动态库、ICC / DCP / 相机与镜头数据、44 项原生依赖许可记录和 26 项 Web 依赖许可记录。Mach-O 加载命令已经审计：非系统依赖使用包内 `@loader_path`。安装版核心还在 `tests/offline-native.sb` 沙箱下实际显影和导出，禁止网络，以及 `/opt/homebrew`、`/usr/local` 读取，全部通过。GUI 会话也在 Electron 网络禁用状态下操作。

本次最低系统 **macOS 26.0 / Apple Silicon**，由实际依赖构建版本决定。未执行其他 macOS 版本、Intel、Windows 或 Linux 验收。没有 Developer ID 签名、公证或外部下载后的 Gatekeeper 验收。

## RAW、精度与色彩

| 样本 | 模式 | ART 可用尺寸 | 与参考输出最大通道差 |
|---|---|---:|---:|
| Nikon D850 NEF | 14 位无损压缩，3:2 | 8280 × 5512 | 0 |
| Canon EOS R5 CR3 | RAW，非 Dual Pixel，3:2 | 8183 × 5455 | 0 |
| Fujifilm X-T4 RAF | 14 位无损压缩，3:2 | 6232 × 4156 | 0 |

样本为 CC0，来源和 SHA-256 见 `tests/fixtures.json`。参考是同一固定源码独立构建的 ART 参考 CLI（含同样的构建及蒙版组合补丁），使用 CaptRAW 生成的完整 ARP，而非另调一个“看起来接近”的预设。三种相机的全图 16 位输出逐像素一致。原始三个文件的 SHA-256 在 GUI 验证后仍一致。

TIFF 实际样本类型为 uint16，ICC 为 sRGB V4；合成 Bayer 灰阶输出超过 256 级。GUI 导出和安装版无界面核心读取同一保存配方再次导出的全图最大差为 0。JPEG 已解析验证 RGB、JPEG 格式和 sRGB ICC。预览 PNG 有 sRGB chunk；适屏与真 1:1 在同一区域低通后平均差约 0.86/255，避免用细节采样差异误判整体色调。

合成图像像素检查覆盖曝光、径向区域内外、开关、反选、线性、画笔和擦除、旋转、裁切及恢复。蒙版随旋转的区域交并比为 0.9943，差异局限于 ART 整数边界取整；关闭蒙版和恢复基线的最大通道差为 0。XMP / ARP 哨兵文件不变。损坏 NEF 和使用未支持压缩标识的合成 DNG 均被拒绝；这不等于已经验证所有相机压缩模式。

## 安装版 GUI

`tests/e2e.mjs`、`tests/revision-e2e.mjs`、`tests/workbench-e2e.mjs`、`tests/restart-e2e.mjs` 操作实际窗口，产生截图和报告。文件对话框的返回路径及关闭 / 退出确认框的选择由测试提供；照片解码、控件、Canvas、进程、保存和导出均实际执行。

通过的工作流包括：

- RAW 打开、可见预览、全部全局滑杆和曲线的实际图像变化。
- 鼠标撤销重做、macOS 快捷键、按住初始状态对比与恢复。
- 三类蒙版、擦除、单笔一步历史、局部调整、羽化、反选、开关、重命名、删除与撤销。
- 裁切与 90° 旋转、真 1:1、平移后收到新的区域图像。
- 三种相机多图切换保持编辑，中文和空格 RAW / 配方 / 导出路径。
- JSON 配方恢复、关闭进程后重新启动应用恢复裁切和三个蒙版。
- 独立导出进程、取消后没有最终文件、损坏文件提示与恢复当前编辑。
- 人为终止当前应用拥有的核心进程后，显示错误，重试恢复当前编辑。
- 网络禁用时运行；渲染器没有 Node.js `require` 权限；没有页面运行时异常。

## 性能

以下为本机样本，文件系统缓存已热。不是冷磁盘、其他硬件或长期使用的性能保证。D850 适屏图为 1656 × 1103，使用 ART 整数缩放获得不超过约 2048 像素的预览。

| 项目 | 实测 | 门槛 |
|---|---:|---:|
| 安装版打开 D850：点击到 Canvas 帧完成 | 827 ms | ≤ 5000 ms |
| 安装版全局调节到可见更新 P95（5 类控件） | 215 ms | ≤ 1000 ms |
| 核心曝光更新 P95（20 次） | 146 ms | ≤ 1000 ms |
| 安装版输入到下一绘制帧 P95（8 次） | 13.8 ms | ≤ 100 ms |
| GUI 首次 1:1 核心区域处理 | 476 ms | 记录值 |
| 安装版核心加载 / 输出过程采样 RSS 峰值 | 3.79 GiB | 记录值 |
| Electron 主进程 RSS | 258 MiB | 记录值 |

RSS 不包含整个应用的渲染器、GPU 进程或整机内存；原生采样间隔 80 ms，不能充当精确的瞬时峰值。本版已接入传统降噪，但未建立噪声 / 细节画质盲评或其专门性能门槛；AI、HDR、批量导出仍未实现，不报告其性能。

## 证据与复跑

- `artifacts/e2e-report.json`、`artifacts/workbench/report.json`、`artifacts/restart-report.json`：安装版路径、操作结果及时间。
- `artifacts/native-acceptance/report.json`：三种 RAW、参考比较、内存、断网和 Homebrew 禁读标记。
- `artifacts/desktop-pixel-report.json`、`artifacts/regression/pixel-report.json`：位深、ICC、逐像素比较及蒙版检查。
- `artifacts/raw-open.png`、`artifacts/mask-edit.png`、`artifacts/detail-1to1.png`、`artifacts/restarted.png`：安装版实际界面。
- `artifacts/revision/report.json`、`artifacts/installed-public-revision/report.json`：0.2 新增的界面回归分别在用户 HE★ 与公共 NEF 上通过。
- `artifacts/nikon-he/report.json`、`artifacts/nikon-he-adobe-reference/comparison.json`：两张公开 Z5II 样本的模式 / 哈希 / 核心预览与独立 HE 解码对照；用户 HE★ 独立对照仅存于私有本机证据，不分发照片。
- `artifacts/curve-conformance.json`、`artifacts/mask-groups/pixel-report.json`、`artifacts/extended-controls/report.json`：实际样条、组合蒙版像素与新增调节处理证据。
- `build/installed-0.2-*.log`、`build/core-regression.log`、`build/desktop-consistency.log`：完整测试日志。

复跑步骤见 README；其中安装版核心和 GUI 使用 `CAPTRAW_ENGINE` / `CAPTRAW_RESOURCES` / `CAPTRAW_APP` 指定，原生禁网与依赖隔离使用 `CAPTRAW_SANDBOX_PROFILE="$PWD/tests/offline-native.sb"`。


## 0.2 用户反馈修正

文件名、胶片和底栏均有关闭入口，⌘W 有效；未保存时保存 / 放弃 / 取消，取消保存保留文件。“完成”保存后关闭；关闭非当前文件和关闭当前文件不丢失邻图编辑。关闭窗口及退出应用取消时均保留编辑。这些分支在安装版窗口通过，实际系统确认框的按钮选择由测试注入；用户人工按钮体验仍待验收。

编辑模式不显示画笔、橡皮擦及蒙版引导。蒙版组可改名、复制、排序、隐藏、删除与反选；组内画笔 / 线性 / 径向组件支持添加、减去、相交、改名、隐藏和删除。中心移动和端点改范围各形成一步历史，撤销恢复原几何。合成图的组覆盖、组反选、组件隐藏和独立进程读取配置后重新输出均通过实际像素检查。新组合字段为 CaptRAW 的 GPL 扩展，原版 ART 不识别。

曲线现在保存多个控制点，显示密集采样的自然三次样条。四组常规及极端控制点各 513 个采样，与 ART 实际 `DiagonalCurve` 采样的最大差 < 1e-12。核心处理、桌面预览和 16 位导出均读取同一 ART 曲线，前端没有另做像素映射。

新增高光、阴影、白色、黑色、HSL、三颜色曲线、去朦胧、颗粒、晕影、USM 锐化、传统亮度 / 颜色降噪和 Lensfun 自动校正。D850 真 1:1 区域中各已测设置产生真实像素变化。它们采用 ART 语义，不代表 ACR 同名算法 / 数值或画质已对齐。

Nikon 解码链接固定的开源 LibRaw Redlamp 分支 `3b20539d3faa766a370e93a529a3b87edffbf0f6`，包内为 `libraw_r.26.dylib`。一张 Z5II HE★ 用户样本的 24,498,560 感光点与本机 Adobe DNG Converter 生成的独立未压缩 DNG 参考完全一致；最大差 0、差异感光点 0。该闭源程序只作测试参考，应用运行不调用它，参考图和原片不进入安装 / 源码包。相同原片在安装版完成 GUI 回归，并在禁止网络与 Homebrew 读取下预览（约 537 ms）及 16 位 TIFF 导出。原片 SHA-256 在测试后仍一致。另外两张公开 Z5II 的 HE / HE★ 样本，分别由安装版核心在离线、Homebrew 禁读条件下生成预览，源哈希未变、感光点哈希与固定上游参考一致。普通 HE 样本的 10,688,000 感光点与本机独立 Adobe DNG 参考也完全一致。上游清单 29 个 HE / HE★ 样本，本机仅完成其中 2 个公开样本；其他机型、尺寸与压缩组合仍未验收，不作全模式支持承诺。

用户样本的 ART 可用区域为 6056×4032，ACR 截图显示 6048×4032；默认裁切范围尚未统一。没有为追求尺寸一致而裁掉图像或改变已有配方坐标。感光点一致不能用于声明默认构图和色彩与 ACR 一致。

整体对齐状态见 [ACR 18.7 能力表](ACR-PARITY.md)。人物 / 部位选择、修复、HDR、反射消除、镜头模糊、自动自适应、配置文件与 Adobe 资产导入等缺口仍在；本版不是完整同级替代。

## 人工验收入口

打开已安装的 CaptRAW，使用 `build/samples/nikon-d850.NEF`：调曝光与曲线，创建画笔和径向蒙版；按住对比，撤销一笔；裁切、旋转并检查蒙版仍落在同一对象；用 1:1 平移观察细节；保存配方、退出并重新打开；最后导出 16 位 TIFF。参考输出可使用 `artifacts/gui-export.tiff`，安装版截图可用于对照当前界面。

曲线支持 RGB 总曲线与独立 R/G/B 多点样条；蒙版覆盖层表示当前组件的几何操作范围，组合及羽化结果以实际显影图像为准。SDR、macOS 26+ 与未公证状态均应纳入本次人工验收边界。


## 0.46 对象选择几何与配置失效

从 `release/CaptRAW-0.46.0-arm64.dmg` 只读安装至 `~/Applications/CaptRAW-0.46.app`。DMG SHA-256 为 `8492bfc4ee87beac6b02ea39dfc3c6412ecad9dc8d149fc1c6ee4acdbb520b54`。严格 ad-hoc 签名检查通过；789 个安装文件与签名后打包应用一致，7 个 ASAR 文件与本次 Web 构建一致。模型权重、图标、处理版本 22 / 基线 4 不变；没有公证。构建 bundle 的 Mach-O 经过 electron-builder 加入 hardened-runtime 签名，不能直接将签名前后文件哈希相等作为验收条件。

- 构建、类型检查、28 项单测通过。分割 worker 的 17 组生命周期检查通过；192 次四方向候选与独立 `np.rot90` 比较无像素差，48 个默认零角度 PNG 与修改前字节一致。没有以模型旋转等变为前提。
- 安装版宿主 6 组通过：四个粗旋转方向叠加细旋转 23°、全局旧参考角 7°、Lensfun 畸变 / 色差和透视。分割快照与当前完整预览字节相同；候选逆向整转后与 ART 最终覆盖 alpha 逐像素一致，实际参考角保存为 23°。局部亮度产生像素变化，TIFF 为 uint16，与独立安装核心输出相同。
- 仅完整 ART 配置改变、可见调节值不变时，已准备候选和正在准备的快照均失效；这些是宿主检查，不冒充前端 `profileId` 分支的 GUI 覆盖。
- 安装版原有点选 7 组、框选 8 组回归通过，包含负点、提示撤回、一次提交、取消、裁切 / 旋转、1:1、局部调节、XMP 重启和 TIFF16 导出。所有测试窗口隐藏且不聚焦。点选测试拦截 HTTP/HTTPS；修正框选脚本原有无依据的 `httpBlocked` 标记，实际拦截并检查外部请求失败后在 `box-offline` 重跑 8 组通过。
- 固定修复 / 几何配方和新对象蒙版配方分别交给已安装的 0.45、0.46 渲染，两个 RGB uint16 输出最大像素差均为 0。此检查证明接入没有改变这两组配方输出，不代表所有组合。

证据：`artifacts/install-0.46.json`、`artifacts/asar-0.46.json`、`artifacts/segmentation-worker/rotation-compatibility.json`、`artifacts/acceptance-0.46/native/run-eiUv3o/report.json`、`artifacts/acceptance-0.46/{object,box-offline,compatibility}/report.json`。新几何 GUI 专项结果另附下段，失败记录保留。

边界：只验证当前创建几何及细旋转参考；任意后续透视 / 镜头 / 粗旋转组合下的内容锁定、颜色 / 亮度范围拾取、拉直入口及 Adobe CropAngle 未因此完成。对象模型仍为二值候选，人物部位、透明物、发丝与 ACR 语义质量未验收；完整 ACR 平替目标未达成。


0.46 安装版新几何 GUI **7 组通过**，加上点选 7、框选 8，共 **22 组**。报告为 `artifacts/acceptance-0.46/geometry-settled/run-uEJOdE/report.json`：粗旋转 90°、细旋转 23°、全局旧参考 7°及镜头 / 透视下，实际 SVG 候选与提交覆盖 IoU 为 0.999386，质心偏差约 0.0246 CSS 像素；局部亮度改变 210599 个像素，蒙版外最大差 0。一次撤销 / 重做、XMP 全新进程恢复、无重新推理及工具切换丢弃迟到结果通过。全部窗口隐藏，HTTP/HTTPS 请求拦截。

首轮安装测试 `artifacts/acceptance-0.46/geometry/run-tpRtoI/report.json` 在切回蒙版后启动对象时失败，未发出对象 IPC。测试原先把 debounce 触发前没有 busy 指示视为就绪；现等待新 revision 的真实覆盖帧，再检查单次 enabled / trusted DOM 点击。首轮缺少指针记录，具体丢点击时点仍未证实；快速切换工具的产品交互竞态仍属未决，不以通过重跑宣布已修复。前端 profile-only 分支也未获得独立可见操作路径证明：同值预设不改变配置，切入预设已经取消对象。宿主对应分支已单独通过。


## 0.47 对象入口点击与空格键

从 `release/CaptRAW-0.47.0-arm64.dmg` 只读安装至 `~/Applications/CaptRAW-0.47.app`，SHA-256 为 `eead43a4247832ef6890b9e8b6f6bb70dcf9c751f72eb48ad001767244ee5af5`。严格 ad-hoc 签名检查通过，789 个安装文件与签名后打包应用一致，7 个 ASAR 文件与当前 Web 构建一致。521 个原生 / 模型文件与安装版 0.46 逐字节相同；处理版本 22、基线 4、图标和模型不变，没有公证。

0.46 已确定性复现入口丢点击：`artifacts/object-start-gui/run-t8ek2x/report.json` 记录真实按下时按钮可用、约 97 ms 后原生 update 令按钮禁用、再过 8 ms 松开时没有 click 或对象 IPC。没有重试、伪造结果或修改 React 状态。修复为入口不再随预览 busy 禁用，仍保留载入 / 前状态对比保护；原先单独一轮缺少指针记录的失败不被追认成同一精确时序。

开发版补测发现画布全局空格 preventDefault 还会吞掉聚焦按钮的键盘激活，失败保留在 `artifacts/object-start-gui/run-KOd9FN/report.json`。现保留交互控件的默认空格行为，同时记录空格按住状态供画布拖动使用。没有改为 pointerdown 启动，也没有用重复点击掩盖问题。

- 构建和类型检查通过，28 项单测通过（本次重复检查复用了任务缓存）。
- 安装版启动专项 **4 组通过**：单次可信鼠标点击跨过真实 busy 切换；Space 开始准备并在暂扣真实 update 回复期间取消，迟到回复不创建对象；Enter 随后重新启动；曝光更新回复未交付时启动对象，模型输入与最新 1.25 EV 预览字节相同，迟到更新后真实候选仍可使用。
- 安装版对象几何 **7 组通过**：候选 / 提交覆盖、独立参考角、撤销重做、局部实际像素、XMP 全新进程恢复、无再次推理、工具切换取消。报告为 `artifacts/acceptance-0.47/geometry/run-QYrGtN/report.json`。
- 真实 Nikon D850 NEF 的隐藏覆盖专项通过：可见覆盖图加载、Y 开关、1:1、点击 1:1 按钮后直接按住空格拖动、详细区域图像 / 蒙版坐标同步、编辑模式隐藏覆盖。证据为 `artifacts/acceptance-0.47/overlay/report.json`。此专项没有进行 ACR 图像质量对照。

启动报告 `artifacts/acceptance-0.47/start/run-umbcpN/report.json` 保存真实 DOM 事件、IPC、快照哈希及隐藏窗口状态。启动和几何专项拦截 HTTP/HTTPS；NEF 覆盖专项只验证本地工作流，不宣称 OS 级断网。所有 E2E 窗口保持隐藏。新脚本可用 `CAPTRAW_OBJECT_START_FIXTURE` 指定对象几何专项生成的 `4-edited.xmp` 及随附资产；`--expect-lost` 默认使用保留的 0.46 安装版复现旧行为。

本次解决已复现的点击禁用竞态与按钮空格激活；没有声称所有快捷键 / 焦点或快速工具切换组合均已验收。范围取样、拉直入口、Adobe CropAngle、任意后续几何内容锁定及完整非生成式 ACR 目标仍未完成。未 commit / push。
