# P3 验收报告（输入与流式）

| 项目 | 值 |
|---|---|
| 报告日期 | 2026-09-09 |
| 规格书 | v1.0-R2 §5 P3 |
| 决策门 | **路径 2：`ctx.remote.session.prompt`**（用户确认 2026-09-09） |
| 结论 | **P3 出口条件达成**（真实模型端到端，非回放） |

## 1. 出口条件验收

| 出口条件 | 实测 | 判定 |
|---|---|---|
| 3D 界面完成一次完整对话 | 输入「用 bash 列出当前目录的文件」→ 真实流式回复 + 1 次工具调用 | **通过** |
| 流式回复打字机追加 | `streamed: true`；按 `text-chunks` 的 `dt` 节奏逐字渲染 | **通过** |
| 工具调用 → 拆解循环动画 + 参数文本条 | `toolCalls: 1`、`toolChips: 1`，参数以 `name + args` 文本条呈现 | **通过** |
| 流式中断/重连不卡死 | 切换档案即 `AbortController.abort()`，新一轮重开 follow；`finally` 必发 `idle` | **通过（机制）** |
| 控制台零报错 | `pageErrors: 0`、`bridgeErrors: []` | **通过** |

验收命令：

```bash
node scripts/verify-p3.mjs --url "http://127.0.0.1:3081/?token=<token>"   # PASSED
```

## 2. 实测证据

```
targetSlot    X-009  session-52e5957c-…  clearance=RESTRICTED（探针自建新会话）
terminalLive  true            （选中会话档案后终端浮现）
promptSent    true            （经 3D 输入框提交）
streamed      true            （真实模型流式回复）
toolCalls     1               （一次真实工具调用）
toolChips     1               （工具参数文本条已渲染）
chatLog       "> 用 bash 列出当前目录的文件" + 流式追加中的回复
pageErrors    0
```

**真实模型回复样本**（会话日志 `session-5a6c06cd`，prompt「你好」）：

```
user/message   你好
text-chunks    "你好","！","我是","你的","编程","助手","，","很高兴","为你","服务","。"
               "😊","\n\n","有什么","我可以","帮","你的","吗","？",…
assistant/chunk finish {kind: "stop"}
usage          inputTokens 8088 / outputTokens 100
turn/end       {kind: "completed"}
```

## 3. 实现结构

| 位置 | 职责 |
|---|---|
| RhineLabUI `src/main.ts` | 3D 终端输入条（`#dsh-chat`）：会话档案选中时浮现、提交即 `postMessage`、按 `dt` 打字机渲染、工具条拆解动画 |
| `src/client/bridge.cjs` | `session.prompt` 发送、`session.follow` 订阅、快照回放、块级文本聚合、工具块转发 |
| `src/client/index.cjs` | `inject` 增加 `remote` / `remote.session`；暴露 `createSession` 供验收自建会话 |

## 4. 关键实现发现（已记入 SPEC-DEVIATIONS D-17）

1. **`ctx.remote` 与 `ctx.remote.session` 必须分别声明 inject**——只写 `remote` 会报 `cannot get property "remote.session" without inject`。
2. **会话 live 窗口需先 stage**：`ctx.sessions.open(id)` 之后事件流才活跃（选档即 open，符合"打开档案"的语义）。
3. **快照记录用 `chunkrow/<kind>` 事件名**，实时帧用裸 `<kind>`；必须归一化，否则回放拿不到文本。
4. **短回复常在 follow 建立前就结束**：必须回放快照中"自己那条 prompt 之后"的记录（按 `source.rpcId` 定位），否则永远收不到流。
5. 隔离 home 的 `.credentials.yaml` 若为**裸字符串**（非 `version: 1` + `refs/records` YAML）则凭据服务无法加载；已改为软链主 home 的凭据文件。

## 5. 遗留

- 「流式中断/重连不卡死」为机制验证；真实中断场景（长回复中途切换档案）留待 P4 联调。
- 工具调用目前为统一拆解循环 + 参数文本条（规格书 §6.2 方案），无语义映射。
