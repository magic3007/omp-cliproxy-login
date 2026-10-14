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

## 安装

```bash
omp plugin install git:https://github.com/magic3007/omp-gateway
```

## 登录

```bash
omp login                            # 选 "Custom gateway (name + base URL + API key)"
                                     #   ① 名字     如 litellm
                                     #   ② 网关地址 如 https://gw.example.com
                                     #   ③ API Key  sk-…
                                     #   ④ 额外模型 id（回车跳过）
# → Saved gateway "litellm" (48 chat models) … select them as litellm/<id>.
```

名字、地址、Key 会先用一次模型列表请求整体校验再入库；Key 或地址不对就直接登录失败，不会留下坏掉的网关。每个网关重复一次登录即可，插件会在每次启动时注册全部网关。

## 开启模型

omp 的 `enabledModels` 是严格白名单，在 `~/.omp/agent/config.yml` 里为每个网关加一条 glob：

```yaml
enabledModels:
  - litellm/*
  - volcengine/*

modelRoles:                             # 可选别名
  gw-opus: litellm/claude-opus-4-1:auto
  ark-code: volcengine/ark-code-latest:auto
```

之后与其他模型用法一致：

```bash
omp models list | grep -E '^litellm '
omp -p --model litellm/claude-opus-4-1 "reply with exactly: OK"
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

模型发现会剔除不可用于聊天的条目（图像/视频/语音，以及网关标记为下线或废弃的条目），并采用网关报告的上下文与输出上限，未报告时回落 200k / 64k。

## 管理网关

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
- **删除**：从文件里删掉该对象并重启 omp。
- **`extraModels`**：网关实际提供但 `/v1/models` 不列的模型 id（套餐专属别名，如方舟 coding plan 的 `ark-code-latest`）。
- **`api`**：只支持 OpenAI Chat Completions 的网关改成 `openai-completions`。

也可以直接手改：`extraModels` 和 `api` 是登录流程不问的两个字段，加载时会重新校验。

## 开发

```bash
git clone https://github.com/magic3007/omp-gateway
cd omp-gateway
omp plugin link .        # 改 src/ 下次启动 omp 生效
```

零依赖：入口是 TS 源码（`package.json#omp.extensions: ["src/index.ts"]`），由 omp 的 Bun 运行时直接加载；宿主类型只走 `import type`。

卸载：`omp plugin disable omp-gateway`（停用）或 `omp plugin uninstall omp-gateway`。

发版记录见 [CHANGELOG.md](CHANGELOG.md)；提 PR 前先看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

[MIT](LICENSE)
