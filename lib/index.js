/**
 * dsh-provider-pool 宿主半边。
 *
 * 注册给 DSH 的能力：
 *   1. 启动本地 OpenAI 兼容代理（127.0.0.1，默认 3121，冲突自动试 3122-3130）；
 *   2. 在 connection 的共享 /api 通道上挂面板路由：
 *        GET  /api/dsh-provider-pool/list    provider 列表（apiKey 只给尾 4 位）
 *        POST /api/dsh-provider-pool/test    测单个 provider 连通性
 *        GET  /api/dsh-provider-pool/stats   最近调用统计
 *        GET  /api/dsh-provider-pool/proxy   代理地址 / 端口 / 运行状态
 *        POST /api/dsh-provider-pool/save    新增或更新 provider（写回配置文件）
 *        POST /api/dsh-provider-pool/delete  删除 provider
 *        GET  /api/dsh-provider-pool/health  插件自身健康检查
 *
 * 安全边界：
 *   - apiKey 只出现在宿主内存与配置文件里；任何 HTTP 响应都不返回完整 key；
 *   - 写操作只接受 JSON，出错信息经过脱敏；
 *   - 代理只 bind 127.0.0.1，不对外网暴露。
 */
import {
  DEFAULT_PORT,
  DEFAULT_TIMEOUT_MS,
  MAX_PORT,
  attemptProvider,
  chatCompletionsUrl,
  closeServer,
  createProxyServer,
  createStatsStore,
  defaultConfigPath,
  defaultStatsPath,
  listenWithPortFallback,
  maskApiKey,
  normalizeBaseUrl,
  readConfigFile,
  saveConfigFile,
  testProvider,
} from "./core.js";

/** 稳定插件名（cordis 组合行按 name 引用；必须等于包名）。 */
export const name = "dsh-provider-pool";

/** 需要 connection 服务提供带鉴权的 /api Fetch 路由。 */
export const inject = ["connection"];

/** 面板接口前缀（client 用同一个常量拼请求）。 */
export const API_PREFIX = "/api/dsh-provider-pool";

const LOG_PREFIX = "[dsh-provider-pool]";

function webResponse(status, payload) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    },
  });
}

