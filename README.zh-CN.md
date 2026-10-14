<div align="center">

[English](README.md) · **简体中文**

</div>

# omp-cliproxy-login

给 [omp](https://github.com/oh-my-pi/oh-my-pi) 增加一个**面向任意 CLIProxyAPI 网关的登录入口**：输入网关地址 + API Key，该 Key 能访问到的全部聊天模型就出现在 omp 里。

适用于任何 CLIProxyAPI 部署（自带 `management.html` 面板的那种聚合网关）。

## 效果

| 项 | 值 |
| --- | --- |
| 登录入口 | `/login`（TUI）或 `omp login`（终端）→ `CLIProxyAPI Gateway (API key)` |
| 登录输入 | ① 网关地址（如 `https://your-cliproxy.example.com`）② API Key |
| 凭证来源 | 登录时由你手动输入，**不**读环境变量、不读配置文件 |
| 模型前缀 | `cliproxy/<网关模型 id>`，如 `cliproxy/devin/claude-opus-4-7`、`cliproxy/grok-4.7` |
| 传输 | `anthropic-messages`（`POST /v1/messages`） |
| 模型来源 | `GET <网关地址>/v1/models`，登录与刷新时重新拉取 |

登录流程：选 provider → 输入网关地址 → 输入 API Key → 插件立刻用这对参数拉一次 `/v1/models` 校验。任一项不对就登录失败且不落库：

- 地址无效：`"xxx" is not an absolute URL (...)`
- Key 无效：`the gateway rejected this API key (HTTP 401)`

网关地址记在 `~/.omp/agent/cliproxy-login.json`，下次登录该提示会预填，直接回车沿用：

```json
{ "baseUrl": "https://your-cliproxy.example.com" }
```

## 安装

```bash
omp plugin install git:https://github.com/magic3007/omp-cliproxy-login
omp plugin doctor          # 条目应为 ok
```

本地开发（改动即时生效）：

```bash
cd <repo>
omp plugin link .
```

### 公司 TLS 代理下装不上

`omp plugin install git:…` 实际调用 `bun install`，它的 git 客户端在公司代理下可能 clone 失败（`git clone` 本身通常没问题）。手动 clone 后软链进去：

```bash
git clone https://github.com/magic3007/omp-cliproxy-login ~/src/omp-cliproxy-login
cd ~/src/omp-cliproxy-login && omp plugin link .
```

卸载：`omp plugin disable omp-cliproxy-login` 或 `omp plugin uninstall omp-cliproxy-login`。

## 使用

```bash
omp login                  # 交互选择；或 omp login cliproxy
# 输入网关地址 → 输入 sk-… 后：
omp models list | grep '^cliproxy'                 # 该网关的聊天模型
omp -p --model cliproxy/devin/claude-opus-4-7 "reply with exactly: OK"
```

TUI 内 `/login`、`/logout` 是同一入口。

## 必需的一步：白名单

omp 的 `enabledModels` 是**严格白名单**；不在其中时模型即使已登录也选不到。在 `~/.omp/agent/config.yml` 加：

```yaml
enabledModels:
  - cliproxy/*        # 或逐个写 cliproxy/devin/claude-opus-4-7 …
```

可选的角色别名：

```yaml
modelRoles:
  cliproxy-opus: cliproxy/devin/claude-opus-4-7:auto
```

## 行为细节

- **过滤非聊天模型**：网关的 `/v1/models` 里混着图像/视频/语音条目（`gpt-image-*`、`grok-imagine-*`、`grok-tts`、`gemini-*-image` …），插件按 id 关键字剔除（见 `src/index.ts` 的 `NON_CHAT_MODEL`），选择器里只留可用的聊天模型。
- **元数据兜底**：`/v1/models` 不返回上下文/输出上限，故统一按 200k / 64k，`reasoning: true`、`input: [text, image]` 注册。
- **未登录时不报空目录**：发现失败会显式报错，而不是返回“空目录”。空的成功结果会被当成权威缓存，把之后登录解锁的模型一直挡住。
- **换网关**：下次 `/login` 时输入新地址即可；地址变化会立刻重新注册 provider，无需重启。
- **一个安装一个网关**：要同时接两个，把仓库装两份（改 `PROVIDER_ID`），或先用 `~/.omp/agent/models.yml` 声明第二个。

## 实现约束

- 零依赖；扩展入口是 TS 源码（`package.json#omp.extensions`），由 omp 的 Bun 运行时直接加载。
- 宿主类型只用 `import type`；运行期只从注入的 `pi.pi` 取 `getAgentDir()`。
