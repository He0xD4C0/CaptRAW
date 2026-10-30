<h1 align="center">
  <img alt="CaptRAW Logo" src="./assets/branding/logo.svg" width="160" height="160" />
  <br>CaptRAW<br>
</h1>
<p align="center">新世代开源 RAW 显像方案</p>


当前执行 **色彩链路可信与 macOS 工作流收尾**，唯一施工与验收入口为[收尾账本](docs/CLOSEOUT.md)。允许算法风格不同，不再追求ACR同参数、同函数或同像素；优先保证软件色彩转换、监看声明、输出及现有摄影工作流。Adobe XMP改为导入来源，原生编辑／预设将采用 `.captraw`／`.captrawpreset`；无可靠色彩声明时弹窗选择，默认sRGB。以上新格式与色彩链路尚未交付，当前仍保留0.64安装基线。旧对齐调查和下方版本记录仅供追溯，不是当前排期或新包验收结论。

本轮不启动全景、独立观察工具、红眼 / 宠物眼、图库或新的独立输出格式；HDR / AI 仅在受影响时回归。产品验收限 macOS，Windows / Linux 仅作接口与构建风险铺路，见[下一轮适配清单](docs/PLATFORMS.md)。0.64 既有 DMG 身份继续有效；追加报告及尚未封存的计数 / 归档边界见 [验收记录](docs/ACCEPTANCE.md#追加报告待主线程封存)。

**未发布工作树进展：** 已接入可见选择联动、共同／单张撤销、整组完成／取消、原片旁 XMP 首次确认与失败重试、调节子集复制／粘贴，以及多图预设、强度、收藏和独立悬停预览。开发构建的会话、预设、真实 RAW 取消／核心恢复和保存专项共 26 个隐藏 GUI 检查通过；XMP SDK 任意限定符和逐图自动白平衡另有原生验证。该证据不代表安装版或 ACR 效果等效已通过。连续修复、完整颗粒／晕影仍在集成；当前 0.64 安装包及源码归档没有包含这些开发改动。

## 安装与使用

构建产物为 `release/CaptRAW-0.64.0-arm64.dmg`，将应用拖入 Applications；本机验收副本为 `~/Applications/CaptRAW-0.64.app`。本次依赖瓶装库的最低系统为 **macOS 26.0，ARM64**；其他版本未验收。原型使用 ad-hoc 签名，没有 Developer ID 签名和 Apple 公证，本机验收不等于跨机器 Gatekeeper 验收。

打开照片后在右侧折叠面板调整；“曲线 → 参数”控制四个区域，图下三个分界支持鼠标、方向键和数值输入；最右工具栏切换编辑、裁切、修复和蒙版。蒙版面板创建组、添加组件或减去 / 相交，拖动中心移动、端点改变范围；画笔和橡皮擦仅在蒙版模式出现。文件名旁、胶片缩略图和底栏都有关闭入口，未保存时选择保存 / 放弃 / 取消；底栏“完成”保存后关闭。裁切区域内的“完成”结束裁切。1:1 按物理屏幕像素显示，并从核心请求完整可见区域，不再截断到 2048×2048；拖动可平移。高质量适屏图刷新不会清除同一处理版本的详细区域。

“光”面板的“自动”根据当前真实预览 RGB 直方图调整曝光、对比度、高光、阴影、白色和黑色；一次点击形成一步撤销。它是 CaptRAW 本地影调算法，不冒充 ACR Auto 的同值结果。

- 胶片工具条可切换“网格视图”；网格保留原缩略图、多选、当前照片、脏标记和关闭入口，并扩大为可滚动多行布局，`Esc` 恢复单行胶片。
- RGB 直方图左上 / 右上的三角按钮切换阴影（蓝）与高光（红）裁剪覆盖。阈值作用于当前 sRGB 预览：阴影三通道均为 3 或更低，高光任一分量达到 252 或更高；该显示不写入 XMP。
- 预览底栏可选择左右、上下、左右分割、上下分割；Q 正向、Shift+Q 反向切换。前状态沿用当前裁切、旋转、透视和镜头校正，两侧共用缩放 / 平移并支持真实 1:1。对比视图只用手形交互，返回单图后继续在图像上编辑；数值调节可在对比中使用。
- 0.64 收口修复：单张和批量均导出所选可见照片的完整编辑快照；筛选隐藏活动照片时不再误导出活动图，无可见选择时禁用导出。菜单显示所选文件名和对应尺寸。无裁框自由角度通过 XMP 现有 ART 扩展保存，预设与同步不丢失；活动裁框仍使用标准 `CropAngle`。这不等于 Adobe 自由旋转已等效。已有实验性 HDR 编辑及 12 位 PQ AVIF 保留，物理 HDR 显示、SDR 映射、SDR AVIF 输入 / 输出仍未完整验收，详见 [HDR 边界](docs/HDR.md)。 收口另修复白平衡适屏缓存：连续调色、撤销与保存重开的预览像素一致；完整导出算法保持。
- 0.63 在胶片上方提供 0–5 星、拒绝和评分筛选；数字 0–5 对所选可见照片评分，输入框和组合键保留原用途。胶片 / 网格显示每张评分，小数评分原样保留；没有符合项时可恢复全部，当前照片被隐藏会明确提示。评分不参与显影，支持逐图撤销、关闭 / 退出保护和显式单张 / 批量 XMP 保存；JPEG / TIFF 导出携带点击时评分，移除输出中冲突的旧 EXIF 评分。拒绝仅写 `xmp:Rating=-1`，不删除原片。颜色标签编辑、排序和完整图库仍未实现。
- 0.62 支持稀疏 HSL、参数曲线、现代颜色分级和原色校准预设；只更新文件中指定的控件，其他编辑保留。带原生配方的稀疏文档从原配置读取基值；分界冲突在应用时明确报错且不修改目标。完整旧式 SplitToning 预设会按 Adobe 公开规则重置新增分级控件，并在导入后说明。详细规则与不能无损转换的情形见 [接口说明](docs/ENGINE.md#稀疏-xmp-与旧式分离色调062--引擎-26)。
- 0.61 修正颜色分级的 5 个 XMP 字段名称，采用实际 Adobe 的 `SplitToning*` 与 `ColorGrade*` 共 14 个字段。旧版 CaptRAW 误写的字段在保存时迁移，保留原编辑和原生配置；外来未知字段保留且不冒充旧参数。新文件写入版本 25，旧安装版明确拒绝；现有版本 20–24 XMP 可读取。分级专项目标已验证实际像素、四色轮、预设、撤销重做、保存重启及 TIFF16；这仍不证明与 ACR 的颜色算法或画质等效。
- 0.60 修正 Adobe 蒙版的残缺组合导入：人物 / 天空等组件无法重建时明确跳过整组，保留原结构，不再把剩余的“减去”变成“添加”。删空全部蒙版后保存、重开保持空列表；已停用组与组件保持状态。画笔支持 RDF `Dabs` 数组中的落笔与逐点半径指令，未知指令整组不应用；笔尖和边界仍未证明与 ACR 等效。安装版 9 项隐藏蒙版 GUI、12 项原生 / SDK 检查及综合 XMP 50 项文档 / 10 项 GUI 通过；真实 ACR 18.7 上次设置快照配合受控 DNG 验证，原文件哈希不变。
- 0.59 增加 Adobe `MaskGroupBasedCorrections` 的部分导入：线性、无旋转径向、画笔与亮度范围成为可编辑蒙版，支持组件添加 / 减去 / 相交及已接入的局部调节；AI 选区等未应用内容会明确提示。原 ACR 结构保留，重开时优先使用已保存的 CaptRAW 蒙版。安装版 6 项隐藏 GUI、6 项原生检查及综合 XMP 10 项 GUI / 50 项文档检查通过；导入后的 TIFF16 带 ICC，桌面与独立核心逐像素一致。该专项使用构造 XMP，尚非真实 ACR 蒙版侧车或 Adobe 画质等效验收。新 Logo 已核对标题栏、favicon、包内 SVG 与 macOS ICNS。
- 0.58 将用户提供的曲线 Logo 同步到标题栏、favicon 与 macOS ICNS，并把引擎 24、自动天空、主体 / 背景和人物部位带入安装版；安装版 **120 项**隐藏 GUI 检查、引擎 24 XMP 和 TIFF16 回归通过，其中包含多点曲线 13 项、蒙版模式／管理 15 项和关闭放弃／退出保护 19 项。Nikon HE / HE★ 固定清单 **29/29** 在安装版离线核心、真实 GUI 与独立 Adobe DNG 感光点对照中再次通过；首次可见预览 P95 为 **2095 ms**，曝光提交到画面稳定 P95 为 **480 ms**。DMG 为 ad-hoc 签名、未公证。
- 0.57 引导透视改为松手后自动校正，完成按钮仅退出工具；每次画线、移动端点或删除可独立撤销。失败保留待修正的线，照片设置不变；Esc 取消当前未完成操作，保留此前成功的编辑。少于两条同向线时保存线并保留现有校正。
- 0.56 引导透视增加 200% 放大镜，读取当前显影的原分辨率细节。Shift+L 切换显示，Option 拖动以四分之一速度定位；放大镜不会写入 XMP，取消保留原编辑。
- 0.55 引导透视允许“两条水平＋一条垂直”或“两条垂直＋一条水平”。三条线拟合旋转和两个透视方向，倾斜固定为零；只保证所画线的方向约束，第四条未指定的边缘可能仍倾斜。0.55 当时需显式应用；0.57 改为逐次自动校正，XMP 引导线保持。
- 0.54 “几何 → 引导透视”支持沿照片边缘画两条同向或两类各两条参考线，拖动端点、选择和删除；点击“应用引导校正”或 Enter 提交一步编辑。引导线源图位置随 XMP 保存，旋转后仍可继续调整；Esc / 取消放弃草稿。这是 0.54 的交互方式；0.57 已移除逐次手动应用按钮。
- 0.53 “几何”增加自动水平、自动垂直与自动联合校正。本地分析直线，成功后为一步编辑；取消 / Esc、切换照片或工具、手动调节会丢弃旧结果，无可靠直线时保留设置并提示。0.54 接入成对引导线；Adobe 算法等效仍未完成。
- 0.52 在“编辑 → 几何”增加垂直 / 水平透视、透视旋转和倾斜。调节自动启用，取消勾选保留数值；独立复位、撤销、XMP 恢复与透视预设 / 同步已接入。比例 / 缩放 / 偏移控件及 Adobe 同值映射仍待完成。
- 0.51 新颜色样本保存源图定位点；样本标记和 Option 删除命中随拉直、旋转、镜头与透视映射更新，颜色值不重算。旧样本没有原图定位信息时保持原位置并提示重新取样。
- 0.50 亮度 / 颜色范围取样从按下鼠标到结果返回纳入保存和退出保护；Esc、换工具 / 照片、参数、对比或视图变化会取消，迟到结果不写入配方。成功取样仍为一步历史；原生显影和 XMP 格式不变。
- 0.49 裁切内的“拉直”支持沿水平 / 竖直边缘拖线，松手应用、一步撤销，Esc 取消。使用当前镜头 / 透视映射求角度；超出 ±45° 或无法映射时保持编辑并提示。
- 0.48 在裁切模式增加手动角度（−45° 至 45°，0.01° 步进）、独立重置与单步撤销；蒙版参考角、前后对比构图和 XMP 保存恢复随之接入。旧 XMP 从 ART 配置恢复实际角度。0.49 已接入画线拉直；0.53 已接入基于结构直线的自动校正，Adobe `CropAngle` 映射仍待完成。
- 0.47 修正切换蒙版时刷新预览吞掉“选择对象”点击的问题；按钮可在预览处理中启动准备。空格 / Enter 可激活该按钮，空格拖动画布仍可临时平移。
- 当前工作区的“蒙版 → 选择对象”新增本地人物部位：面部皮肤、身体皮肤、头发、衣物和附件。使用 Apache-2.0 的 MediaPipe Selfie Multiclass ONNX 权重，推理、蒙版生成和保存均在本地；当前会把画面内所有人物同类区域合并，尚不能指定某个人或拆分多人。
- 对象选择同时提供“自动主体”和“自动背景”。使用 Apache-2.0 的 U²-Net 显著物体模型在本地生成主体概率图，背景为同一概率图的灰度补集；两张候选沿用预览坐标、粗旋转、内容寻址栅格资产、XMP 保存恢复和 TIFF16 输出。显著物体结果本身不能充当天空蒙版，后者由下项独立检测。
- “自动天空”从预览顶部检测连续天空色彩与平滑度，自动生成 SAM2.1 正提示并输出可编辑栅格蒙版；无可靠天空时明确要求改用点选或框选。真实 D850 天空与人工提示参考的 IoU 为 0.9971，但树枝间天空、遮挡与 ACR 分割边界质量仍需扩大样本验证。
- 0.46 对象选择保留当前旋转 / 镜头 / 透视准备快照，候选无损转回栅格存储方向；新蒙版绑定实际细旋转角，配置变化会取消旧候选。后续任意几何组合与 ACR 选区质量仍待验证。
- 点曲线支持多点、端点移动、输入 / 输出数值和方向键微调；Shift 每次调整 10，Esc 撤回当前输入或拖动。新操作采用 0–255 整数网格，读取和保存已有小数坐标不取整。
- `⌘O` 打开；`⌘S` 保存；`⌘W` 关闭；`⌘Z` / `⇧⌘Z` 撤销 / 重做。视图与图像选择沿用 ACR：`⌘0` 适屏、`⌘⌥0` 100%、`⌘+` / `⌘-` 缩放，`⌘⇧A` 或 `⌘D` 只保留当前照片。
- 裁切模式：`X` 切换横竖，`Enter` 完成；拖动边角缩放、框内移动、框外新建。
- `P` 切换前状态；按住“按住对比”按钮临时查看。默认使用打开照片时的设置（包括 XMP）。底栏“保存前状态”或 `Option/Alt+P` 保存当前设置为对比参考，“交换前后设置”可一步撤销，“还原打开时状态”恢复默认参考。参考只保留于当前会话，切换照片保留，关闭后不写入 XMP。`Shift+P` 打开预设。
- `I` 白平衡吸管；可选 5×5 / 11×11 / 25×25 原图像素，在中性灰处单击；`Esc` 退出。自动与预设结果保存为固定的通道系数；手动改色温 / 色调转为自定义。
- 0.36 修正镜头校正后的吸管错位：取样跟随预览中的畸变、色差、90° 旋转和裁切位置，已有固定白平衡系数及配方渲染不变。
- 0.42 补齐含 ART 任意角 / 透视配置时的白平衡取样映射，并处理已关闭但保留数值的色差设置；现有固定配方输出不变。共享正反坐标映射已验证，任意角交互及蒙版跟随仍未接入，不能将此修复视为拉直功能完成。
- 0.43 修正画笔保存后的边缘精度损失、镜头校正 / 透视详细预览的黑边，以及平移到蒙版外误报空蒙版。XMP 写入处理版本 21，仍读取已有版本 20；任意角蒙版跟随已接入核心，拉直操作与 Adobe CropAngle 仍未开放。
- “配置文件 → 导入 DCP / ICC”将文件复制到本地库；保存 XMP 时随附可校验资产。移动编辑文件须保留 `.xmp.assets` 文件夹。DCP 检查机型限制，控件按实际能力显示；Adobe 名称 / digest 自动匹配仍待验证。
- 0.64 的 RAW 全局白平衡使用 Adobe Temperature / Tint 坐标（2000–50000 K，-150–150），由当前相机 DCP / 矩阵转换；未发布工作树已将下限扩至1500 K，并完成低色温、旧范围及保存历史专项。XMP 只含其中一项时保留另一项。已渲染图像的相对白平衡、Adobe 相机配置及完整画质等效仍待验证，见 [白平衡接口](docs/ENGINE.md#xmp-白平衡坐标033)。
- `⇧L` 新建亮度范围，直接单击或拖框取样；“显示亮度图”切换灰度视图，“亮度取样”重新启用吸管。
- `B` 修复：先单击来源，再单击目标；Option 单击重新取样，拖动两端重定位；Backspace 删除选中点，`[` / `]` 改半径，Shift 配合改羽化。
- `E` 编辑，`M` 蒙版，`K` 新画笔，`⇧K` 添加画笔组件，`G` 线性，`J` 径向，`C` 裁切，`H` 平移，空格临时平移，`R/L` 右 / 左旋转，`Y` 覆盖层，`X` 反选蒙版。
- `[` / `]` 改画笔大小，`⇧[` / `⇧]` 改羽化，按住 Option 临时擦除。实际参数及颜色使用 ART 语义，不能按相同数值复现 ACR。
- 编辑和预设使用 `.xmp`；默认识别原片旁的同名 XMP。当前工作区把曝光、色温、色调、对比度、高光、阴影、白色、黑色、自然饱和度、饱和度、纹理、清晰度、去朦胧、裁切后晕影及羽化 / 圆度、颗粒、锐化、锐化半径、锐化细节、锐化边缘蒙版、明亮度 / 颜色降噪及细节 / 对比度 / 平滑度、手动镜头扭曲、镜头暗角、紫 / 绿色差去边、红 / 绿 / 蓝原色色相与饱和度、四条点曲线、七个参数曲线字段、八色 HSL 的 24 个字段、颜色分级的 14 个字段、黑白转换与八色 `GrayMixer*`，以及 `tiff:Orientation`、`HasCrop`、裁切矩形和 `CropAngle` 写入标准属性；这证明字段参与显影，不等于 ACR 像素或算法等效。当前安装包为 0.64 / 引擎 27，兼容读取 20–27，旧私有裁切 / 旋转和完整参数 / HSL / 颜色分级 / 黑白组在下一次保存时迁移为标准字段。当前初始显影基线固定为 4，旧 JSON 格式不读取、不迁移。撤销历史仅存在于当前会话；关闭文件与退出应用均提示未保存更改。Adobe 参数支持范围见 [XMP 接口说明](docs/ENGINE.md#xmp-编辑文档与预设032替代旧文件格式)。
- 胶片条“保存所选…”将选中的编辑批量另存至所选文件夹，包含所需蒙版和配置资产；同名文件自动编号，不覆盖原有 XMP。失败项保留未保存标记，可单独重试。取消或保存中退出会完成当前文件后停止，已保存文件保留。
- 胶片工具条的“匹配曝光”读取当前照片与其他所选照片的 ISO、光圈、快门和曝光补偿，按相机设置修正目标照片曝光；目标缩略图和像素刷新，每个目标独立一步撤销，主动照片不变。不会分析场景光线；“相机设置＋光线”模式尚未接入。
- 默认导出新文件；保存对话框中的覆盖选择才允许替换已有输出。取消或失败保留已有目标文件。

0.44 增加独立蒙版参考角与跨照片预设 / 同步；已有任意角配置中的画笔、擦除和线性 / 径向手柄使用原生坐标映射。单次拖动在松手后提交一步历史，Esc 或切换照片取消未提交草稿。XMP 写入处理版本 22，读取 20 / 21 / 22；旧 0.43 不能读取新写出的 22 文件。0.45 将修复点的拾取、拖动及完整轮廓接入细旋转 / 镜头 / 透视映射，待映射操作受保存和退出保护；单击手柄不创建历史。0.46 已修正对象候选当前几何快照，0.48 开放手动角度；0.49 已开放画线拉直，完整范围取样联动和 Adobe CropAngle 尚未完成，证据见 [验收记录](docs/ACCEPTANCE.md)。

## 构建

需要 Xcode Command Line Tools、ARM64 Node.js 22.13+（CI 固定 22.23.1）、pnpm 11.25.0、CMake、Ninja、pkg-config、Homebrew。固定开源 LibRaw HE 解码分支 `3b20539d3faa766a370e93a529a3b87edffbf0f6` 和 ART 提交 `1e0e12c62e4f329d30bb5624d62a23a663ffbe6b`，源码压缩包有 SHA-256 检查；JavaScript 依赖由 `pnpm-lock.yaml` 固定，工作区由 `pnpm-workspace.yaml` 管理，Turborepo 固定为 2.11.10。

```sh
brew install cmake ninja pkgconf autoconf automake libtool gtkmm3 exiv2 lensfun libomp nlohmann-json librsvg jpeg-turbo fftw little-cms2 aom
corepack enable
corepack prepare pnpm@11.25.0 --activate
pnpm install --frozen-lockfile
pnpm build
pnpm package
```
HDR AVIF 构建当前固定 AOM **3.15.0**，`scripts/build-avif.mjs` 校验版本并构建固定 libavif 1.4.2；升级 Homebrew 后若版本不同，须先核验并更新依赖固定信息。产品安装后不依赖 Homebrew、FFmpeg 或 Python。


如默认 Electron 下载站点不可达，可在构建环境设置 `ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/`；安装器仍使用 Electron 包内的官方 SHA-256 校验。运行应用不需要网络。

`pnpm dev` 启动开发工作台，之前必须构建原生核心和 XMP worker（`pnpm build`）。开发入口先构建共享包，再监听共享包、Electron bundle 和 Vite；React 与浏览器侧契约更新支持热更新，主进程、preload 或共享服务更新编译后需按终端提示手动重启应用。编译失败时保留当前会话，退出开发流程会回收监听进程。

`pnpm build:ui` 只构建共享包与桌面 JavaScript，产物位于各包的 `dist/` 和 `apps/desktop/dist/`；`pnpm build` 依次构建原生核心、XMP worker 和 UI。`pnpm prepare:electron` 显式准备 Electron 二进制，开发、E2E 和打包入口会调用它；纯 JavaScript 检查无需下载 Electron。安装仅允许 esbuild 的依赖构建脚本，Electron 下载通过上述显式命令执行。

`pnpm package` 构建 ARM64 应用和 DMG，收集依赖、重写 Mach-O 加载路径并审计，无需运行时 Homebrew。打包仍需本机按 [分割文档](docs/SEGMENTATION.md) 准备并校验的模型资产。实际使用的原生库版本、许可证、源地址及加载命令保存在安装包 `Contents/Resources/native/dependency-manifest.json`。构建命令可重复执行；没有声称产物逐字节可复现或不同 Homebrew 版本产生同一二进制。

## 验证

生成受控 EXIF 测试图需要 `exiftool`（`brew install exiftool`）。白平衡光学校正回归使用 `~/Applications/CaptRAW-0.35.app`，几何取样回归使用 `~/Applications/CaptRAW-0.41.app`，裁切局部明暗回归使用 `~/Applications/CaptRAW-0.39.app` 作为修复前参考；产品运行不依赖这些版本。

```sh
pnpm ci:check
node scripts/fetch-samples.mjs
uv venv build/qa-venv
uv pip install --python build/qa-venv/bin/python -r tests/support/requirements.txt
build/qa-venv/bin/python tests/fixtures/generators/synthetic.py
node tests/integration/documents/xmp-sdk.mjs
node tests/integration/documents/xmp-documents.mjs
node tests/integration/documents/batch-save.mjs
node tests/e2e/documents/batch-save-e2e.mjs
node tests/integration/geometry/cropped-tone.mjs
node tests/e2e/geometry/cropped-tone-e2e.mjs
node tests/integration/geometry/fine-rotation.mjs
node tests/e2e/geometry/fine-rotation-e2e.mjs
node tests/integration/geometry/straighten.mjs
node tests/e2e/geometry/straighten-e2e.mjs
node tests/e2e/workflows/range-transaction-e2e.mjs
node tests/integration/geometry/range-geometry.mjs
node tests/e2e/color/color-pin-e2e.mjs
node tests/e2e/workflows/comparison-e2e.mjs
node tests/e2e/workflows/comparison-state-e2e.mjs
node tests/integration/color/wide-detail.mjs
node tests/e2e/color/wide-detail-e2e.mjs
node tests/integration/masks/segmentation-worker.mjs
node tests/integration/masks/object-selection.mjs
node tests/integration/masks/object-geometry.mjs
node tests/e2e/masks/object-geometry-e2e.mjs
node tests/integration/masks/person-parts.mjs
node tests/e2e/masks/person-parts-e2e.mjs
node tests/integration/masks/semantic-masks.mjs
node tests/e2e/masks/semantic-masks-e2e.mjs
node tests/integration/masks/sky-mask.mjs
node tests/e2e/masks/sky-mask-e2e.mjs
CAPTRAW_OBJECT_START_FIXTURE=/绝对路径/对象几何测试输出/4-edited.xmp node tests/e2e/masks/object-start-e2e.mjs
pnpm test:e2e
node tests/e2e/documents/xmp-e2e.mjs
node tests/e2e/workflows/revision-e2e.mjs
node tests/e2e/color/point-curve-e2e.mjs
node tests/e2e/workflows/workbench-e2e.mjs
node tests/e2e/workflows/restart-e2e.mjs
node tests/integration/color/white-balance.mjs
build/qa-venv/bin/python tests/support/inspect/inspect-white-balance.py
node tests/e2e/color/white-balance-e2e.mjs
node tests/integration/geometry/white-balance-optics.mjs
cmake --build build/native --target captraw-geometry-probe captraw-mask-geometry-probe -j 4
node tests/integration/geometry/geometry-mapping.mjs
for angle in -23 23; do
  for fill in false true; do
    build/native/captraw-mask-geometry-probe "$PWD/build/native/resources" "$PWD/artifacts/geometry-mapping/probe-cache" "$PWD/artifacts/geometry-mapping/geometry-target.png" "$angle" "$fill" > "artifacts/geometry-mapping/masks-$angle-$fill.json" || exit 1
  done
done
node tests/integration/masks/mask-geometry-pipeline.mjs
node tests/integration/geometry/coordinates.mjs
node tests/integration/masks/mask-reference.mjs
node tests/e2e/masks/mask-reference-e2e.mjs
node tests/e2e/masks/mask-interaction-e2e.mjs
node tests/e2e/workflows/viewport-lifecycle-e2e.mjs
node tests/e2e/workflows/match-exposure-e2e.mjs
node tests/e2e/workflows/grid-view-e2e.mjs
node tests/e2e/workflows/histogram-clipping-e2e.mjs
node tests/e2e/geometry/white-balance-optics-e2e.mjs
node tests/integration/platform/desktop-consistency.mjs artifacts/white-balance-gui/switched.xmp artifacts/white-balance-gui/independent.tiff
```

`mask-interaction-e2e` 使用 `mask-reference` 或 `coordinates` 的受控图，所有输出写入独立运行目录。可设 `CAPTRAW_MASK_INTERACTION_ROTATION=90` 和 `CAPTRAW_MASK_INTERACTION_CROP=1` 验证粗旋转与对称裁切。

`fine-rotation` 两项检查以 `~/Applications/CaptRAW-0.47.app` 为独立 ART 输出参考；默认 GUI 使用受控 DNG，可用 `CAPTRAW_FINE_SOURCE` 指定真实 RAW，`CAPTRAW_FINE_GUI_OUT` 指定独立证据目录。检查最小窗口、角度 / 蒙版 / 历史、旧 XMP 继承及 TIFF16 像素；角度重置只重置旋转，不清除裁切。

`straighten` 两项检查使用 `~/Applications/CaptRAW-0.48.app` 独立渲染参照；GUI 输出目录可用 `CAPTRAW_STRAIGHTEN_GUI_OUT` 设置。原生专项覆盖粗旋转、正负细旋转、镜头 / 透视和 AutoFill，GUI 检查真实拖线、取消及持久化。

原生和桌面测试需先执行 `pnpm build`；`xmp-e2e` 使用 `xmp-documents` 生成的 Adobe 样本。设定 `CAPTRAW_APP=/绝对路径/CaptRAW.app/Contents/MacOS/CaptRAW` 可测试安装包；`CAPTRAW_ENGINE`、`CAPTRAW_RESOURCES` 和 `CAPTRAW_XMP_BINARY` 指向同一候选包内对应程序与资源。默认入口测试本地构建，不代表已安装应用通过验收。

Nikon 相机构图还需 ExifTool 和 `tests/integration/platform/nikon-he.mjs` 固定样本。`tests/integration/geometry/camera-crop.mjs` 使用固定 ART CLI 作为同配方 TIFF 像素对照。历史 GUI 与文档专项已迁移至 XMP、当前处理版本和基线 4，移除旧 JSON 迁移验收；各专项仍需先生成对应夹具；预设 GUI 测试依赖 `tests/e2e/masks/object-selection-e2e.mjs` 生成的 `committed.xmp`，两者需使用相同 `CAPTRAW_OBJECT_E2E_OUT`。旧 JSON 夹具不能替代。语法迁移通过不表示这些专项已全部在新安装包重跑；旧版验收保留于 [验收记录](docs/ACCEPTANCE.md)。

白平衡独立数值与双光源 DNG 验证（Colour Science 仅作为 QA 参考，不进入产品）：

```sh
cmake --build build/native --target captraw-wb-probe -j 4
uv venv build/wb-reference-venv
uv pip install --python build/wb-reference-venv/bin/python colour-science==0.4.6 tifffile==2026.10.15
build/wb-reference-venv/bin/python tests/integration/color/white-balance-reference.py
node tests/integration/color/white-balance-reference.mjs
```

固定样本的授权、机型 / 压缩模式和 SHA-256 位于 [tests/fixtures/fixtures.json](tests/fixtures/fixtures.json)。追加 Nikon HE 验收使用 `tests/integration/platform/nikon-he.mjs`；只测试已有且哈希正确的样本可设置 `CAPTRAW_NIKON_CACHED_ONLY=1`。`tests/integration/platform/nikon-adobe-reference.mjs` 使用 Adobe DNG Converter 生成独立参考，转换器不参与产品运行或分发。测试图及参考不进入应用或源码归档。

测试证据输出至 `artifacts/`。历史性能记录不等于冷磁盘、其他设备或完整画质盲评。安装包完成后运行 `node scripts/source-release.mjs`，源码、依赖清单和二进制应一并保留。

既有实验性 HDR、可选缓存浮点帧及 WebGPU 主画布见 [HDR 接入验证](docs/HDR.md)；0.64 已登记的 HDR 回归与安装身份以 [验收记录](docs/ACCEPTANCE.md) 为准。本轮仅做受影响回归，物理显示、SDR 映射及完整 HDR 工具仍未验收。

## Monorepo 结构

- 根包：产品版本的唯一来源，协调原生 / XMP 构建、验收、打包和源码归档。
- `native/`：无窗口 C++ 核心、固定上游补丁、原生测试、CMake 和配置；生产源码与头文件分别位于 `src/`、`include/`。
- `apps/desktop/`（`@captraw/desktop`）：React 工作台、Electron main / preload 及 Vite 配置；渲染器内部按 `app/components/hooks/lib/styles` 分层。
- `packages/contracts/`（`@captraw/contracts`）：与 ART / GTK 类型隔离的契约、参数校验、导出选项、预设和同步契约。
- `packages/desktop-core/`（`@captraw/desktop-core`）：Node-only 服务，内部按 `engine/documents/editing/presets/profiles/export` 分域；公共 package 子路径保持不变。
- `scripts/`：源码固定、构建、打包、依赖和样本收集。
- `tests/`：按运行层级和功能域组织；详细规则见 [测试目录](tests/README.md)。

三个工作区均为私有包，内部依赖使用 `workspace:*`；跨包通过公开包入口引用。共享包输出 ESM JavaScript 与 TypeScript 声明，桌面 bundle 包含内部包代码。Turborepo 按 contracts → desktop-core → desktop 的依赖顺序编排任务；本地 `.turbo/` 只缓存 JavaScript 构建、类型检查和纯 Node 单元测试，原生构建、模型准备、打包与 E2E 每次实际执行。

根测试声明了共享包开发依赖；按 [Turbo 全局哈希规则](https://turborepo.dev/docs/reference/configuration#globaldependencies)，修改这些共享包会使全部 JavaScript 任务失效。仅修改桌面源码时保留共享包缓存。`pnpm test:e2e:performance` 单独检查本机 5 秒首帧预算；`CAPTRAW_RELEASE_DIR` 可将源码归档与校验清单输出到独立发布目录。

## CI

PR 和 `main` 推送执行 Ubuntu 快检，使用 Node 22.23.1、pnpm 11.25.0 冻结安装后运行 `pnpm ci:check`（`turbo run build typecheck test:unit`）；此流程不准备 Electron 二进制。只需 JavaScript 验证时，本机也可执行相同命令，无需 Homebrew 原生依赖。

`v*` 标签或手动触发 macOS smoke，使用 `macos-26` ARM64，安装上述 Homebrew 依赖，执行 `pnpm build`，下载并校验 D850 固定 RAW，再执行 `pnpm test:e2e`。E2E 入口准备 Electron 与 UI，并运行后台 `tests/e2e/workflows/smoke.mjs`，覆盖开图、曝光 / 蒙版编辑、保存 XMP、导出 TIFF 和恢复配方。功能等待期限为 60 秒，首帧耗时写入报告；本机性能门槛单独验收。

原生构建默认并行度为 8，可通过 `CAPTRAW_BUILD_JOBS` 设置；macOS CI 使用 2，限制托管 runner 的编译内存占用。

两个工作流只缓存 pnpm store 与 `.turbo/`，缓存键包含 OS、架构、Node / pnpm 版本、lockfile 哈希及 commit，并仅恢复相同 lockfile 前缀。macOS 无论成功或失败均尝试上传 `artifacts/monorepo/e2e/**` 下的报告、截图和日志；启动或构建失败时可能尚无截图。CI 不构建 DMG、不发布 Release，也不配置外部远程缓存。后台 smoke、安装包验收及可见窗口人工验收各自记录，工作流配置本身不代表远端已执行成功。

核心接口与持久化约定见 [docs/ENGINE.md](docs/ENGINE.md)。开源说明见 [THIRD_PARTY.md](THIRD_PARTY.md)，项目采用 GPL-3.0-or-later，保留 ART 与 RawTherapee 作者声明。

所有 `tests/e2e/**/*-e2e.mjs` 默认使用隐藏且不可聚焦的 Electron 窗口，通过 `CAPTRAW_E2E_BACKGROUND=1` 保持后台渲染，不弹窗或抢占焦点。共享启动器在运行前拒绝不支持该模式的旧安装包，并验证窗口实际隐藏。后台控件、截图和像素检查不代表用户已完成可见窗口人工验收；正常启动应用仍显示工作台。
