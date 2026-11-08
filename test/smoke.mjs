#!/usr/bin/env node
/**
 * 离线冒烟测试（不需要网络、不调用真实付费 API）。
 *
 * 覆盖：
 *   1. 构建产物：client.js 内嵌的 gzip 面板可解压、槽位注册、React 直接渲染；
 *   2. 宿主：本地 mock provider（p1 返回 500、p2 返回 200）验证自动 fallback；
 *   3. 流式 fallback、超时切换、全部失败 502、/v1/models 聚合；
 *   4. API key 脱敏：/api 响应、统计文件里都不得出现完整 key；
 *   5. /api 路由：list / proxy / stats / test / save / delete / health；
 *   6. 端口冲突自动顺延；
 *   7. 包名 / cordis row / client id / host name 一致；icon 512x512。
 *
 * 用法：node test/smoke.mjs（先 node build.mjs）
 */
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import url from "node:url";
import zlib from "node:zlib";

const here = path.dirname(url.fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "..");
const errors = [];
const quiet = () => {};
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function ok(name) {
  console.log(`  ✔ ${name}`);
}
function fail(name, detail) {
  errors.push(name);
  console.log(`  ✘ ${name}${detail ? ` — ${detail}` : ""}`);
}
function check(name, condition, detail) {
  if (condition) ok(name);
  else fail(name, detail);
}