/** 兼容不同宿主的 request 形态：标准 Request / 带 body 的普通对象。 */
async function readRequestBody(request) {
  if (!request) return {};
  try {
    if (typeof request.json === "function") return (await request.json()) || {};
    if (typeof request.text === "function") {
      const text = await request.text();
      return text ? JSON.parse(text) : {};
    }
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
  const raw = request.body;
  if (raw === undefined || raw === null) return {};
  try {
    if (typeof raw === "string") return raw.trim() ? JSON.parse(raw) : {};
    if (Buffer.isBuffer(raw)) return raw.length ? JSON.parse(raw.toString("utf8")) : {};
    if (raw instanceof Uint8Array) return raw.length ? JSON.parse(Buffer.from(raw).toString("utf8")) : {};
    if (typeof raw === "object") return raw;
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
  return {};
}

function slugify(name) {
  const slug = String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return slug || "provider";
}

function uniqueId(base, providers) {
  const used = new Set(providers.map((provider) => provider.id));
  if (!used.has(base)) return base;
  let index = 2;
  while (used.has(`${base}-${index}`)) index += 1;
  return `${base}-${index}`;
}

/** 对外暴露的 provider 视图：绝不包含原始 apiKey。 */
function providerView(provider) {
  return {
    id: provider.id,
    name: provider.name,
    baseUrl: provider.baseUrl,
    model: provider.model || "",
    priority: provider.priority,
    apiKeyMasked: maskApiKey(provider.apiKey),
    hasApiKey: Boolean(provider.apiKey),
  };
}

/**
 * 创建 Provider 池服务（不依赖 Cordis，便于单测 / 复用）。
 * @param {{configPath?: string, statsPath?: string, log?: (message: string) => void}} options
 */
export function createProviderPool(options = {}) {
  const configPath = options.configPath || defaultConfigPath();
  const statsPath = options.statsPath || defaultStatsPath();
  const log = typeof options.log === "function" ? options.log : (message) => console.log(`${LOG_PREFIX} ${message}`);
  const stats = createStatsStore({ file: statsPath, log });

  let proxyState = {
    running: false,
    port: null,
    desiredPort: null,
    address: null,
    error: null,
    host: "127.0.0.1",
  };

  /** 配置每次都从磁盘读：面板保存后立刻生效，无需重启。 */
  function readPool() {
    return readConfigFile(configPath);
  }

  const proxy = createProxyServer({
    getProviders: () => readPool().config.providers,
    getTimeoutMs: () => readPool().config.timeoutMs,
    stats,
    log,
  });

  proxy.server.on("error", (error) => {
    log(`代理 server 错误：${error && error.message}`);
  });

  function proxyPayload() {
    return {
      host: "127.0.0.1",
      port: proxyState.port !== null ? proxyState.port : proxyState.desiredPort,
      desiredPort: proxyState.desiredPort,
      address: proxyState.port !== null ? `http://127.0.0.1:${proxyState.port}/v1` : null,
      running: proxyState.running,
      error: proxyState.error,
    };
  }

  function listPayload() {
    const pool = readPool();
    return {
      ok: true,
      plugin: "dsh-provider-pool",
      version: "0.1.0",
      configPath,
      statsPath,
      exists: pool.exists,
      readError: pool.readError,
      warnings: pool.warnings,
      timeoutMs: pool.config.timeoutMs,
      proxyPort: pool.config.proxyPort,
      providers: pool.config.providers.map(providerView),
      proxy: proxyPayload(),
      hint: pool.exists
        ? undefined
        : `配置文件不存在：${configPath}。可以在面板里新增 provider，或手动创建该文件（providers 数组 + proxyPort）。`,
    };
  }

  async function startProxy() {
    const pool = readPool();
    const desiredPort = pool.config.proxyPort;
    proxyState = { ...proxyState, desiredPort };
    const result = await listenWithPortFallback(proxy.server, {
      host: "127.0.0.1",
      port: desiredPort,
      maxPort: Math.max(MAX_PORT, desiredPort >= MAX_PORT ? desiredPort : MAX_PORT),
    });
    if (result.ok) {
      const address = `http://127.0.0.1:${result.port}/v1`;
      // proxyPort=0 表示「随机可用端口」（测试用），不算端口冲突。
      const portChanged = desiredPort !== 0 && result.port !== desiredPort;
      proxyState = {
        running: true,
        port: result.port,
        desiredPort,
        address,
        error: portChanged ? `端口 ${desiredPort} 被占用，已改用 ${result.port}` : null,
        host: "127.0.0.1",
      };
      log(`本地代理已启动：${address}` + (proxyState.error ? `（${proxyState.error}）` : ""));
    } else {
      proxyState = { running: false, port: null, desiredPort, address: null, error: result.error, host: "127.0.0.1" };
      log(`本地代理启动失败：${result.error}`);
    }
    return proxyState;
  }

  async function stop() {
    stats.flush();
    await closeServer(proxy.server);
    proxyState = { ...proxyState, running: false, port: null, address: null };
  }

  /** 把配置写回磁盘；apiKey 留空时保留旧 key。 */
  function upsertProvider(input) {
    const pool = readPool();
    const providers = pool.config.providers;
    const raw = input && typeof input === "object" ? input : {};
    const wantedId = String(raw.id == null ? "" : raw.id).trim();
    const existing = wantedId ? providers.find((provider) => provider.id === wantedId) : undefined;

    const name = String(raw.name == null ? (existing ? existing.name : "") : raw.name).trim();
    if (!name) return { ok: false, error: "名称不能为空" };
    const baseUrlRaw = String(raw.baseUrl == null ? (existing ? existing.baseUrl : "") : raw.baseUrl).trim();
    if (!/^https?:\/\//i.test(baseUrlRaw)) {
      return { ok: false, error: "Base URL 必须以 http:// 或 https:// 开头" };
    }
    let apiKey = typeof raw.apiKey === "string" ? raw.apiKey.trim() : "";
    if (!apiKey && existing) apiKey = existing.apiKey;
    const model = String(raw.model == null ? (existing ? existing.model : "") : raw.model).trim();
    const priorityRaw = raw.priority;
    let priority;
    if (priorityRaw === undefined || priorityRaw === null || priorityRaw === "") {
      priority = existing ? existing.priority : providers.length + 1;
    } else {
      priority = Number(priorityRaw);
      if (!Number.isFinite(priority)) return { ok: false, error: "优先级必须是数字" };
    }
    const id = existing ? existing.id : uniqueId(wantedId || slugify(name), providers);
    const nextProvider = {
      id,
      name,
      baseUrl: normalizeBaseUrl(baseUrlRaw),
      apiKey,
      model,
      priority,
    };
    const nextProviders = providers
      .filter((provider) => provider.id !== id)
      .concat(nextProvider)
      .sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id));
    saveConfigFile(configPath, { ...pool.config, providers: nextProviders });
    log(`已保存 provider「${name}」（${id}）`);
    return { ok: true, provider: providerView(nextProvider) };
  }

  function removeProvider(id) {
    const wanted = String(id || "").trim();
    if (!wanted) return { ok: false, error: "缺少 provider id" };
    const pool = readPool();
    const nextProviders = pool.config.providers.filter((provider) => provider.id !== wanted);
    if (nextProviders.length === pool.config.providers.length) {
      return { ok: false, error: `找不到 provider：${wanted}` };
    }
    saveConfigFile(configPath, { ...pool.config, providers: nextProviders });
    log(`已删除 provider：${wanted}`);
    return { ok: true, removed: wanted, providers: nextProviders.map(providerView) };
  }

  const routes = [
    {
      path: `${API_PREFIX}/list`,
      methods: ["GET"],
      handle: async () => webResponse(200, listPayload()),
    },
    {
      path: `${API_PREFIX}/proxy`,
      methods: ["GET"],
      handle: async () => {
        const pool = readPool();
        return webResponse(200, {
          ok: true,
          ...proxyPayload(),
          endpoint: proxyPayload().address,
          timeoutMs: pool.config.timeoutMs,
          configPath,
          hint:
            "在 DSH 里添加一个自定义 OpenAI 兼容 provider，Base URL 填这个地址（以 /v1 结尾），" +
            "模型名随便填（代理会按 provider 配置改写），API Key 随便填（代理会使用池里的 key）。",
        });
      },
    },
    {
      path: `${API_PREFIX}/stats`,
      methods: ["GET"],
      handle: async () => {
        const recent = stats.recent();
        return webResponse(200, {
          ok: true,
          statsPath,
          summary: stats.summary(),
          total: recent.length,
          // 新的在前，方便面板直接渲染。
          calls: recent.slice().reverse(),
        });
      },
    },
    {
      path: `${API_PREFIX}/test`,
      methods: ["POST"],
      handle: async (request) => {
        const body = await readRequestBody(request);
        const providerId = String(body.providerId || body.id || "").trim();
        const pool = readPool();
        const provider = pool.config.providers.find((item) => item.id === providerId);
        if (!provider) {
          return webResponse(404, {
            ok: false,
            error: `找不到 provider：${providerId || "(空)"}`,
            providerIds: pool.config.providers.map((item) => item.id),
          });
        }
        const result = await testProvider(provider, { timeoutMs: Math.min(15000, pool.config.timeoutMs) });
        log(`测试 provider「${provider.name}」：${result.ok ? "OK" : "FAIL"} ${result.status} ${result.ms}ms`);
        return webResponse(200, {
          ok: true,
          provider: providerView(provider),
          test: result,
        });
      },
    },
    {
      path: `${API_PREFIX}/save`,
      methods: ["POST"],
      handle: async (request) => {
        const body = await readRequestBody(request);
        const result = upsertProvider(body && typeof body.provider === "object" ? body.provider : body);
        if (!result.ok) return webResponse(400, { ok: false, error: result.error });
        return webResponse(200, {
          ok: true,
          provider: result.provider,
          providers: readPool().config.providers.map(providerView),
          proxy: proxyPayload(),
        });
      },
    },
    {
      path: `${API_PREFIX}/delete`,
      methods: ["POST"],
      handle: async (request) => {
        const body = await readRequestBody(request);
        const result = removeProvider(body.id || body.providerId);
        if (!result.ok) return webResponse(404, { ok: false, error: result.error });
        return webResponse(200, { ok: true, removed: result.removed, providers: result.providers });
      },
    },
    {
      path: `${API_PREFIX}/health`,
      methods: ["GET"],
      handle: async () => {
        const pool = readPool();
        return webResponse(200, {
          ok: true,
          plugin: "dsh-provider-pool",
          version: "0.1.0",
          providers: pool.config.providers.length,
          configExists: pool.exists,
          proxy: proxyPayload(),
          uptimeSec: Math.round(process.uptime()),
        });
      },
    },
  ];

  return {
    name,
    configPath,
    statsPath,
    stats,
    routes,
    proxyServer: proxy.server,
    start: startProxy,
    stop,
    state: () => proxyState,
    proxyPayload,
    listPayload,
    upsertProvider,
    removeProvider,
    // 便于测试 / 调试，不暴露 key。
    debugPaths: { chatCompletionsUrl, attemptProvider },
  };
}

