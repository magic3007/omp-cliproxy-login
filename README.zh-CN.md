<div align="center">

[English](README.md) · **简体中文**

<img src="assets/banner.png" alt="omp-cliproxy-login — 面向任意 CLIProxyAPI 网关的 /login 入口" />

### 给任意 CLIProxyAPI 网关加一个 `/login` 入口：输入地址 + API Key，全部聊天模型自动出现。

<a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-f4c430?style=flat-square" /></a>&nbsp;
<a href="https://omp.sh"><img alt="omp ≥ 18" src="https://img.shields.io/badge/omp-%E2%89%A518-5f43e9?style=flat-square" /></a>&nbsp;
<a href="package.json"><img alt="零依赖" src="https://img.shields.io/badge/deps-zero-success?style=flat-square" /></a>&nbsp;
<a href="../../commits"><img alt="Last commit" src="https://img.shields.io/github/last-commit/magic3007/omp-cliproxy-login?style=flat-square" /></a>

</div>

<br>

一个 [omp](https://omp.sh)（[`@oh-my-pi/pi-coding-agent`](https://github.com/can1357/oh-my-pi)，即 oh-my-pi）扩展：把任何 CLIProxyAPI 部署（自带 `management.html` 面板的那种聚合网关）变成一等登录 provider。在终端登录一次，网关下当前的全部聊天模型即可直接选择，不用改 `models.yml`，也不碰任何环境变量。

## 快速开始

```bash
omp plugin install git:https://github.com/magic3007/omp-cliproxy-login
omp plugin doctor                    # 每项检查都应是 ok

omp login                            # 选 "CLIProxyAPI Gateway (API key)"
                                     #   ① 粘贴网关地址（https://your-cliproxy.example.com）
                                     #   ② 粘贴 API Key（sk-…）

omp models list | grep '^cliproxy'   # 刚发现出来的网关聊天模型
omp -p --model cliproxy/devin/claude-opus-4-7 "reply with exactly: OK"
```

还差一步：omp 的 `enabledModels` 是**严格白名单**——在 `~/.omp/agent/config.yml` 里加：

```yaml
enabledModels:
  - cliproxy/*                          # 或逐个写 cliproxy/… 的 id

modelRoles:                             # 可选别名
  cliproxy-opus: cliproxy/devin/claude-opus-4-7:auto
```

## 你会得到什么

| 项 | 值 |
| --- | --- |
| 登录入口 | `/login`（TUI）或 `omp login`（终端）→ `CLIProxyAPI Gateway (API key)` |
| 登录输入 | ① 网关地址 ② API Key——都由你手动输入，**不**读环境变量、不读配置文件 |
| 模型前缀 | `cliproxy/<网关模型 id>`，如 `cliproxy/devin/claude-opus-4-7`、`cliproxy/grok-4.7` |
| 传输 | `anthropic-messages`（`POST /v1/messages`） |
| 模型来源 | `GET <网关地址>/v1/models`，登录与发现刷新时重新拉取 |
| 登出 | 与内置 provider 相同：`/logout`，或用 `omp auth` 管理已存凭证 |

登录**先校验 URL + Key 这对参数再入库**：先拉一次模型列表——

- 地址无效：`"xxx" is not an absolute URL (...)`
- Key 无效：`the gateway rejected this API key (HTTP 401)`

已存地址记在 `~/.omp/agent/cliproxy-login.json`（`0600`），下次登录预填该地址：回车沿用，或输入新地址直接换网关（provider 立即重新注册，无需重启）：

```json
{ "baseUrl": "https://your-cliproxy.example.com" }
```

## 行为细节

- **过滤非聊天模型**：网关的 `/v1/models` 里混着图像/视频/语音条目（`gpt-image-*`、`grok-imagine-*`、`grok-tts`、`gemini-*-image` …），插件按 id 关键字剔除，选择器里只留可用的聊天模型（见 `src/index.ts` 的 `NON_CHAT_MODEL`）。
- **元数据兜底**：`/v1/models` 不返回上下文/输出上限，故统一按 200k / 64k、`reasoning: true`、`input: [text, image]` 注册。
- **未登录时不报空目录**：发现失败会显式报错，而不是返回“空目录”。空的成功结果会被当成权威缓存，把之后登录解锁的模型一直挡住。
- **一个安装一个网关**：要同时接两个，把仓库装两份（改 `PROVIDER_ID`），或先用 `~/.omp/agent/models.yml` 声明第二个。

## 排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 已登录但 `cliproxy/…` 模型 not found | `enabledModels` 没有 `cliproxy/*`，见「快速开始」 |
| `the gateway rejected this API key (HTTP 401)` | 该 Key 不属于你给的 URL；CLIProxyAPI 每个部署有独立的 Key 列表 |
| 登录成功但一个模型都没有 | 该 Key 的 `/v1/models` 只有图像/视频/语音条目，没有可用聊天模型 |
| 公司 TLS 代理下 `omp plugin install git:…` 失败 | 见下一节 |

### 公司 TLS 代理下装不上

`omp plugin install git:…` 实际调用 `bun install`，它的 git 客户端在公司代理下可能 clone 失败（`git clone` 本身通常没问题）。手动 clone 后软链进去：

```bash
git clone https://github.com/magic3007/omp-cliproxy-login ~/src/omp-cliproxy-login
cd ~/src/omp-cliproxy-login && omp plugin link .
```

## 开发

```bash
git clone https://github.com/magic3007/omp-cliproxy-login
cd omp-cliproxy-login
omp plugin link .        # 改 src/ 即时生效
```

零依赖：入口是 TS 源码（`package.json#omp.extensions: ["src/index.ts"]`），由 omp 的 Bun 运行时直接加载。宿主类型只走 `import type`；运行时唯一的宿主依赖是从注入的 `pi.pi` 取的 `getAgentDir()`。

`assets/` 是共用美术资源：`logo.png`（透明底图标，可用于社交预览/图标）、`banner.png`（README 头图）。

卸载：`omp plugin disable omp-cliproxy-login`（停用）或 `omp plugin uninstall omp-cliproxy-login`。

发版记录见 [CHANGELOG.md](CHANGELOG.md)；提 PR 前先看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

[MIT](LICENSE)