function startMock(handler) {
  return new Promise((resolve, reject) => {
    const server = http.createServer(handler);
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

function closeMock(server) {
  return new Promise((resolve) => {
    try {
      if (typeof server.closeAllConnections === "function") server.closeAllConnections();
    } catch {
      /* ignore */
    }
    try {
      server.close(() => resolve());
    } catch {
      resolve();
    }
  });
}

function listenOn(port) {
  return new Promise((resolve) => {
    const server = http.createServer();
    server.once("error", (error) => resolve({ ok: false, error, server }));
    server.once("listening", () => resolve({ ok: true, port: server.address().port, server }));
    server.listen(port, "127.0.0.1");
  });
}

async function findBlockedRange(count) {
  for (let attempt = 0; attempt < 25; attempt += 1) {
    const base = 34000 + Math.floor(Math.random() * 3000);
    const servers = [];
    let success = true;
    for (let index = 0; index < count; index += 1) {
      const result = await listenOn(base + index);
      if (!result.ok) {
        success = false;
        for (const server of servers) server.close();
        break;
      }
      servers.push(result.server);
    }
    if (success) return { base, servers };
  }
  return null;
}

async function waitUntil(predicate, timeoutMs = 4000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (predicate()) return true;
    await sleep(25);
  }
  return false;
}

/* ------------------------------------------------------------------ */
/* 0. 构建产物 & 一致性                                                 */
/* ------------------------------------------------------------------ */
console.log("\n[1/7] 构建产物与包一致性");

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
const clientCode = fs.readFileSync(path.join(ROOT, "lib", "client.js"), "utf8");
const clientTemplate = fs.readFileSync(path.join(ROOT, "lib", "client.template.js"), "utf8");
const patchYml = fs.readFileSync(path.join(ROOT, "cordis.patch.yml"), "utf8");
const hostSource = fs.readFileSync(path.join(ROOT, "lib", "index.js"), "utf8");

check("包名 dsh-provider-pool", pkg.name === "dsh-provider-pool", pkg.name);
check("版本 0.1.0", pkg.version === "0.1.0", pkg.version);
check("cordis.patch.yml 的 row name = 包名", /name:\s*dsh-provider-pool\b/.test(patchYml));
check("cordis.patch.yml 有 row id", /id:\s*provider-pool\b/.test(patchYml));
check("dsh.bundle.patch 指向 cordis.patch.yml", pkg.dsh?.bundle?.patch === "./cordis.patch.yml");
check("client id = 包名", /id:\s*"dsh-provider-pool"/.test(clientCode));
check("client 模板占位符已被构建替换", /var PANEL_GZIP_B64 = "/.test(clientCode) && !/var PANEL_GZIP_B64 = __/.test(clientCode));
check("client 模板仍保留占位符（供重建）", clientTemplate.includes("__PANEL_GZIP_B64__"));

const b64Match = clientCode.match(/var PANEL_GZIP_B64 = "([^"]+)";/);
if (!b64Match) {
  fail("client.js 内嵌面板 gzip");
  process.exit(1);
}
let panelSource = "";
try {
  panelSource = zlib.gunzipSync(Buffer.from(b64Match[1], "base64")).toString("utf8");
  ok(`client.js 内嵌面板可解压（${(panelSource.length / 1024).toFixed(1)} KB 源码）`);
} catch (error) {
  fail("client.js 内嵌面板可解压", error.message);
}
check(
  "面板源码包含 ProviderPanel / stats / 复制地址提示",
  panelSource.includes("ProviderPanel") &&
    panelSource.includes("/api/dsh-provider-pool") &&
    panelSource.includes("proxy.copy") &&
    panelSource.includes("stats.title")
);

const files = Array.isArray(pkg.files) ? pkg.files : [];
for (const required of [
  "lib/index.js",
  "lib/core.js",
  "lib/client.js",
  "app/panel.js",
  "assets/icon.png",
  "cordis.patch.yml",
  "README.md",
  "LICENSE",
]) {
  check(`files 包含 ${required}`, files.includes(required));
}
check("files 含 README.zh.md", files.includes("README.zh.md"));

const rawIcon = fs.readFileSync(path.join(ROOT, "assets", "icon.png"));
const pngOk = rawIcon[0] === 0x89 && rawIcon.toString("ascii", 1, 4) === "PNG";
const iconWidth = rawIcon.readUInt32BE(16);
const iconHeight = rawIcon.readUInt32BE(20);
check("icon.png 是 512x512 PNG 且 < 500KB", pngOk && iconWidth === 512 && iconHeight === 512 && rawIcon.length < 500 * 1024, `${rawIcon.length} bytes`);
for (const file of ["LICENSE", "README.md", "README.zh.md", "build.mjs", "test/smoke.mjs"]) {
  check(`文件存在：${file}`, fs.existsSync(path.join(ROOT, file)));
}

/* ------------------------------------------------------------------ */
/* 1. 客户端半边：ModuleLoader / 槽位 / 面板                            */
/* ------------------------------------------------------------------ */
console.log("\n[2/7] 客户端半边（ModuleLoader / slot / React 渲染）");

let captured = null;
globalThis.window = {
  __ModuleLoader__: {
    load(info) {
      captured = info;
    },
  },
};
const reactStub = {
  createElement(type, props, ...children) {
    return { type, props: props || {}, children };
  },
  useState(initial) {
    return [typeof initial === "function" ? initial() : initial, () => {}];
  },
  useEffect() {},
  useSyncExternalStore(_subscribe, getSnapshot) {
    return getSnapshot();
  },
};
const requireStub = (id) => {
  if (id === "react") return reactStub;
  throw new Error(`unexpected require: ${id}`);
};
try {
  // eslint-disable-next-line no-new-func
  const runClient = new Function("window", "require", clientCode);
  runClient(globalThis.window, requireStub);
  check("__ModuleLoader__.load 被调用", captured !== null);
  check("client 注册 id 正确", captured && captured.id === "dsh-provider-pool", captured && captured.id);
  const clientModule = captured.factory(requireStub);
  check("factory 返回 apply/inject", typeof clientModule.apply === "function" && Array.isArray(clientModule.inject));

  const registered = [];
  const slots = {
    inject(_name, factory) {
      factory();
    },
    register(options, component) {
      registered.push({ options, component });
    },
  };
  const locale = { register() { return () => {}; }, bind() { return (key) => "T:" + key; } };
  const clientCtx = {
    get(name) {
      if (name === "slots") return slots;
      if (name === "locale") return locale;
      return undefined;
    },
    effect(fn) {
      const dispose = fn();
      return () => {
        if (typeof dispose === "function") dispose();
      };
    },
  };
  clientModule.apply(clientCtx);
  const slotNames = registered.map((item) => item.options.name).sort();
  check(
    "注册 shell.overlay + sidebar.footer.action",
    JSON.stringify(slotNames) === JSON.stringify(["shell.overlay", "sidebar.footer.action"]),
    JSON.stringify(slotNames)
  );
  for (const item of registered) {
    try {
      item.component({ t: (key) => key, wide: true });
      ok(`组件可渲染：${item.options.id}`);
    } catch (error) {
      fail(`组件渲染：${item.options.id}`, error.message);
    }
  }
  // locale 服务可用时走 locale.bind 的翻译
  const toggleSlot = registered.find((item) => item.options.id === "dsh-provider-pool.toggle");
  const wrapperTree = toggleSlot.component({});
  check(
    "locale 可用时使用 locale.bind 的翻译",
    JSON.stringify(wrapperTree.type(wrapperTree.props)).includes("T:app.name")
  );
  // locale 没有该字典时回退内置中文（不能把 key 直接显示给用户）
  const fallbackRegistrations = [];
  const fallbackLocale = { register() { return () => {}; }, bind() { return (key) => key; } };
  clientModule.apply({
    get(name) {
      if (name === "slots") {
        return {
          inject(_name, factory) { factory(); },
          register(options, component) { fallbackRegistrations.push({ options, component }); },
        };
      }
      if (name === "locale") return fallbackLocale;
      return undefined;
    },
    effect(fn) { fn(); },
  });
  const fallbackToggle = fallbackRegistrations.find((item) => item.options.id === "dsh-provider-pool.toggle");
  const fallbackTree = fallbackToggle.component({});
  check(
    "locale 缺字典时回退中文（不显示原始 key）",
    JSON.stringify(fallbackTree.type(fallbackTree.props)).includes("Provider 池")
  );

  // 面板源码直接执行 + 首屏渲染（React 直接渲染，不是 iframe）。
  // eslint-disable-next-line no-new-func
  const panelFactory = new Function("react", panelSource)(reactStub);
  check("面板导出 ProviderPanel", panelFactory && typeof panelFactory.ProviderPanel === "function");
  try {
    const tree = panelFactory.ProviderPanel({ t: (key) => key, onClose() {} });
    check("ProviderPanel 可渲染（React 直接渲染）", Boolean(tree) && tree.type === "div");
  } catch (error) {
    fail("ProviderPanel 渲染", error.message);
  }
} catch (error) {
  fail("客户端半边执行", error.message);
}

/* ------------------------------------------------------------------ */
/* 2. 宿主核心纯函数                                                   */
/* ------------------------------------------------------------------ */
console.log("\n[3/7] 宿主核心（脱敏 / URL / fallback 规则 / 配置）");

const core = await import(url.pathToFileURL(path.join(ROOT, "lib", "core.js")));
const host = await import(url.pathToFileURL(path.join(ROOT, "lib", "index.js")));

check("host name = 包名", host.name === "dsh-provider-pool", host.name);
check("host inject 含 connection", Array.isArray(host.inject) && host.inject.includes("connection"));
check("默认端口 3121", core.DEFAULT_PORT === 3121);
check("端口重试上限 3130", core.MAX_PORT === 3130);
check("默认超时 20s", core.DEFAULT_TIMEOUT_MS === 20000);
check("maskApiKey 只保留尾 4 位", core.maskApiKey("sk-mock-provider-one-aaaa") === "••••aaaa", core.maskApiKey("sk-mock-provider-one-aaaa"));
check("maskApiKey 空值不报错", core.maskApiKey("") === "" && core.maskApiKey(undefined) === "");
check(
  "chatCompletionsUrl 自动补 /v1",
  core.chatCompletionsUrl("https://api.deepseek.com") === "https://api.deepseek.com/v1/chat/completions"
);
check(
  "chatCompletionsUrl 已带 /v1 不重复",
  core.chatCompletionsUrl("https://api.openai.com/v1/") === "https://api.openai.com/v1/chat/completions"
);
check("fallback 状态：401/402/403/429/5xx", [401, 402, 403, 429, 500, 503].every((code) => core.isFallbackStatus(code)));
check("非 fallback 状态：200/400/404", [200, 400, 404].every((code) => !core.isFallbackStatus(code)));
const normalized = core.normalizeConfig({ providers: [{ id: "x", name: "bad", baseUrl: "ftp://x" }] });
check("坏 provider 被忽略并给出 warning", normalized.config.providers.length === 0 && normalized.warnings.length === 1);

/* ------------------------------------------------------------------ */
/* 3. mock provider + 代理 fallback                                     */
/* ------------------------------------------------------------------ */
console.log("\n[4/7] 本地代理 fallback（mock provider：p1=500 / p2=200）");

const tempHome = fs.mkdtempSync(path.join(os.tmpdir(), "dsh-provider-pool-smoke-"));
process.env.DSH_HOME = tempHome;
const configFile = path.join(tempHome, "provider-pool.json");
const statsFile = path.join(tempHome, "provider-pool-stats.json");
const KEY_ONE = "sk-mock-provider-one-aaaa";
const KEY_TWO = "sk-mock-provider-two-bbbb";

const providerRequests = { p1: [], p2: [] };
const providerOne = await startMock((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    providerRequests.p1.push({ url: request.url, headers: request.headers, body });
    if (request.url.startsWith("/v1/models")) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: { message: "models boom" } }));
      return;
    }
    response.writeHead(500, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "upstream exploded" } }));
  });
});
const providerTwo = await startMock((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    providerRequests.p2.push({ url: request.url, headers: request.headers, body });
    let parsed = {};
    try {
      parsed = body ? JSON.parse(body) : {};
    } catch {
      parsed = {};
    }
    if (request.url.startsWith("/v1/models")) {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ object: "list", data: [{ id: "mock-model-a" }, { id: "mock-model-b" }] }));
      return;
    }
    if (parsed.stream === true) {
      response.writeHead(200, { "content-type": "text/event-stream; charset=utf-8" });
      response.write('data: {"choices":[{"delta":{"content":"po"}}]}\n\n');
      response.write('data: {"choices":[{"delta":{"content":"ng"}}]}\n\n');
      response.end("data: [DONE]\n\n");
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        id: "chatcmpl-mock",
        object: "chat.completion",
        model: parsed.model || "",
        choices: [{ index: 0, message: { role: "assistant", content: "pong from provider2" }, finish_reason: "stop" }],
      })
    );
  });
});
const slowProvider = await startMock(() => {
  /* 故意不响应，触发 1s 超时 */
});
const badRequestProvider = await startMock((request, response) => {
  let body = "";
  request.on("data", (chunk) => (body += chunk));
  request.on("end", () => {
    response.writeHead(400, { "content-type": "application/json" });
    response.end(JSON.stringify({ error: { message: "bad request from provider3" } }));
  });
});

