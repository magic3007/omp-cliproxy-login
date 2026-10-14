<div align="center">

[English](README.md) · **简体中文**

<img src="assets/banner.png" alt="omp-gateway — 面向任意 base URL + API Key 网关的登录入口" />

### 输入网关地址和 API Key 即可登录，该网关下的全部聊天模型直接可选。

<a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-f4c430?style=flat-square" /></a>&nbsp;
<a href="../../releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/magic3007/omp-gateway?style=flat-square&color=5f43e9" /></a>&nbsp;
<a href="https://omp.sh"><img alt="omp ≥ 18" src="https://img.shields.io/badge/omp-%E2%89%A518-5f43e9?style=flat-square" /></a>&nbsp;
<a href="package.json"><img alt="零依赖" src="https://img.shields.io/badge/deps-zero-success?style=flat-square" /></a>&nbsp;
<a href="../../commits"><img alt="Last commit" src="https://img.shields.io/github/last-commit/magic3007/omp-gateway?style=flat-square" /></a>

</div>

<br>

一个 [omp](https://omp.sh)（[`@oh-my-pi/pi-coding-agent`](https://github.com/can1357/oh-my-pi)，即 oh-my-pi）扩展：把**任意**「base URL + API Key」网关变成一等登录 provider——CLIProxyAPI、LiteLLM、one-api、new-api、火山引擎方舟 coding plan、自建路由都可以，只要它响应 `GET <base URL>/v1/models` 且支持 Anthropic Messages（或 OpenAI Chat Completions）。

一份安装可以同时挂**任意多个网关**：登录时你给它起名字，这个名字就是模型前缀。

## 快速开始

```bash
omp plugin install git:https://github.com/magic3007/omp-gateway
omp plugin doctor                    # 每项检查都应是 ok

omp login                            # 选 "Custom gateway (name + base URL + API key)"
                                     #   ① 名字     如 litellm
                                     #   ② 网关地址 如 https://gw.example.com
                                     #   ③ API Key  sk-…
                                     #   ④ 额外模型 id（回车跳过）
# → Saved gateway "litellm" (48 chat models) … select them as litellm/<id>.

omp models list | grep -E '^litellm '
omp -p --model litellm/claude-opus-4-1 "reply with exactly: OK"
```

每个网关重复一次登录即可；插件会记住全部网关，并在每次启动时注册它们。

还差一步：omp 的 `enabledModels` 是**严格白名单**，在 `~/.omp/agent/config.yml` 里为每个网关加一条 glob：

```yaml
enabledModels:
  - litellm/*
  - volcengine/*

modelRoles:                             # 可选别名
  gw-opus: litellm/claude-opus-4-1:auto
  ark-code: volcengine/ark-code-latest:auto
```

## 你会得到什么

| 项 | 值 |
| --- | --- |
| 登录入口 | `/login`（TUI）或 `omp login`（终端）→ `Custom gateway (name + base URL + API key)` |
| 登录输入 | 名字、网关地址、API Key、可选额外模型 id——全部手动输入，**不**读环境变量 |
| 模型前缀 | `<名字>/<模型 id>`，如 `litellm/claude-opus-4-1`、`volcengine/ark-code-latest` |
| 传输 | 默认 `anthropic-messages`，可在配置文件里按网关改成 `openai-completions` |
| 模型来源 | `GET <网关地址>/v1/models`，登录与发现刷新时重新拉取 |
| 网关数量 | 不限，配置文件里每个名字一条 |

登录**先整体校验再入库**（拉一次模型列表）：

- 名字非法：`"Bad Name!" is not a usable gateway name (use letters, digits, ".", "_" or "-")`
- 地址非法：`"not-a-url" is not an absolute URL (...)`
- Key 非法：`the gateway rejected this API key (HTTP 401)`

校验失败**不写任何东西**，配置文件里原有网关保持原样。

## 新增 / 修改 / 删除

所有内容在一个 JSON 文件里：`~/.omp/agent/gateways-login.json`（`0600`，Key 为明文，与 omp 自带凭证库同等级）：

```json
{
  "providers": [
    { "name": "litellm", "baseUrl": "https://gw.example.com", "api": "anthropic-messages",
      "apiKey": "sk-…", "extraModels": [] },
    { "name": "volcengine", "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
      "api": "anthropic-messages", "apiKey": "…",
      "extraModels": ["ark-code-latest", "doubao-seed-2.0-pro", "glm-5.3"] }
  ]
}
```

- **新增**：再跑一次登录入口，换个新名字。
- **修改**：用已有名字再跑一次；地址和 Key 直接回车沿用，额外 id 输入 `-` 清空。
- **删除**：从文件里删掉该对象（重启 omp 生效）。

也可以直接手改：`extraModels` 和 `api` 是登录流程不问的两个字段，加载时会重新校验。

## 发现逻辑对网关目录做了什么

各家网关对目录的描述不一样，插件做归一化：

- **剔除已下线条目**：`status` 为 `Shutdown`/`Deprecated`/`Retired`/`Deleted`/`Offline` 的直接丢掉（火山引擎方舟目录里绝大多数是墓碑条目）。
- **剔除非聊天条目**：按 id 关键字过滤图像/视频/语音，以及网关声明了 `task_type` 时不含 `TextGeneration` 的条目。
- **网关报了真实上限就用真实的**：上下文取 `token_limits.context_window` / `max_input_tokens` / `context_length`，输出上限取 `token_limits.max_output_token_length` / `max_tokens`；都没有才回落 200k / 64k。
- **图片输入能力**：按 `modalities.input_modalities` 判断；未报告时按支持图片处理。
- **额外 id 解决「套餐专属别名」**：coding plan 常见的情况是 `/v1/models` 不列它实际提供的别名（方舟：`ark-code-latest`、`doubao-seed-2.0-pro`、`glm-5.3`）。这些额外 id 因网关不提供元数据，按 200k / 64k 注册。
- **成本恒为 0**：这类网关不提供价格，`cost` 全 0，omp 显示 `$0.00`。

## 行为细节

- **网关没配好时不报空目录**：发现阶段直接报错，而不是返回「空目录」。空的成功结果会被当成权威缓存，把之后登录解锁的模型一直挡住。
- **网关名会遮蔽 `models.yml` 里同名 provider**：运行时注册会替换该 provider 当次会话的模型列表；想让动态目录成为唯一来源，就删掉 `models.yml` 里那段。
- **终端登录会多打一行 `No credentials were stored for …`**：这行说的是 omp 自带凭证库；本插件把 Key 存在自己的文件里，不产生第二份副本。上面那行 `Saved gateway …` 才是真实结果，模型对下一个 omp 进程即可用。

## 排查

| 现象 | 原因 / 处理 |
| --- | --- |
| 已登录但 `<名字>/…` 模型 not found | `enabledModels` 缺 `<名字>/*`，见「快速开始」 |
| `the gateway rejected this API key (HTTP 401)` | 该 Key 不属于你给的地址；每个网关有独立的 Key 列表 |
| `did not return a model list` | 地址能通但 `<base>/v1/models` 不是模型列表；检查地址后缀（有的网关需要带 `/v1` 或 `/api/coding`） |
| 没发现任何可用模型 | 目录里全是非聊天条目；用 `extraModels` 手动补上你已知的聊天 id |
| 公司 TLS 代理下 `omp plugin install git:…` 失败 | 见下一节 |

### 公司 TLS 代理下装不上

`omp plugin install git:…` 实际调用 `bun install`，它的 git 客户端在公司代理下可能 clone 失败（`git clone` 本身通常没问题）。手动 clone 后软链进去：

```bash
git clone https://github.com/magic3007/omp-gateway ~/src/omp-gateway
cd ~/src/omp-gateway && omp plugin link .
```

## 开发

```bash
git clone https://github.com/magic3007/omp-gateway
cd omp-gateway
omp plugin link .        # 改 src/ 下次启动 omp 生效
```

零依赖：入口是 TS 源码（`package.json#omp.extensions: ["src/index.ts"]`），由 omp 的 Bun 运行时直接加载。宿主类型只走 `import type`；运行期用到注入的 `pi.pi`（取 `getAgentDir()`）和 `pi.zod`（校验网关响应与自己的配置文件）。

`assets/` 是共用美术资源：`logo.png`（透明底图标，可用于社交预览/图标）、`banner.png`（README 头图）。

卸载：`omp plugin disable omp-gateway`（停用）或 `omp plugin uninstall omp-gateway`。

发版记录见 [CHANGELOG.md](CHANGELOG.md)；提 PR 前先看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

[MIT](LICENSE)
