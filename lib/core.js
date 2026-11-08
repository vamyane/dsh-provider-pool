/**
 * dsh-provider-pool 宿主核心（可独立测试，不依赖 Cordis）。
 *
 * 这一层只做四件事：
 *   1. 读 / 写 ~/.dsh/provider-pool.json（provider 列表 + proxyPort）；
 *   2. 用一个本地 HTTP server 对外提供 OpenAI 兼容代理：
 *        POST /v1/chat/completions  按 priority 依次尝试，失败自动切换
 *        GET  /v1/models            聚合各 provider 的模型列表（失败忽略）
 *        GET  /health               代理自身健康检查
 *   3. 每次调用记录 {time, providerId, model, ms, status, fallback}，
 *      内存最近 200 条 + 持久化到 ~/.dsh/provider-pool-stats.json；
 *   4. apiKey 只在宿主侧使用：stats / 响应 / 错误信息里一律不出现完整 key。
 *
 * 设计约束：
 *   - 非流式：状态码 401/402/403/429/5xx、连接失败、超时 → 换下一个 provider；
 *     其他 4xx 视为「服务端明确拒绝」，原样回给客户端，不切换（避免掩盖参数错误）。
 *   - 流式：只在「收到上游响应头（首字节）之前」失败时切换；一旦开始向客户端写
 *     body，就不再切换（客户端已经拿到半截 SSE，换源会串内容）。
 *   - 超时默认 20s，指「等上游响应头」的时间；流式提交后不再计时。
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import https from "node:https";

export const DEFAULT_PORT = 3121;
export const MAX_PORT = 3130;
export const DEFAULT_TIMEOUT_MS = 20000;
export const STATS_LIMIT = 200;
export const USER_AGENT = "dsh-provider-pool/0.1.0";
export const FALLBACK_STATUSES = Object.freeze([401, 402, 403, 429]);
const MAX_JSON_BODY = 16 * 1024 * 1024;
const MAX_UPSTREAM_BODY = 32 * 1024 * 1024;

/* ------------------------------------------------------------------ */
/* 路径                                                                */
/* ------------------------------------------------------------------ */

export function dshHome() {
  return process.env.DSH_HOME || path.join(os.homedir(), ".dsh");
}

export function defaultConfigPath() {
  return path.join(dshHome(), "provider-pool.json");
}

export function defaultStatsPath() {
  return path.join(dshHome(), "provider-pool-stats.json");
}

/* ------------------------------------------------------------------ */
/* key 脱敏：任何离开宿主的东西都走这里                                  */
/* ------------------------------------------------------------------ */

/** 前端只允许看到尾 4 位。 */
export function maskApiKey(key) {
  const value = typeof key === "string" ? key.trim() : "";
  if (!value) return "";
  if (value.length <= 4) return "••••";
  return "••••" + value.slice(-4);
}

