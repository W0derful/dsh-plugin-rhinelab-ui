# P0 探针实验报告（决策门输入）

| 项目 | 值 |
|---|---|
| 报告日期 | 2026-09-09 |
| 规格书 | v1.0-R2（`deepseek harness pl`）§4 |
| 锚定 dsh | `0.1.2-rc.1`（npm `latest`） |
| 隔离环境 | `DSH_HOME=/home/liuyu/Code/dsh_pl/.dsh-test`，端口 **3081**（运行中的 3080 全程未受影响） |
| 对照环境 | `DSH_HOME=/home/liuyu/Code/dsh_pl/.dsh-ctl`，端口 3082（无插件，用作对照） |
| 浏览器 | 无头 Chrome 152（`playwright-core` + `/usr/bin/google-chrome`） |
| 结论 | **三探针全部通过；建议主用官方通道 B，兜底 D 保留** |

## 0. 裁决摘要

| 探针 | 验收条件 | 实测 | 判定 |
|---|---|---|---|
| A 视觉接管 | 页面全屏被覆盖；移除后原生完整恢复 | 覆盖 1440×900 = 视口；卸载后自身层/样式移除且 `#root` 子树不变 | **通过** |
| B 官方通道 | 注册最小组件后拿到真实会话数组 | 注册进 `shell.overlay` 并渲染；取到 **5 个真实会话** | **通过** |
| C 兜底通道 | 同源取到会话数据 | 宿主路由 200，解析 **5 份日志 / 最多 3707 条记录** | **通过** |
| 页面错误 | 控制台零报错 | `pageErrors: 0`，11 条 `[RHINE-*]` 探针日志 | **通过** |
| add/remove 循环 | 装/卸后无残留、无重复条目 | 装 47 条 → 卸 46 条（= 对照）→ 重装 47 条，全程零报错 | **通过** |

---

## 1. 探针 A：视觉接管

**实现**：客户端半在 `document.body` 追加 `#rhinelab-ui-root`（`position:fixed; inset:0; z-index:2147483000`）并向 `document.head` 注入 `#rhinelab-ui-style`；两者由同一个 disposer 回收。

**覆盖证据**（`window.__RHINE_PROBE__.probeA.coverage`）：

```json
{ "width": 1440, "height": 900, "viewportWidth": 1440, "viewportHeight": 900, "coversViewport": true }
```

**移除证据**（`report.removal`）：

```json
{
  "before": { "bodyChildren": 5, "styleTags": 92, "rootChildren": 1 },
  "after":  { "bodyChildren": 4, "styleTags": 91, "rootChildren": 1,
              "layerPresent": false, "stylePresent": false, "slotEntryPresent": false },
  "restored": true
}
```

- 恰好减少 1 个 body 子节点（本插件层）与 1 个 `<style>`（本插件样式）；`#root` 子树数量不变。
- 截图存档：`.dsh-test/probe/probe-a-mounted.png`、`.dsh-test/probe/probe-a-removed.png`（**人工确认项**：本代理所用模型不支持读图，DOM 断言已通过，视觉确认留待人工）。

## 2. 探针 B：官方通道

**实现**：`ctx.slots.register({ name:'shell.overlay', id:'rhinelab-ui-probe-b', order:10, inject:()=>({}) }, Component)`，组件内读 `ctx.sessions.list.getSnapshot()`。

**注册与渲染**：

```json
{ "registered": true, "slot": "shell.overlay", "entryId": "rhinelab-ui-probe-b", "rendered": true }
```

DOM 实测：`document.getElementById('rhinelab-ui-probe-b').textContent === "PROBE B · sessions=5 · current=none"`。

**数据证据**：

```json
{
  "sessionTotal": 5,
  "current": null,
  "snapshotKeys": ["ids","byId","current","phase","subagentsByParent","jobsBySession","currentAddress"],
  "injectedPropsKeys": ["useSessions","useSessionPendingInteraction","useWorkspaces"],
  "sample": [
    { "id": "session-c28a72a4-…", "title": null, "displayTitle": "dsh_pl",              "blank": false },
    { "id": "session-4714cd81-…", "title": null, "displayTitle": "react",               "blank": false },
    { "id": "session-204d0c20-…", "title": null, "displayTitle": "react",               "blank": false },
    { "id": "session-b4dd33e7-…", "title": null, "displayTitle": "react",               "blank": true  },
    { "id": "session-a08b36a2-…", "title": null, "displayTitle": "deepseek_workspace",  "blank": true  }
  ]
}
```

**要点**：
1. 规格书原文 `console.log(useSessions())` **成立**——`shell.overlay` 条目的注入 props 确实含 `useSessions`（另有 `useWorkspaces`、`useSessionPendingInteraction`）。
2. **全部真实会话 `title` 为 `null`**，只有 `displayTitle`（cwd 基名）可用 → 40 槽位必须实现标题回退链（见 D-12）。
3. `ctx.slots.register` 的返回值是 disposer，且注册会被 caller 的 fiber 生命周期接管（卸载自动回收）。

## 3. 探针 C：兜底通道 D（宿主半直读会话日志）

**实现**：宿主半 `ctx.webServer.register({kind:'prefix', path:'/rhinelab-ui', handler})`，路由 `/rhinelab-ui/probe/sessions` 扫描 `$DSH_HOME/sessions/**/session.jsonl.zstd`；客户端同源 `fetch`。