function writePoolConfig(providers, extra = {}) {
  fs.writeFileSync(
    configFile,
    JSON.stringify({ proxyPort: 0, timeoutMs: extra.timeoutMs || 20000, providers }, null, 2) + "\n",
    "utf8"
  );
}

writePoolConfig([
  { id: "p1", name: "Mock Provider One", baseUrl: `http://127.0.0.1:${providerOne.port}`, apiKey: KEY_ONE, model: "mock-model-1", priority: 1 },
  { id: "p2", name: "Mock Provider Two", baseUrl: `http://127.0.0.1:${providerTwo.port}`, apiKey: KEY_TWO, model: "mock-model-2", priority: 2 },
]);

const pool = host.createProviderPool({ log: quiet });
const state = await pool.start();
check("本地代理已监听随机端口", state.running === true && state.port > 0, JSON.stringify(state));
const proxyBase = `http://127.0.0.1:${state.port}`;

const chatResponse = await fetch(`${proxyBase}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "client-model", messages: [{ role: "user", content: "hi" }] }),
});
const chatJson = await chatResponse.json();
check(
  "fallback：p1 返回 500 → p2 返回 200，最终 200",
  chatResponse.status === 200 && chatJson.choices?.[0]?.message?.content === "pong from provider2",
  `status=${chatResponse.status} body=${JSON.stringify(chatJson).slice(0, 200)}`
);
check("先请求了 p1（500）", providerRequests.p1.length === 1, String(providerRequests.p1.length));
check("p1 收到的是代理请求（不是浏览器直连）", providerRequests.p1[0].url === "/v1/chat/completions");
check(
  "p2 收到 Authorization: Bearer <池里的 key>",
  providerRequests.p2[0]?.headers?.authorization === `Bearer ${KEY_TWO}`,
  providerRequests.p2[0]?.headers?.authorization
);
check(
  "模型名被改写为 provider 配置的 model",
  JSON.parse(providerRequests.p2[0].body).model === "mock-model-2",
  JSON.parse(providerRequests.p2[0].body).model
);

const recent = pool.stats.recent();
check("stats 记录 2 次尝试（500 后 200）", recent.length === 2, String(recent.length));
check(
  "stats 第一次：p1 / 500 / fallback=false",
  recent[0].providerId === "p1" && recent[0].status === 500 && recent[0].fallback === false,
  JSON.stringify(recent[0])
);
check(
  "stats 第二次：p2 / 200 / fallback=true",
  recent[1].providerId === "p2" && recent[1].status === 200 && recent[1].fallback === true,
  JSON.stringify(recent[1])
);
check(
  "stats 字段齐全：time/providerId/model/ms/status/fallback",
  ["time", "providerId", "model", "ms", "status", "fallback"].every((key) => key in recent[0])
);

const modelsResponse = await fetch(`${proxyBase}/v1/models`);
const modelsJson = await modelsResponse.json();
check(
  "GET /v1/models 聚合（失败 provider 忽略）",
  modelsResponse.status === 200 &&
    Array.isArray(modelsJson.data) &&
    modelsJson.data.length === 2 &&
    modelsJson.data.every((model) => model.owned_by === "p2"),
  JSON.stringify(modelsJson)
);

const streamResponse = await fetch(`${proxyBase}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "client-model", stream: true, messages: [{ role: "user", content: "hi" }] }),
});
const streamText = await streamResponse.text();
check(
  "流式 fallback：首字节前 p1 500 → p2 SSE 正常返回",
  streamResponse.status === 200 &&
    String(streamResponse.headers.get("content-type") || "").includes("text/event-stream") &&
    streamText.includes("data:") &&
    streamText.includes("[DONE]"),
  `status=${streamResponse.status} body=${streamText.slice(0, 120)}`
);

