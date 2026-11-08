# dsh-provider-pool

A [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) plugin: a **local OpenAI-compatible proxy** with a **prioritized provider pool and automatic fallback**.

Point any DSH custom model at `http://127.0.0.1:3121/v1` once. Every request is then tried against your providers in priority order — if one is rate-limited, out of credit, down, or too slow, the next one is used automatically. The provider API keys stay on the host; the browser UI only ever sees the last 4 characters.

> Status: `0.1.0` (MVP). Local-only, no npm publish, no network telemetry.

## Features

- **Local proxy** — `node:http` server on `127.0.0.1`, OpenAI compatible:
  - `POST /v1/chat/completions` (streaming and non-streaming)
  - `GET /v1/models` (aggregates the provider model lists, failures ignored)
  - `GET /health`
- **Automatic fallback** — tries providers by `priority` (smaller first):
  - non-streaming: fallback on `401 / 402 / 403 / 429 / 5xx`, connection errors and **20 s timeout**;
  - streaming: fallback only **before the first upstream byte** (response headers); once SSE bytes are flowing the response is committed and never switched mid-stream;
  - other `4xx` (e.g. `400`, `404`) are passed through unchanged, so your request bugs are not silently masked.
- **Port fallback** — configured port (default `3121`), if busy tries `3122 … 3130` automatically.
- **Call log** — every attempt (`time, providerId, model, ms, status, fallback, stream`) is kept in memory (last 200) and persisted to `~/.dsh/provider-pool-stats.json`.
- **Panel** — sidebar entry + full-screen panel rendered with **React directly (no iframe)**: provider list, add/edit/delete, connectivity test, recent-call stats, proxy address with copy button.
- **Key hygiene** — API keys are used only on the host, masked as `••••abcd` everywhere, and never written to logs or stats files.

## Install

The package is **not published to npm**. Build locally and install into a DSH profile:

```bash
cd dsh-provider-pool
node build.mjs        # generates lib/client.js from app/panel.js
npm pack              # dsh-provider-pool-0.1.0.tgz
```

Then either:

```bash
dsh plugin --profile desktop add ./dsh-provider-pool-0.1.0.tgz
```

or install manually (what DSH does under the hood): copy the package to
`<profile>/local-plugins/dsh-provider-pool`, add `"dsh-provider-pool": "link:./local-plugins/dsh-provider-pool"`
to the profile `dependencies`, append `dsh-provider-pool` to `dsh.profile.bundles`, run `pnpm install`
in the profile directory, and fully restart DSH.

After the restart you should see **🔀 Provider Pool** at the bottom of the left sidebar.

## Quick start

1. Open the panel (🔀 in the sidebar) and add at least one provider, or create
   `~/.dsh/provider-pool.json` manually:

```json
{
  "proxyPort": 3121,
  "providers": [
    {
      "id": "deepseek",
      "name": "DeepSeek official",
      "baseUrl": "https://api.deepseek.com",
      "apiKey": "sk-...",
      "model": "deepseek-chat",
      "priority": 1
    },
    {
      "id": "backup",
      "name": "Backup provider",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "model": "gpt-4o-mini",
      "priority": 2
    }
  ]
}
```

2. In DSH model settings add a **custom OpenAI-compatible provider**:
   - Base URL: `http://127.0.0.1:3121/v1` (copy it from the panel)
   - API Key: anything (ignored — the proxy uses the pooled keys)
   - Model: anything (if a provider has `model` set, the proxy rewrites the request model to it;
     otherwise the requested model is forwarded unchanged)

3. Chat as usual. If the first provider returns `500`/`429`/`401` or times out, the panel stats show the
   fallback attempt and the answer comes from the next provider.

## Configuration (`~/.dsh/provider-pool.json`)

| Field | Default | Description |
| --- | --- | --- |
| `proxyPort` | `3121` | Local proxy port. If busy, `3122 … 3130` are tried; the actually used port is shown in the panel. |
| `timeoutMs` | `20000` | Per-provider timeout until the upstream response headers arrive. |
| `providers[]` | `[]` | Provider list, sorted by `priority`. |
| `providers[].id` | auto | Stable id (auto-generated from the name when added via the panel). |
| `providers[].name` | — | Display name. |
| `providers[].baseUrl` | — | `http(s)://…`; `/v1/chat/completions` is appended automatically, or used directly if the URL already ends in `/v1`. |
| `providers[].apiKey` | `""` | Bearer token. **Host-only**, never sent to the browser. |
| `providers[].model` | `""` | If set, the request model is rewritten to this value before forwarding. |
| `providers[].priority` | insertion order | Smaller number = tried earlier. |

The file is read on every request, so provider edits in the panel take effect immediately.
A changed `proxyPort` needs a DSH restart (the listener is created when the plugin loads).

## Panel API

Registered on the host `connection` service (same-origin, authenticated by DSH) under `/api/dsh-provider-pool`:

| Route | Description |
| --- | --- |
| `GET /list` | Providers with masked keys, proxy state, config path, warnings |
| `POST /test` | Body `{ providerId }` — send a minimal chat request to that provider |
| `GET /stats` | Recent attempts (newest first) + per-provider summary |
| `GET /proxy` | Proxy address, port, running state |
| `POST /save` | Body `{ provider }` — add or update a provider (empty `apiKey` keeps the old key) |
| `POST /delete` | Body `{ id }` — remove a provider |
| `GET /health` | Plugin health check |

## Security model

- The proxy binds `127.0.0.1` only and is not exposed to the network.
- The proxy replaces any incoming `Authorization` header with the pooled provider key.
  The key never reaches the browser: `/list`, `/test`, `/stats` only return `••••` + last 4 characters.
- Stats and error messages are sanitized; stats files never contain keys.
- `~/.dsh/provider-pool.json` holds plaintext keys: on POSIX it is written with mode `600`
  (Windows ignores the mode — protect the file with your user profile ACL).
- The proxy itself does not authenticate callers; any local process can call it.
  That is the same trust level as the DSH process itself.

## Known limitations

- **Streaming switch boundary**: fallback can only happen before the first upstream byte. If a provider
  accepts the request, starts streaming, and then dies mid-stream, the client response is terminated
  rather than silently resumed from another provider (mixing two SSE streams would corrupt the answer).
- Fallback triggers are limited to `401 / 402 / 403 / 429 / 5xx`, network errors and timeouts;
  other `4xx` are returned as-is by design.
- `ms` in the stats is time-to-decision: for non-streaming it is the full response time, for streaming it
  is the first-byte latency (the stream itself can run longer).
- Changing `proxyPort` requires restarting DSH.
- Only one process can own the proxy port; if all ports `3121–3130` are busy the proxy stays down and the
  panel shows the error (the plugin itself keeps working).
- No vision/embedding/rerank routing yet — chat completions and model listing only.

## Development

```bash
node build.mjs        # app/panel.js → gzip/base64 → lib/client.js
node test/smoke.mjs   # offline smoke: mock providers, fallback, streaming, key masking, routes, icon
npm pack --dry-run    # inspect the published file list
```

Layout:

```
lib/index.js            host plugin (routes + proxy lifecycle)
lib/core.js             config, stats, proxy engine, port fallback (framework-free, testable)
lib/client.template.js  browser module loader + slots + zh/en locale dictionary
lib/client.js           generated bundle (build.mjs output)
app/panel.js            React panel source (gzip-embedded by build.mjs)
assets/icon.png         512x512 icon (generated by assets/generate_icon.py)
cordis.patch.yml        DSH bundle patch (row name == package name)
test/smoke.mjs          offline smoke tests
```

## License

MIT — see [LICENSE](./LICENSE).
