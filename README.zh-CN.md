<div align="center">

[English](README.md) · **简体中文**

<img src="assets/banner.png" alt="omp-model-gateway — 面向任意 base URL + API Key 网关的登录入口" />

### 输入网关地址和 API Key 即可登录，该网关下的全部聊天模型直接可选。

<a href="https://www.npmjs.com/package/omp-model-gateway"><img alt="npm version" src="https://img.shields.io/npm/v/omp-model-gateway?style=flat-square&color=cb3837" /></a>&nbsp;
<a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-f4c430?style=flat-square" /></a>&nbsp;
<a href="../../actions/workflows/ci.yml"><img alt="CI" src="https://img.shields.io/github/actions/workflow/status/magic3007/omp-model-gateway/ci.yml?branch=master&style=flat-square&label=CI" /></a>&nbsp;
<a href="../../releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/magic3007/omp-model-gateway?style=flat-square&color=5f43e9" /></a>&nbsp;
<a href="https://omp.sh"><img alt="omp ≥ 18.2.3" src="https://img.shields.io/badge/omp-%E2%89%A518.2.3-5f43e9?style=flat-square" /></a>&nbsp;
<a href="package.json"><img alt="零依赖" src="https://img.shields.io/badge/deps-zero-success?style=flat-square" /></a>&nbsp;
<a href="../../commits"><img alt="Last commit" src="https://img.shields.io/github/last-commit/magic3007/omp-model-gateway?style=flat-square" /></a>

</div>

<br>

