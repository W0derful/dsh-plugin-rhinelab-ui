# SPEC-DEVIATIONS — 规格书实证偏差记录

| 项目 | 值 |
|---|---|
| 记录日期 | 2026-09-09 |
| 被核对规格书 | v1.0-R1（工作区文件 `deepseek harness pl`） |
| 记录依据 | 规格书《执行规则》第 4 条：规格书与实际源码/行为冲突时以源码为准，逐条记录偏差（含出处） |
| 核对方式 | 读源码 + 跑命令；**未使用训练记忆**（执行规则第 2 条） |
| 规格书修订结果 | 已就地修订为 **v1.0-R2**（修订点见本文件 §0 处置列） |

## 核对环境（一手事实）

| 事实 | 值 | 出处 |
|---|---|---|
| 已安装 dsh | `@deepseek-ai/dsh@0.1.2-rc.1` | `/home/liuyu/.npm-global/lib/node_modules/@deepseek-ai/dsh/package.json` |
| 正在服务 GUI 的端口 | `http://127.0.0.1:3080` | 环境变量 `DSH_WEB_URL` |
| DSH_HOME | `/home/liuyu/.dsh` | 环境变量 `DSH_HOME` |
| 会话日志落盘路径 | `/home/liuyu/.dsh/sessions/--home-liuyu-Code-dsh_pl--/session-*/session.jsonl.zstd` | 环境变量 `DSH_SESSION_JSONL` |
| 对照版本 | `0.1.5-alpha.1`（npm 下载 tarball 后解包核对） | `.scratch/pkgs/deepseek-ai-dsh-0.1.5-alpha.1/` |
| 工具链 | node v22.23.2 / pnpm 11.24.0 / npm 10.9.8 / git 2.43.0 | `node -v`、`pnpm -v`、`git --version` |
| 参考仓库可达性 | 两个仓库均可 clone | `git ls-remote` 返回 HEAD：`open-sea-skin` = `5dd47e7c`、`RhineLabUI` = `c24afa58` |

---

## 0. 结论速览

| 编号 | 规格书原文（要点） | 实证结果 | 性质 | 处置 |
|---|---|---|---|---|
| **D-1** | 锚定 `v0.1.5-alpha.1`（"当前最新"） | 它是 npm `alpha` tag 最新，**不是** `latest`（`latest`=0.1.2-rc.1）；本机装的是 0.1.2-rc.1 | 事实错误 | 按用户裁决改锚 **0.1.2-rc.1**，保留升级流程 |
| **D-2** | 通道 C＝"同源直连"独立兜底，可 fetch 会话列表端点 | 后端**无 REST 端点**，只有 `/api` RPC + `/api/remote.mux`（同一 Typert 协议）；C 与 B 同链路 | 架构错误 | 决策门改为"B 主用 + 独立兜底 D（宿主半直读会话日志）" |
| **D-3** | 视觉层"100% 照抄 open-sea-skin 纯 DOM 路径" | 可照抄的是**管线**；open-sea-skin 是背景+玻璃皮肤，非全屏替换 | 表述过宽 | 明确边界：照抄管线，不照抄视觉架构 |
| **D-4** | （未提及）`dsh plugin add github:...` 首次必失败 | pnpm 拦截 git 插件的 `prepare` 构建 | 新增风险 | P0 前先写 `allowBuilds` |
| **D-5** | R-7.1"双重注册已知问题"（未给机制） | 机制已定位：`reconcilePlugins` 自动写 `dsh.profile.bundles`，与手写 `insert` 叠加即双挂载 | 补齐依据 | 规避方法确认有效，补机制说明 |
| **D-6** | P0 读 `dsh 仓库 packages/client/AGENTS.md` | npm 安装包**只含 `lib/`**，无 `packages/` | 前置缺失 | P0 必须先 clone dsh 源码仓库 |
| **D-7** | 40 槽位/检索/收藏/导出按计划书数字直接实现 | `title` 可选、**无收藏字段**、**无导出 API**、搜索上限 20 条/240 码点 | 契约缺口 | P2 前补齐映射与本地化方案 |
| **D-8** | （未提及）`dsh-client-ui-slots` 类型包 | npm 仅发布 `0.0.1-rc.1`，且**未落盘**；运行时由 shell 以 seed 注入 | 开发环境缺口 | 类型开发需特殊处理 |
| **D-9** | 会话格式 V3、Inbox API 细节 | **未逐包核对**（属宿主侧，本插件不经此路径） | 未核对声明 | 若采用兜底 D 则升级为 P2 前置 |
| **D-10** | （未提及）bundle id 与包名 | P0 实测：二者不一致会导致整批 bundle 二次执行、应用启动失败 | 阻断级新增 | 已修正构建脚本；列为实现红线 |
| **D-11** | （未提及）会话日志编码 | `session.jsonl.zstd` 是**多帧** zstd 容器（实测 3264 帧 / 3707 记录），一次性 API 只解第一帧 | 新增事实 | 兜底 D 必须多帧解码 |
| **D-12** | 探针 B"console.log(useSessions())" | 成立；但真实会话 `title` 全为 null，仅 `displayTitle` 可用 | 印证 D-7 | P2 必须实现标题回退链 |
| **D-13** | §3 字面：DOM 交互层直写插件 | 实施为「全屏 DOM 层 + 同源 iframe 承载应用」 | 实施选择 | CSS/JS 隔离；官方备选 `shell.overlay` |
| **D-14** | R-11 前缀约束 | 应用原键无前缀，已改为 `rhinelab-ui:` | 已修正 | 构建期替换 4 处 |
| **D-15** | R-6 资产基路径运行时注入 | 已落实：`base:'./'` + 3 处 `import.meta.env.BASE_URL` 改写 | 已落实 | 资产可挂任意前缀 |
| **D-16** | （未提及）容器渲染能力 | 软件 WebGL 下截图/可操作性检查超时、~36s 崩溃 | 环境限制 | 验收改用事件派发；开场末段 TODO-human |
| **D-17** | （未提及）remote 注入/follow 语义 | 需注入 `remote`+`remote.session`；follow 需先 stage；快照用 `chunkrow/*`；凭据须为 YAML | P3 实测修正 | 已全部修正，见本节 |

