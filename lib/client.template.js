/**
 * dsh-provider-pool 浏览器半边（模板）。
 * build.mjs 会把 app/panel.js gzip+base64 塞进 __PANEL_GZIP_B64__ 占位符，
 * 然后替换占位符生成 lib/client.js。
 *
 * 页面上下文里做两件事：
 *   - sidebar.footer.action：左侧栏底部的「🔀 Provider 池」按钮；
 *   - shell.overlay：点开后盖住整页的全屏面板。面板是 React 直接渲染（不是 iframe），
 *     代码在打开时才解压执行，避免 DSH 首屏加载负担。
 *
 * 面板数据全部走同源相对路径 /api/dsh-provider-pool/*（宿主 lib/index.js 注册），
 * 天然带登录态；apiKey 永远不会下发到浏览器，前端只拿到尾 4 位。
 */
window.__ModuleLoader__.load({
  id: "dsh-provider-pool",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    var react = require("react");

    var PANEL_GZIP_B64 = __PANEL_GZIP_B64__;

    var NS = "dsh-provider-pool";
    var MESSAGES = {
      zh: {
        "app.name": "Provider 池",
        "toggle.title": "模型 Provider 池 · 本地代理与自动 fallback",
        "panel.title": "🔀 Provider 池 · 本地代理与自动 fallback",
        "panel.subtitle": "OpenAI 兼容本地代理 · 按优先级自动切换 provider",
        "panel.refresh": "刷新",
        "panel.close": "关闭",
        "panel.loading": "正在加载面板…",
        "panel.loadFailed": "面板加载失败",
        "panel.note": "代理只监听 127.0.0.1；API Key 只保存在宿主侧，前端只显示尾 4 位。修改配置后无需重启 DSH。",
        "panel.loadError": "面板数据加载失败",
        "proxy.title": "代理地址",
        "proxy.running": "运行中",
        "proxy.notRunning": "未启动",
        "proxy.copy": "复制地址",
        "proxy.copied": "代理地址已复制",
        "proxy.copyFailed": "复制失败，请手动复制：",
        "proxy.hint": "在 DSH 的模型设置里添加一个自定义 OpenAI 兼容 provider，Base URL 填上面这个地址（保留 /v1），模型名和 API Key 随便填——请求会按 provider 池的优先级转发，并自动使用池里的真实 key。",
        "proxy.port": "端口",
        "proxy.configPath": "配置文件",
        "providers.title": "Provider 列表",
        "providers.add": "新增 Provider",
        "providers.empty": "还没有配置 provider。",
        "providers.emptyExample": "{\n  \"proxyPort\": 3121,\n  \"providers\": [\n    {\n      \"id\": \"deepseek\",\n      \"name\": \"DeepSeek\",\n      \"baseUrl\": \"https://api.deepseek.com\",\n      \"apiKey\": \"sk-...\",\n      \"model\": \"deepseek-chat\",\n      \"priority\": 1\n    }\n  ]\n}",
        "providers.test": "测试",
        "providers.testing": "测试中…",
        "providers.edit": "编辑",
        "providers.delete": "删除",
        "providers.save": "保存",
        "providers.saving": "保存中…",
        "providers.cancel": "取消",
        "providers.confirmDelete": "确认删除这个 provider？",
        "providers.saved": "已保存：",
        "providers.deleted": "已删除：",
        "providers.addTitle": "新增 Provider",
        "providers.editTitle": "编辑 Provider",
        "providers.colName": "名称",
        "providers.colModel": "模型 / 地址",
        "providers.colKey": "Key",
        "providers.colStatus": "状态",
        "providers.colPriority": "优先级",
        "providers.colActions": "操作",
        "providers.statusUnknown": "未测试",
        "providers.statusOk": "正常",
        "providers.statusFail": "失败",
        "providers.statusOkDetail": "测试通过",
        "providers.noKey": "未设置 key",
        "field.name": "名称",
        "field.namePlaceholder": "例如 DeepSeek 官方",
        "field.baseUrl": "Base URL",
        "field.baseUrlPlaceholder": "https://api.deepseek.com（可带 /v1）",
        "field.model": "模型",
        "field.modelPlaceholder": "deepseek-chat（留空沿用请求里的模型）",
        "field.priority": "优先级",
        "field.priorityHint": "数字越小越先尝试",
        "field.apiKey": "API Key",
        "field.apiKeyHint": "Key 只在宿主侧使用；编辑时留空表示保留原 key。",
        "field.apiKeyPlaceholder": "sk-…（编辑时留空 = 不修改）",
        "form.required": "名称不能为空",
        "form.badUrl": "Base URL 必须以 http:// 或 https:// 开头",
        "form.priorityNumber": "优先级必须是数字",
        "stats.title": "最近调用",
        "stats.summary": "调用",
        "stats.failures": "失败",
        "stats.avg": "平均",
        "stats.empty": "还没有调用记录。把 DSH 的模型指向本地代理后，这里会显示每次调用与自动切换。",
        "stats.time": "时间",
        "stats.provider": "Provider",
        "stats.model": "模型",
        "stats.ms": "耗时",
        "stats.status": "状态",
        "stats.fallback": "来源",
        "stats.firstChoice": "首选",
        "stats.switched": "切换",
      },
      en: {
        "app.name": "Provider Pool",
        "toggle.title": "Model provider pool · local proxy with automatic fallback",
        "panel.title": "🔀 Provider Pool · Local proxy with automatic fallback",
        "panel.subtitle": "OpenAI-compatible local proxy · tries providers by priority",
        "panel.refresh": "Refresh",
        "panel.close": "Close",
        "panel.loading": "Loading panel…",
        "panel.loadFailed": "Failed to load panel",
        "panel.note": "The proxy only listens on 127.0.0.1. API keys stay on the host; the UI only shows the last 4 characters. Config changes apply without restarting DSH.",
        "panel.loadError": "Failed to load panel data",
        "proxy.title": "Proxy endpoint",
        "proxy.running": "running",
        "proxy.notRunning": "not running",
        "proxy.copy": "Copy address",
        "proxy.copied": "Proxy address copied",
        "proxy.copyFailed": "Copy failed, copy manually:",
        "proxy.hint": "In DSH settings add a custom OpenAI-compatible provider and put this address in Base URL (keep /v1). The model name and API key can be anything: requests are routed through the pool by priority and use the real keys from the pool.",
        "proxy.port": "port",
        "proxy.configPath": "Config file",
        "providers.title": "Providers",
        "providers.add": "Add provider",
        "providers.empty": "No providers configured yet.",
        "providers.emptyExample": "{\n  \"proxyPort\": 3121,\n  \"providers\": [\n    {\n      \"id\": \"deepseek\",\n      \"name\": \"DeepSeek\",\n      \"baseUrl\": \"https://api.deepseek.com\",\n      \"apiKey\": \"sk-...\",\n      \"model\": \"deepseek-chat\",\n      \"priority\": 1\n    }\n  ]\n}",
        "providers.test": "Test",
        "providers.testing": "Testing…",
        "providers.edit": "Edit",
        "providers.delete": "Delete",
        "providers.save": "Save",
        "providers.saving": "Saving…",
        "providers.cancel": "Cancel",
        "providers.confirmDelete": "Delete this provider?",
        "providers.saved": "Saved:",
        "providers.deleted": "Deleted:",
        "providers.addTitle": "Add provider",
        "providers.editTitle": "Edit provider",
        "providers.colName": "Name",
        "providers.colModel": "Model / URL",
        "providers.colKey": "Key",
        "providers.colStatus": "Status",
        "providers.colPriority": "Priority",
        "providers.colActions": "Actions",
        "providers.statusUnknown": "untested",
        "providers.statusOk": "ok",
        "providers.statusFail": "failed",
        "providers.statusOkDetail": "Test passed",
        "providers.noKey": "no key",
        "field.name": "Name",
        "field.namePlaceholder": "e.g. DeepSeek official",
        "field.baseUrl": "Base URL",
        "field.baseUrlPlaceholder": "https://api.deepseek.com (or with /v1)",
        "field.model": "Model",
        "field.modelPlaceholder": "deepseek-chat (empty = keep request model)",
        "field.priority": "Priority",
        "field.priorityHint": "lower number = tried first",
        "field.apiKey": "API Key",
        "field.apiKeyHint": "The key is only used on the host; leave empty while editing to keep the current key.",
        "field.apiKeyPlaceholder": "sk-… (empty = unchanged)",
        "form.required": "Name is required",
        "form.badUrl": "Base URL must start with http:// or https://",
        "form.priorityNumber": "Priority must be a number",
        "stats.title": "Recent calls",
        "stats.summary": "calls",
        "stats.failures": "failed",
        "stats.avg": "avg",
        "stats.empty": "No calls yet. Point a DSH model at the local proxy and calls (plus fallbacks) will show up here.",
        "stats.time": "Time",
        "stats.provider": "Provider",
        "stats.model": "Model",
        "stats.ms": "ms",
        "stats.status": "Status",
        "stats.fallback": "Source",
        "stats.firstChoice": "first",
        "stats.switched": "fallback",
      },
    };

    function translateFactory(locale) {
      function fallback(key) {
        return MESSAGES.zh[key] !== undefined ? MESSAGES.zh[key] : key;
      }
      if (locale !== undefined && locale !== null && typeof locale.bind === "function") {
        try {
          var bound = locale.bind(NS);
          return function (key) {
            // 字典还没注册 / 该语言缺 key 时回退到内置中文，避免把 key 直接显示出来。
            var value = bound(key);
            if (value === undefined || value === null || value === key) return fallback(key);
            return value;
          };
        } catch (error) {
          /* fallback below */
        }
      }
      return fallback;
    }

    function decodeGzip(b64) {
      return new Promise(function (resolve, reject) {
        try {
          var bin = atob(b64);
          var bytes = new Uint8Array(bin.length);
          for (var i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
          if (typeof DecompressionStream === "undefined") {
            reject(new Error("当前浏览器不支持 DecompressionStream"));
            return;
          }
          var stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("gzip"));
          new Response(stream).text().then(resolve, reject);
        } catch (error) {
          reject(error);
        }
      });
    }

    var panelFactoryPromise = null;
    var panelFactoryCache = null;

    function loadPanelFactory() {
      if (panelFactoryPromise !== null) return panelFactoryPromise;
      panelFactoryPromise = decodeGzip(PANEL_GZIP_B64).then(function (source) {
        // 面板源码是一个函数体，执行后返回 { ProviderPanel }。
        var run = new Function("react", source);
        var factory = run(react);
        if (!factory || typeof factory.ProviderPanel !== "function") {
          throw new Error("面板源码没有导出 ProviderPanel");
        }
        panelFactoryCache = factory;
        return factory;
      });
      return panelFactoryPromise;
    }

    /* ---------------- 开合状态 ---------------- */
    var store = { open: false };
    var listeners = new Set();
    var getOpen = function () { return store.open; };
    function subscribe(callback) {
      listeners.add(callback);
      return function () { listeners.delete(callback); };
    }
    function setOpen(value) {
      if (store.open !== value) {
        store.open = value;
        listeners.forEach(function (callback) { callback(); });
      }
    }
    function useOpen() {
      return react.useSyncExternalStore(subscribe, getOpen, getOpen);
    }

    function usePanelFactory(active) {
      var state = react.useState(function () {
        if (panelFactoryCache !== null) return { status: "ready", factory: panelFactoryCache, error: "" };
        return { status: "idle", factory: null, error: "" };
      });
      var current = state[0];
      var setCurrent = state[1];
      react.useEffect(function () {
        // 只有面板打开时才解压执行面板代码，避免 DSH 首屏负担。
        if (!active || current.status !== "idle") return undefined;
        var cancelled = false;
        loadPanelFactory().then(
          function (factory) {
            if (cancelled) return;
            setCurrent({ status: "ready", factory: factory, error: "" });
          },
          function (error) {
            if (cancelled) return;
            setCurrent({
              status: "error",
              factory: null,
              error: String(error && error.message ? error.message : error),
            });
          }
        );
        return function () { cancelled = true; };
      }, [active, current.status]);
      return current;
    }

    /* ---------------- 全屏面板（外壳） ---------------- */
    function ProviderPoolOverlay(props) {
      var t = props.t;
      var open = useOpen();
      var loaded = usePanelFactory(open);

      react.useEffect(function () {
        if (!open) return undefined;
        var onKey = function (event) {
          if (event.key === "Escape") setOpen(false);
        };
        document.addEventListener("keydown", onKey);
        return function () { document.removeEventListener("keydown", onKey); };
      }, [open]);

      if (!open) return null;

      var body;
      if (loaded.status === "ready") {
        body = react.createElement(loaded.factory.ProviderPanel, {
          t: t,
          onClose: function () { setOpen(false); },
        });
      } else if (loaded.status === "error") {
        body = react.createElement(
          "div",
          {
            style: {
              padding: "24px 28px", color: "#f87171", fontSize: "13px",
              background: "#0a101d", borderRadius: "16px",
              border: "1px solid #22304a", maxWidth: "min(760px, 90vw)",
            },
          },
          t("panel.loadFailed") + "：" + loaded.error
        );
      } else {
        body = react.createElement(
          "div",
          {
            style: {
              padding: "24px 28px", color: "#8b93a7", fontSize: "13px",
              background: "#0a101d", borderRadius: "16px",
              border: "1px solid #22304a",
            },
          },
          t("panel.loading")
        );
      }

      return react.createElement(
        "div",
        {
          "data-dsh-provider-pool": "overlay",
          onClick: function (event) {
            if (event.target === event.currentTarget) setOpen(false);
          },
          style: {
            position: "fixed",
            inset: "0",
            zIndex: 99999,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            background: "rgba(8,11,20,.62)",
          },
        },
        body
      );
    }

    /* ---------------- 左侧栏底部按钮 ---------------- */
    function ProviderPoolToggle(props) {
      var t = props.t;
      var open = useOpen();
      var showLabel = props.wide !== false;
      return react.createElement(
        "button",
        {
          type: "button",
          onClick: function () { setOpen(!open); },
          title: t("toggle.title"),
          style: {
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "6px",
            cursor: "pointer",
            border: "1px solid #2e384b",
            borderRadius: "999px",
            background: open ? "#0b3550" : "transparent",
            color: open ? "#e0f2fe" : "#b8b2a6",
            padding: "6px 10px",
            fontSize: "13px",
            maxWidth: "100%",
            overflow: "hidden",
          },
        },
        react.createElement("span", { style: { fontSize: "15px", lineHeight: 1 } }, "🔀"),
        showLabel
          ? react.createElement(
              "span",
              { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } },
              t("app.name")
            )
          : null
      );
    }

    /* ---------------- 插件入口 ---------------- */
    function apply(ctx) {
      var slots = ctx && typeof ctx.get === "function" ? ctx.get("slots") : undefined;
      if (!slots) slots = ctx && ctx.slots;
      if (!slots || typeof slots.register !== "function") return;

      var locale = ctx && typeof ctx.get === "function" ? ctx.get("locale") : undefined;
      if (!locale) locale = ctx && ctx.locale;
      var t = translateFactory(locale);
      var translated = t;

      if (
        translated !== undefined &&
        locale !== undefined &&
        locale !== null &&
        typeof locale.register === "function" &&
        typeof ctx.effect === "function"
      ) {
        try {
          ctx.effect(function () {
            return locale.register(NS, MESSAGES);
          });
        } catch (error) {
          /* locale 服务不可用就退化成中文兜底 */
        }
      }

      var register = function (slotName, id, order, component) {
        return slots.register({ name: slotName, id: id, order: order, locale: NS }, component);
      };

      if (typeof slots.inject === "function") {
        slots.inject("shell.overlay", function () {
          return register("shell.overlay", "dsh-provider-pool.panel", 30, function (props) {
            return react.createElement(ProviderPoolOverlay, {
              t: (props && props.t) || translated,
            });
          });
        });
        slots.inject("sidebar.footer.action", function () {
          return register("sidebar.footer.action", "dsh-provider-pool.toggle", 20, function (props) {
            return react.createElement(ProviderPoolToggle, {
              t: (props && props.t) || translated,
              wide: props && props.wide,
            });
          });
        });
      }
    }

    exports.apply = apply;
    exports.inject = ["slots", "locale"];
    return module.exports;
  },
});