一个 [omp](https://omp.sh)（[`@oh-my-pi/pi-coding-agent`](https://github.com/can1357/oh-my-pi)，即 oh-my-pi）扩展：把**任意**「base URL + API Key」网关变成一等登录 provider——CLIProxyAPI、LiteLLM、one-api、new-api、火山引擎方舟 coding plan、自建路由都可以，只要它响应 `GET <base URL>/v1/models` 且支持 Anthropic Messages（或 OpenAI Chat Completions）。

一份安装可以同时挂**任意多个网关**：登录时你给它起名字，这个名字就是模型前缀。

## 安装

需要 [omp](https://omp.sh) ≥ 18.2.3（`@oh-my-pi/pi-coding-agent`），即加载本扩展的 agent。

```bash
omp plugin install omp-model-gateway
```

也可以直接从 git 安装：`omp plugin install github:magic3007/omp-model-gateway`。不要省略 npm 包名里的 `model`——`omp-gateway` 是另一个无关项目。

从早先的 `omp-gateway` id 过来？迁移一次即可：先 `omp plugin uninstall omp-gateway`，再按上面的命令安装。其他都不用动：配置文件和其中的网关条目原地保留。

## 登录

```bash
omp login                            # 选 "Custom gateway (name + base URL + API key)"
                                     #   ① 名字     如 litellm
                                     #   ② 网关地址 如 https://gw.example.com
                                     #   ③ key      LITELLM_API_KEY，或 sk-…，或 !pass show gw
                                     #   ④ 额外模型 id（回车跳过）
# → Saved gateway "litellm" (48 chat models) … select them as litellm/<id>. Key stored as the reference LITELLM_API_KEY.
```

名字、地址、key 会先用一次模型列表请求整体校验再入库；key 或地址不对就直接登录失败，不会留下坏掉的网关。每个网关重复一次登录即可，插件会在每次启动时注册全部网关。**写进配置文件的是你输入的那个引用（reference），不是密钥本身**（见[Key 引用](#key-引用)）。（终端登录末尾那句「是否存了凭证」说的是 omp 自带凭证库；本插件把引用存在自己的文件里，由 omp 去解析。）

## 开启模型

如果你的 `~/.omp/agent/config.yml` 里已有 `enabledModels` 白名单，就为每个网关加一条 glob；没有这份白名单时，发现到的模型本来就可选：

```yaml
enabledModels:
  - litellm/*
  - volcengine/*

modelRoles:                             # 可选别名
  gw-opus: litellm/claude-opus-4-1:auto
  ark-code: volcengine/ark-code-latest:auto   # :auto 是 omp 的思考档位后缀
```

之后与其他模型用法一致：

```bash
omp models list litellm
omp -p --model litellm/claude-opus-4-1 "reply with exactly: OK"
```

## 你会得到什么

| 项 | 值 |
| --- | --- |
| 登录入口 | `/login`（TUI）或 `omp login`（终端）→ `Custom gateway (name + base URL + API key)` |
| 登录输入 | 名字、网关地址、key **或 key 引用**（环境变量名、`!命令`、字面量）、可选额外模型 id |
| 模型前缀 | `<名字>/<模型 id>`，如 `litellm/claude-opus-4-1`、`volcengine/ark-code-latest` |
| 传输 | 默认 `anthropic-messages`；只支持 OpenAI 的网关在配置文件里改成 `openai-completions` |
| 模型来源 | `GET <网关地址>/v1/models`，登录与发现刷新时重新拉取 |
| 网关数量 | 不限，配置文件里每个名字一条 |

模型发现会剔除不可用于聊天的条目（图像/视频/语音，以及网关标记为下线或废弃的条目），并采用网关报告的上下文与输出上限，未报告时回落 200k / 64k。

模型 id（也就是选择器里写的部分）与网关列出的完全一致。omp 显示的名称（状态栏、选择器）：网关报告了显示名就用显示名；否则用去掉上游来源前缀的 id（`devin/claude-opus-5-5` 显示为 `claude-opus-5-5`）。两个 id 去前缀后同名时（`devin/gpt-6-luna` 与 `gpt-6-luna`），带前缀的那个在括号里注明来源：`gpt-6-luna (devin)`。

## 管理网关

所有内容在一个 JSON 文件里：`~/.omp/agent/gateways-login.json`（`0600`）：

```json
{
  "providers": [
    { "name": "litellm", "baseUrl": "https://gw.example.com", "api": "anthropic-messages",
      "apiKey": "LITELLM_API_KEY", "extraModels": [] },
    { "name": "volcengine", "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
      "api": "anthropic-messages", "apiKey": "VE_CODE_API_KEY",
      "extraModels": ["ark-code-latest", "doubao-seed-2.0-pro", "glm-5.3"] }
  ]
}
```

- **新增**：再跑一次登录入口，换个新名字。
- **修改**：用已有名字再跑一次；地址和 key 引用直接回车沿用，额外 id 输入 `-` 清空。
- **删除**：从文件里删掉该对象并重启 omp。
- **`extraModels`**：网关实际提供但 `/v1/models` 不列的模型 id（套餐专属别名，如方舟 coding plan 的 `ark-code-latest`）。
- **`api`**：只支持 OpenAI Chat Completions 的网关改成 `openai-completions`。

### Key 引用

`apiKey` 是**引用**而非一定是密钥：omp 在每次用到 key 时按自己的规则解析（`resolveConfigValue`，与 `models.yml` 同一套）。

| 写法 | omp 实际使用 | 适用场景 |
| --- | --- | --- |
| `LITELLM_API_KEY` | 该环境变量的值 | 常规做法——密钥只留在 shell 环境里 |
| `!gpg -q -d ~/.omp/keys/gateway.gpg` | 该命令 stdout（去掉首尾空白） | 密钥放加密文件、`pass show …`、`op read …`、钥匙串查询 |
| `sk-…` | 字面量本身 | 临时试用；此时文件里就是密钥 |

所以这个文件可以放心进 dotfiles 仓库：它只记录密钥从哪来，不必包含密钥。登录入口同样只写引用——你粘贴的明文 key 如果已存在于某个环境变量里，它会改存那个变量名，并在输出里说明。完整的安全说明见 [SECURITY.md](SECURITY.md)。

环境变量形式有两点要注意：变量必须在**每个启动 omp 的 shell** 里 export；没设置的名字会按 omp 规则当字面量发出去，登录流程会直接这样报给你。`!command` 以你的用户身份经 `/bin/sh -c` 执行，omp 按进程缓存其输出，所以交互式的 `gpg`/`op` 提示每次 omp 运行只出现一次——登录本身会再跑一次。

也可以直接手改：`extraModels` 和 `api` 是登录流程不问的两个字段。每一行单独校验，写错只影响那一个网关；但只要还有坏行，登录入口会拒绝执行，而不是把文件原样写回时丢掉它。

地址按「网关根」存储（`https://gw.example.com`，末尾的 `/v1` 会被去掉）：发现时由插件补 `/v1/models`，OpenAI 传输需要的 `/v1` 也由插件补。手改文件后执行 `omp models refresh` 刷新模型缓存。

## 开发

```bash
git clone https://github.com/magic3007/omp-model-gateway
cd omp-model-gateway
bun install              # 仅开发用：TypeScript 与 omp 宿主类型
omp plugin link .        # 改 src/ 下次启动 omp 生效
bun run typecheck && bun test
```

无运行时依赖：入口是 TS 源码（`package.json#omp.extensions: ["src/index.ts"]`），由 omp 的 Bun 运行时直接加载；宿主类型只走 `import type`。

卸载：`omp plugin disable omp-model-gateway`（停用）或 `omp plugin uninstall omp-model-gateway`。

发版记录见 [CHANGELOG.md](CHANGELOG.md)；提 PR 前先看 [CONTRIBUTING.md](CONTRIBUTING.md)；Key 的存储方式见 [SECURITY.md](SECURITY.md)。

## 许可

[MIT](LICENSE)