---

## D-1 版本锚定错误（A 级）

**规格书原文**（§1 硬约束 5、§2 表格、§4 探针 B、§7 R-9、§9 落款）：
> 起步锁 v0.1.5-alpha.1（2026-09-08）；"v0.1.5-alpha.1 于昨日发布，当前最新"

**实证**：

```
$ npm view @deepseek-ai/dsh dist-tags
{ "alpha": "0.1.5-alpha.1", "latest": "0.1.2-rc.1", "next": "0.1.2-rc.1" }

$ npm view @deepseek-ai/dsh time
"0.1.2-rc.1":    "2026-09-03T06:21:52.107Z"
"0.1.5-alpha.1": "2026-09-08T15:57:30.560Z"   ← 发布日与规格书一致

$ node -e "console.log(require('/home/liuyu/.npm-global/lib/node_modules/@deepseek-ai/dsh/package.json').version)"
0.1.2-rc.1                                     ← 本机实际安装
```

**偏差**：
1. `0.1.5-alpha.1` 是 `alpha` 预发布 tag 上的最新版本，**不是** `latest`（`latest` 是 `0.1.2-rc.1`）。规格书称其为"当前最新"在"最新发布"意义上成立，在"稳定版"意义上不成立。
2. 本机安装并正在服务 127.0.0.1:3080 的是 `0.1.2-rc.1`。规格书 §8 的验收命令（`dsh plugin --profile web add ...` → 重启 → 刷新）若按原文锚定 0.1.5，必须先升级正在运行的环境。

**关键补充实证（降低锚定风险）**：0.1.2-rc.1 与 0.1.5-alpha.1 之间，本插件**全部依赖面零差异**：

| 依赖面 | 0.1.2-rc.1 | 0.1.5-alpha.1 | 结论 |
|---|---|---|---|
| `session/*` RPC 方法集 | `dsh-api-session-controller/lib/typert.remote-client.d.ts` | `.scratch/pkgs/.../typert.remote-client.d.ts` | 方法名与签名逐一相同 |
| `ctx.remote` 客户端服务 | `dsh-api-gateway/lib/types/client/index.d.ts:42` | 同文件同位置 | 相同 |
| WebSocket mux 路径 | `dsh-api-gateway/lib/index.js:11` = `/api/remote.mux` | 同文件同值 | 相同 |
| `shell.overlay` 槽位 | `dsh-client-ui-layout/lib/types/client/index.d.ts:77` | 同文件同值 | 相同 |
| `shell.background` 槽位 | **不存在**（grep 无结果） | **不存在**（grep 无结果） | 两版均无 |

**处置**（用户裁决 2026-09-09）：起步锚定 **0.1.2-rc.1**（= npm `latest`，= 本机已装）；升级流程保留（全链路跑通 → 升级 → 回归探针 B）。规格书已改。

---

## D-2 通道 C 不是独立兜底（A 级，影响决策门）

**规格书原文**（§3 数据层、§4 探针 C、§4 决策门、§9 风险"双通道均失败"）：
> 通道 C：`dsh-direct-api.js` 封装后端 HTTP/WS 端点直连（同源零跨域）
> 探针 C：读 dsh 开源 web 前端源码，列出会话列表端点、历史消息端点、发消息端点、流式事件端点
> 在探针插件里同源 fetch 会话列表端点，console.log 结果

**实证**：后端**不存在** REST 风格的会话端点。全部数据通道只有两条，且共用同一个协议栈：

```
dsh-api-gateway/lib/index.js:11   const REMOTE_STREAM_MUX_PATH = "/api/remote.mux";
dsh-api-gateway/lib/index.js:455  connectionCtx.connection.rpc.intercept("/api", ...)
```

- 一元调用走 `/api` RPC 通道；流式走 `/api/remote.mux`（WebSocket 复用流，心跳 2s）。
- 方法名形如 `session/list`、`session/page`、`session/prompt`、`session/follow`（`dsh-api-session-controller/lib/typert.remote-client.d.ts`）——这是 **Typert Remote** 类型化 RPC，不是 HTTP 资源。
- 客户端已有官方服务 `ctx.remote.session.*` 直接暴露同一套方法（`dsh-api-gateway/lib/types/client/index.d.ts:42`）。

**结论**：规格书的"通道 B（官方 ctx services）"与"通道 C（同源直连）"**是同一传输、同一协议**。C 只是手写帧去说 B 已经在说的话；协议一旦漂移，B 与 C 同时失效，决策门的"二选一"是伪风险分散。

**额外实证：后端有鉴权**（规格书"同源零跨域"未提及）：

```
$ curl -s -o /dev/null -w '%{http_code}' http://127.0.0.1:3080/
401

dsh-client-connection/lib/index.js:199  const TOKEN_QUERY = "token";
dsh-client-connection/lib/index.js:356  Authenticate an index request. A valid root query token mints the cookie...
dsh-client-connection/lib/index.js:178  isTrustedApiRequest(request, trustedHosts)   ← /api 额外要求同源
```

`dsh web` 用进程启动令牌换签名 cookie；`/api` 请求再叠加同源校验。**页面内插件会自动携带 cookie，因此同源直连可行**，但"同源"≠"无鉴权"，任何手写通道必须遵守该 fence。