/**
 * Cordis 插件入口。
 * @param {import("@deepseek-ai/cordis").Context} ctx
 */
export function apply(ctx) {
  const log = (message) => console.log(`${LOG_PREFIX} ${message}`);
  const pool = createProviderPool({ log });

  const disposers = [];
  const connection =
    ctx && ctx.connection ? ctx.connection : ctx && typeof ctx.get === "function" ? ctx.get("connection") : undefined;

  if (connection && connection.fetch && typeof connection.fetch.register === "function") {
    for (const route of pool.routes) {
      try {
        // DSH 的 connection 桥接要求显式声明 requestBody：官方所有 GET/POST 路由
        // 都传 "buffered"。不传会被当成 streaming，GET 请求构造带 body 的 Request
        // 会直接抛 TypeError，POST 也会多出一堆半流边界问题。
        const dispose = connection.fetch.register({
          path: route.path,
          methods: route.methods,
          requestBody: "buffered",
          fetch: (request) => route.handle(request),
        });
        if (typeof dispose === "function") disposers.push(dispose);
      } catch (error) {
        log(`注册路由失败 ${route.path}：${error && error.message}`);
      }
    }
    log(`已注册 ${pool.routes.length} 条面板 API 路由（${API_PREFIX}）`);
  } else {
    log("当前宿主没有 connection.fetch 服务：面板 API 不可用，但本地代理仍会启动");
  }

  // 先返回路由，再异步启动代理：端口被占用时最多重试到 3130。
  pool.start().catch((error) => log(`启动代理异常：${error && error.message}`));

  const cleanup = () => {
    for (const dispose of disposers) {
      try {
        dispose();
      } catch {
        /* ignore */
      }
    }
    pool.stop().catch(() => {});
  };
  if (ctx && typeof ctx.effect === "function") {
    try {
      ctx.effect(() => cleanup);
    } catch {
      if (typeof ctx.on === "function") ctx.on("dispose", cleanup);
    }
  } else if (ctx && typeof ctx.on === "function") {
    ctx.on("dispose", cleanup);
  }

  return pool;
}

// 供测试 / 二次封装使用的内部导出（不含任何 key）。
export {
  attemptProvider,
  chatCompletionsUrl,
  createProxyServer,
  createStatsStore,
  listenWithPortFallback,
  maskApiKey,
  readConfigFile,
  saveConfigFile,
  testProvider,
  DEFAULT_PORT,
  DEFAULT_TIMEOUT_MS,
  MAX_PORT,
};
