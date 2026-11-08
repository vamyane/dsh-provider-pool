/**
 * dsh-provider-pool 面板（React 直接渲染，不使用 iframe）。
 *
 * 这个文件不是独立模块：build.mjs 会把它 gzip 后内嵌进 lib/client.js；
 * 浏览器侧用 new Function("react", 源码) 执行，返回 { ProviderPanel }。
 * 所有用户可见文本都走 props.t(key)，字典在 lib/client.template.js。
 *
 * 数据来源（同源 fetch，带登录态）：
 *   GET  /api/dsh-provider-pool/list    provider 列表 + 代理状态
 *   GET  /api/dsh-provider-pool/stats   最近调用
 *   POST /api/dsh-provider-pool/test    测连通性
 *   POST /api/dsh-provider-pool/save    新增 / 更新
 *   POST /api/dsh-provider-pool/delete  删除
 */
var h = react.createElement;

var API = "/api/dsh-provider-pool";

var C = {
  bg: "#0a101d",
  card: "#101a2b",
  cardSoft: "#0d1522",
  border: "#22304a",
  borderSoft: "#1b2637",
  text: "#e6e0d4",
  dim: "#8b93a7",
  faint: "#5c677d",
  accent: "#38bdf8",
  accentBg: "rgba(56,189,248,.12)",
  green: "#34d399",
  greenBg: "rgba(52,211,153,.14)",
  red: "#f87171",
  redBg: "rgba(248,113,113,.14)",
  amber: "#fbbf24",
  amberBg: "rgba(251,191,36,.14)",
  mono: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace",
};

var styles = {
  card: {
    background: C.card,
    border: "1px solid " + C.borderSoft,
    borderRadius: "12px",
    padding: "14px 16px",
  },
  cardTitle: { fontSize: "13px", fontWeight: 600, color: C.text, letterSpacing: ".2px" },
  dim: { fontSize: "12px", color: C.dim, lineHeight: 1.6 },
  hint: { fontSize: "12px", color: C.dim, lineHeight: 1.65, marginTop: "8px" },
  codeBox: {
    display: "flex", alignItems: "center", flexWrap: "wrap", gap: "10px",
    background: C.cardSoft, border: "1px solid " + C.border,
    borderRadius: "10px", padding: "10px 12px", marginTop: "8px",
  },
  code: { fontFamily: C.mono, fontSize: "13px", color: C.accent, wordBreak: "break-all" },
  input: {
    width: "100%", boxSizing: "border-box", padding: "7px 9px",
    background: C.cardSoft, border: "1px solid " + C.border, borderRadius: "8px",
    color: C.text, fontSize: "13px", outline: "none",
  },
  label: { display: "block", fontSize: "12px", color: C.dim, marginBottom: "5px" },
  btn: {
    display: "inline-flex", alignItems: "center", justifyContent: "center", gap: "5px",
    padding: "6px 11px", borderRadius: "8px", border: "1px solid " + C.border,
    background: "transparent", color: C.text, fontSize: "12px", cursor: "pointer",
    lineHeight: 1.2, whiteSpace: "nowrap",
  },
  btnPrimary: { background: C.accentBg, borderColor: "rgba(56,189,248,.45)", color: C.accent },
  btnDanger: { color: C.red, borderColor: "rgba(248,113,113,.35)" },
  btnDisabled: { opacity: 0.5, cursor: "not-allowed" },
  row: { display: "flex", alignItems: "center", gap: "8px" },
  grow: { flex: 1, minWidth: 0 },
};

/* ------------------------------------------------------------------ */
/* 小工具                                                              */
/* ------------------------------------------------------------------ */

function styleOf() {
  var out = {};
  for (var i = 0; i < arguments.length; i += 1) {
    var item = arguments[i];
    if (!item) continue;
    for (var key in item) if (Object.prototype.hasOwnProperty.call(item, key)) out[key] = item[key];
  }
  return out;
}

function request(path, options) {
  var opts = { credentials: "same-origin", cache: "no-store" };
  if (options) {
    for (var key in options) if (Object.prototype.hasOwnProperty.call(options, key)) opts[key] = options[key];
  }
  return fetch(API + path, opts).then(function (response) {
    return response.text().then(function (text) {
      var body = null;
      try {
        body = text ? JSON.parse(text) : null;
      } catch (error) {
        body = { error: String(text || "").slice(0, 240) };
      }
      if (!response.ok) {
        var raw = body && body.error;
        var message = raw && raw.message ? raw.message : raw ? String(raw) : "HTTP " + response.status;
        var error = new Error(message);
        error.status = response.status;
        error.body = body;
        throw error;
      }
      return body || {};
    });
  });
}

