# P4 验收报告（打磨发布）

| 项目 | 值 |
|---|---|
| 报告日期 | 2026-09-09 |
| 规格书 | v1.0-R2 §5 P4、§8 双列验收 |
| 锚定 dsh | `0.1.2-rc.1` |
| 结论 | **P4 出口条件达成**（代理自验全绿；人工验收清单见 §4） |

## 1. 接线验收（`scripts/verify-p4.mjs`）

| 出口条件 | 实测 | 判定 |
|---|---|---|
| 检索 | 应用内检索弹窗打开；输入档案编号前缀 → **40 条命中** | **通过** |
| 收藏 | 详情页 SAVE → `rhinelab-ui:saved` 写入会话 id → 桥重推 → **该会话进入「收藏」列** | **通过** |
| 导出 | `GET /rhinelab-ui/export/<sessionId>` → **200 / 1141 B**，含 `[USER]` / `[ASSISTANT]` 段落与工具调用 | **通过** |
| 模型查看器 | 详情页 360° 按钮 → 查看器打开，无页面报错 | **通过** |
| 控制台 | `pageErrors: 0` | **通过** |

## 2. 资产瘦身（规格书 P1 任务，本轮补齐）

| 资产 | 优化前 | 优化后 | 手段 |
|---|---|---|---|
| MiSans 四字重 | 19.4 MB | **0.79 MB** | `pyftsubset` 按「应用文案 + 已见会话文本」取 1438 字（含 1240 CJK）子集化 |
| `archive-cassette.glb` | 3.40 MB | **2.70 MB** | dedup + weld + prune（**禁用 quantize**，见 D-24） |
| `archive-assembly.glb` | 3.19 MB | **2.59 MB** | 同上 |
| **`rhine-dist/` 合计** | 30 MB | **11 MB** | −63% |

- **量化方案已回退**（D-24）：RhineLabUI 会把世界矩阵烘进几何体，归一化 int16 属性在 `applyMatrix4` 回写时被截断，导致位置错乱与法线损坏（表现为「玻璃材质消失」）。现仅做 dedup/weld/prune，属性保持 float32。
- 字体子集化的取舍：未覆盖的生僻字回退系统字体（已写入 README「已知限制」）。

## 2.5 §8 代理自验：全量通过（`scripts/verify-all.mjs`）

```
[verify-all] P0 三探针 …
[verify-all] P1 接管与资产 …
[verify-all] P2 数据桥 …
[verify-all] P3 输入与流式 …
[verify-all] P4 检索/收藏/导出/查看器 …
{ "passed": "5/5" }
ALL ACCEPTANCE PROBES PASSED
```

| 探针 | 耗时 | 结果 |
|---|---|---|
| P0 三探针（视觉接管 / 官方通道 / 兜底通道） | 5s | PASS |
| P1 接管与资产（覆盖 + 幽灵态 + 画质开关 + 卸载还原） | 51s | PASS |
| P2 数据桥（40 槽位真实会话 + 真实历史） | 77s | PASS |
| P3 输入与流式（官方 prompt + 流式 + 工具条） | 74s | PASS |
| P4 检索/收藏/导出/模型查看器 | 84s | PASS |

汇总：`.dsh-test/verify-all/summary.json`。

## 3. 打包发布

| 项目 | 值 |
|---|---|
| `npm pack` 包体 | **6.0 MB**（解包 9.0 MB，67 文件） |
| 包内容 | `plugin/index.js`、`plugin/client.js`、`cordis.patch.yml`、`rhine-dist/**`、README、LICENSE |
| 元数据 | 去 `private`、补 `repository`/`bugs`/`homepage`/`keywords`；构建工具移入 `devDependencies` |
| README | 含**锚定版本声明**、安装/卸载、架构、隐私、开发与验收脚本、已知限制、许可与致谢 |

> 实际 `npm publish` 未执行（需仓库地址与账号授权）。包已通过 `npm pack --dry-run` 校验。

## 4. §8 人工验收清单（TODO-human）