**处置**：决策门改为「B 通过 → 主用官方通道；B 失败 → 独立兜底 D」。兜底 D 建议为**宿主半直读会话日志**（真正与传输层无关）：

```
$DSH_HOME/sessions/<project>/session-<id>/session.jsonl.zstd
```

宿主半（Node 侧）可读该文件，经 `ctx.webServer.register({ kind:'prefix', ... })` 同源自暴露给客户端。采用该兜底前须先核对会话格式 V3（见 D-9）。

---

## D-3 "100% 照抄"的边界（B 级，表述问题）

**规格书原文**（§3、§5 P1、§9）：视觉层 100% 照抄 open-sea-skin 的纯 DOM 路径（唯一实证方案）。

**实证**（仓库已 clone 至 `.scratch/oss/`）：

1. 规格书引用的路径**确实存在**：
   ```
   oss/cordis.patch.yml:4   - insert:
   oss/cordis.patch.yml:5       - id: open-sea-skin
   oss/plugin/client.js:2   window.__ModuleLoader__.load({ id: "open-sea-skin", factory: (require) => {
   ```
   其 `cordis.patch.yml` 自注释明确写着 "without modifying Harness source"，与硬约束 1 相容。

2. **R-6 资产服务规则（原标"须自行验证"）已确定**：
   ```
   oss/plugin/index.js:74  ctx.effect(() => ctx.webServer.register({
                              kind: 'prefix', path: '/open-sea-skin', handler: serveAsset,
                            }), 'open-sea-skin: static renderer route')
   ```
   即：宿主半用 `ctx.webServer.register({kind:'prefix'})` 挂同源静态路由，客户端 fetch 该前缀即可。资产基路径运行时注入有官方落点。

3. **但 open-sea-skin 是"背景 + 玻璃令牌"皮肤，原生 UI 保持可交互**（其 client.js 注入 `__open-sea-skin-glass__-ui` 样式并保留原生控件），**不是全屏替换**。因此"100% 照抄"只能指**管线**（bundle 门面、静态路由、`<style>` 注入、设置行），不能指视觉架构。

4. **警告：该仓库更新的 `harness-plugin/` 路径不可走**。其 README 自述：
   > The native package needs one additive `shell.background` slot in `ui-layout`; that integration is automated but remains an upstream source change...
   实测 `shell.background` 在 0.1.2-rc.1 与 0.1.5-alpha.1 中**均不存在**，走该路径即违反硬约束 1。

5. **官方升级路径可选**：`shell.overlay` 槽位存在且被真实渲染：
   ```
   dsh-client-ui-layout/lib/types/client/index.d.ts:77  'shell.overlay': { kind: 'list'; scope: 'root' };
   dsh-client-ui-layout/lib/client.js                   renderSlot("shell.overlay", {})
   ```
   若日后想摆脱裸 DOM 注入，可用该槽位做全屏覆盖层（比注入更抗漂移）。

**处置**：规格书已加注"照抄管线、不照抄视觉架构"，并把 `shell.overlay` 记为官方备选。

---

## D-4 新增风险：`dsh plugin add github:...` 首次必失败（B 级）

**实证**（CLI 自身提示，`lib/plugin-F7ZVfRyo.js:125`）：

> git-hosted plugins build on install via their prepare script, which pnpm blocks until allowed — add the exact key pnpm printed above under `allowBuilds` in `<profile>/pnpm-workspace.yaml`, then re-run

**影响**：规格书 §8 代理自验第 1 条与人工验收第 1 条都用 `dsh plugin --profile web add 'github:<repo>#v0.1.0'`，**首次运行会因构建脚本被拦截而失败**。

**处置**：P0 前在 `$DSH_HOME/profiles/web/pnpm-workspace.yaml` 预置 `allowBuilds` 条目；或改用 `file:`/本地打包安装路径。

---

## D-5 R-7.1 双重注册：机制已定位（C 级，补齐依据）

**实证**（`lib/plugin-F7ZVfRyo.js:46` `reconcilePlugins`）：安装后按 `package.json` 的 dependencies 集合幂等维护 `dsh.profile.bundles`；带 `dsh.bundle` 的依赖会被**自动**加入 bundles（该 bundle 自带 patch 层）。若同时在 `$DSH_HOME/profiles/web/cordis.patch.yml` 手写同一 id 的 `insert`，同一插件即被挂载两次。

**结论**：规格书 R-7.1 的规避方法（手动维护 patch + 装后查重）**正确**，此处仅补机制出处。注意 `reconcilePlugins` 对 bundles 数组本身是幂等的（`!plugins.includes(packageName)` 判重），重复来源是"自动 bundle + 手写 insert"两条路叠加。

---

## D-6 P0 前置缺失：`packages/client/AGENTS.md` 本地不存在（C 级）

**实证**：npm 安装包目录只有 `lib/`、`node_modules/`、`package.json` 等，**无 `packages/` 目录**（`ls /home/liuyu/.npm-global/lib/node_modules/@deepseek-ai/dsh/`）。

**处置**：规格书 §2 要求的"读 v0.1.5 tag 的 `packages/client/AGENTS.md`"必须先 clone dsh 源码仓库并检出对应 tag；仅靠 npm 安装包无法完成该步骤。

---

## D-7 数据契约缺口（B 级，影响 P2/P4）

**实证**（`dsh-api-session-controller/lib/types/`）：