// 超时切换：slow provider 永不响应，1s 后切换 p2。
writePoolConfig(
  [
    { id: "slow", name: "Slow Provider", baseUrl: `http://127.0.0.1:${slowProvider.port}`, apiKey: "sk-slow-cccc", model: "slow-model", priority: 1 },
    { id: "p2", name: "Mock Provider Two", baseUrl: `http://127.0.0.1:${providerTwo.port}`, apiKey: KEY_TWO, model: "mock-model-2", priority: 2 },
  ],
  { timeoutMs: 1000 }
);
const timeoutStart = Date.now();
const timeoutResponse = await fetch(`${proxyBase}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "client-model", messages: [{ role: "user", content: "hi" }] }),
});
const timeoutJson = await timeoutResponse.json();
const timeoutMs = Date.now() - timeoutStart;
check(
  "超时 1s 后自动切换下一个 provider",
  timeoutResponse.status === 200 && timeoutJson.choices?.[0]?.message?.content === "pong from provider2" && timeoutMs < 5000,
  `status=${timeoutResponse.status} ms=${timeoutMs}`
);
const timeoutStats = pool.stats.recent().slice(-2);
check(
  "超时尝试记为 status=0 且 fallback=false",
  timeoutStats[0].providerId === "slow" && timeoutStats[0].status === 0 && timeoutStats[0].fallback === false,
  JSON.stringify(timeoutStats[0])
);

// 非 fallback 状态（400）：原样透传，不切换 provider。
writePoolConfig([
  { id: "p400", name: "Bad Request Provider", baseUrl: `http://127.0.0.1:${badRequestProvider.port}`, apiKey: "sk-mock-bad-dddd", model: "bad-model", priority: 1 },
  { id: "p2", name: "Mock Provider Two", baseUrl: `http://127.0.0.1:${providerTwo.port}`, apiKey: KEY_TWO, model: "mock-model-2", priority: 2 },
]);
const p2HitsBefore400 = providerRequests.p2.length;
const badResponse = await fetch(`${proxyBase}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "client-model", messages: [{ role: "user", content: "hi" }] }),
});
const badJson = await badResponse.json();
check(
  "非 fallback 状态 400 原样返回且不切换",
  badResponse.status === 400 &&
    badJson.error?.message === "bad request from provider3" &&
    providerRequests.p2.length === p2HitsBefore400,
  `status=${badResponse.status} body=${JSON.stringify(badJson).slice(0, 120)}`
);

// 空池 → 503 + 可操作提示（不崩、不重试）。
writePoolConfig([]);
const emptyResponse = await fetch(`${proxyBase}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "client-model", messages: [{ role: "user", content: "hi" }] }),
});
const emptyJson = await emptyResponse.json();
check(
  "provider 池为空 → 503 + 提示",
  emptyResponse.status === 503 &&
    emptyJson.error?.type === "provider_pool_empty" &&
    String(emptyJson.error?.message || "").includes("provider-pool.json"),
  `status=${emptyResponse.status} body=${JSON.stringify(emptyJson).slice(0, 160)}`
);