**证据**（`probeC`）：

```json
{ "status": 200, "ok": true, "count": 5, "hostStatus": 200,
  "sessionsRoot": "/home/liuyu/Code/dsh_pl/.dsh-test/sessions" }
```

**解析质量**（每份日志）：

| sessionId | 帧数 | 记录数 | 记录类型数 |
|---|---|---|---|
| `session-4714cd81-…` | 3264 | 3707 | 29 |
| `session-c28a72a4-…` | 2235 | 3495 | 24 |
| `session-204d0c20-…` | 1357 | 1892 | 24 |

记录类型含 `user/message`、`assistant/message`、`assistant/chunk`、`reasoning-chunks`、`tool/call`、`tool/result`、`turn/start`、`step/end` 等——**足以驱动 40 槽位、阅读面板与工具拆解动画**。

**关键实现约束**（D-11）：日志是多帧 zstd 容器，`zstdDecompressSync(整文件)` 只能解出 204 字节的会话头，必须逐帧解码。

## 4. 插件装载/卸载契约（本项目底线）

| 状态 | boot 条目 | 页面错误 | `dsh.profile.bundles` | profile `cordis.patch.yml` |
|---|---|---|---|---|
| 无插件（对照） | 46 | 0 | `[dsh-base, dsh-web-app]` | `[]` |
| 装入插件 | 47 | 0 | `[…, dsh-plugin-rhinelab-ui]` | `[]` |
| 卸载插件 | 46 | 0 | `[dsh-base, dsh-web-app]` | `[]` |
| 重装插件 | 47 | 0 | `[…, dsh-plugin-rhinelab-ui]` | `[]` |

- `reconcilePlugins` 自动维护 bundles，**profile 自身 patch 始终为 `[]`** → R-7.1 双重注册风险已用实践规避。
- 安装命令：`dsh plugin --profile web add link:<插件目录>`（开发期用 `link:` 免重装迭代）。
- 沙箱注意：pnpm 默认 store 在工作区外会报 `ERR_SQLITE_ERROR`，需 `XDG_DATA_HOME` / `npm_config_store_dir` 指向工作区内（仅本地开发约束，与规格书无关）。

## 5. 决策门裁决（2026-09-09，已确认）

**裁决：主用官方通道 B（`ctx.remote` / `ctx.sessions`），兜底 D 保留为独立降级路径。**

理由：
1. B 通过，且是**类型化、官方、抗漂移**的通道，符合规格书决策门的第一优先级。
2. C 已重定义为兜底 D 并实测通过——它与 B 传输层解耦（读磁盘日志，不依赖 WebSocket 协议），是**真正独立**的降级路径。
3. 已实测两者数据互补：B 给实时列表与状态（`updatedAt`/`blank`/`running`），D 给完整历史与工具调用细节（B 的 `session/page` 也能取，但 D 不受 RPC 限流与协议漂移影响）。

**决策门证据复采**（P1 构建下的探针专用模式 `?rhine-probe=1`，不加载 3D 场景，读 `window.__RHINE_PROBE__`）：

```
A coverage   {"width":1440,"height":900,"viewportWidth":1440,"viewportHeight":900,"coversViewport":true} zIndex=2147483000
A restore    layer 与 style 各自 -1（body -1 / style -1），layerGone=true styleGone=true
B register   registered=true  slot=shell.overlay  渲染文本="PROBE B · sessions=5 · current=none"
B sessions   sessionTotal=5   注入 props=["useSessions","useSessionPendingInteraction","useWorkspaces"]
B 数据缺口   5 个会话 title 全为 null（仅 displayTitle 可用）
C fetch      status=200  count=5  hostStatus=200
C 解析质量   3264 帧/3707 记录/29 类型；2235 帧/3495 记录/24 类型；1357 帧/1892 记录/24 类型
errors       probe errors=[]   pageErrors=[]
```

证据文件：`.dsh-test/probe/p0-decision-gate.json`（本次复采）、`.dsh-test/probe/probe-report.json`（首采，含截图）。

**P1 开工前必须落实**（来自 P0 实测）：
- R-5 构建红线：bundle id **必须**等于包名（D-10）。
- P2 数据契约：标题回退链 `title → displayTitle → cwd 基名 → sessionId`（D-12）。
- 兜底 D 若启用：多帧 zstd 解码（D-11）。

## 6. 可复现命令

```bash
# 1. 隔离实例（不影响 3080）
DSH_HOME=$PWD/.dsh-test dsh web --no-open --port 3081 > .dsh-test/boot.log 2>&1 &
TOKEN=$(grep -o 'token=[A-Za-z0-9_-]*' .dsh-test/boot.log | cut -d= -f2)

# 2. 三探针断言（无头 Chrome）
node scripts/probe-browser.mjs --url "http://127.0.0.1:3081/?token=$TOKEN"
#    → P0 browser probe PASSED，报告落在 .dsh-test/probe/probe-report.json

# 3. boot 清单 / 对照
node scripts/diag-boot.mjs --url "http://127.0.0.1:3081/?token=$TOKEN" --label with-plugin

# 4. 装/卸循环
dsh plugin --profile web add    "link:$PWD"
dsh plugin --profile web remove dsh-plugin-rhinelab-ui
```