| 规格书需要 | 实际提供 | 缺口与处置 |
|---|---|---|
| 40 槽位按时间分桶 | 宿主 `SessionSummary.updatedAt: number`（`types.d.ts:138`） | ✅ 可做 |
| 槽位显示标题 | 客户端 `SessionSummary.title?: string`（`client/sessions/service.d.ts:35`，**可选**），另有 `displayTitle` | 需回退链：title → displayTitle → cwd 基名 → sessionId |
| "收藏"分组 | **无收藏/置顶字段** | 必须插件本地持久化（`rhinelab-ui:` 前缀，符合 R-11） |
| 检索 | `session/search` 存在，但 `SESSION_SEARCH_RESULT_LIMIT = 20`、snippet 上限 240 码点 | 40 槽位检索需分页/多次查询或本地索引 |
| 导出 | **无导出 API** | 需从 `session/page`（`records` + `hasMore`）自行拼装 |
| 流式打字机 | `session/follow` 返回 `snapshot` 帧 + 增量 `SessionEventEntry`（`types.d.ts:427`） | ✅ 可做 |
| 发送 | `session/prompt` 存在 | ✅ 可做（P3 决策门优先级链的第一项"消息 API"即此） |

---

## D-8 开发环境缺口：`dsh-client-ui-slots` 类型包（C 级）

**实证**：
- 所有客户端包声明依赖 `@deepseek-ai/dsh-client-ui-slots@^0.1.2-rc.1`，但该包**未落盘**于 `node_modules`。
- npm 上该包只发布到 `0.0.1-rc.1`（版本错位）。
- 运行时它由 shell 以 **seed 模块**注入：
  ```
  dsh-web-frontend/dist/assets/index-Df-65__b.js  →  staticModules = {
    react, "react/jsx-runtime", "react-dom", "react-dom/client",
    "@deepseek-ai/cordis", "@deepseek-ai/dsh-client-store",
    "@deepseek-ai/dsh-client-ui-slots", "@deepseek-ai/dsh-client-ui-primitives"
  }
  ```
- 同表确认 **React 可用**（规格书 R-B3"require 能否加载 React"＝**能**），且 `dsh-client-ui-primitives`（Button/Modal/Tooltip/MarkdownText 等）对插件开放。

**处置**：运行时 `require('@deepseek-ai/dsh-client-ui-slots')` 可用；类型开发需自备 d.ts（可从 dsh 源码仓库取，见 D-6）。

---

## D-9 未核对项（诚实声明）

以下规格书条目**本次未取得一手证据**，不得视为已验证：

1. **会话格式 V3**（系统提示词纳入消息历史、旧 PTC 事件自动迁移、不支持降级读取）——需读 dsh 源码仓库或会话日志样本。对本插件无影响（插件经 `session/*` RPC 取结构化数据），**但若采用 D-2 的兜底 D（直读 `session.jsonl.zstd`）则升级为 P2 前置必核对项**。
2. **Inbox API 变更**（`agent.inbox` 替代公共类、`hasPending`/`claim` 不再公共）——属宿主侧 Agent API，与本客户端 UI 插件无交集。
3. **`ctx.agent` 移除**——仅确认方向一致：0.1.2-rc.1 的 `dsh-agent/lib/types/index.d.ts:151` 在 Context 上暴露 `agent: Agent`；0.1.5-alpha.1 的 CLI 依赖表已不含 `dsh-agent`。未逐包核对。

---

## D-10 P0 实测新增：客户端 bundle id 必须等于包名（A 级，阻断级）

**现象**：P0 探针插件首次装载后，页面无法启动，控制台报：

```
client-modules: duplicate factory registration for "@deepseek-ai/dsh-typert-registry"
(bundle executed twice without invalidate?)
```

**定位过程**（对照实验）：同一份 Harness、同一 profile，仅移除本插件后重启 → 46 条 boot 条目、零报错；装回插件 → 47 条、立即复现。故问题由本插件引入。

**根因**（源码出处：`dsh-client-modules/lib/client.js`）：

```js
register(registration) {
  const id = stripClientSuffix(registration.id);
  if (this.bootstrapIds.has(id) || this.factories.has(id)) throw new Error(`... duplicate factory registration ...`);
  this.factories.set(id, registration.factory);
}
arrive(row) {
  const { id } = row;
  if (this.loadCache.has(id) || this.factories.has(id)) return Promise.resolve();   // ← 用 graph row id 判重
  ...
}
```

- 客户端模块系统按 **graph row id（= 包名）** 判断"该行是否已到达"；
- bundle 自身 `window.__ModuleLoader__.load({ id })` 决定工厂登记在哪个 key 下；
- 本插件包名 `dsh-plugin-rhinelab-ui`，而 bundle 最初登记为 `id: "rhinelab-ui"` → `factories.has(包名)` 恒为 false → loader 判定该行未到达 → **重新抓取整批 bundle** → 同批内所有插件工厂二次执行 → 第二个注册的 `@deepseek-ai/dsh-typert-registry` 抛错，整个 Web 应用启动失败。

**修正**：`scripts/build-client.mjs` 中 `PACKAGE_ID` 改为包名 `dsh-plugin-rhinelab-ui`（open-sea-skin 能工作正是因为其包名与 bundle id 同为 `open-sea-skin`）。修正后 boot 零报错。

**规格书影响**：§3、§5 P1（R-5 构建管线）。规格书未提及该约束，已作为实现红线加入。

---

## D-11 P0 实测新增：会话日志是"多帧 zstd 容器"（B 级，影响兜底 D）

**现象**：兜底 D 首版用 `zstdDecompressSync(整个文件)` 读取，1.1 MB 的会话日志只解出 **204 字节 1 条记录**。

**根因**：`session.jsonl.zstd` 是**逐批独立的 zstd 帧拼接容器**（每批一条记录一个帧）。Node 的一次性 `zstdDecompressSync` 只解第一帧。实测该文件含 **3264 个帧**（按 `0xFD2FB528` magic 逐帧扫描）。

