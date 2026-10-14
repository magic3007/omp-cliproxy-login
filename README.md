# omp-kafara-login

给 omp 增加一个「粘贴 API Key 即可登录」的 provider，登录后自动发现网关下**全部聊天模型**。

适用对象：CLIProxyAPI 一类的聚合网关（本插件默认指向 `https://ai.kafara.men`，与 `management.html` 同一实例）。

## 效果

| 项 | 值 |
|---|---|
| 登录入口 | `/login`（TUI）或 `omp login`（终端），列表里出现 `Kafara Gateway (API key)` |
| 凭证来源 | 登录时由用户手动粘贴，**不读环境变量**、不读配置文件 |
| 模型前缀 | `kafara/<网关模型 id>`，如 `kafara/devin/claude-opus-4-7`、`kafara/grok-4.7` |
| 传输 | `anthropic-messages`（`POST /v1/messages`），baseUrl `https://ai.kafara.men/v1` |
| 模型来源 | 每次登录/刷新时拉 `GET /v1/models`（动态发现） |

登录流程：选 provider → 粘贴 key → 插件立刻用该 key 拉一次 `/v1/models` 校验。key 无效直接报 `the gateway rejected this API key (HTTP 401)`，不会写进凭证库。

## 安装

```bash
omp plugin install git:https://github.com/<you>/omp-kafara-login
omp plugin doctor          # 条目应为 ok
```

本地开发用软链：

```bash
cd <repo>
omp plugin link .
```

卸载：`omp plugin disable omp-kafara-login`（停用）或 `omp plugin uninstall omp-kafara-login`。

## 使用

```bash
omp login                  # 交互选择；或 omp login kafara
# 粘贴 sk-… 后：
omp models list | grep '^kafara'   # 应看到该网关的聊天模型
omp -p --model kafara/devin/claude-opus-4-7 "reply with exactly: OK"
```

TUI 内用 `/login`、`/logout` 同样入口。

## 必需的一步：白名单

omp 的 `enabledModels` 是**严格白名单**；不在其中时模型已登录也选不到。在 `~/.omp/agent/config.yml` 加：

```yaml
enabledModels:
  - kafara/*        # 或逐个写 kafara/devin/claude-opus-4-7 …
```

`modelRoles` 里加别名（可选）：

```yaml
modelRoles:
  kafara-opus: kafara/devin/claude-opus-4-7:auto
```

## 行为细节

- **非聊天模型被过滤**：网关的 `/v1/models` 里混着 `gpt-image-*`、`grok-imagine-*`、`grok-tts`、`gemini-*-image` 等图像/视频/语音条目，插件按 id 关键字剔除（见 `src/index.ts` 的 `NON_CHAT_MODEL`），只注册聊天模型。
- **元数据兜底**：`/v1/models` 不返回上下文/输出上限，插件统一按 200k / 64k 注册，并按 `reasoning: true`、`input: [text, image]` 注册。
- **未登录时该 provider 无模型**：没 key 就不列模型，避免出现必失败的选项。
- **改默认网关**：把 `src/index.ts` 的 `BASE_URL` 换成自己的网关根地址（带不带 `/v1` 都行）。

## 实现约束

- 包内零依赖，扩展入口是 TS 源码（`package.json#omp.extensions`），由 omp 的 Bun 运行时直接加载。
- 只用 `import type` 引用宿主类型，运行时不解析任何宿主包。
