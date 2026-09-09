# dsh-plugin-rhinelab-ui

把 [RhineLabUI](https://github.com/LBEILC/RhineLabUI) 的三维档案室封装成 **dsh（DeepSeek Harness）客户端 UI 插件**：
启用后 3D 档案室接管界面并显示**真实 dsh 会话**，卸载后原生界面完整恢复。

> **版本锚定：仅测试通过 dsh `0.1.2-rc.1`**（npm dist-tag `latest`）。
> dsh 处于预览期，API 漂移频繁；升级前请先跑 `npm run verify` 回归。
> 已核对 `0.1.2-rc.1` 与 `0.1.5-alpha.1` 在本插件全部依赖面（`session/*` RPC、`ctx.remote`、
> `/api/remote.mux`、`shell.overlay`）零差异，但锚定声明以实测版本为准。

## 效果

| 能力 | 说明 |
|---|---|
| 3D 接管 | 全屏 3D 档案室 + 开场动画；原生 UI 被压制成幽灵态，**仅靠运行时注入的 `<style>`**，卸载即还原 |
| 真实会话 | 40 个档案槽位 = 5 列 × 8 槽（收藏 / 最近 24h / 本周 / 本月 / 更早），数据来自 dsh 官方会话通道 |
| 实时对话 | 打开档案 → **04 对话** 页签：完整历史 + 逐字流式回复 + 工具调用参数条，输入框可直接发消息 |
| 检索 / 收藏 / 导出 | 应用内检索与收藏（`rhinelab-ui:saved`），导出为纯文本转录 |
| 模型查看器 | 详情页 360° 查看，拆解 / 重组 |
| 画质与性能 | 5 档画质预设（含 DPR 上限）、FPS 上报、`prefers-reduced-motion` 支持 |
| 低配自动降级 | 帧率看门狗：中位 < 24 FPS 自动切 **2D 卡片模式**（DOM 网格，停掉全部 WebGL 调用），可在设置里切回 3D |

## 安装

```bash
# 从 GitHub 安装（构建产物已随仓库提交，无需构建步骤，因此不需要 allowBuilds）
dsh plugin --profile web add github:<owner>/dsh-plugin-rhinelab-ui#v0.1.0

# 或从 release tarball 安装
dsh plugin --profile web add https://github.com/<owner>/dsh-plugin-rhinelab-ui/releases/download/v0.1.0/dsh-plugin-rhinelab-ui-0.1.0.tgz

# 或本地目录（开发期，改代码即生效）
dsh plugin --profile web add link:/path/to/dsh_pl

# 然后重启 dsh web 并刷新浏览器
```

卸载（原生界面完整恢复，无残留）：

```bash
dsh plugin --profile web remove dsh-plugin-rhinelab-ui
```

## 架构

```
浏览器（dsh Web GUI，同源）
├── 原生 dsh shell            ← 启用时被插件注入的 <style> 压制成幽灵态
└── 插件接管层 #rhinelab-ui-root
    └── 同源 iframe → /rhinelab-ui/index.html   （RhineLabUI 生产构建）
        ├── 3D 档案室（Three.js）
        └── 档案详情面板（含 04 对话页签）
```

| 半边 | 文件 | 职责 |
|---|---|---|
| 宿主 | `plugin/index.js` | `/rhinelab-ui` 前缀静态路由、会话日志解析（多帧 zstd）、`/sessions` 元数据、`/session/<id>` 转录、`/export/<id>` 导出 |
| 客户端 | `plugin/client.js`（由 `src/client/*.cjs` 构建） | 接管层、原生 UI 幽灵态、安全降级、数据桥（40 槽映射）、`session.prompt` 发送与 `session.follow` 流式 |
| 应用 | `rhine-dist/`（RhineLabUI 构建） | 3D 场景、档案阵列、对话页签、模型查看器 |

**数据通道**（P0 决策门结论）：主用官方通道 `ctx.sessions` / `ctx.remote`；宿主日志路由作为独立兜底
（不依赖 WebSocket 协议，逐帧解码 `session.jsonl.zstd`）。

## 本地数据与隐私

- 无 CDN 请求、无数据上报；全部资产本地化，随插件包一起分发。
- `localStorage` 键统一 `rhinelab-ui:` 前缀（`prefs` / `settings` / `saved`）。
- 卸载后 UI 状态零残留；收藏与设置属合法持久痕迹，不清理。

## 开发

```bash
npm run build      # esbuild 打包 src/client → plugin/client.js（bundle id 必须等于包名）
npm run verify     # 在隔离实例上跑 P0~P4 全部断言（需要 DSH_HOME 与端口）
```

验收脚本（`scripts/`）：

| 脚本 | 覆盖 |
|---|---|
| `probe-browser.mjs` | P0 三探针（`?rhine-probe=1` 探针专用模式） |
| `verify-p1.mjs` | 视觉接管 / 资产 / 画质开关 |
| `verify-p2.mjs` | 40 槽位真实会话 / 点卡加载历史 |
| `verify-p3.mjs` | 3D 输入 → 官方 prompt → 流式回复 → 工具条 |
| `verify-p4.mjs` | 检索 / 收藏 / 导出 / 模型查看器 |
| `diag-boot.mjs` | 启动清单与插件装载诊断 |
| `verify-2d.mjs` | 低配自动降级 / 2D 卡片模式 |

## 已知限制

- **仅锚定 `0.1.2-rc.1`**；升级 dsh 前先跑回归。
- 字体按「应用文案 + 已见会话文本」子集化（1438 字），**未覆盖的生僻字会回退系统字体**。
- 工具调用动画为统一拆解循环 + 参数文本条（无语义映射）。
- 开场动画 22–35 秒段需在有 GPU 的浏览器人工确认（软件渲染下渲染进程会崩）。
- 检索为应用内 40 槽位过滤，未接 `session/search` 全库检索。

## 许可与致谢

- 本插件：MIT。
- 3D 场景与档案内容：[RhineLabUI](https://github.com/LBEILC/RhineLabUI)（MIT）。
- 字体：MiSans（小米），许可见 `rhine-dist/fonts/MiSans-license.pdf`。
- 接管层模式参考：[open-sea-skin](https://github.com/d-dev0101/open-sea-skin)（MIT）。

实现细节与验收记录（规格书、逐条偏差、P0–P4 报告）保存在开发工作区的 `.notes/` 目录，不随仓库分发。