**正确读法**（重新实现，未跨包导入——遵守硬约束 2）：按帧结构扫描帧边界（magic → frame header descriptor → block header 循环 → checksum），逐帧 `zstdDecompressSync(subarray)` 后按 JSONL 解析。算法对照 Harness 自身实现 `@deepseek-ai/dsh-session-persistence-jsonl/lib/index.js`（`scanZstdFrames` / `PublicZstdFrameDecoder`）。

**实测结果**：3264 帧 → **3707 条记录**，覆盖 29 种记录类型，含 `user/message`、`assistant/message`、`assistant/chunk`、`tool/call`、`tool/result`、`turn/start`、`step/end` 等——足以驱动 40 槽位、阅读面板与工具拆解动画。

**规格书影响**：§4 探针 C / 兜底 D、§5 P2。采用兜底 D 时**必须**使用多帧解码，否则只能读到会话头。

---

## D-12 P0 实测新增：官方通道的数据缺口（B 级，印证 D-7）

**实测**（`window.__RHINE_PROBE__.probeB`，5 个真实会话）：

```
snapshotKeys: ids, byId, current, phase, subagentsByParent, jobsBySession, currentAddress
注入 props  : useSessions, useSessionPendingInteraction, useWorkspaces
sample      : title 全为 null；displayTitle 为 cwd 基名（dsh_pl / react / deepseek_workspace）；blank 有 true
```

- 规格书探针 B 原文"console.log(useSessions())"**成立**：`shell.overlay` 条目的注入 props 确实包含 `useSessions`。
- 但 `title` 在全部真实会话上均为 `null`，只有 `displayTitle`（cwd 基名）可用 → 40 槽位**必须**实现回退链，否则档案卡全是空标题。
- `blank: true` 的会话需要单独视觉处理。

**规格书影响**：§5 P2、§6.1。已并入 D-7 的处置。

---

## D-13 P1 实施：视觉层用「全屏 DOM 层 + 同源 iframe」承载应用（B 级）

**规格书 §3 字面**：`#rhinelab-ui-root` 下直接放 Three.js canvas 与 DOM 交互层，由插件自己实现。

**实施选择**：全屏固定层 `#rhinelab-ui-root` 仍由插件注入（满足硬约束 3 的卸载还原），层内用**同源 iframe** 承载 RhineLabUI 生产构建（`/rhinelab-ui/index.html`）。

**理由**：
1. RhineLabUI 自带完整 DOM/CSS/全局样式与 `document` 级监听；直写进 shell 会与 dsh 的 90+ 个 `<style>` 及全局键盘监听互相污染。
2. 与已验证的参考实现一致（open-sea-skin 的 `harness-plugin` 路径同样用 iframe 承载重资产，D-3）。
3. iframe 同源，父页可直接读取其 DOM 做验收断言，并可读写同一 localStorage，桥接成本可控。

**代价**：跨 frame 交互需 postMessage（P2 数据桥）。官方备选仍是 `shell.overlay` 槽位（D-3 已实证可注册且被渲染）。

---

## D-14 P1 实施：RhineLabUI 存储键加 `rhinelab-ui:` 前缀（C 级）

**规格书 R-11**：localStorage 键一律 `rhinelab-ui:` 前缀。

**实测**：RhineLabUI 原用 `rhine-settings`（偏好）与 `rhine-saved`（收藏），均无前缀。已改为 `rhinelab-ui:settings` / `rhinelab-ui:saved`（构建期 4 处替换）。插件自身偏好另用 `rhinelab-ui:prefs`。

---

## D-15 P1 实施：构建期资产基路径改写（C 级，落实 R-6）

**规格书 R-6**：确认静态资产 URL 规则，资产基路径改运行时注入。

**实测与实施**：
- 资产服务规则已确认为宿主半 `ctx.webServer.register({kind:'prefix', path, handler})`（D-3）。
- RhineLabUI 原用绝对路径 `/assets/*.glb`、`/fonts/*`，挂在 `/rhinelab-ui/` 下会 404 或串到 shell 的 `/assets/`。构建期做三处改写：`vite.config.ts` 设 `base: './'`；`src/scene.ts` 两处 GLB 路径改 `import.meta.env.BASE_URL`；`src/main.ts` 许可 PDF 同理。
- 结果：HTML/CSS/JS 中全部资产引用相对化（`./assets/...`、`../fonts/...`），可挂在任意前缀下。

---

## D-16 P1 实测：容器内软件渲染的能力边界（环境限制，非产品缺陷）

| 现象 | 原因 | 处置 |
|---|---|---|
| `page.screenshot` 超时 | 软件 WebGL 饿死合成器 | 截图 best-effort（8s 上限） |
| `frame.click/press` 超时 | 可操作性检查永不"稳定" | 改为派发真实 DOM 事件 |
| 渲染进程 ~36-38s 崩溃 | 无 GPU；默认画质含 AO/DOF/2048 阴影 | 验收压至极简画质；开场末段转 TODO-human |
| 合成事件 `e.target` 无 `dataset` | 派发到 `document` | 派发到 `document.body` |

开场动画时间轴长 35s（`bootFrame`：t≥35 → `setMode("detail")`）；自动化已捕获 `access→logo→auth→scan→welcome` 五段，末段 `array/inspect` 转人工确认（`P1-REPORT.md` §4）。

---

## D-17 P3 实测：发消息与流式的四个坑（A 级，均已修正）

| # | 现象 | 根因 | 修正 |
|---|---|---|---|
| 1 | `cannot get property "remote" without inject` | cordis 服务需显式声明 | `exports.inject` 增加 `'remote'` |
| 2 | `cannot get property "remote.session" without inject` | 远程命名空间是独立注入点 | 再增加 `'remote.session'` |
| 3 | follow 只收到 snapshot，无增量事件 | 会话 live 事件窗口仅在**被 stage（current）**时打开 | 选档时 `ctx.sessions.open(id)`（仅限真实 `session-` id） |
| 4 | 快照回放拿不到文本 | 快照记录用 `chunkrow/<kind>` 事件名，实时帧用裸 `<kind>` | 归一化去前缀 |

