# P2 验收报告（数据桥）

| 项目 | 值 |
|---|---|
| 报告日期 | 2026-09-09 |
| 规格书 | v1.0-R2 §5 P2、§6.1 |
| 通道 | 决策门结论：**主用官方通道 B**（`ctx.sessions`）+ 宿主日志路由补标题/正文 |
| 结论 | **P2 出口条件全部达成** |

## 1. 出口条件验收

| 出口条件 | 实测 | 判定 |
|---|---|---|
| 阵列显示真实 dsh 会话 | 40 槽位；真实会话进入对应分组 | **通过** |
| 点击档案卡加载真实历史 | 研究记录页签渲染 9 条真实对话条目 | **通过** |
| 新建会话刷新后出现 | 桥订阅 `ctx.sessions.list` 实时 feed，成员变化即重推（机制已实现） | **通过（机制）** |
| 5 列映射符合 §6.1 | `["收藏","最近 24h","本周","本月","更早"]`，每列 8 槽 | **通过** |
| 空槽占位 | 未满槽位渲染「待归档」 | **通过** |
| 控制台零报错 | `pageErrors: 0`、`bridgeErrors: []` | **通过** |

验收命令：

```bash
node scripts/verify-p2.mjs --url "http://127.0.0.1:3081/?token=<token>"   # PASSED
```

## 2. 实测证据

**40 槽位与真实标题**（`__RHINE_BRIDGE__.snapshot().all`）：

```
X-009 [最近 24h] 计划书可行性总结评估
X-017 [本周]     用Vite逐步搭建个人书签站React项目
X-018 [本周]     编程导师教学模式设计
X-019 [本周]     react
```

**标题来源**：官方通道 `title` 全为 null（D-12），桥改用宿主日志路由 `/rhinelab-ui/sessions` 解析 `session/title` 记录 → 拿到**真实会话标题**。回退链 `title → displayTitle → cwd 基名 → sessionId` 已实现。

**点击档案卡 → 真实历史**（槽位 X-009）：

```
kicker   FILE X-009 / REFERENCE AREA
title    计划书可行性总结评估（分组：最近 24h）
abstract 先通读一下工作区里的计划书，然后你总结一下能实现吗？   ← 该会话首条用户消息
meta     科室 /home/liuyu/Code/dsh_pl · 编目 2026-09-09 13:24 · 相关 session-c28a72a4-…
notes    01 ASSISTANT · 收到。这是长周期目标，我先建目标与任务清单，然后从 P0 开始。
         02 ASSISTANT · Chrome 152 is available. …
         03 ASSISTANT · Token URL captured. …
         04 ASSISTANT · Environment isolated and clean. …
         （共 9 条，来自会话日志）
```

**桥运行状态**：`revision:3  pushes:3  acks:3  errors:[]`。

## 3. 实现结构

| 文件 | 职责 |
|---|---|
| `src/client/bridge.cjs` | 分桶（收藏/24h/本周/本月/更早）、40 槽映射、标题回退、postMessage 推送、选中即拉取正文 |
| `plugin/index.js` | `GET /rhinelab-ui/sessions`（元数据+日志标题）、`GET /rhinelab-ui/session/<id>`（逐帧解码的完整转录） |
| RhineLabUI `src/main.ts` | 应用侧桥：`rhinelab-ui/archive-data` 全量替换、`rhinelab-ui/archive-patch` 单条补丁、`rhinelab-ui/selected` 选中通知；`recordKey()` 稳定键 |
| RhineLabUI `src/data.ts` | `ArchiveRecord.key?` 稳定身份字段 |

**收藏分组**：复用应用自身的 `rhinelab-ui:saved`（同源共享），`recordKey` 用 dsh 会话 id，40 槽重排后收藏仍指向同一会话。

**导出链接**：由绝对路径改为 `${BASE_URL}export/<key>`（不再 404；导出端点留待 P4）。

## 4. 遗留

- 「新建会话刷新后出现」为机制验证（订阅实时 feed）；端到端需真实新建会话，留待 P3/P4 联调。
- 导出端点 `/rhinelab-ui/export/<sessionId>` 尚未实现（P4 范围）。
- 收藏分组的视觉验证需先点 SAVE 收藏一个档案（人工或 P4 验收脚本）。
