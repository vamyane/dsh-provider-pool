# dsh-provider-pool

[DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 插件：**本地 OpenAI 兼容代理 + 按优先级自动 fallback 的模型 Provider 池**。

只要把 DSH 里的自定义模型指向一次 `http://127.0.0.1:3121/v1`，之后每个请求都会按 provider 优先级依次尝试：某个 provider 限流、欠费、挂了或者太慢，就自动换下一个。API Key 只留在宿主侧，面板里永远只显示尾 4 位。

> 状态：`0.1.0`（MVP）。本地使用，不发布 npm、不上报任何数据。

## 功能

- **本地代理** —— `node:http` 在 `127.0.0.1` 监听，OpenAI 兼容：
  - `POST /v1/chat/completions`（流式 + 非流式）
  - `GET /v1/models`（聚合各 provider 的模型列表，失败忽略）
  - `GET /health`
- **自动 fallback** —— 按 `priority` 从小到大尝试：
  - 非流式：`401 / 402 / 403 / 429 / 5xx`、连接失败、**超时 20s** → 换下一个；
  - 流式：只在**收到上游首字节（响应头）之前**失败时切换；一旦开始给客户端写 SSE，就不在中途换源；
  - 其他 `4xx`（如 `400 / 404`）原样返回，不切换，避免掩盖参数错误。
- **端口自动顺延** —— 默认 `3121`，被占用时依次尝试 `3122 … 3130`。
- **调用统计** —— 每次尝试记录 `time / providerId / model / ms / status / fallback / stream`，内存最近 200 条 + 持久化到 `~/.dsh/provider-pool-stats.json`。
- **面板** —— 侧栏入口 + 全屏面板，**React 直接渲染（不用 iframe）**：provider 列表、新增/编辑/删除、连通性测试、最近调用统计、复制代理地址。
- **Key 安全** —— API Key 只在宿主使用，前端只见 `••••abcd`，不会写进日志和统计文件。

## 安装

本包**不发布到 npm**。本地构建后装进 DSH profile：

```bash
cd dsh-provider-pool
node build.mjs        # 由 app/panel.js 生成 lib/client.js
npm pack              # 得到 dsh-provider-pool-0.1.0.tgz
```

然后二选一：

```bash
dsh plugin --profile desktop add ./dsh-provider-pool-0.1.0.tgz
```

或手动安装（DSH 内部做的事）：把包放到 `<profile>/local-plugins/dsh-provider-pool`，在 profile 的
`dependencies` 里加 `"dsh-provider-pool": "link:./local-plugins/dsh-provider-pool"`，把 `dsh-provider-pool`
追加到 `dsh.profile.bundles`，在 profile 目录跑一次 `pnpm install`，然后完全退出 DSH 再打开。

重启后左侧栏底部会出现 **🔀 Provider 池** 入口。

## 快速开始

1. 打开面板（🔀）新增至少一个 provider，或直接创建 `~/.dsh/provider-pool.json`：

```json
{
  "proxyPort": 3121,
  "providers": [
    {
      "id": "deepseek",
      "name": "DeepSeek 官方",
      "baseUrl": "https://api.deepseek.com",
      "apiKey": "sk-...",
      "model": "deepseek-chat",
      "priority": 1
    },
    {
      "id": "backup",
      "name": "备用 provider",
      "baseUrl": "https://api.openai.com/v1",
      "apiKey": "sk-...",
      "model": "gpt-4o-mini",
      "priority": 2
    }
  ]
}
```

2. 在 DSH 模型设置里添加一个**自定义 OpenAI 兼容 provider**：
   - Base URL：`http://127.0.0.1:3121/v1`（可以从面板一键复制）
   - API Key：随便填（会被忽略，代理用池里的 key）
   - 模型：随便填（provider 配了 `model` 时代理会把请求模型改写成它，否则原样转发）

3. 正常聊天即可。第一个 provider 返回 `500/429/401` 或超时，面板统计会显示这次 fallback，回答来自下一个 provider。

## 配置说明（`~/.dsh/provider-pool.json`）

| 字段 | 默认值 | 说明 |
| --- | --- | --- |
| `proxyPort` | `3121` | 本地代理端口；被占用时自动试 `3122 … 3130`，实际端口见面板。 |
| `timeoutMs` | `20000` | 单个 provider 等上游响应头的超时时间。 |
| `providers[]` | `[]` | provider 列表，按 `priority` 排序。 |
| `providers[].id` | 自动 | 稳定 id（面板新增时自动生成）。 |
| `providers[].name` | — | 显示名称。 |
| `providers[].baseUrl` | — | `http(s)://…`；代理会自动补 `/v1/chat/completions`，若地址本身以 `/v1` 结尾则直接拼 `/chat/completions`。 |
| `providers[].apiKey` | `""` | Bearer token，**只在宿主侧**，永不下发浏览器。 |
| `providers[].model` | `""` | 配置后转发前会把请求模型改写成它。 |
| `providers[].priority` | 按加入顺序 | 数字越小越先尝试。 |

配置文件在每次请求时读取，面板里改 provider 立即生效；改 `proxyPort` 需要重启 DSH（监听在插件加载时创建）。

## 面板 API

挂在宿主 `connection` 服务的同源通道上（由 DSH 统一鉴权），前缀 `/api/dsh-provider-pool`：

| 路由 | 说明 |
| --- | --- |
| `GET /list` | provider 列表（key 已脱敏）、代理状态、配置路径、warning |
| `POST /test` | body `{ providerId }`，给该 provider 发一个最小请求测连通 |
| `GET /stats` | 最近调用（新的在前）+ 按 provider 汇总 |
| `GET /proxy` | 代理地址、端口、运行状态 |
| `POST /save` | body `{ provider }`，新增/更新（`apiKey` 留空 = 保留原 key） |
| `POST /delete` | body `{ id }`，删除 |
| `GET /health` | 插件健康检查 |

## 安全模型

- 代理只 bind `127.0.0.1`，不对外网暴露。
- 代理会把客户端带来的 `Authorization` 替换成池里 provider 的 key，key 不会到浏览器：
  `/list`、`/test`、`/stats` 只返回 `••••` + 尾 4 位。
- 统计与错误信息都会脱敏，统计文件里没有 key。
- `~/.dsh/provider-pool.json` 是明文 key：POSIX 下以 `600` 权限写入
  （Windows 忽略该权限位，请用用户目录 ACL 保护文件）。
- 代理本身不校验调用者，本机任意进程都能访问，信任级别与 DSH 进程相同。

## 已知限制

- **流式切换边界**：fallback 只发生在上游首字节之前。如果 provider 已经 200 并开始出流、随后中途断掉，
  客户端连接会被终止，而不会静默切到另一个 provider 续写（混两路 SSE 会串内容）。
- fallback 触发条件限定 `401 / 402 / 403 / 429 / 5xx`、网络错误、超时；其他 `4xx` 按设计原样返回。
- 统计里的 `ms` 是「决策耗时」：非流式为完整响应时间，流式为首字节延迟（流本身可能更长）。
- 修改 `proxyPort` 需要重启 DSH。
- 代理端口同一时间只能被一个进程占用；`3121–3130` 都被占时代理不启动，面板会显示错误（插件本身仍可用）。
- 目前只做 chat completions 转发与模型列表聚合，不做 vision / embedding / rerank 路由。

## 开发

```bash
node build.mjs        # app/panel.js → gzip/base64 → lib/client.js
node test/smoke.mjs   # 离线冒烟：mock provider、fallback、流式、key 脱敏、路由、icon
npm pack --dry-run    # 查看发布文件清单
```

目录结构：

```
lib/index.js            宿主插件（面板路由 + 代理生命周期）
lib/core.js             配置、统计、代理引擎、端口顺延（不依赖框架，可单测）
lib/client.template.js  浏览器模块加载器 + 槽位 + 中英文字典
lib/client.js           构建产物（build.mjs 生成）
app/panel.js            React 面板源码（build.mjs gzip 内嵌）
assets/icon.png         512x512 图标（assets/generate_icon.py 生成）
cordis.patch.yml        DSH bundle 补丁（row name 必须等于包名）
test/smoke.mjs          离线冒烟测试
```

## 许可证

MIT —— 见 [LICENSE](./LICENSE)。