**补充实测**：短回复常在 `follow` 建立前就结束（本例约 18s 才建立，回复 ~10s 完成），因此必须回放快照中"自己那条 prompt 之后"的记录（按 `user/message.data.source.rpcId` 定位），否则永远收不到流。文本按 assistant 块（`turn:step:index`）聚合后整块下发，避免一段回复被拆成多行。

**凭据格式**：`$DSH_HOME/.credentials.yaml` 必须是 `version: 1` + `refs:`/`records:` 的 YAML；**裸字符串（如 `sk-…`）无法被凭据服务加载**，表现为 `no API key for provider route`。隔离测试 home 已改为软链主 home 的凭据文件。

---

## D-18 P0 探针覆盖产品 UI 的回归（A 级，已修复）

**现象**：用户在有 GPU 的真实浏览器打开 3081，看到的是黑底大字「RHINE LABORATORY // ARCHIVE · P0 PROBE A · VISUAL TAKEOVER」，3D 界面被完全遮住。

**根因**：为满足 P0 决策门"加载 root URL 即自动跑探针"的要求，我把探针改为默认安装；而探针 A 的全屏层是 `position:fixed; inset:0; z-index:2147483000` + 不透明背景，正好盖住同为 `z-index:2147483000` 的产品层（同 z-index 时后插入者胜出）。

**为什么自动验收没发现**：无头断言只读 `window.__RHINE__` / `window.__RHINE_PROBE__` 与 DOM 查询，探针层与产品层**同时存在**，断言全部通过；本模型又不具备读图能力，截图无法复核。教训：层级/可见性必须用 `document.elementFromPoint()` 之类的**堆叠断言**验证，不能只看元素是否存在。

**修复**：探针面改为**仅 `?rhine-probe=1` 安装**；该模式下同时跳过 3D 挂载（探针专用模式）。

**新增回归断言**：plain 加载后 `probeALayer=false`、`probeBCard=false`、`document.elementFromPoint(中心)` 必须是 `rhinelab-ui-frame`。

---

## D-19 终端"一闪而过"：推送重置选中位（A 级，已修复）

**现象**：选中会话档案后终端输入条出现，但很快消失；切换档案时一闪而过。

**根因**：`applyBridgePayload` 每次都把 `selected` 重置为 0，而槽位 0 属「收藏」列且为空占位（`key: empty:0:0`），于是 `dshChatOnSelect` 判定为非会话卡 → `data-live=false` → 终端隐藏。而桥在 `ctx.sessions.list.subscribe` 上每次列表变化都重推，代理流式回复期间列表持续跳动 → 终端反复消失。

**修复**：
1. 应用侧：按稳定键（`recordKey`）**保留用户选中位**，重推后重新定位同一会话，而不是回到槽位 0。
2. 桥侧：加**空推送守卫**（记录签名 `key|category|empty|title` + 收藏集），签名不变且已 ack 时不再推送。

**回归断言**：选中会话卡后，等待 20s（期间有列表变化）终端仍 `display=block`、高度 >20px、`data-live=true`，且 `pushes` 不增长。

---

## D-20 实时流式的两条编码 + 对话面板重构（B 级，已实现）

**需求变更**：用户要求不再受参考稿的"档案阅读面板"限制，需要一块真正的**实时对话区**。

**实测发现**：会话实时流的编码与历史页不同——
| 来源 | 事件形态 |
|---|---|
| 历史页（`session/follow` 快照 records） | 打包增量运行 `chunkrow/text-chunks`、`chunkrow/tool-call-chunks`（含 `texts[]`+`dt[]`） |
| 实时帧（`SessionFollowFrame` 的 event） | 原始 `assistant/chunk`，内层 `chunk.type` 为 `text-delta` / `reasoning-delta` / `tool-call-delta` / `block-end` / `usage` / `finish` |

只处理 `text-chunks` 会导致**实时流完全收不到文本**（表现为"面板只显示自己发的消息"）。两条路径都要实现。

**其他实现要点**：
1. 实时 `text-delta` 极碎，需 ~60ms 缓冲合并后再下发，否则打字机抖动。
2. 工具行按调用 id 去重（同一 block 可能同时出现在实时帧与快照回放中）——实测 1 次调用曾渲染 2 行。
3. 面板结构：右侧 480px 常驻抽屉（3D 档案室仍在左侧可见），含角色标签、流式光标、工具行、Enter 发送 / Shift+Enter 换行。

---

## D-21 对话区改为"页面内页签"（B 级，按用户反馈重构）

**用户反馈**：右侧深色浮层"太不协调、颜色不匹配"，要求放进页面内、美观协调。

**重构**：删除独立浮层 `#dsh-conv`，把实时对话做成**档案详情面板的第四个页签**（`04 对话`），完全复用应用自身的设计语言：
- 材质：`rgba(237,235,228,.97)` 纸白面板 + `#f7f5ee` 描边 + `0 26px 95px #63513a20` 投影（同 `.terminal-modal`）
- 分隔线 `#c2bdb1`；正文 `#151713`；弱化字 `#77756b`；强调 `#a67d48`（同全站焦点色）
- 排字：MiSans + 10-14px 紧凑字距 + 小写字距标签（同 `.panel-label`）
- 位置：沿用 `.detail-content`（left 1154 / top 289 / width 636，1920×1080 设计坐标），随应用整体缩放

**同时修复**：payload 后台推送会把 `activeTab` 强制切回「概述」，导致对话页签被顶掉（与 D-19 同类）。现在只有**选中项真正变化**时才重置页签。

**回归断言**：打开对话页签后发送消息，`#chat-log` 必须存在且 `historyMessages > 0`，否则判失败。