function formatTime(value) {
  if (!value) return "—";
  var date = new Date(value);
  if (isNaN(date.getTime())) return String(value);
  var pad = function (n) { return n < 10 ? "0" + n : String(n); };
  return pad(date.getHours()) + ":" + pad(date.getMinutes()) + ":" + pad(date.getSeconds());
}

function formatBaseUrl(value) {
  var text = String(value || "");
  return text.replace(/^https?:\/\//, "").replace(/\/+$/, "");
}

function isOkStatus(status) {
  return typeof status === "number" && status >= 200 && status < 300;
}

/* ------------------------------------------------------------------ */
/* 基础组件                                                            */
/* ------------------------------------------------------------------ */

function Btn(props) {
  var style = styleOf(styles.btn, props.primary ? styles.btnPrimary : null, props.danger ? styles.btnDanger : null, props.disabled ? styles.btnDisabled : null, props.style);
  return h(
    "button",
    {
      type: "button",
      onClick: props.onClick,
      disabled: Boolean(props.disabled),
      title: props.title || undefined,
      style: style,
    },
    props.children
  );
}

function Pill(props) {
  var map = {
    ok: { color: C.green, background: C.greenBg, border: "1px solid rgba(52,211,153,.35)" },
    fail: { color: C.red, background: C.redBg, border: "1px solid rgba(248,113,113,.35)" },
    warn: { color: C.amber, background: C.amberBg, border: "1px solid rgba(251,191,36,.35)" },
    accent: { color: C.accent, background: C.accentBg, border: "1px solid rgba(56,189,248,.4)" },
    dim: { color: C.dim, background: "rgba(139,147,167,.1)", border: "1px solid " + C.borderSoft },
  };
  var tone = map[props.tone] || map.dim;
  return h(
    "span",
    {
      title: props.title || undefined,
      style: styleOf(
        {
          display: "inline-flex", alignItems: "center", gap: "4px",
          padding: "2px 7px", borderRadius: "999px", fontSize: "11px",
          whiteSpace: "nowrap", lineHeight: "16px",
        },
        tone,
        props.style
      ),
    },
    props.children
  );
}

function ProviderStatus(props) {
  var status = props.status;
  if (!status || status.tone === "none") {
    return h(Pill, { tone: "dim", title: status && status.detail }, props.t("providers.statusUnknown"));
  }
  var label = status.tone === "ok" ? props.t("providers.statusOk") : props.t("providers.statusFail");
  var detail = status.detail ? status.detail : undefined;
  return h("span", { title: detail, style: { display: "inline-flex" } }, h(Pill, { tone: status.tone }, label));
}

/* ------------------------------------------------------------------ */
/* Provider 行 / 表单 / 统计表                                          */
/* ------------------------------------------------------------------ */

function ProviderRow(props) {
  var t = props.t;
  var provider = props.provider;
  var testing = props.testing;
  return h(
    "div",
    {
      style: {
        display: "grid",
        gridTemplateColumns: "44px minmax(120px,1.3fr) minmax(90px,1fr) minmax(120px,1.3fr) 74px auto",
        gap: "10px",
        alignItems: "center",
        padding: "9px 8px",
        borderTop: "1px solid " + C.borderSoft,
        fontSize: "12px",
      },
    },
    h(
      "span",
      {
        title: t("providers.colPriority"),
        style: {
          display: "inline-flex", alignItems: "center", justifyContent: "center",
          width: "28px", height: "28px", borderRadius: "8px",
          background: "rgba(56,189,248,.1)", border: "1px solid rgba(56,189,248,.28)",
          color: C.accent, fontFamily: C.mono, fontSize: "12px",
        },
      },
      String(provider.priority)
    ),
    h(
      "div",
      { style: { minWidth: 0 } },
      h("div", { style: { color: C.text, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, provider.name),
      h("div", { style: { color: C.faint, fontFamily: C.mono, fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, provider.id)
    ),
    h(
      "div",
      { style: { minWidth: 0 } },
      h("div", { style: { color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, provider.model || "—"),
      h(
        "div",
        { style: { color: C.faint, fontSize: "11px", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }, title: provider.baseUrl },
        formatBaseUrl(provider.baseUrl)
      )
    ),
    h(
      "div",
      { style: { minWidth: 0, color: C.dim, fontFamily: C.mono, fontSize: "11px" } },
      provider.hasApiKey ? h("span", { title: t("field.apiKeyHint") }, provider.apiKeyMasked) : h("span", { style: { color: C.amber } }, t("providers.noKey"))
    ),
    h(ProviderStatus, { t: t, status: props.status }),
    h(
      "div",
      { style: { display: "flex", gap: "6px", justifyContent: "flex-end", flexWrap: "wrap" } },
      h(Btn, { onClick: function () { props.onTest(provider); }, disabled: testing, title: t("providers.test") }, testing ? t("providers.testing") : t("providers.test")),
      h(Btn, { onClick: function () { props.onEdit(provider); } }, t("providers.edit")),
      h(Btn, { danger: true, onClick: function () { props.onDelete(provider); } }, t("providers.delete"))
    )
  );
}

function ProviderForm(props) {
  var t = props.t;
  var draft = props.draft;
  var field = function (name, label, extra) {
    var options = extra || {};
    var inputStyle = styleOf(styles.input, options.mono ? { fontFamily: C.mono } : null);
    return h(
      "label",
      { style: { display: "block", minWidth: 0 } },
      h("span", { style: styles.label }, label),
      h("input", {
        style: inputStyle,
        value: draft[name] === undefined || draft[name] === null ? "" : String(draft[name]),
        placeholder: options.placeholder || undefined,
        type: options.type || "text",
        autoComplete: options.autoComplete || "off",
        spellCheck: false,
        onChange: function (event) { props.onChange(name, event.target.value); },
        disabled: props.saving,
      })
    );
  };
  return h(
    "div",
    { style: styleOf(styles.card, { borderColor: "rgba(56,189,248,.4)", background: "rgba(56,189,248,.05)" }) },
    h(
      "div",
      { style: styleOf(styles.row, { marginBottom: "10px" }) },
      h("span", { style: styles.cardTitle }, props.mode === "edit" ? t("providers.editTitle") : t("providers.addTitle")),
      h("span", { style: { flex: 1 } }),
      draft.id ? h("span", { style: { color: C.faint, fontFamily: C.mono, fontSize: "11px" } }, draft.id) : null
    ),
    h(
      "div",
      { style: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(200px, 1fr))", gap: "10px" } },
      field("name", t("field.name"), { placeholder: t("field.namePlaceholder") }),
      field("baseUrl", t("field.baseUrl"), { placeholder: t("field.baseUrlPlaceholder"), mono: true }),
      field("model", t("field.model"), { placeholder: t("field.modelPlaceholder"), mono: true }),
      field("priority", t("field.priority"), { type: "number", placeholder: "1" })
    ),
    h(
      "div",
      { style: { marginTop: "10px" } },
      field("apiKey", t("field.apiKey"), {
        type: "password",
        placeholder: t("field.apiKeyPlaceholder"),
        autoComplete: "new-password",
      })
    ),
    h("div", { style: styles.hint }, t("field.apiKeyHint"), " · ", t("field.priorityHint")),
    props.error ? h("div", { style: { color: C.red, fontSize: "12px", marginTop: "8px" } }, props.error) : null,
    h(
      "div",
      { style: styleOf(styles.row, { marginTop: "12px" }) },
      h(Btn, { primary: true, onClick: props.onSubmit, disabled: props.saving }, props.saving ? t("providers.saving") : t("providers.save")),
      h(Btn, { onClick: props.onCancel, disabled: props.saving }, t("providers.cancel"))
    )
  );
}

function StatsTable(props) {
  var t = props.t;
  var calls = props.calls || [];
  var columns = "74px minmax(90px,1fr) minmax(80px,1fr) 68px 62px 56px";
  var head = h(
    "div",
    {
      style: {
        display: "grid", gridTemplateColumns: columns, gap: "8px",
        padding: "6px 8px", color: C.faint, fontSize: "11px",
        textTransform: "uppercase", letterSpacing: ".4px",
      },
    },
    h("span", null, t("stats.time")),
    h("span", null, t("stats.provider")),
    h("span", null, t("stats.model")),
    h("span", { style: { textAlign: "right" } }, t("stats.ms")),
    h("span", { style: { textAlign: "right" } }, t("stats.status")),
    h("span", { style: { textAlign: "right" } }, t("stats.fallback"))
  );
  var rows = calls.map(function (call, index) {
    var ok = isOkStatus(call.status);
    return h(
      "div",
      {
        key: "call-" + index,
        style: {
          display: "grid", gridTemplateColumns: columns, gap: "8px",
          padding: "6px 8px", borderTop: "1px solid " + C.borderSoft,
          fontSize: "12px", color: C.dim, fontFamily: C.mono,
        },
      },
      h("span", { title: call.time }, formatTime(call.time)),
      h("span", { style: { color: C.text, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, call.providerId || "—"),
      h("span", { style: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" } }, call.model || "—"),
      h("span", { style: { textAlign: "right" } }, String(call.ms || 0)),
      h("span", { style: { textAlign: "right", color: ok ? C.green : C.red } }, call.status ? String(call.status) : "ERR"),
      h(
        "span",
        { style: { textAlign: "right", color: call.fallback ? C.amber : C.faint } },
        call.fallback ? t("stats.switched") : t("stats.firstChoice")
      )
    );
  });
  return h("div", null, head, rows);
}

/* ------------------------------------------------------------------ */
/* 主面板                                                              */
/* ------------------------------------------------------------------ */

function ProviderPanel(props) {
  var t = props.t;
  var onClose = props.onClose;

  var listState = react.useState({ status: "loading", data: null, error: "" });
  var list = listState[0];
  var setList = listState[1];

  var statsState = react.useState({ status: "loading", data: null, error: "" });
  var stats = statsState[0];
  var setStats = statsState[1];

  var tickState = react.useState(0);
  var tick = tickState[0];
  var setTick = tickState[1];

  var testState = react.useState({});
  var testResults = testState[0];
  var setTestResults = testState[1];

  var formState = react.useState({ mode: "none", draft: null, saving: false, error: "" });
  var form = formState[0];
  var setForm = formState[1];

  var noticeState = react.useState(null);
  var notice = noticeState[0];
  var setNotice = noticeState[1];

  react.useEffect(function () {
    if (typeof onClose === "function") {
      var onKey = function (event) {
        if (event.key === "Escape") onClose();
      };
      document.addEventListener("keydown", onKey);
      return function () { document.removeEventListener("keydown", onKey); };
    }
    return undefined;
  }, []);

  react.useEffect(function () {
    var cancelled = false;
    setList(function (prev) { return { status: prev.data ? "refreshing" : "loading", data: prev.data, error: "" }; });
    setStats(function (prev) { return { status: prev.data ? "refreshing" : "loading", data: prev.data, error: "" }; });
    request("/list").then(
      function (data) { if (!cancelled) setList({ status: "ready", data: data, error: "" }); },
      function (error) { if (!cancelled) setList({ status: "error", data: null, error: String((error && error.message) || error) }); }
    );
    request("/stats").then(
      function (data) { if (!cancelled) setStats({ status: "ready", data: data, error: "" }); },
      function (error) { if (!cancelled) setStats({ status: "error", data: null, error: String((error && error.message) || error) }); }
    );
    return function () { cancelled = true; };
  }, [tick]);

  function refresh() {
    setTick(function (value) { return value + 1; });
  }

  var data = list.data || {};
  var providers = Array.isArray(data.providers) ? data.providers : [];
  var proxyInfo = data.proxy || {};
  var calls = stats.data && Array.isArray(stats.data.calls) ? stats.data.calls : [];
  var summary = stats.data && stats.data.summary ? stats.data.summary : null;

  function latestCall(providerId) {
    for (var i = 0; i < calls.length; i += 1) {
      if (calls[i] && calls[i].providerId === providerId) return calls[i];
    }
    return null;
  }

  function providerStatus(provider) {
    var tested = testResults[provider.id];
    if (tested && tested.state === "ok") {
      return { tone: "ok", detail: t("providers.statusOkDetail") + " " + tested.status + " · " + tested.ms + "ms" };
    }
    if (tested && tested.state === "fail") {
      return { tone: "fail", detail: (tested.error || "") + (tested.status ? " (HTTP " + tested.status + ")" : "") };
    }
    var call = latestCall(provider.id);
    if (!call) return { tone: "none", detail: t("providers.statusUnknown") };
    if (isOkStatus(call.status)) {
      return { tone: "ok", detail: formatTime(call.time) + " · " + call.status + " · " + call.ms + "ms" };
    }
    return { tone: "fail", detail: formatTime(call.time) + " · " + (call.status || "ERR") + " · " + (call.error || "") };
  }

  function copyText(text) {
    var success = function () {
      setNotice({ kind: "ok", text: t("proxy.copied") });
    };
    var failure = function () {
      setNotice({ kind: "fail", text: t("proxy.copyFailed") + " " + text });
    };
    var legacy = function () {
      try {
        var area = document.createElement("textarea");
        area.value = text;
        area.setAttribute("readonly", "readonly");
        area.style.position = "fixed";
        area.style.opacity = "0";
        document.body.appendChild(area);
        area.select();
        var ok = document.execCommand("copy");
        document.body.removeChild(area);
        if (ok) success();
        else failure();
      } catch (error) {
        failure();
      }
    };
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(success, legacy);
        return;
      }
    } catch (error) {
      /* fall through */
    }
    legacy();
  }

  function openAdd() {
    setForm({
      mode: "add",
      draft: { id: "", name: "", baseUrl: "", model: "", priority: String(providers.length + 1), apiKey: "" },
      saving: false,
      error: "",
    });
  }

  function openEdit(provider) {
    setForm({
      mode: "edit",
      draft: {
        id: provider.id,
        name: provider.name || "",
        baseUrl: provider.baseUrl || "",
        model: provider.model || "",
        priority: String(provider.priority),
        apiKey: "",
      },
      saving: false,
      error: "",
    });
  }

  function closeForm() {
    setForm({ mode: "none", draft: null, saving: false, error: "" });
  }

  function changeField(field, value) {
    setForm(function (prev) {
      if (!prev.draft) return prev;
      var draft = {};
      for (var key in prev.draft) if (Object.prototype.hasOwnProperty.call(prev.draft, key)) draft[key] = prev.draft[key];
      draft[field] = value;
      return styleOf(prev, { draft: draft, error: "" });
    });
  }

  function submitForm() {
    var draft = form.draft;
    if (!draft) return;
    var name = String(draft.name || "").trim();
    var baseUrl = String(draft.baseUrl || "").trim();
    if (!name) {
      setForm(styleOf(form, { error: t("form.required") }));
      return;
    }
    if (!/^https?:\/\//i.test(baseUrl)) {
      setForm(styleOf(form, { error: t("form.badUrl") }));
      return;
    }
    if (String(draft.priority || "").trim() !== "" && !isFinite(Number(draft.priority))) {
      setForm(styleOf(form, { error: t("form.priorityNumber") }));
      return;
    }
    setForm(styleOf(form, { saving: true, error: "" }));
    request("/save", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        provider: {
          id: draft.id || undefined,
          name: name,
          baseUrl: baseUrl,
          apiKey: draft.apiKey || "",
          model: String(draft.model || "").trim(),
          priority: String(draft.priority || "").trim() === "" ? providers.length + 1 : Number(draft.priority),
        },
      }),
    }).then(
      function (result) {
        closeForm();
        setNotice({ kind: "ok", text: t("providers.saved") + " " + (result.provider ? result.provider.name : name) });
        refresh();
      },
      function (error) {
        setForm(styleOf(form, { saving: false, error: String((error && error.message) || error) }));
      }
    );
  }

  function deleteProvider(provider) {
    var message = t("providers.confirmDelete") + "\n" + (provider.name || provider.id);
    var confirmed = true;
    try {
      confirmed = typeof window === "undefined" || typeof window.confirm !== "function" ? true : window.confirm(message);
    } catch (error) {
      confirmed = true;
    }
    if (!confirmed) return;
    request("/delete", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ id: provider.id }),
    }).then(
      function () {
        setNotice({ kind: "ok", text: t("providers.deleted") + " " + (provider.name || provider.id) });
        refresh();
      },
      function (error) {
        setNotice({ kind: "fail", text: String((error && error.message) || error) });
      }
    );
  }

  function runTest(provider) {
    setTestResults(function (prev) {
      var next = styleOf(prev);
      next[provider.id] = { state: "testing" };
      return next;
    });
    request("/test", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ providerId: provider.id }),
    }).then(
      function (result) {
        var test = result && result.test ? result.test : {};
        setTestResults(function (prev) {
          var next = styleOf(prev);
          next[provider.id] = {
            state: test.ok ? "ok" : "fail",
            status: test.status,
            ms: test.ms,
            error: test.error,
          };
          return next;
        });
      },
      function (error) {
        setTestResults(function (prev) {
          var next = styleOf(prev);
          next[provider.id] = { state: "fail", error: String((error && error.message) || error) };
          return next;
        });
      }
    );
  }

  var proxyAddress = proxyInfo.address || "http://127.0.0.1:" + (proxyInfo.port || proxyInfo.desiredPort || 3121) + "/v1";
  var configPath = data.configPath || "~/.dsh/provider-pool.json";

  var errorBanner = null;
  if (list.status === "error") {
    errorBanner = h(
      "div",
      { style: { color: C.red, fontSize: "12px", background: C.redBg, border: "1px solid rgba(248,113,113,.3)", borderRadius: "10px", padding: "9px 12px" } },
      t("panel.loadError") + "：" + list.error
    );
  }

  var noticeBanner = notice
    ? h(
        "div",
        {
          style: {
            color: notice.kind === "ok" ? C.green : C.red,
            background: notice.kind === "ok" ? C.greenBg : C.redBg,
            border: "1px solid " + (notice.kind === "ok" ? "rgba(52,211,153,.3)" : "rgba(248,113,113,.3)"),
            borderRadius: "10px", padding: "8px 12px", fontSize: "12px",
          },
        },
        notice.text
      )
    : null;

  var proxyCard = h(
    "div",
    { style: styleOf(styles.card, { borderColor: "rgba(56,189,248,.32)" }) },
    h(
      "div",
      { style: styleOf(styles.row, { marginBottom: "2px", flexWrap: "wrap" }) },
      h("span", { style: styles.cardTitle }, t("proxy.title")),
      proxyInfo.running
        ? h(Pill, { tone: "ok" }, t("proxy.running"))
        : h(Pill, { tone: "fail", title: proxyInfo.error || undefined }, t("proxy.notRunning")),
      h("span", { style: { flex: 1 } }),
      h(Btn, { onClick: function () { copyText(proxyAddress); }, title: t("proxy.copy") }, t("proxy.copy"))
    ),
    h(
      "div",
      { style: styles.codeBox },
      h("code", { style: styles.code }, proxyAddress),
      h("span", { style: { color: C.faint, fontSize: "12px" } }, t("proxy.port") + " " + (proxyInfo.port || proxyInfo.desiredPort || "—"))
    ),
    proxyInfo.error ? h("div", { style: { color: C.amber, fontSize: "12px", marginTop: "6px" } }, proxyInfo.error) : null,
    h("div", { style: styles.hint }, t("proxy.hint")),
    h("div", { style: { marginTop: "6px", fontFamily: C.mono, fontSize: "11px", color: C.faint, wordBreak: "break-all" } }, t("proxy.configPath") + "：" + configPath)
  );

  var providersCard = h(
    "div",
    { style: styles.card },
    h(
      "div",
      { style: styleOf(styles.row, { marginBottom: "4px" }) },
      h("span", { style: styles.cardTitle }, t("providers.title")),
      h(Pill, { tone: "dim" }, String(providers.length)),
      h("span", { style: { flex: 1 } }),
      h(Btn, { primary: true, onClick: openAdd }, "+ " + t("providers.add"))
    ),
    data.readError ? h("div", { style: { color: C.red, fontSize: "12px", marginTop: "6px" } }, data.readError) : null,
    Array.isArray(data.warnings) && data.warnings.length
      ? h(
          "div",
          { style: { color: C.amber, fontSize: "12px", marginTop: "6px", lineHeight: 1.6 } },
          data.warnings.map(function (warning, index) { return h("div", { key: "warn-" + index }, "⚠ " + warning); })
        )
      : null,
    providers.length === 0
      ? h(
          "div",
          { style: { marginTop: "8px" } },
          h("div", { style: { color: C.dim, fontSize: "13px" } }, t("providers.empty")),
          data.hint ? h("div", { style: styles.hint }, data.hint) : null,
          h(
            "pre",
            {
              style: {
                marginTop: "10px", padding: "10px 12px", background: C.cardSoft,
                border: "1px solid " + C.borderSoft, borderRadius: "10px",
                color: C.dim, fontSize: "11px", fontFamily: C.mono,
                overflow: "auto", lineHeight: 1.55,
              },
            },
            t("providers.emptyExample")
          )
        )
      : h(
          "div",
          { style: { marginTop: "8px" } },
          h(
            "div",
            {
              style: {
                display: "grid",
                gridTemplateColumns: "44px minmax(120px,1.3fr) minmax(90px,1fr) minmax(120px,1.3fr) 74px auto",
                gap: "10px", padding: "6px 8px", color: C.faint, fontSize: "11px",
                textTransform: "uppercase", letterSpacing: ".4px",
              },
            },
            h("span", null, "#"),
            h("span", null, t("providers.colName")),
            h("span", null, t("providers.colModel")),
            h("span", null, t("providers.colKey")),
            h("span", null, t("providers.colStatus")),
            h("span", { style: { textAlign: "right" } }, t("providers.colActions"))
          ),
          providers.map(function (provider) {
            var tested = testResults[provider.id];
            return h(ProviderRow, {
              key: provider.id,
              t: t,
              provider: provider,
              status: providerStatus(provider),
              testing: Boolean(tested && tested.state === "testing"),
              onTest: runTest,
              onEdit: openEdit,
              onDelete: deleteProvider,
            });
          })
        )
  );

  var formCard = form.mode === "none" ? null : h(ProviderForm, {
    t: t,
    mode: form.mode,
    draft: form.draft || {},
    saving: Boolean(form.saving),
    error: form.error || "",
    onChange: changeField,
    onSubmit: submitForm,
    onCancel: closeForm,
  });

  var statsCard = h(
    "div",
    { style: styles.card },
    h(
      "div",
      { style: styleOf(styles.row, { flexWrap: "wrap" }) },
      h("span", { style: styles.cardTitle }, t("stats.title")),
      summary ? h(Pill, { tone: "dim" }, t("stats.summary") + " " + summary.total + " · " + t("stats.failures") + " " + summary.failures + " · " + t("stats.avg") + " " + summary.avgMs + "ms") : null,
      h("span", { style: { flex: 1 } })
    ),
    summary && summary.byProvider && summary.byProvider.length
      ? h(
          "div",
          { style: { display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "8px" } },
          summary.byProvider.map(function (item) {
            return h(
              Pill,
              { key: "sum-" + item.providerId, tone: item.failures > 0 ? "warn" : "accent", title: item.providerId },
              item.providerId + " · " + item.calls + " · " + item.avgMs + "ms" + (item.failures ? " · ✕" + item.failures : "")
            );
          })
        )
      : null,
    calls.length === 0
      ? h("div", { style: styles.hint }, t("stats.empty"))
      : h("div", { style: { marginTop: "6px" } }, h(StatsTable, { t: t, calls: calls.slice(0, 20) }))
  );

  return h(
    "div",
    {
      role: "dialog",
      "aria-modal": "true",
      "aria-label": t("panel.title"),
      style: {
        width: "min(1180px, 96vw)",
        height: "88vh",
        display: "flex",
        flexDirection: "column",
        background: C.bg,
        border: "1px solid " + C.border,
        borderRadius: "16px",
        overflow: "hidden",
        boxShadow: "0 24px 80px rgba(0,0,0,.55)",
        color: C.text,
        fontSize: "13px",
      },
    },
    h(
      "div",
      {
        style: {
          display: "flex", alignItems: "center", gap: "12px",
          padding: "12px 16px", borderBottom: "1px solid " + C.border,
          background: "#0d1522", flex: "none",
        },
      },
      h("span", { style: { fontSize: "18px", lineHeight: 1 } }, "🔀"),
      h(
        "div",
        { style: styles.grow },
        h("div", { style: { fontSize: "15px", fontWeight: 600 } }, t("panel.title")),
        h("div", { style: { fontSize: "12px", color: C.dim, marginTop: "1px" } }, t("panel.subtitle"))
      ),
      h(Btn, { onClick: refresh, title: t("panel.refresh") }, "↻"),
      h(Btn, { onClick: onClose || function () {}, title: t("panel.close") }, "✕")
    ),
    h(
      "div",
      {
        style: {
          flex: 1, overflow: "auto", padding: "14px 16px 18px",
          display: "flex", flexDirection: "column", gap: "12px",
        },
      },
      errorBanner,
      noticeBanner,
      proxyCard,
      providersCard,
      formCard,
      statsCard,
      h("div", { style: { color: C.faint, fontSize: "11px", textAlign: "center", paddingTop: "2px" } }, t("panel.note"))
    )
  );
}

return { ProviderPanel: ProviderPanel };