// 全部失败 → 502 + attempts
writePoolConfig([
  { id: "p1", name: "Mock Provider One", baseUrl: `http://127.0.0.1:${providerOne.port}`, apiKey: KEY_ONE, model: "mock-model-1", priority: 1 },
]);
const exhaustedResponse = await fetch(`${proxyBase}/v1/chat/completions`, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ model: "client-model", messages: [{ role: "user", content: "hi" }] }),
});
const exhaustedJson = await exhaustedResponse.json();
check(
  "全部 provider 失败 → 502 + attempts",
  exhaustedResponse.status === 502 &&
    exhaustedJson.error?.type === "provider_pool_exhausted" &&
    Array.isArray(exhaustedJson.error?.attempts) &&
    exhaustedJson.error.attempts.length === 1,
  JSON.stringify(exhaustedJson).slice(0, 200)
);

// 恢复双 provider，等统计落盘后检查 key 不落盘
writePoolConfig([
  { id: "p1", name: "Mock Provider One", baseUrl: `http://127.0.0.1:${providerOne.port}`, apiKey: KEY_ONE, model: "mock-model-1", priority: 1 },
  { id: "p2", name: "Mock Provider Two", baseUrl: `http://127.0.0.1:${providerTwo.port}`, apiKey: KEY_TWO, model: "mock-model-2", priority: 2 },
]);
pool.stats.flush();
const statsRaw = fs.readFileSync(statsFile, "utf8");
check("统计已持久化到 ~/.dsh/provider-pool-stats.json", JSON.parse(statsRaw).calls.length >= 4);
check("统计文件不含完整 apiKey", !statsRaw.includes(KEY_ONE) && !statsRaw.includes(KEY_TWO));
check("统计文件不含 'Bearer ' + key", !statsRaw.includes("Bearer " + KEY_ONE));