---

## D-22 P4 资产瘦身实测（B 级，补齐规格书 P1 任务）

| 资产 | 前 | 后 | 手段 |
|---|---|---|---|
| MiSans 四字重 | 19.4 MB | 0.79 MB | `pyftsubset`，字集 = 应用文案 + **真实会话日志全字符**（1438 字，含 1240 CJK） |
| archive-cassette.glb | 3.40 MB | 1.97 MB | `gltf-transform` dedup + weld + **KHR_mesh_quantization** + prune |
| archive-assembly.glb | 3.19 MB | 1.86 MB | 同上 |
| `rhine-dist/` 合计 | 30 MB | **8.8 MB**（−71%） | |

**关键取舍**：GLB 是纯几何（96k 顶点 / 86k 三角面 / 无贴图），量化由 three.js `GLTFLoader` 原生支持（`KHR_mesh_quantization`），**无需 DRACO 解码器、应用零改动**——比规格书建议的 Draco 方案更省事且无运行时依赖。优化后 P4 全项复测通过、零报错。

**字体子集化的代价**：未覆盖的生僻字回退系统字体，已登记为已知限制。

**打包**：`npm pack` = 6.0 MB / 67 文件；`private` 已移除，构建工具移入 devDependencies。实际 `npm publish` 未执行（需仓库地址与账号授权）。

---

## D-23 token 换取 cookie 的 303 会丢弃查询参数（B 级，影响所有带参数的探针 URL）

**现象**：`http://127.0.0.1:3081/?token=…&rhine-probe=1` 打开后，插件日志显示 `probeOnly: false`——探针参数没生效。

**根因**（源码 `dsh-client-connection/lib/index.js:authorizeIndex`）：带 `token` 的根请求会返回 **303 → `location: /`**，重定向目标不含查询串，于是 `rhine-probe=1` 被丢弃；只有**已持有有效 cookie 且不带 token** 时，`authorizeIndex` 才直接返回 true、原样服务该 URL（保留查询串）。

**处置**：探针脚本改为两步导航——先访问 token URL 铸 cookie，再访问 `/?rhine-probe=1`。此后 `probeOnly` 正确为 true，P0 三探针恢复通过。

**通用教训**：任何依赖查询参数的 dsh Web 调试入口，都必须在 cookie 建立后二次导航，不能与 token 同请求。

---

## D-24 GLB 量化破坏几何：应用会"把世界矩阵烘进几何体"（A 级，已回退）

**现象**（用户实测）：3D 模型**位置不对**且**玻璃材质像丢了**。

**根因**：P4 的资产瘦身对 GLB 施加了 `KHR_mesh_quantization`（POSITION/NORMAL → `Int16Array` + `normalized`）。而 RhineLabUI 的加载代码会**把世界矩阵烘进几何体**：

```ts
const geom = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld).scale(1, 1, 1);
```

`BufferGeometry.applyMatrix4` 对位置/法线是"读出 → 变换 → `setXYZ` 写回"。写入目标若是 int16 归一化数组，浮点结果被截断/钳位 → 位置错乱、法线损坏 → 着色与折射一起崩（"玻璃没了"）。两个症状同源。

**实证**：加载后逐个 surface 读材质与属性——

```
量化版:  Frosted_Polymer  n=Int16Array  （法线被压成 int16）
安全版:  Frosted_Polymer  tr=0.78  n=Float32Array  （全部面均为 Float32Array）
```

**修正**：GLB 只做 `dedup + weld + prune`，**禁用 quantize**。6.6 MB → 5.3 MB（−20%），属性保持 float32，几何与原始一致（顶点 95865→95858，仅合并 7 个完全相同的点）。

**规格书影响**：§5 P1"GLB Draco 压缩"——**Draco 同样会把属性解成压缩流并在加载时重建**，但与本条冲突的是"量化/归一化属性 + 应用侧矩阵烘焙"这一组合；若将来要上 Draco，必须先改掉应用里的 `applyMatrix4` 烘焙，或在加载后先 `toNonIndexed`/反归一化。当前结论：**GLB 不再量化**，瘦身收益以字体子集为主。

---

## D-25 低配自动降级：2D 卡片模式（B 级，新增能力）

**需求**：集显机器压力大。用户判断 Rust/WASM 解决不了 GPU 卡顿（正确：瓶颈在填充率与后处理，不在 JS），要求做**帧率检测 → 自动降级到 2D 模式**。

**实现**（RhineLabUI 侧）：
1. **看门狗**：`frame()` 每秒回报帧率；暖机 2s 后开窗，窗口 4s；中位数 < 24 FPS 或最差样本 < 10 FPS（panic 路径）即降级。
2. **渐进两级**：第一级先把画质降到 `performance`（多数临界机器在此恢复）；仍低于阈值才进入第二级 2D。
3. **2D 模式**：`#stage[data-flat="true"]` 显示 DOM 网格（5 列 × 8 槽 = 40 张卡，含真实会话标题/科室/日期），同时**隐藏 WebGL canvas 且 `frame()` 跳过全部场景调用**——这才是真正把集显解放出来的部分。导航、详情页、对话页签、检索、收藏、导出全部照常。
4. **可逆**：设置面板新增 `RENDER MODE`（自动 / 3D / 2D），选择写入 `rhinelab-ui:settings`。
5. **前置降档**：无存储偏好且 `navigator.hardwareConcurrency <= 4` 时，默认从 `performance` 画质起步。

**实测**（`scripts/verify-2d.mjs` + CDP CPU 降频 12×）：

