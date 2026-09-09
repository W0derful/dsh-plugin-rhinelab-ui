// GENERATED from src/client/index.cjs by scripts/build-client.mjs — do not edit.
window.__ModuleLoader__.load({ id: "dsh-plugin-rhinelab-ui", factory: (require) => {
	var module = { exports: {} };
	var exports = module.exports;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __commonJS = (cb, mod) => function __require() {
  try {
    return mod || (0, cb[__getOwnPropNames(cb)[0]])((mod = { exports: {} }).exports, mod), mod.exports;
  } catch (e) {
    throw mod = 0, e;
  }
};

// src/client/bridge.cjs
var require_bridge = __commonJS({
  "src/client/bridge.cjs"(exports2) {
    var COLUMNS = ["\u6536\u85CF", "\u6700\u8FD1 24h", "\u672C\u5468", "\u672C\u6708", "\u66F4\u65E9"];
    var SLOTS_PER_COLUMN = 8;
    var SAVED_KEY = "rhinelab-ui:saved";
    var FRAME_ID2 = "rhinelab-ui-frame";
    var ROUTE2 = "/rhinelab-ui";
    var DAY_MS = 864e5;
    function readSaved() {
      try {
        const raw = globalThis.localStorage?.getItem(SAVED_KEY);
        const parsed = raw === null || raw === void 0 ? [] : JSON.parse(raw);
        return new Set(Array.isArray(parsed) ? parsed : []);
      } catch {
        return /* @__PURE__ */ new Set();
      }
    }
    function titleOf(session, durableTitle) {
      if (typeof durableTitle === "string" && durableTitle.trim() !== "") return durableTitle.trim();
      if (typeof session.title === "string" && session.title.trim() !== "") return session.title.trim();
      if (typeof session.displayTitle === "string" && session.displayTitle.trim() !== "") return session.displayTitle.trim();
      const base = typeof session.cwd === "string" ? session.cwd.split("/").filter(Boolean).pop() : void 0;
      return base ?? session.id;
    }
    function bucketOf(session, now, saved) {
      if (saved.has(session.id)) return 0;
      const age = now - (session.updatedAt ?? 0);
      if (age <= DAY_MS) return 1;
      if (age <= 7 * DAY_MS) return 2;
      if (age <= 30 * DAY_MS) return 3;
      return 4;
    }
    function formatTime(at) {
      if (typeof at !== "number" || !Number.isFinite(at)) return "\u2014";
      const d = new Date(at);
      const pad = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
    }
    function buildPayload(sessions, titles, revision) {
      const now = Date.now();
      const saved = readSaved();
      const buckets = COLUMNS.map(() => []);
      for (const session of sessions) {
        buckets[bucketOf(session, now, saved)].push(session);
      }
      for (const bucket of buckets) bucket.sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0));
      const records = [];
      let slot = 0;
      for (let lane = 0; lane < COLUMNS.length; lane += 1) {
        const column = COLUMNS[lane];
        for (let row = 0; row < SLOTS_PER_COLUMN; row += 1) {
          slot += 1;
          const id = `X-${String(slot).padStart(3, "0")}`;
          const session = buckets[lane][row];
          if (session === void 0) {
            records.push({
              id,
              key: `empty:${lane}:${row}`,
              title: "\u5F85\u5F52\u6863",
              en: "PENDING ARCHIVE",
              department: "\u2014",
              category: column,
              date: "\u2014",
              lead: "\u2014",
              clearance: "REFERENCE AREA",
              abstract: "\u8BE5\u69FD\u4F4D\u6682\u65E0\u6863\u6848\u3002",
              findings: [],
              source: "#",
              empty: true
            });
            continue;
          }
          const title = titleOf(session, titles.get(session.id));
          const cwd = typeof session.cwd === "string" ? session.cwd : "";
          records.push({
            id,
            key: session.id,
            title,
            en: session.id.slice(0, 24).toUpperCase(),
            department: cwd === "" ? "\u2014" : cwd,
            category: column,
            date: formatTime(session.updatedAt),
            lead: session.id,
            clearance: session.blank === true ? "RESTRICTED" : "REFERENCE AREA",
            abstract: session.blank === true ? "\u7A7A\u767D\u4F1A\u8BDD\uFF0C\u5C1A\u672A\u4EA7\u751F\u5185\u5BB9\u3002" : `${title} \xB7 \u6700\u8FD1\u6D3B\u52A8 ${formatTime(session.updatedAt)}`,
            findings: [],
            source: `${ROUTE2}/session/${encodeURIComponent(session.id)}`,
            empty: false
          });
        }
      }
      return { columns: [...COLUMNS], records, revision };
    }
    async function fetchTitles() {
      const map = /* @__PURE__ */ new Map();
      try {
        const res = await fetch(`${ROUTE2}/sessions`, { credentials: "same-origin" });
        if (!res.ok) return map;
        const data = await res.json();
        for (const item of data.items ?? []) {
          if (typeof item.sessionId === "string" && typeof item.title === "string" && item.title !== "") {
            map.set(item.sessionId, item.title);
          }
        }
      } catch {
      }
      return map;
    }
    function transcriptPatch(transcript) {
      const messages = Array.isArray(transcript.messages) ? transcript.messages : [];
      const tools = Array.isArray(transcript.tools) ? transcript.tools : [];
      const firstUser = messages.find((m) => m.role === "user");
      const findings = [];
      for (const message of messages.slice(-6)) {
        findings.push(`${message.role === "user" ? "USER" : "ASSISTANT"} \xB7 ${message.text.replace(/\s+/g, " ").slice(0, 160)}`);
      }
      for (const tool of tools.slice(-3)) {
        findings.push(`TOOL \xB7 ${tool.name} ${tool.args.replace(/\s+/g, " ").slice(0, 120)}`);
      }
      return {
        abstract: firstUser === void 0 ? `${transcript.title ?? "\u4F1A\u8BDD"} \xB7 ${messages.length} \u6761\u6D88\u606F` : firstUser.text.replace(/\s+/g, " ").slice(0, 400),
        findings: findings.length === 0 ? ["\uFF08\u8BE5\u4F1A\u8BDD\u6682\u65E0\u6D88\u606F\u8BB0\u5F55\uFF09"] : findings,
        date: formatTime(transcript.lastAt ?? transcript.createdAt),
        en: `${messages.length} MSG \xB7 ${tools.length} TOOL`.toUpperCase(),
        source: `${ROUTE2}/session/${encodeURIComponent(transcript.sessionId)}`
      };
    }
    exports2.install = function install(ctx) {
      const state = { revision: 0, lastPayload: null, patches: /* @__PURE__ */ new Map(), disposed: false, pushes: 0, acks: 0, errors: [], prompts: 0, streamed: 0, tools: 0, replayed: 0, cursor: null, followOpened: false, followFrames: 0, followKinds: [], followError: null, eventKinds: [] };
      const frameOf = () => document.getElementById(FRAME_ID2);
      const post = (message) => {
        const frame = frameOf();
        const target = frame?.contentWindow;
        if (target === null || target === void 0) return false;
        target.postMessage(message, location.origin);
        return true;
      };
      const sessionsOf = () => {
        const snapshot = ctx.sessions.list.getSnapshot();
        const byId = snapshot.byId ?? {};
        return Object.keys(byId).map((id) => ({ ...byId[id], id }));
      };
      const push = async () => {
        if (state.disposed) return;
        try {
          const titles = await fetchTitles();
          state.revision += 1;
          const payload = buildPayload(sessionsOf(), titles, state.revision);
          for (const [key, patch] of state.patches) {
            const record = payload.records.find((r) => r.key === key);
            if (record !== void 0) Object.assign(record, patch);
          }
          state.lastPayload = payload;
          const signature = payload.records.map((r) => `${r.key}|${r.category}|${r.empty === true ? 1 : 0}|${r.title}`).join("~") + `|saved:${[...readSaved()].sort().join(",")}`;
          if (signature === state.signature && state.acks > 0) return;
          state.signature = signature;
          if (post({ type: "rhinelab-ui/archive-data", payload })) state.pushes += 1;
        } catch (error) {
          state.errors.push(String(error));
        }
      };
      const loadTranscript = async (key) => {
        if (typeof key !== "string" || key.startsWith("empty:")) return;
        try {
          const res = await fetch(`${ROUTE2}/session/${encodeURIComponent(key)}`, { credentials: "same-origin" });
          if (!res.ok) return;
          const transcript = await res.json();
          post({
            type: "rhinelab-ui/transcript",
            key,
            payload: {
              title: transcript.title ?? null,
              messages: transcript.messages ?? [],
              tools: transcript.tools ?? [],
              messageCount: transcript.messageCount ?? 0,
              toolCount: transcript.toolCount ?? 0
            }
          });
          const patch = transcriptPatch(transcript);
          state.patches.set(key, patch);
          post({ type: "rhinelab-ui/archive-patch", payload: { key, patch } });
        } catch (error) {
          state.errors.push(String(error));
        }
      };
      const follow = async (key, requestId) => {
        state.controller?.abort();
        const controller = new AbortController();
        state.controller = controller;
        state.cursor = null;
        let pending = { texts: [], dt: [] };
        let flushTimer;
        const flushText = () => {
          if (flushTimer !== void 0) {
            clearTimeout(flushTimer);
            flushTimer = void 0;
          }
          if (pending.texts.length === 0) return;
          post({ type: "rhinelab-ui/stream", key, texts: pending.texts, dt: pending.dt });
          state.streamed += 1;
          pending = { texts: [], dt: [] };
        };
        const emitText = (text, delay = 8) => {
          if (typeof text !== "string" || text === "") return;
          pending.texts.push(text);
          pending.dt.push(delay);
          if (flushTimer === void 0) flushTimer = setTimeout(flushText, 60);
        };
        const toolCalls = /* @__PURE__ */ new Map();
        const emittedTools = /* @__PURE__ */ new Set();
        const emitTool = (id, name, args) => {
          const identity = typeof id === "string" && id !== "" ? id : `${name}:${args}`;
          if (emittedTools.has(identity)) return;
          emittedTools.add(identity);
          flushText();
          state.tools += 1;
          post({ type: "rhinelab-ui/tool", key, name: name || "tool", args: args || "" });
        };
        const forward = (event) => {
          const rawType = event?.type;
          const type = typeof rawType === "string" && rawType.startsWith("chunkrow/") ? rawType.slice("chunkrow/".length) : rawType;
          if (type === "assistant/chunk") {
            const chunk = event.data?.chunk;
            if (chunk === null || chunk === void 0) return;
            switch (chunk.type) {
              case "text-delta":
                emitText(chunk.text, 8);
                return;
              case "tool-call-delta": {
                const current = toolCalls.get(chunk.index) ?? { name: "", args: "" };
                if (typeof chunk.name === "string" && chunk.name !== "") current.name = chunk.name;
                current.args += chunk.argumentsDelta ?? "";
                toolCalls.set(chunk.index, current);
                return;
              }
              case "block-end": {
                const block = chunk.block;
                if (block?.type === "tool-call") {
                  emitTool(
                    block.id,
                    block.name,
                    typeof block.arguments === "string" ? block.arguments : JSON.stringify(block.arguments ?? "")
                  );
                }
                return;
              }
              case "finish":
                flushText();
                post({ type: "rhinelab-ui/prompt-state", message: "idle" });
                return;
              default:
                return;
            }
          }
          if (type === "text-chunks") {
            const texts = Array.isArray(event.data?.texts) ? event.data.texts : [];
            const dt = Array.isArray(event.data?.dt) ? event.data.dt : [];
            for (let i = 0; i < texts.length; i += 1) emitText(texts[i], dt[i] ?? 8);
            flushText();
            return;
          }
          if (type === "tool-call-chunks") {
            emitTool(
              event.data?.id,
              event.data?.name ?? "tool",
              Array.isArray(event.data?.args) ? event.data.args.join("") : ""
            );
            return;
          }
          if (type === "turn/end") {
            flushText();
            post({ type: "rhinelab-ui/prompt-state", message: "idle" });
          }
        };
        try {
          const iterable = ctx.remote.session.follow(
            { address: { kind: "session", sessionId: key }, maxMessages: 40 },
            controller.signal
          );
          state.followOpened = true;
          for await (const frame of iterable) {
            if (state.disposed || controller.signal.aborted) break;
            state.followFrames += 1;
            if (state.followKinds.length < 12) state.followKinds.push(frame?.type ?? "unknown");
            if (frame?.type === "snapshot") {
              state.cursor = frame.cursor ?? null;
              let started = requestId === void 0;
              for (const record of frame.records ?? []) {
                const event = record?.event;
                if (!started) {
                  if (event?.type === "user/message" && event?.data?.source?.rpcId === requestId) started = true;
                  continue;
                }
                state.replayed += 1;
                forward(event);
              }
              continue;
            }
            if (frame?.type === "event") {
              const event = frame.event;
              const kind = event?.type ?? "unknown";
              if (state.eventKinds.length < 24 && !state.eventKinds.includes(kind)) state.eventKinds.push(kind);
              if (state.cursor !== null && typeof event?.seq === "number" && event.seq <= state.cursor) continue;
              forward(event);
            }
          }
        } catch (error) {
          state.followError = String(error);
          if (!controller.signal.aborted) state.errors.push(`follow: ${String(error)}`);
        } finally {
          flushText();
          post({ type: "rhinelab-ui/prompt-state", message: "idle" });
        }
      };
      const sendPrompt = async (key, text) => {
        state.prompts += 1;
        try {
          const requestId = typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;
          const result = await ctx.remote.session.prompt({
            requestId,
            sessionId: key,
            mode: "queue",
            content: [{ type: "text", text }],
            clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone
          });
          if (result?.ok !== true) {
            const code = result?.error?.code ?? result?.error?.message ?? "prompt-failed";
            post({ type: "rhinelab-ui/prompt-state", message: `error: ${String(code)}` });
            return;
          }
          post({ type: "rhinelab-ui/prompt-state", message: "streaming" });
          void follow(key, requestId);
        } catch (error) {
          state.errors.push(`prompt: ${String(error)}`);
          post({ type: "rhinelab-ui/prompt-state", message: `error: ${String(error)}` });
        }
      };
      const onMessage = (event) => {
        if (event.origin !== location.origin) return;
        const data = event.data;
        if (data === null || typeof data !== "object") return;
        if (data.type === "rhinelab-ui/archive-ack") {
          state.acks += 1;
          return;
        }
        if (data.type === "rhinelab-ui/selected" && typeof data.key === "string") {
          if (/^session-/.test(data.key)) {
            try {
              ctx.sessions.open(data.key);
              state.staged = data.key;
            } catch (error) {
              state.errors.push(`open: ${String(error)}`);
            }
          }
          void loadTranscript(data.key);
          return;
        }
        if (data.type === "rhinelab-ui/prompt" && typeof data.key === "string" && typeof data.text === "string") {
          void sendPrompt(data.key, data.text);
          return;
        }
        if (data.type === "rhinelab-ui/bookmark") {
          void push();
        }
      };
      window.addEventListener("message", onMessage);
      let unsubscribe;
      try {
        unsubscribe = ctx.sessions.list.subscribe(() => {
          void push();
        });
      } catch (error) {
        state.errors.push(String(error));
      }
      let attempts = 0;
      const timer = setInterval(() => {
        if (state.disposed || state.acks > 0 || attempts >= 20) {
          clearInterval(timer);
          return;
        }
        attempts += 1;
        void push();
      }, 1e3);
      void push();
      globalThis.__RHINE_BRIDGE_STATE__ = state;
      return function dispose() {
        state.disposed = true;
        clearInterval(timer);
        window.removeEventListener("message", onMessage);
        if (typeof unsubscribe === "function") unsubscribe();
      };
    };
  }
});

// src/client/probe.cjs
var require_probe = __commonJS({
  "src/client/probe.cjs"(exports2) {
    var React = require("react");
    var PROBE = globalThis.__RHINE_PROBE__ = globalThis.__RHINE_PROBE__ ?? {
      build: "p1-probe-1",
      startedAt: (/* @__PURE__ */ new Date()).toISOString(),
      lines: [],
      probeB: null,
      probeC: null,
      errors: []
    };
    function log2(tag, payload) {
      PROBE.lines.push({ tag, at: (/* @__PURE__ */ new Date()).toISOString(), payload });
      try {
        console.log(`[RHINE-${tag}]`, payload);
      } catch {
      }
    }
    function fail2(where, error) {
      PROBE.errors.push({ where, message: String(error) });
      try {
        console.error(`[RHINE-ERROR] ${where}`, error);
      } catch {
      }
    }
    function describe(el) {
      return {
        tag: el.tagName?.toLowerCase() ?? null,
        id: el.id || null,
        children: el.children?.length ?? 0
      };
    }
    function domSnapshot() {
      const root = document.querySelector("#root");
      return {
        bodyChildren: [...document.body.children].map(describe),
        bodyChildCount: document.body.children.length,
        rootExists: root !== null,
        rootChildren: root === null ? 0 : root.children.length,
        styleTags: [...document.head.querySelectorAll("style")].length,
        title: document.title
      };
    }
    function mountProbeA() {
      const before = domSnapshot();
      const layer = document.createElement("div");
      layer.id = "rhinelab-ui-probe-a";
      layer.dataset.rhinelab = "probe-a";
      layer.style.cssText = [
        "position:fixed",
        "inset:0",
        "z-index:2147483000",
        "display:flex",
        "align-items:center",
        "justify-content:center",
        "background:radial-gradient(120% 90% at 50% 0%, #0b2f3a 0%, #04121a 55%, #01070b 100%)",
        "color:#dff6ff",
        "font:600 24px/1.4 ui-monospace, monospace",
        "letter-spacing:0.18em"
      ].join(";");
      layer.innerHTML = [
        '<div style="text-align:center">',
        '<div style="font-size:12px;opacity:.62;letter-spacing:.32em">RHINE LABORATORY // ARCHIVE</div>',
        '<div style="margin-top:12px">P0 PROBE A \xB7 VISUAL TAKEOVER</div>',
        "</div>"
      ].join("");
      document.body.append(layer);
      const style = document.createElement("style");
      style.id = "rhinelab-ui-probe-a-style";
      style.textContent = "#rhinelab-ui-probe-a{contain:strict}";
      document.head.append(style);
      const rect = layer.getBoundingClientRect();
      PROBE.probeA = {
        mounted: true,
        layerId: layer.id,
        styleId: style.id,
        coverage: {
          width: Math.round(rect.width),
          height: Math.round(rect.height),
          viewportWidth: window.innerWidth,
          viewportHeight: window.innerHeight,
          coversViewport: rect.width >= window.innerWidth - 1 && rect.height >= window.innerHeight - 1
        },
        domBefore: before,
        unmounted: null
      };
      log2("PROBE-A", { coverage: PROBE.probeA.coverage, bodyChildCount: before.bodyChildCount });
      return function disposeProbeA() {
        layer.remove();
        style.remove();
        const restored = domSnapshot();
        PROBE.probeA.unmounted = {
          at: (/* @__PURE__ */ new Date()).toISOString(),
          layerPresent: document.getElementById("rhinelab-ui-probe-a") !== null,
          stylePresent: document.getElementById("rhinelab-ui-probe-a-style") !== null,
          domAfterUnmount: restored,
          restored: restored.bodyChildCount === before.bodyChildCount && restored.styleTags === before.styleTags
        };
        log2("PROBE-A-UNMOUNT", PROBE.probeA.unmounted);
      };
    }
    function mountProbeB(ctx) {
      const readSessions = () => {
        const snapshot = ctx.sessions.list.getSnapshot();
        const byId = snapshot.byId ?? {};
        const ids = Object.keys(byId);
        return {
          snapshotKeys: Object.keys(snapshot),
          current: snapshot.current ?? null,
          total: ids.length,
          sample: ids.slice(0, 5).map((id) => ({
            id,
            title: byId[id]?.title ?? null,
            displayTitle: byId[id]?.displayTitle ?? null,
            blank: byId[id]?.blank ?? null,
            updatedAt: byId[id]?.updatedAt ?? null
          }))
        };
      };
      const ProbeCard = (props) => {
        const [snap, setSnap] = React.useState(() => readSessions());
        React.useEffect(() => {
          let off;
          try {
            off = ctx.sessions.list.subscribe(() => setSnap(readSessions()));
          } catch (error) {
            fail2("probeB.subscribe", error);
          }
          return typeof off === "function" ? off : void 0;
        }, []);
        React.useEffect(() => {
          PROBE.probeB = {
            ...PROBE.probeB,
            rendered: true,
            sessionTotal: snap.total,
            current: snap.current,
            snapshotKeys: snap.snapshotKeys,
            sample: snap.sample,
            injectedPropsKeys: Object.keys(props ?? {})
          };
          log2("PROBE-B", PROBE.probeB);
        }, [snap]);
        return React.createElement(
          "div",
          {
            id: "rhinelab-ui-probe-b",
            style: {
              position: "absolute",
              left: "16px",
              bottom: "16px",
              padding: "10px 14px",
              borderRadius: "10px",
              background: "rgba(4,18,26,0.86)",
              border: "1px solid rgba(120,220,255,0.35)",
              color: "#dff6ff",
              font: "500 12px/1.5 ui-monospace, monospace",
              letterSpacing: "0.08em"
            }
          },
          `PROBE B \xB7 sessions=${snap.total} \xB7 current=${snap.current ?? "none"}`
        );
      };
      const spec = { name: "shell.overlay", id: "rhinelab-ui-probe-b", order: 10, inject: () => ({}) };
      let dispose;
      try {
        dispose = ctx.slots.register(spec, ProbeCard);
        PROBE.probeB = { registered: true, slot: spec.name, entryId: spec.id };
        log2("PROBE-B-REGISTER", { slot: spec.name, entryId: spec.id });
      } catch (error) {
        PROBE.probeB = { registered: false, error: String(error) };
        fail2("probeB.register", error);
      }
      return () => {
        try {
          if (typeof dispose === "function") dispose();
          PROBE.probeB = { ...PROBE.probeB, disposedAt: (/* @__PURE__ */ new Date()).toISOString() };
        } catch (error) {
          fail2("probeB.dispose", error);
        }
      };
    }
    async function runProbeC() {
      const url = "/rhinelab-ui/probe/sessions";
      try {
        const hostRes = await fetch("/rhinelab-ui/probe/host", { credentials: "same-origin" });
        const host = await hostRes.json();
        const res = await fetch(url, { credentials: "same-origin" });
        const data = await res.json();
        PROBE.probeC = {
          url,
          status: res.status,
          ok: res.ok,
          sessionsRoot: data.sessionsRoot,
          count: data.count,
          sample: (data.items ?? []).slice(0, 3),
          hostStatus: hostRes.status,
          hostPid: host.pid ?? null
        };
        log2("PROBE-C", PROBE.probeC);
      } catch (error) {
        PROBE.probeC = { url, error: String(error) };
        fail2("probeC", error);
      }
    }
    exports2.install = function install(ctx) {
      log2("PROBE-INSTALL", { build: PROBE.build });
      let disposeA;
      try {
        disposeA = mountProbeA();
      } catch (error) {
        fail2("probeA", error);
      }
      const disposeB = mountProbeB(ctx);
      void runProbeC();
      PROBE.unmountA = () => {
        if (typeof disposeA === "function") disposeA();
      };
      PROBE.unmountB = () => {
        if (typeof disposeB === "function") disposeB();
      };
      return () => {
        PROBE.unmountA();
        disposeB();
        PROBE.disposedAt = (/* @__PURE__ */ new Date()).toISOString();
      };
    };
  }
});

// src/client/index.cjs
var ROUTE = "/rhinelab-ui";
var APP_URL = `${ROUTE}/index.html`;
var LAYER_ID = "rhinelab-ui-root";
var FRAME_ID = "rhinelab-ui-frame";
var STYLE_ID = "rhinelab-ui-style";
var PREFS_KEY = "rhinelab-ui:prefs";
var APP_SETTINGS_KEY = "rhinelab-ui:settings";
var LOAD_TIMEOUT_MS = 2e4;
var STATE = globalThis.__RHINE__ = globalThis.__RHINE__ ?? {
  build: "p1-1",
  startedAt: (/* @__PURE__ */ new Date()).toISOString(),
  mounted: false,
  frameLoaded: false,
  fallback: null,
  errors: [],
  lines: []
};
function log(tag, payload) {
  STATE.lines.push({ tag, at: (/* @__PURE__ */ new Date()).toISOString(), payload });
  try {
    console.log(`[RHINE-${tag}]`, payload);
  } catch {
  }
}
function fail(where, error) {
  STATE.errors.push({ where, message: String(error) });
  try {
    console.error(`[RHINE-ERROR] ${where}`, error);
  } catch {
  }
}
function readPrefs() {
  try {
    const raw = globalThis.localStorage?.getItem(PREFS_KEY);
    return raw === null || raw === void 0 ? {} : JSON.parse(raw);
  } catch {
    return {};
  }
}
function writePrefs(patch) {
  const next = { ...readPrefs(), ...patch };
  try {
    globalThis.localStorage?.setItem(PREFS_KEY, JSON.stringify(next));
  } catch {
  }
  return next;
}
var SUPPRESSION_CSS = [
  "#root{opacity:.16!important;filter:saturate(0) brightness(.7)!important;pointer-events:none!important}",
  `#${LAYER_ID}{contain:strict}`,
  `#${LAYER_ID} iframe{width:100%;height:100%;border:0;display:block;background:#0b0d10}`
].join("");
function applyPrefsToApp(prefs) {
  if (prefs === null || typeof prefs !== "object" || Object.keys(prefs).length === 0) return null;
  try {
    const store = globalThis.localStorage;
    const current = JSON.parse(store?.getItem(APP_SETTINGS_KEY) ?? "{}") ?? {};
    const next = { ...current };
    if (prefs.reduced !== void 0) next.reduced = prefs.reduced === true;
    if (prefs.rendering !== void 0) next.rendering = prefs.rendering;
    if (prefs.quality !== void 0) next.quality = prefs.quality === true;
    store?.setItem(APP_SETTINGS_KEY, JSON.stringify(next));
    return next;
  } catch {
    return null;
  }
}
function createLayer() {
  const layer = document.createElement("div");
  layer.id = LAYER_ID;
  layer.dataset.rhinelab = "root";
  layer.style.cssText = [
    "position:fixed",
    "inset:0",
    "z-index:2147483000",
    "background:#0b0d10",
    "overflow:hidden"
  ].join(";");
  const frame = document.createElement("iframe");
  frame.id = FRAME_ID;
  frame.title = "Rhine Lab Analysis OS";
  frame.setAttribute("allow", "autoplay; fullscreen");
  frame.setAttribute("referrerpolicy", "same-origin");
  frame.src = APP_URL;
  layer.append(frame);
  return layer;
}
function mount(ctx) {
  const prefs = readPrefs();
  const appliedSettings = applyPrefsToApp(prefs);
  const layer = createLayer();
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.dataset.rhinelab = "style";
  style.textContent = SUPPRESSION_CSS;
  document.head.append(style);
  document.body.append(layer);
  const frame = layer.querySelector(`#${FRAME_ID}`);
  const rect = layer.getBoundingClientRect();
  const coverage = {
    width: Math.round(rect.width),
    height: Math.round(rect.height),
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    coversViewport: rect.width >= window.innerWidth - 1 && rect.height >= window.innerHeight - 1
  };
  let disposed = false;
  let loaded = false;
  let disposeBridge;
  const onLoad = () => {
    if (disposed) return;
    loaded = true;
    STATE.frameLoaded = true;
    let app = null;
    try {
      const doc = frame.contentDocument;
      const scene = doc?.querySelector("#three-scene");
      app = {
        title: doc?.title ?? null,
        hasStage: doc?.querySelector("#stage") !== null,
        hasScene: scene !== null,
        fps: scene?.getAttribute("data-fps") ?? null,
        mode: doc?.querySelector("#stage")?.getAttribute("data-mode") ?? null
      };
    } catch (error) {
      fail("frame.inspect", error);
    }
    STATE.app = app;
    log("P1-APP-LOADED", { url: APP_URL, app });
    if (typeof disposeBridge !== "function") {
      try {
        disposeBridge = require_bridge().install(ctx);
        STATE.bridgeInstalled = true;
        log("P2-BRIDGE-INSTALL", { route: ROUTE });
      } catch (error) {
        fail("bridge.install", error);
      }
    }
  };
  frame.addEventListener("load", onLoad);
  const timer = setTimeout(() => {
    if (disposed || loaded) return;
    STATE.fallback = { reason: "app-load-timeout", at: (/* @__PURE__ */ new Date()).toISOString() };
    log("P1-FALLBACK", STATE.fallback);
    layer.remove();
    style.remove();
  }, LOAD_TIMEOUT_MS);
  STATE.mounted = true;
  STATE.coverage = coverage;
  STATE.frameUrl = APP_URL;
  STATE.prefs = prefs;
  STATE.appSettings = appliedSettings;
  log("P1-MOUNT", { coverage, prefs, appliedSettings, appUrl: APP_URL });
  return function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(timer);
    frame.removeEventListener("load", onLoad);
    if (typeof disposeBridge === "function") disposeBridge();
    layer.remove();
    style.remove();
    STATE.mounted = false;
    STATE.disposedAt = (/* @__PURE__ */ new Date()).toISOString();
    const root = document.getElementById("root");
    STATE.removal = {
      layerPresent: document.getElementById(LAYER_ID) !== null,
      stylePresent: document.getElementById(STYLE_ID) !== null,
      rootPresent: root !== null,
      rootOpacity: root === null ? null : getComputedStyle(root).opacity
    };
    log("P1-DISPOSE", STATE.removal);
  };
}
exports.name = "rhinelab-ui-client";
exports.inject = ["slots", "sessions", "remote", "remote.session"];
exports.apply = function apply(ctx) {
  const params = new URLSearchParams(location.search);
  const probeOnly = params.get("rhine-probe") === "1";
  log("APPLY", { build: STATE.build, appUrl: APP_URL, probeOnly });
  let dispose;
  if (probeOnly) {
    STATE.probeOnly = true;
  } else {
    try {
      dispose = mount(ctx);
    } catch (error) {
      fail("mount", error);
      return;
    }
  }
  let disposeProbe;
  if (probeOnly) {
    try {
      disposeProbe = require_probe().install(ctx);
    } catch (error) {
      fail("probe.install", error);
    }
  }
  STATE.unmount = () => {
    if (typeof dispose === "function") dispose();
  };
  STATE.setPrefs = (patch) => {
    STATE.prefs = writePrefs(patch);
    return STATE.prefs;
  };
  STATE.createSession = async () => {
    const id = await ctx.sessions.create();
    if (typeof ctx.sessions.refresh === "function") await ctx.sessions.refresh();
    return id;
  };
  ctx.effect(
    () => () => {
      if (typeof disposeProbe === "function") disposeProbe();
      if (typeof dispose === "function") dispose();
    },
    "rhinelab-ui: 3D takeover surface"
  );
};

	return module.exports;
}});