/* ------------------------------------------------------------------ */
/* 4. 端口冲突自动顺延                                                  */
/* ------------------------------------------------------------------ */
console.log("\n[5/7] 端口冲突自动顺延");

const blocked = await findBlockedRange(2);
if (blocked) {
  const target = http.createServer();
  const listenResult = await core.listenWithPortFallback(target, { port: blocked.base, maxPort: blocked.base + 3 });
  check(
    "端口被占用时自动试下一个（3121→3122 规则）",
    listenResult.ok && listenResult.port > blocked.base && listenResult.port <= blocked.base + 3,
    JSON.stringify(listenResult)
  );
  await core.closeServer(target);
  for (const server of blocked.servers) await closeMock(server);
} else {
  fail("端口冲突测试环境准备");
}

await pool.stop();
check("代理 stop 后不再监听", pool.state().running === false);

/* ------------------------------------------------------------------ */
/* 5. /api 路由（apply + connection.fetch.register）                    */
/* ------------------------------------------------------------------ */
console.log("\n[6/7] /api 路由（key 脱敏 / 测试 / 统计 / 保存 / 删除）");

writePoolConfig([
  { id: "p1", name: "Mock Provider One", baseUrl: `http://127.0.0.1:${providerOne.port}`, apiKey: KEY_ONE, model: "mock-model-1", priority: 1 },
  { id: "p2", name: "Mock Provider Two", baseUrl: `http://127.0.0.1:${providerTwo.port}`, apiKey: KEY_TWO, model: "mock-model-2", priority: 2 },
]);