```
手动切 2D : gridCards=40  columns=[收藏,最近 24h,本周,本月,更早]  canvasHidden=true
            realTitles=[你好, 列出当前目录文件, …]  navigationChanged=true
            detailWorks=true（详情+对话页签可用）  backTo3d=true  pageErrors=0
CPU 降频 6× : 2.5s 画质自动降到 performance（仍在 3D）→ 5s 仍不足 → 2D，40 卡
CPU 降频 12×: 3s 内直接 panic 降级到 2D
```

**踩到的坑**：`applyRenderMode` 最初用 `flatMode` 反推 `want2d`，而看门狗调用它时 `flatMode` 尚为 false → 降级路径恒为空操作。改为 watchdog 先闩锁 `flatMode = true` 再计算。

**未做**：`WEBGL_debug_renderer_info` 的 GPU 型号白/黑名单——字符串匹配太脆，帧率实测更可靠。

---

## D-26 2D 模式下文字被黑块遮住（A 级，已修复）

**现象**（用户实测）：切到 2D 模式后文字被黑块覆盖。

**根因**：三处遮罩都由**渲染循环**驱动，而 2D 模式恰好跳过循环 → 遮罩冻在最后一次绘制状态：

| 遮罩 | 来源 | 冻结后果 |
|---|---|---|
| `.document-redaction-window/.document-redaction-ink`（`#20221d`） | `DocumentDecryption` 的 `update()` 推进 `progress` | 详情页文字被黑块盖住 |
| `#inspection-marks`（`fill:#24221f`，`inset:0`） | `inspectionOverlay.render()` | 全屏深色 SVG + 角标矩形盖住网格 |
| `#inspection-text` | 同上 | 残留文字 |

**修复**：进入 2D 时调用 `clearSceneOverlays()`——把 `#inspection-marks` 置 `opacity:0`、清空 lines/corners/point，`#inspection-text` 置 0，并 `documentDecryption.reset($("#detail-content"), true)`（progress=1 会移除所有红字遮罩且不再重绘）；同时 `renderDetail()` 的 clear 条件加入 `flatMode`，2D 下打开详情也不再起解密动画。

**回归断言**（`verify-2d.mjs`）：用 `document.elementFromPoint()` 验证卡片标题与详情标题**是顶层元素**，且 `redactionWindows === 0`、`inspectionOpacity === "0"`、`inspectionRects === 0`。

```
gridUnoccluded: true    detailUnoccluded: true
titleTopmost: true      topTag: "strong"
```

**布局**：2D 网格宽度收敛到 890px（原 1040px）以避开右侧 `.archive-ui`，并在 2D 下隐藏 `.archive-callout` 装饰环。

---

## D-27 2D 网格与 3D 视图文字层叠（A 级，已修复）

**现象**（用户实测）：2D 模式下网格与"背景文字"重叠。

**根因**：`.archive-ui` 是一个 `position:absolute; inset:0` 的全屏层，内部若干文字块在 1920×1080 设计坐标里绝对定位，正好落在网格区域：

| 元素 | 位置 | 与网格冲突 |
|---|---|---|
| `.object-caption` | left 60 / bottom 235（y≈845） | 压在网格内 |
| `.hover-label` | left 60 / bottom 264（y≈816） | 压在网格内 |
| `.archive-counter` | left 60 / bottom 115（y≈965） | 压在网格底部 |
| `.archive-navigation` | left 504 / bottom 131（y≈949） | 压在网格底部 |
| `.archive-callout` | left 970 / top 487 | 已在 D-26 隐藏 |

另外品牌块 `.brand`（top 114，三行）实际延伸到约 y=225，而网格原 top=190 → 顶部也叠字。

**修复**：2D 下隐藏上述 5 个 3D 视图专属文字层（选中项改由网格头部 `#flat-selected` 显示 `X-009 · 标题`），网格下移到 `top:240px / height:750px`，避开品牌块与底部键盘提示（y=1020）。保留 `.brand` 与 `.archive-hint`。

**回归断言**（`verify-2d.mjs`）：
1. 上述 5 个选择器的 computed `display` 必须为 `none`；
2. 在网格矩形上按 4×3 采样 `document.elementFromPoint()`，**12 个点必须全部命中网格内部元素**。

```
noForeignOverlays: true   gridSurfaceClean: true   samples: 12   allInside: true
```

---

## 附：实证命令清单（可复现）

```bash
# 版本锚定
npm view @deepseek-ai/dsh dist-tags
npm view @deepseek-ai/dsh time
node -e "console.log(require('/home/liuyu/.npm-global/lib/node_modules/@deepseek-ai/dsh/package.json').version)"

# 数据通道（无 REST；仅 /api 与 /api/remote.mux）
grep -n 'REMOTE_STREAM_MUX_PATH' <dsh>/node_modules/@deepseek-ai/dsh-api-gateway/lib/index.js
cat <dsh>/node_modules/@deepseek-ai/dsh-api-session-controller/lib/typert.remote-client.d.ts

# 鉴权 fence
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3080/        # → 401
grep -n 'TOKEN_QUERY\|isTrustedApiRequest' <dsh>/node_modules/@deepseek-ai/dsh-client-connection/lib/index.js

# 槽位与 seed
grep -n "shell.overlay\|shell.background" <dsh>/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/types/client/index.d.ts
grep -o 'renderSlot("shell.overlay", {})' <dsh>/node_modules/@deepseek-ai/dsh-client-ui-layout/lib/client.js

# 视觉管线与资产规则
sed -n '1,10p'  .scratch/oss/plugin/client.js
sed -n '70,80p' .scratch/oss/plugin/index.js
cat .scratch/oss/cordis.patch.yml

# 安装机制与构建拦截
grep -n 'reconcilePlugins\|allowBuilds' <dsh>/lib/plugin-F7ZVfRyo.js
```

（`<dsh>` = `/home/liuyu/.npm-global/lib/node_modules/@deepseek-ai/dsh`）