| # | 观察点位 | 期望 |
|---|---|---|
| 1 | 安装 → 重启 → 刷新 | 开场动画完整播放（逐字、标志绘制、身份接入、权限扫描、欢迎转场、**档案展开**） |
| 2 | 档案阵列 | 40 槽位显示真实会话；上下翻阅、左右切列循环 |
| 3 | 点击档案卡 | 3D 升起 → 镜头衔接 → 阅读面板显示历史 |
| 4 | 04 对话页签 | 输入 → 流式打字回复 → 工具调用参数条 |
| 5 | 检索 / 收藏 / 导出 | 三者可用，收藏后进入「收藏」列 |
| 6 | 模型查看器 | 360° 环绕、六组拆解重组可用 |
| 7 | 卸载 → 重启 → 刷新 | 原生界面与全部功能完整恢复，无残留 |
| 8 | 音频 | 开场音效与三轨配乐听感（规格书亦标为待用户试听） |

第 7 条是契约底线：**进得去，出得来，来去无痕**。

## 4.5 低配自动降级（集显用户，post-P4 增补）

**问题**：集显机器跑不动 transmission/AO/阴影 这些填充率密集的通道。Rust/WASM 不解决 GPU 瓶颈（只会增加维护成本），真正需要的是自动降级。

**实现**（RhineLabUI 侧，DOM 层）：
1. 帧率看门狗：暖机 2s 后开 4s 窗口；**中位 < 24 FPS** 或**最差 < 10 FPS（panic）** 触发。
2. **两级渐进**：先把画质降到 `performance`（多数临界机器在此恢复）；仍低于阈值才进入第二级。
3. **2D 卡片模式**：`#stage[data-flat]` 显示 DOM 网格（5 列 × 8 槽 = 40 张卡，真实会话标题/科室/日期），同时**隐藏 canvas 且渲染循环跳过全部场景调用**——这才是真正释放集显的部分。导航、详情、对话、检索、收藏、导出全部照常。
4. **可逆**：设置面板 `RENDER MODE`（自动 / 3D / 2D）；无存储偏好且 `hardwareConcurrency <= 4` 时默认从 `performance` 起步。

**实测**（`scripts/verify-2d.mjs`，已并入全量验收）：

```
手动切 2D : gridCards=40  columns=[收藏,最近 24h,本周,本月,更早]  canvasHidden=true
            realTitles=[你好, 列出当前目录文件, …]  navigationChanged=true
            detailWorks=true（详情+对话页签可用）  backTo3d=true  pageErrors=0
CPU 降频 6× : 2.5s 画质自动降到 performance（仍在 3D）→ 5s 仍不足 → 2D，40 卡
CPU 降频 12×: 3s 内 panic 直接降到 2D
```

**踩坑 1**：切到 2D 后文字被黑块盖住——三处遮罩（详情页红字、`#inspection-marks`、`#inspection-text`）都由渲染循环驱动，2D 跳过循环后冻在最后状态。修复：进入 2D 时 `clearSceneOverlays()` 强制清零，并用 `elementFromPoint()` 做遮挡回归断言（D-26）。

**踩坑 2**：`applyRenderMode` 曾用 `flatMode` 反推 `want2d`，而看门狗调用它时 `flatMode` 尚为 false → 降级恒为空操作；改为先闩锁再计算（D-25）。

## 5. 已知限制（如实登记）

- 仅锚定 `0.1.2-rc.1`；升级 dsh 前需回归。
- 字体子集未覆盖生僻字 → 回退系统字体。
- 检索为应用内 40 槽位过滤，未接 `session/search` 全库检索。
- 开场动画 22–35 秒段需有 GPU 的浏览器人工确认（容器内软件渲染会崩）。
- 2D 模式为**卡片网格**（非 3D 场景的等比替代）；降级判定基于实测帧率，不做 GPU 型号白/黑名单。
- 工具调用动画为统一拆解循环 + 参数文本条（无语义映射，规格书 §6.2 方案）。
