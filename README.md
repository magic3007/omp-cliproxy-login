<div align="center">

**English** · [简体中文](README.zh-CN.md)

<img src="assets/banner.png" alt="omp-gateway-login — log in to any base-URL + API-key model gateway" />

### Log in to any model gateway with a base URL and an API key — every chat model it serves becomes selectable.

<a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-f4c430?style=flat-square" /></a>&nbsp;
<a href="../../releases"><img alt="Latest release" src="https://img.shields.io/github/v/release/magic3007/omp-gateway-login?style=flat-square&color=5f43e9" /></a>&nbsp;
<a href="https://omp.sh"><img alt="omp ≥ 18" src="https://img.shields.io/badge/omp-%E2%89%A518-5f43e9?style=flat-square" /></a>&nbsp;
<a href="package.json"><img alt="Zero dependencies" src="https://img.shields.io/badge/deps-zero-success?style=flat-square" /></a>&nbsp;
<a href="../../commits"><img alt="Last commit" src="https://img.shields.io/github/last-commit/magic3007/omp-gateway-login?style=flat-square" /></a>

</div>

<br>

An [omp](https://omp.sh) ([`@oh-my-pi/pi-coding-agent`](https://github.com/can1357/oh-my-pi), aka oh-my-pi) extension that turns **any** "base URL + API key" gateway into a first-class login provider. CLIProxyAPI is just the archetype: LiteLLM, one-api, new-api, the Volcengine Ark coding plan and in-house routers all work, as long as the endpoint answers `GET <base URL>/v1/models` and speaks Anthropic Messages (or OpenAI Chat Completions).

One installation fronts **as many gateways as you configure**. You name each one during login, and that name is the model prefix.

## Quick start

```bash
omp plugin install git:https://github.com/magic3007/omp-gateway-login
omp plugin doctor                    # every check should be ok

omp login                            # pick "Custom gateway (name + base URL + API key)"
                                     #   ① name        e.g. mafia
                                     #   ② base URL    e.g. https://api.example.com
                                     #   ③ API key     sk-…
                                     #   ④ extra ids   Enter for none
# → Saved gateway "mafia" (48 chat models) … select them as mafia/<id>.

omp models list | grep -E '^(mafia|kafara|volcengine) '
omp -p --model mafia/claude-opus-5-5 "reply with exactly: OK"
```

Repeat the login for each gateway you want — the plugin remembers all of them and registers them on every start.

One more step, because omp's `enabledModels` is a **strict allow-list**: add one glob per gateway name to `~/.omp/agent/config.yml`:

```yaml
enabledModels:
  - mafia/*
  - kafara/*
  - volcengine/*

modelRoles:                             # optional aliases
  mafia-opus: mafia/claude-opus-5-5:auto
  ark-code: volcengine/ark-code-latest:auto
```

## What you get

| Item | Value |
| --- | --- |
| Login entry | `/login` (TUI) or `omp login` (terminal) → `Custom gateway (name + base URL + API key)` |
| Login input | name, base URL, API key, optional extra model ids — all typed by you, **never** read from env vars |
| Model prefix | `<name>/<model id>`, e.g. `mafia/claude-opus-5-5`, `kafara/devin/claude-opus-4-7` |
| Wire | `anthropic-messages` by default, `openai-completions` per gateway in the config file |
| Model source | `GET <base URL>/v1/models`, re-fetched on login and on discovery refresh |
| Gateways per install | unlimited — one entry per name in the config file |

Login **validates the whole triple before storing anything** by pulling the model list once:

- Bad name: `"Bad Name!" is not a usable gateway name (use letters, digits, ".", "_" or "-")`
- Bad URL: `"not-a-url" is not an absolute URL (...)`
- Bad key: `the gateway rejected this API key (HTTP 401)`

A failed login writes nothing: the config file keeps the gateways you already had.

## Adding, updating, removing

Everything lives in one JSON file, `~/.omp/agent/gateways-login.json` (`0600`, plaintext keys — same posture as omp's own credential store):

```json
{
  "providers": [
    { "name": "kafara", "baseUrl": "https://ai.kafara.men", "api": "anthropic-messages",
      "apiKey": "sk-…", "extraModels": [] },
    { "name": "mafia", "baseUrl": "https://api.appintheloop.com", "api": "anthropic-messages",
      "apiKey": "sk-…", "extraModels": [] },
    { "name": "volcengine", "baseUrl": "https://ark.cn-beijing.volces.com/api/coding",
      "api": "anthropic-messages", "apiKey": "…",
      "extraModels": ["ark-code-latest", "doubao-seed-2.0-pro", "glm-5.3"] }
  ]
}
```

- **Add** — run the login entry again with a new name.
- **Update** — run it with an existing name: Enter keeps the stored URL and key, `-` clears the extra ids.
- **Remove** — delete its object from the file (restart omp), or point the key at nothing.

Hand-editing works too: `extraModels` and `api` are the fields the login flow does not ask about, and values are re-validated on load.

## What discovery does with a gateway's catalog

Different gateways describe their catalogs differently, so the plugin normalizes what it can:

- **Dead entries are dropped** — a `status` of `Shutdown`/`Deprecated`/`Retired`/`Deleted`/`Offline` (Volcengine Ark's catalog is mostly tombstones).
- **Non-chat entries are dropped** — image/video/speech ids by keyword, plus anything whose `task_type` lacks `TextGeneration` when the gateway declares task types.
- **Real limits are used when reported** — `token_limits.context_window` / `max_input_tokens` / `context_length` for the context window, `token_limits.max_output_token_length` / `max_tokens` for the output cap; otherwise 200k / 64k.
- **Image input is set from `modalities.input_modalities`** when reported; otherwise models are assumed to accept images.
- **Extra ids cover plan-only names.** Coding plans often serve aliases their `/v1/models` never lists (Ark: `ark-code-latest`, `doubao-seed-2.0-pro`, `glm-5.3`). Those extras are registered with the default 200k / 64k because the gateway reports no metadata for them.
- **Costs are zero.** No gateway in this class reports pricing, so `cost` is always `0` and omp shows `$0.00`.

## Behaviour notes

- **No models while a gateway is unconfigured.** Discovery fails loudly instead of reporting an empty catalog — an empty "success" would be cached as authoritative and hide the models a later login unlocks.
- **A gateway name shadows any same-named `models.yml` provider.** The runtime registration replaces that provider's model list for the session; delete the `models.yml` block if you want the dynamic catalog to be the only source.
- **The terminal login prints `No credentials were stored for …`** even on success. That line is about omp's credential store; this plugin keeps keys in its own file, so there is no second copy. The `Saved gateway …` line above it is the real result, and the models are available to the next omp process.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Model `<name>/…` not found while logged in | `enabledModels` lacks `<name>/*` — see Quick start |
| `the gateway rejected this API key (HTTP 401)` | The key is not valid for that URL, or belongs to a different deployment — each gateway keeps its own key list |
| `did not return a model list` | The URL answers but its `<base>/v1/models` is not a model list; check the base URL (some gateways need the `/v1` or `/api/coding` suffix) |
| No usable models discovered | The catalog is all non-chat entries — add the chat ids you know via `extraModels` |
| `omp plugin install git:…` fails behind a corporate proxy | See below |

### Behind a TLS-intercepting proxy

`omp plugin install git:…` shells out to `bun install`, whose git client can fail to clone through a corporate proxy (`git clone` alone usually still works). Clone by hand and link the checkout:

```bash
git clone https://github.com/magic3007/omp-gateway-login ~/src/omp-gateway-login
cd ~/src/omp-gateway-login && omp plugin link .
```

## Development

```bash
git clone https://github.com/magic3007/omp-gateway-login
cd omp-gateway-login
omp plugin link .        # edits in src/ take effect on the next omp start
```

Zero dependencies: the entry point is TypeScript source (`package.json#omp.extensions: ["src/index.ts"]`) loaded directly by omp's Bun runtime. Host types come through `import type` only; at runtime the extension uses the injected `pi.pi` (for `getAgentDir()`) and `pi.zod` (to validate gateway responses and its own config file).

`assets/` holds the shared artwork: `logo.png` (transparent symbol, for icons and social preview) and `banner.png` (the README hero).

Remove: `omp plugin disable omp-gateway-login` (keep, stop loading) or `omp plugin uninstall omp-gateway-login`.

See [CHANGELOG.md](CHANGELOG.md) for release notes and [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

[MIT](LICENSE)