const routes = [];
const routeDisposers = [];
const fakeCtx = {
  connection: {
    fetch: {
      register(route) {
        routes.push(route);
        return () => {};
      },
    },
  },
  effect(fn) {
    const cleanup = fn();
    if (typeof cleanup === "function") routeDisposers.push(cleanup);
    return () => {};
  },
};
const appliedPool = host.apply(fakeCtx);
check("apply 注册 7 条面板 /api 路由", routes.length === 7, String(routes.length));
check(
  "路由都声明 requestBody: buffered（DSH connection 桥接要求）",
  routes.every((route) => route.requestBody === "buffered"),
  JSON.stringify(routes.map((route) => route.requestBody))
);
check(
  "路由都挂在 /api/dsh-provider-pool/ 前缀",
  routes.every((route) => route.path.startsWith("/api/dsh-provider-pool/"))
);
await waitUntil(() => appliedPool.state().running === true, 4000);

async function callRoute(routePath, init) {
  const route = routes.find((item) => item.path === routePath);
  if (!route) throw new Error(`没有注册路由：${routePath}`);
  return route.fetch(new Request(`http://127.0.0.1${routePath}`, init || {}));
}
function jsonInit(body) {
  return { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
}

const listResponse = await callRoute("/api/dsh-provider-pool/list");
const listJson = await listResponse.json();
const listRaw = JSON.stringify(listJson);
check("GET /list 返回 2 个 provider", listResponse.status === 200 && listJson.providers.length === 2, JSON.stringify(listJson.providers));
check(
  "list 里 apiKey 脱敏为尾 4 位（••••aaaa / ••••bbbb）",
  listJson.providers[0].apiKeyMasked === "••••aaaa" && listJson.providers[1].apiKeyMasked === "••••bbbb",
  JSON.stringify(listJson.providers.map((provider) => provider.apiKeyMasked))
);
check("list 不含 apiKey 原始字段", listJson.providers.every((provider) => !("apiKey" in provider)));
check("list 响应里没有完整 key", !listRaw.includes(KEY_ONE) && !listRaw.includes(KEY_TWO));
check("list 返回代理配置与配置文件路径", Boolean(listJson.configPath) && listJson.proxyPort === 0);

const proxyRouteResponse = await callRoute("/api/dsh-provider-pool/proxy");
const proxyRouteJson = await proxyRouteResponse.json();
check(
  "GET /proxy 返回代理地址与端口",
  proxyRouteJson.address === `http://127.0.0.1:${appliedPool.state().port}/v1` &&
    proxyRouteJson.port === appliedPool.state().port &&
    proxyRouteJson.running === true,
  JSON.stringify(proxyRouteJson)
);

const statsRouteResponse = await callRoute("/api/dsh-provider-pool/stats");
const statsRouteJson = await statsRouteResponse.json();
check(
  "GET /stats 返回调用记录与汇总",
  Array.isArray(statsRouteJson.calls) &&
    statsRouteJson.calls.length >= 4 &&
    statsRouteJson.summary.total === statsRouteJson.calls.length,
  JSON.stringify(statsRouteJson.summary)
);
check("stats 响应里没有完整 key", !JSON.stringify(statsRouteJson).includes(KEY_ONE));

const testOkResponse = await callRoute("/api/dsh-provider-pool/test", jsonInit({ providerId: "p2" }));
const testOkJson = await testOkResponse.json();
check(
  "POST /test 测 p2 连通性 OK",
  testOkJson.ok === true && testOkJson.test.ok === true && testOkJson.test.status === 200,
  JSON.stringify(testOkJson.test)
);
check("test 响应里没有完整 key", !JSON.stringify(testOkJson).includes(KEY_TWO));

const testFailResponse = await callRoute("/api/dsh-provider-pool/test", jsonInit({ providerId: "p1" }));
const testFailJson = await testFailResponse.json();
check("POST /test 测 p1 返回失败状态 500", testFailJson.ok === true && testFailJson.test.ok === false && testFailJson.test.status === 500);
check("test 未知 provider → 404", (await callRoute("/api/dsh-provider-pool/test", jsonInit({ providerId: "nope" }))).status === 404);

const saveResponse = await callRoute(
  "/api/dsh-provider-pool/save",
  jsonInit({ provider: { name: "Third", baseUrl: "https://api.example.com/v1", apiKey: "sk-mock-provider-three-cccc", model: "m3", priority: 3 } })
);
const saveJson = await saveResponse.json();
check("POST /save 新增 provider（id 自动生成）", saveResponse.status === 200 && saveJson.ok === true && Boolean(saveJson.provider.id));
check("save 响应里 apiKey 同样脱敏", saveJson.provider.apiKeyMasked === "••••cccc");
const savedConfig = JSON.parse(fs.readFileSync(configFile, "utf8"));
check("save 把 provider 写回配置文件", savedConfig.providers.length === 3);
check("配置文件里 key 是完整保存的（宿主侧）", savedConfig.providers.some((provider) => provider.apiKey === "sk-mock-provider-three-cccc"));

const listAfterSave = await (await callRoute("/api/dsh-provider-pool/list")).json();
check("list 反映新增 provider", listAfterSave.providers.length === 3);
const savedId = saveJson.provider.id;
const deleteResponse = await callRoute("/api/dsh-provider-pool/delete", jsonInit({ id: savedId }));
const deleteJson = await deleteResponse.json();
check("POST /delete 删除 provider", deleteResponse.status === 200 && deleteJson.ok === true && deleteJson.removed === savedId);
check("delete 后 list 回到 2 个", (await (await callRoute("/api/dsh-provider-pool/list")).json()).providers.length === 2);
check("delete 未知 id → 404", (await callRoute("/api/dsh-provider-pool/delete", jsonInit({ id: "nope" }))).status === 404);
check("GET /health 正常", (await (await callRoute("/api/dsh-provider-pool/health")).json()).ok === true);

for (const cleanup of routeDisposers) {
  try {
    cleanup();
  } catch {
    /* ignore */
  }
}
await appliedPool.stop();

/* ------------------------------------------------------------------ */
/* 6. 清理 + 汇总                                                       */
/* ------------------------------------------------------------------ */
console.log("\n[7/7] 清理");
await closeMock(providerOne.server);
await closeMock(providerTwo.server);
await closeMock(slowProvider.server);
await closeMock(badRequestProvider.server);
try {
  fs.rmSync(tempHome, { recursive: true, force: true });
} catch {
  /* ignore */
}
if (process.env.DSH_HOME === tempHome) delete process.env.DSH_HOME;
check("临时目录已清理", !fs.existsSync(tempHome));

console.log("");
if (errors.length) {
  console.log(`FAILED (${errors.length}): ${errors.join("; ")}`);
  process.exit(1);
}
console.log("SMOKE OK");
