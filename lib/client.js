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

    var PANEL_GZIP_B64 = "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";

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
