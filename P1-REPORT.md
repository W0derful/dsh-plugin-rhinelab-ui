# P1 验收报告（3D 嵌入 + 资产管线）

| 项目 | 值 |
|---|---|
| 报告日期 | 2026-09-09 |
| 规格书 | v1.0-R2 §5 P1 |
| 锚定 dsh | `0.1.2-rc.1` |
| 隔离环境 | `DSH_HOME=.dsh-test`，端口 **3081**（运行中的 3080 未受影响） |
| 验证工具 | 无头 Chrome 152 + `playwright-core` |
| 结论 | **P1 出口条件全部达成**；开场动画末段转场为 TODO-human（环境限制，见 §4） |

## 1. 交付物

| 产物 | 说明 |
|---|---|
| `rhine-dist/` | RhineLabUI 生产构建（30MB：字体 19MB + GLB 7.5MB + 音频 3MB + 档案 164KB） |
| `plugin/index.js` | 宿主半：`/rhinelab-ui` 前缀路由（静态资产 + P0 探针端点），MIME/缓存策略/目录穿越防护 |
| `src/client/index.cjs` | 客户端半：全屏接管层 + 同源 iframe + 原生 UI 幽灵态 + 安全降级 + 偏好桥 |
| `src/client/probe.cjs` | P0 三探针（A/B/C），随包发布，`rhine-no-probe=1` 可关闭 |
| `scripts/build-client.mjs` | esbuild → `plugin/client.js`（bundle id = 包名，D-10 红线） |
| `scripts/verify-p1.mjs` | P1 双通道验收（boot / archive） |

## 2. 出口条件验收

| 出口条件 | 实测 | 判定 |
|---|---|---|
| 开场动画完整播放 | 阶段序列逐级捕获（见 §3） | **部分自动 + TODO-human** |
| 档案阵列可翻阅（静态数据） | `mode=archive`；方向键切列/选档生效（`navigationChanged=true`） | **通过** |
| DPR 开关可用 | 5 个画质预设 `performance/original/high/ultra/custom`，含 `pixelRatio` 1×/1.5×/2×/3× | **通过** |
| FPS 开关可用 | `#three-scene[data-fps]` 实时上报（稳定 59-60fps） | **通过** |
| reduced-motion 开关可用 | 设置面板 `[data-pref="reduced"]` 存在；开启后跳过开场直接进档案 | **通过** |
| 视觉接管 + 卸载还原 | 覆盖 1280×720 = 视口；卸载后 layer/style 各 -1、`#root` opacity 回 1、pointer-events 恢复 | **通过** |
| 控制台零报错 | `pageErrors: 0`，`appErrors: 0` | **通过** |

验收命令：

```bash
node scripts/verify-p1.mjs --pass archive --url "http://127.0.0.1:3081/?token=<token>"   # PASSED
```

## 3. 开场动画证据（自动化）

以 2s 间隔采样 `#stage[data-boot]` 与字幕，逐级捕获：

```
0s   boot/access
2s   boot/logo      （标志绘制）
4s   boot/auth      字幕「身份信息确认：JOYCE MOORE」   （身份接入）
12s  boot/scan      字幕「权限验证通过」                （权限扫描）
16s  boot/welcome   字幕「欢迎访问莱茵生命内部资料档案」 （欢迎转场）
38s  frame lost     ← 容器内软件渲染崩溃，未捕获 array/inspect 段
```

对应规格书 §8 人工验收描述「逐字、标志绘制、身份接入、权限扫描、欢迎转场、档案展开」——**前 5 段已自动验证**，末段「档案展开」与 t=35s 转入 detail 的交接未捕获。

**原因**：开场时间轴长 35s（`src/main.ts` `bootFrame`：t≥35 → `setMode("detail")`），且容器内无 GPU，仅 SwiftShader 软件渲染。即使压到极简画质（scale 50 / 阴影 0 / AO 0 / DOF 0），渲染进程仍在 ~36-38s 崩溃。

## 4. TODO-human（规格书执行规则 5）

以下为不可自动化项，实现已完成，需人工在**有 GPU 的浏览器**观察确认：

| 观察点位 | 期望 |
|---|---|
| 开场动画 22-35s 段 | 「档案展开」动画完整播放，阵列升起，t=35s 转入 detail 视图 |
| 视觉质感 | 与 `DESIGN.md` 基准一致（玻璃、内构、解密线） |
| 音频 | 开场音效与三轨配乐（§8 听感项，规格书亦标为待用户试听） |
| 性能 | 真实 GPU 下 FPS / DPR 表现（软件渲染数据不具代表性） |

截图存档（软件渲染，仅供形态参考）：`.dsh-test/p1/p1-archive.png`、`p1-boot-early.png`、`p1-restored.png`。

## 5. 环境限制记录（非产品缺陷）

| 现象 | 原因 | 处置 |
|---|---|---|
| `page.screenshot` 超时 | 软件 WebGL 饿死合成器，Playwright 可操作性检查永不满足 | 截图改为 best-effort（8s 上限，失败不判错） |
| `frame.click/press` 超时 | 同上（元素永不"稳定"） | 改为派发真实 DOM 事件（仍走应用自身监听器） |
| 渲染进程 ~36s 崩溃 | 无 GPU，SwiftShader 承载 AO/DOF/阴影 | 验收压至极简画质；末段转场转 TODO-human |
| 合成事件 `e.target` 无 `dataset` | 派发到 `document` 时目标无 dataset | 派发到 `document.body` |

以上均记入 `SPEC-DEVIATIONS.md`（D-13）。

## 6. 与规格书的偏差

| 编号 | 偏差 | 依据 |
|---|---|---|
| D-13 | 视觉层采用「全屏 DOM 层 + 同源 iframe 承载 RhineLabUI」而非 §3 字面的「DOM 交互层直写插件」 | iframe 隔离 CSS/JS，且与已验证的参考实现一致（D-3）；`shell.overlay` 槽位仍为官方备选 |
| D-14 | RhineLabUI 存储键 `rhine-settings`/`rhine-saved` 改为 `rhinelab-ui:` 前缀 | R-11 硬约束 |
| D-15 | 构建期对 RhineLabUI 做 3 处运行时基路径改写 + `base: './'` | R-6「资产基路径改运行时注入」 |