/** 把文本里意外出现的原始 key 换成脱敏形式（错误信息兜底）。 */
export function sanitizeSecretText(text, secrets) {
  let out = String(text == null ? "" : text);
  for (const secret of secrets || []) {
    const value = typeof secret === "string" ? secret.trim() : "";
    if (value.length >= 6 && out.includes(value)) out = out.split(value).join(maskApiKey(value));
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* 配置                                                                */
/* ------------------------------------------------------------------ */

export function normalizeBaseUrl(baseUrl) {
  const value = String(baseUrl || "").trim();
  if (!value) return "";
  return value.replace(/\/+$/, "");
}

/** 上游 chat completions 地址：baseUrl 已带 /v1 时直接拼 /chat/completions。 */
export function chatCompletionsUrl(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error("baseUrl 为空");
  return /\/v1$/i.test(base) ? `${base}/chat/completions` : `${base}/v1/chat/completions`;
}

/** 上游 models 地址：与 chatCompletionsUrl 同一套规则。 */
export function modelsUrl(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) throw new Error("baseUrl 为空");
  return /\/v1$/i.test(base) ? `${base}/models` : `${base}/v1/models`;
}

function toPort(value, fallback = DEFAULT_PORT) {
  const port = Number(value);
  if (!Number.isInteger(port) || port < 0 || port > 65535) return fallback;
  return port;
}

function toTimeout(value, fallback = DEFAULT_TIMEOUT_MS) {
  const timeout = Number(value);
  if (!Number.isFinite(timeout) || timeout < 1000) return fallback;
  return Math.min(Math.round(timeout), 120000);
}

/**
 * 把磁盘上的原始 JSON 归一化成稳定的内部结构。
 * 坏条目只跳过并记 warning，不让整个插件挂掉。
 */
export function normalizeConfig(raw) {
  const warnings = [];
  const source = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  if (raw !== undefined && raw !== null && (typeof raw !== "object" || Array.isArray(raw))) {
    warnings.push("配置文件顶层必须是对象");
  }
  const rawProviders = source.providers;
  if (rawProviders !== undefined && !Array.isArray(rawProviders)) {
    warnings.push("providers 字段不是数组，已忽略");
  }
  const list = Array.isArray(rawProviders) ? rawProviders : [];
  const seen = new Set();
  const providers = [];
  list.forEach((item, index) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      warnings.push(`providers[${index}] 不是对象，已忽略`);
      return;
    }
    const id = String(item.id == null ? "" : item.id).trim() || `provider-${index + 1}`;
    const name = String(item.name == null ? "" : item.name).trim() || id;
    const baseUrl = normalizeBaseUrl(item.baseUrl);
    if (!/^https?:\/\//i.test(baseUrl)) {
      warnings.push(`provider「${name}」的 baseUrl 必须是 http(s) 地址，已忽略`);
      return;
    }
    if (seen.has(id)) {
      warnings.push(`provider id 重复：${id}，已忽略后出现的那个`);
      return;
    }
    seen.add(id);
    const priorityRaw = Number(item.priority);
    const priority = Number.isFinite(priorityRaw) ? priorityRaw : index + 1;
    providers.push({
      id,
      name,
      baseUrl,
      apiKey: typeof item.apiKey === "string" ? item.apiKey.trim() : "",
      model: String(item.model == null ? "" : item.model).trim(),
      priority,
    });
  });
  providers.sort((a, b) => (a.priority - b.priority) || a.id.localeCompare(b.id));
  return {
    config: {
      proxyPort: toPort(source.proxyPort, DEFAULT_PORT),
      timeoutMs: toTimeout(source.timeoutMs, DEFAULT_TIMEOUT_MS),
      providers,
    },
    warnings,
  };
}

/**
 * 读配置文件，永不抛异常。
 * @returns {{config: object, exists: boolean, path: string, warnings: string[], readError: string|null}}
 */
export function readConfigFile(file) {
  const target = file || defaultConfigPath();
  let text;
  try {
    text = fs.readFileSync(target, "utf8");
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return { config: normalizeConfig({}).config, exists: false, path: target, warnings: [], readError: null };
    }
    return {
      config: normalizeConfig({}).config,
      exists: true,
      path: target,
      warnings: [],
      readError: `读取配置文件失败：${sanitizeSecretText(error && error.message, [])}`,
    };
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    return {
      config: normalizeConfig({}).config,
      exists: true,
      path: target,
      warnings: [],
      readError: `配置文件不是合法 JSON：${error.message}`,
    };
  }
  const normalized = normalizeConfig(raw);
  return { config: normalized.config, exists: true, path: target, warnings: normalized.warnings, readError: null };
}

/** 原子写配置（tmp + rename），POSIX 上顺手 chmod 600。 */
export function saveConfigFile(file, config) {
  const target = file || defaultConfigPath();
  const payload = {
    proxyPort: toPort(config.proxyPort, DEFAULT_PORT),
    timeoutMs: toTimeout(config.timeoutMs, DEFAULT_TIMEOUT_MS),
    providers: (config.providers || []).map((provider) => ({
      id: provider.id,
      name: provider.name,
      baseUrl: normalizeBaseUrl(provider.baseUrl),
      apiKey: typeof provider.apiKey === "string" ? provider.apiKey : "",
      model: provider.model || "",
      priority: Number(provider.priority) || 1,
    })),
  };
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmp = `${target}.tmp-${process.pid}-${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(payload, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  fs.renameSync(tmp, target);
  try {
    fs.chmodSync(target, 0o600);
  } catch {
    /* Windows 上 chmod 可能不支持 600，忽略 */
  }
  return payload;
}

/* ------------------------------------------------------------------ */
/* 调用统计（内存 200 条 + 持久化）                                      */
/* ------------------------------------------------------------------ */

/**
 * @param {{file?: string, limit?: number, log?: (message: string) => void}} options
 */
export function createStatsStore(options = {}) {
  const file = options.file || defaultStatsPath();
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : STATS_LIMIT;
  const log = typeof options.log === "function" ? options.log : () => {};
  let calls = [];
  let dirty = false;
  let timer = null;

  try {
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
      const stored = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.calls) ? parsed.calls : [];
      calls = stored.filter((item) => item && typeof item === "object").slice(-limit);
    }
  } catch (error) {
    log(`读取历史统计失败（忽略）：${error && error.message}`);
  }

  function persist() {
    try {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      const payload = JSON.stringify({ version: 1, updatedAt: new Date().toISOString(), calls }, null, 2);
      fs.writeFileSync(file, payload + "\n", "utf8");
    } catch (error) {
      log(`写入统计失败（忽略）：${error && error.message}`);
    }
  }

  function schedule() {
    dirty = true;
    if (timer) return;
    timer = setTimeout(() => {
      timer = null;
      if (!dirty) return;
      dirty = false;
      persist();
    }, 250);
    if (typeof timer.unref === "function") timer.unref();
  }

  return {
    /** 记录一次尝试。record 里不允许出现 apiKey。 */
    add(record) {
      calls.push({
        time: record.time || new Date().toISOString(),
        providerId: String(record.providerId || ""),
        model: String(record.model || ""),
        ms: Math.max(0, Math.round(Number(record.ms) || 0)),
        status: Math.round(Number(record.status) || 0),
        fallback: Boolean(record.fallback),
        stream: Boolean(record.stream),
        error: record.error ? String(record.error).slice(0, 300) : undefined,
      });
      if (calls.length > limit) calls = calls.slice(-limit);
      schedule();
    },
    /** 时间顺序（旧 → 新）。 */
    recent() {
      return calls.slice();
    },
    summary() {
      const byProvider = new Map();
      let failures = 0;
      let totalMs = 0;
      for (const call of calls) {
        const failed = call.status === 0 || call.status >= 400;
        if (failed) failures += 1;
        totalMs += call.ms;
        const key = call.providerId || "(unknown)";
        const current = byProvider.get(key) || { providerId: key, calls: 0, failures: 0, totalMs: 0 };
        current.calls += 1;
        if (failed) current.failures += 1;
        current.totalMs += call.ms;
        byProvider.set(key, current);
      }
      return {
        total: calls.length,
        failures,
        avgMs: calls.length ? Math.round(totalMs / calls.length) : 0,
        persistedCalls: limit,
        byProvider: Array.from(byProvider.values()).map((item) => ({
          providerId: item.providerId,
          calls: item.calls,
          failures: item.failures,
          avgMs: item.calls ? Math.round(item.totalMs / item.calls) : 0,
        })),
      };
    },
    flush() {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (!dirty) return;
      dirty = false;
      persist();
    },
    file,
  };
}

/* ------------------------------------------------------------------ */
/* 上游请求                                                            */
/* ------------------------------------------------------------------ */

export function isFallbackStatus(status) {
  const code = Math.round(Number(status) || 0);
  if (FALLBACK_STATUSES.includes(code)) return true;
  return code >= 500 && code <= 599;
}

function readJsonBody(request) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    request.on("data", (chunk) => {
      size += chunk.length;
      if (size > MAX_JSON_BODY) {
        reject(new Error("请求体过大"));
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on("end", () => {
      if (!chunks.length) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new Error("请求体不是合法 JSON"));
      }
    });
    request.on("error", reject);
  });
}

function drain(response) {
  try {
    response.resume();
  } catch {
    /* ignore */
  }
}

function outgoingBody(body, provider, stream) {
  const outgoing = { ...body };
  if (provider.model) outgoing.model = provider.model;
  if (stream) outgoing.stream = true;
  else outgoing.stream = false;
  return outgoing;
}

/**
 * 尝试一个 provider。
 * 返回（永不 reject）：
 *   {kind:"response", status, headers, body:Buffer}   非流式成功/非切换类状态
 *   {kind:"stream",   status, headers, response}      流式，响应头已到，可以开始 pipe
 *   {kind:"fallback", status, headers}                需要换下一个 provider
 *   {kind:"error",    error}                          网络错误 / 超时 / 非法 baseUrl
 */
export function attemptProvider(provider, body, options = {}) {
  const stream = Boolean(options.stream);
  const timeoutMs = Number(options.timeoutMs) || DEFAULT_TIMEOUT_MS;
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(chatCompletionsUrl(provider.baseUrl));
    } catch (error) {
      resolve({ kind: "error", error: `baseUrl 不是合法地址：${error.message}` });
      return;
    }
    const transport = url.protocol === "https:" ? https : http;
    const payload = Buffer.from(JSON.stringify(outgoingBody(body || {}, provider, stream)), "utf8");
    const headers = {
      "content-type": "application/json",
      "content-length": payload.length,
      accept: stream ? "text/event-stream" : "application/json",
      "user-agent": USER_AGENT,
    };
    if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;

    let settled = false;
    let timer = null;
    const finish = (value) => {
      if (settled) return;
      settled = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      resolve(value);
    };

    let request;
    try {
      request = transport.request(url, { method: "POST", headers }, (response) => {
        const status = response.statusCode || 0;
        if (isFallbackStatus(status)) {
          drain(response);
          finish({ kind: "fallback", status, headers: response.headers });
          return;
        }
        if (stream) {
          // 首字节已到：从这里开始提交给客户端，不再切换 provider。
          finish({ kind: "stream", status, headers: response.headers, response });
          return;
        }
        const chunks = [];
        let total = 0;
        response.on("data", (chunk) => {
          total += chunk.length;
          if (total > MAX_UPSTREAM_BODY) {
            response.destroy(new Error("上游响应体过大"));
            return;
          }
          chunks.push(chunk);
        });
        response.on("end", () =>
          finish({ kind: "response", status, headers: response.headers, body: Buffer.concat(chunks) })
        );
        response.on("error", (error) =>
          finish({ kind: "error", error: `读取上游响应失败：${error.message}` })
        );
      });
    } catch (error) {
      finish({ kind: "error", error: `创建上游请求失败：${error.message}` });
      return;
    }

    timer = setTimeout(() => {
      try {
        request.destroy(new Error("timeout"));
      } catch {
        /* ignore */
      }
      finish({ kind: "error", error: `请求超时（${timeoutMs}ms）` });
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();

    request.on("error", (error) => {
      const message = error && error.code === "ECONNREFUSED" ? "连接被拒绝" : String(error && error.message);
      finish({ kind: "error", error: message });
    });
    request.end(payload);
  });
}

/** 一个最小的 /v1/models 拉取。失败返回空数组，不抛。 */
export async function fetchProviderModels(provider, options = {}) {
  const timeoutMs = Number(options.timeoutMs) || 8000;
  return new Promise((resolve) => {
    let url;
    try {
      url = new URL(modelsUrl(provider.baseUrl));
    } catch {
      resolve([]);
      return;
    }
    const transport = url.protocol === "https:" ? https : http;
    const headers = { accept: "application/json", "user-agent": USER_AGENT };
    if (provider.apiKey) headers.authorization = `Bearer ${provider.apiKey}`;
    let settled = false;
    const finish = (models) => {
      if (settled) return;
      settled = true;
      resolve(models);
    };
    let timer = null;
    let request;
    try {
      request = transport.request(url, { method: "GET", headers }, (response) => {
        if ((response.statusCode || 0) >= 400) {
          drain(response);
          finish([]);
          return;
        }
        const chunks = [];
        response.on("data", (chunk) => chunks.push(chunk));
        response.on("end", () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString("utf8"));
            const data = Array.isArray(parsed) ? parsed : Array.isArray(parsed && parsed.data) ? parsed.data : [];
            finish(data.filter((item) => item && typeof item.id === "string" && item.id));
          } catch {
            finish([]);
          }
        });
        response.on("error", () => finish([]));
      });
    } catch {
      finish([]);
      return;
    }
    timer = setTimeout(() => {
      try {
        request.destroy();
      } catch {
        /* ignore */
      }
      finish([]);
    }, timeoutMs);
    if (typeof timer.unref === "function") timer.unref();
    const clear = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
    };
    request.on("response", clear);
    request.on("error", () => {
      clear();
      finish([]);
    });
    request.end();
  });
}

/** 测连通性：发一个最小 chat 请求，返回 {ok,status,ms,model,error}（不含 key）。 */
export async function testProvider(provider, options = {}) {
  const timeoutMs = Math.max(5000, Number(options.timeoutMs) || 15000);
  const started = Date.now();
  const attempt = await attemptProvider(
    provider,
    {
      model: provider.model || "provider-pool-test",
      messages: [{ role: "user", content: "ping" }],
      max_tokens: 1,
      stream: false,
    },
    { stream: false, timeoutMs }
  );
  const ms = Date.now() - started;
  if (attempt.kind === "error") {
    return {
      ok: false,
      status: 0,
      ms,
      model: provider.model || "",
      error: sanitizeSecretText(attempt.error, [provider.apiKey]),
    };
  }
  const ok = attempt.status >= 200 && attempt.status < 300;
  let detail = "";
  if (!ok) {
    const text = attempt.body ? attempt.body.toString("utf8") : "";
    try {
      const parsed = JSON.parse(text);
      detail = (parsed && parsed.error && (parsed.error.message || parsed.error)) || parsed.message || "";
    } catch {
      detail = text.slice(0, 200);
    }
    detail = sanitizeSecretText(detail, [provider.apiKey]);
  }
  return {
    ok,
    status: attempt.status,
    ms,
    model: provider.model || "",
    error: ok ? undefined : detail || `上游返回 HTTP ${attempt.status}`,
  };
}

/* ------------------------------------------------------------------ */
/* 本地代理 server                                                     */
/* ------------------------------------------------------------------ */

function clientHeaders(upstreamHeaders, bodyLength, stream) {
  const headers = {
    "cache-control": "no-store",
    "content-type": (upstreamHeaders && upstreamHeaders["content-type"]) ||
      (stream ? "text/event-stream; charset=utf-8" : "application/json; charset=utf-8"),
  };
  if (!stream && Number.isFinite(bodyLength)) headers["content-length"] = String(bodyLength);
  return headers;
}

function sendJson(response, status, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  response.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": body.length,
    "cache-control": "no-store",
    "access-control-allow-origin": "*",
  });
  response.end(body);
}

function publicAttemptError(attempt) {
  return {
    providerId: attempt.providerId,
    status: attempt.status,
    ms: attempt.ms,
    ...(attempt.error ? { error: sanitizeSecretText(attempt.error, attempt.secrets) } : {}),
  };
}

/**
 * 创建代理 server（还没 listen）。
 * @param {{
 *   getProviders: () => Array<object>,
 *   getTimeoutMs?: () => number,
 *   stats: ReturnType<typeof createStatsStore>,
 *   log?: (message: string) => void,
 * }} options
 */
export function createProxyServer(options) {
  const getProviders = options.getProviders;
  const getTimeoutMs = typeof options.getTimeoutMs === "function" ? options.getTimeoutMs : () => DEFAULT_TIMEOUT_MS;
  const stats = options.stats;
  const log = typeof options.log === "function" ? options.log : () => {};

  async function handleChat(request, response) {
    let body;
    try {
      body = await readJsonBody(request);
    } catch (error) {
      sendJson(response, 400, { error: { message: error.message, type: "invalid_request" } });
      return;
    }
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      sendJson(response, 400, { error: { message: "请求体必须是 JSON 对象", type: "invalid_request" } });
      return;
    }
    const providers = getProviders() || [];
    if (!providers.length) {
      sendJson(response, 503, {
        error: {
          message:
            "Provider 池是空的：请在 DSH 的 Provider 池面板里添加 provider，" +
            "或编辑 ~/.dsh/provider-pool.json（providers 数组 + proxyPort）。",
          type: "provider_pool_empty",
        },
      });
      return;
    }
    const stream = body.stream === true;
    const timeoutMs = Number(getTimeoutMs()) || DEFAULT_TIMEOUT_MS;
    const failures = [];

    for (let index = 0; index < providers.length; index += 1) {
      const provider = providers[index];
      const started = Date.now();
      const attempt = await attemptProvider(provider, body, { stream, timeoutMs });
      const ms = Date.now() - started;
      const model = provider.model || (typeof body.model === "string" ? body.model : "");
      const baseRecord = {
        time: new Date().toISOString(),
        providerId: provider.id,
        model,
        ms,
        fallback: index > 0,
        stream,
      };

      if (attempt.kind === "fallback") {
        stats.add({ ...baseRecord, status: attempt.status, error: `HTTP ${attempt.status}，已切换下一个` });
        failures.push(publicAttemptError({ providerId: provider.id, status: attempt.status, ms }));
        log(`[${provider.id}] HTTP ${attempt.status} → 切换下一个 provider`);
        continue;
      }
      if (attempt.kind === "error") {
        const safeError = sanitizeSecretText(attempt.error, [provider.apiKey]);
        stats.add({ ...baseRecord, status: 0, error: safeError });
        failures.push(publicAttemptError({ providerId: provider.id, status: 0, ms, error: safeError }));
        log(`[${provider.id}] 请求失败（${safeError}）→ 切换下一个 provider`);
        continue;
      }

      stats.add({ ...baseRecord, status: attempt.status });

      if (attempt.kind === "stream") {
        response.writeHead(attempt.status, clientHeaders(attempt.headers, NaN, true));
        attempt.response.pipe(response);
        attempt.response.on("error", () => {
          try {
            response.destroy();
          } catch {
            /* ignore */
          }
        });
        response.on("close", () => {
          try {
            attempt.response.destroy();
          } catch {
            /* ignore */
          }
        });
        return;
      }

      response.writeHead(attempt.status, clientHeaders(attempt.headers, attempt.body ? attempt.body.length : 0, false));
      response.end(attempt.body && attempt.body.length ? attempt.body : Buffer.from(""));
      return;
    }

    sendJson(response, 502, {
      error: {
        message: `所有 provider 都失败（共 ${providers.length} 个），已按优先级依次尝试`,
        type: "provider_pool_exhausted",
        attempts: failures,
      },
    });
  }

  async function handleModels(response) {
    const providers = getProviders() || [];
    if (!providers.length) {
      sendJson(response, 200, { object: "list", data: [], hint: "Provider 池是空的" });
      return;
    }
    const lists = await Promise.all(
      providers.map((provider) => fetchProviderModels(provider, { timeoutMs: Math.min(8000, Number(getTimeoutMs()) || 8000) }))
    );
    const seen = new Set();
    const data = [];
    lists.forEach((models, index) => {
      const provider = providers[index];
      for (const model of models) {
        if (seen.has(model.id)) continue;
        seen.add(model.id);
        data.push({ id: model.id, object: "model", owned_by: provider.id });
      }
    });
    sendJson(response, 200, { object: "list", data });
  }

  const server = http.createServer((request, response) => {
    let pathname = "/";
    try {
      pathname = new URL(request.url || "/", "http://127.0.0.1").pathname;
    } catch {
      pathname = "/";
    }
    if (pathname === "/v1/chat/completions") {
      if (request.method !== "POST") {
        sendJson(response, 405, { error: { message: "只接受 POST", type: "method_not_allowed" } });
        return;
      }
      handleChat(request, response).catch((error) => {
        log(`代理内部错误：${error && error.message}`);
        if (!response.headersSent) {
          sendJson(response, 500, { error: { message: `代理内部错误：${error.message}`, type: "proxy_error" } });
        } else {
          try {
            response.destroy();
          } catch {
            /* ignore */
          }
        }
      });
      return;
    }
    if (pathname === "/v1/models" || pathname === "/models") {
      handleModels(response).catch(() => {
        sendJson(response, 200, { object: "list", data: [] });
      });
      return;
    }
    if (pathname === "/health" || pathname === "/v1/health") {
      sendJson(response, 200, {
        ok: true,
        service: "dsh-provider-pool",
        version: "0.1.0",
        providers: (getProviders() || []).length,
        uptimeSec: Math.round(process.uptime()),
      });
      return;
    }
    if (pathname === "/" || pathname === "/v1") {
      sendJson(response, 200, {
        ok: true,
        service: "dsh-provider-pool",
        endpoints: ["POST /v1/chat/completions", "GET /v1/models", "GET /health"],
      });
      return;
    }
    sendJson(response, 404, { error: { message: `未知路径：${pathname}`, type: "not_found" } });
  });

  return { server, handleChat };
}

/**
 * 监听端口；EADDRINUSE 时向后自动尝试，最多到 maxPort（默认 3130）。
 * port === 0 时只尝试一次（测试用随机端口）。
 */
export function listenWithPortFallback(server, options = {}) {
  const host = options.host || "127.0.0.1";
  const startPort = Number.isInteger(options.port) ? options.port : DEFAULT_PORT;
  const maxPort = Number.isInteger(options.maxPort) ? options.maxPort : MAX_PORT;
  return new Promise((resolve) => {
    const attempt = (port, lastCandidate) => {
      const onError = (error) => {
        server.removeListener("listening", onListening);
        if (error && error.code === "EADDRINUSE" && lastCandidate === false && port < maxPort) {
          attempt(port + 1, port + 1 >= maxPort);
          return;
        }
        resolve({
          ok: false,
          port: null,
          error:
            error && error.code === "EADDRINUSE"
              ? `端口 ${tryPortDescription(startPort, port, maxPort)} 都被占用`
              : `端口 ${port} 监听失败：${error.code || error.message}`,
        });
      };
      const onListening = () => {
        server.removeListener("error", onError);
        const address = server.address();
        resolve({ ok: true, port: address && typeof address === "object" ? address.port : port });
      };
      server.once("error", onError);
      server.once("listening", onListening);
      try {
        server.listen(port, host);
      } catch (error) {
        server.removeListener("listening", onListening);
        server.removeListener("error", onError);
        resolve({ ok: false, port: null, error: `端口 ${port} 监听失败：${error.message}` });
      }
    };
    if (startPort === 0) {
      attempt(0, true);
      return;
    }
    attempt(startPort, startPort >= maxPort);
  });
}

function tryPortDescription(startPort, lastPort, maxPort) {
  const end = Math.min(maxPort, lastPort);
  if (startPort === end) return String(startPort);
  return `${startPort}-${end}`;
}

/** 关闭 server（含 keep-alive 连接），不抛异常。 */
export function closeServer(server) {
  return new Promise((resolve) => {
    if (!server) {
      resolve();
      return;
    }
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
