<div align="center">

**English** · [简体中文](README.zh-CN.md)

<img src="assets/banner.png" alt="omp-cliproxy-login — a /login entry for any CLIProxyAPI gateway" />

### Log in to any CLIProxyAPI gateway — type its URL + API key, get every chat model it serves.

<a href="LICENSE"><img alt="License: MIT" src="https://img.shields.io/badge/license-MIT-f4c430?style=flat-square" /></a>&nbsp;
<a href="https://omp.sh"><img alt="omp ≥ 18" src="https://img.shields.io/badge/omp-%E2%89%A518-5f43e9?style=flat-square" /></a>&nbsp;
<a href="package.json"><img alt="Zero dependencies" src="https://img.shields.io/badge/deps-zero-success?style=flat-square" /></a>&nbsp;
<a href="../../commits"><img alt="Last commit" src="https://img.shields.io/github/last-commit/magic3007/omp-cliproxy-login?style=flat-square" /></a>

</div>

<br>

An [omp](https://omp.sh) ([`@oh-my-pi/pi-coding-agent`](https://github.com/can1357/oh-my-pi), aka oh-my-pi) extension that turns any CLIProxyAPI deployment — the kind that ships a `management.html` admin panel — into a first-class login provider. Log in once from the terminal and the gateway's whole live chat-model catalog becomes selectable, without editing `models.yml`, without touching an environment variable.

## Quick start

```bash
omp plugin install git:https://github.com/magic3007/omp-cliproxy-login
omp plugin doctor                    # every check should be ok

omp login                            # pick "CLIProxyAPI Gateway (API key)"
                                     #   ① paste the gateway URL   (https://your-cliproxy.example.com)
                                     #   ② paste the API key       (sk-…)

omp models list | grep '^cliproxy'   # the gateway's chat models, freshly discovered
omp -p --model cliproxy/devin/claude-opus-4-7 "reply with exactly: OK"
```

One more step, because omp's `enabledModels` is a **strict allow-list** — add this to `~/.omp/agent/config.yml`:

```yaml
enabledModels:
  - cliproxy/*                          # or list individual cliproxy/… ids

modelRoles:                             # optional alias
  cliproxy-opus: cliproxy/devin/claude-opus-4-7:auto
```

## What you get

| Item | Value |
| --- | --- |
| Login entry | `/login` (TUI) or `omp login` (terminal) → `CLIProxyAPI Gateway (API key)` |
| Login input | ① gateway URL ② API key — both typed by you, **never** read from env vars or config files |
| Model prefix | `cliproxy/<gateway model id>`, e.g. `cliproxy/devin/claude-opus-4-7`, `cliproxy/grok-4.7` |
| Wire | `anthropic-messages` (`POST /v1/messages`) |
| Model source | `GET <gateway>/v1/models`, re-fetched on login and on discovery refresh |
| Logout | `/logout` or `omp auth` handles the stored credential like any built-in provider's |

The login **validates the URL + key pair before storing anything** by pulling the model list once:

- Bad URL: `"xxx" is not an absolute URL (...)`
- Bad key: `the gateway rejected this API key (HTTP 401)`

A stored URL lives in `~/.omp/agent/cliproxy-login.json` (`0600`), so the next login prefills it — press Enter to keep it, or type a new one to switch gateways (the provider re-registers immediately, no restart):

```json
{ "baseUrl": "https://your-cliproxy.example.com" }
```

## Behaviour notes

- **Non-chat models are filtered out.** Gateways list image, video and speech models (`gpt-image-*`, `grok-imagine-*`, `grok-tts`, `gemini-*-image`, …) next to the chat ones; the extension drops them by id keyword, so the picker only holds usable chat models (`NON_CHAT_MODEL` in `src/index.ts`).
- **Metadata defaults.** `/v1/models` reports no context or output limits, so every model registers with 200k / 64k, `reasoning: true`, `input: [text, image]`.
- **No models while logged out.** Discovery fails loudly instead of reporting an empty catalog — an empty "success" would be cached as authoritative and hide the models a later login unlocks.
- **One gateway per install.** To front two gateways, install the repo twice under different `PROVIDER_ID`s, or declare the second one in `~/.omp/agent/models.yml`.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| Model "cliproxy/…" not found while logged in | `enabledModels` lacks `cliproxy/*` — see Quick start |
| `the gateway rejected this API key (HTTP 401)` | The key is not valid for the URL you gave, or it belongs to a different deployment — each CLIProxyAPI instance has its own key list |
| Login shows no models at all | `/v1/models` answered but only contained image/video/speech entries — nothing chat-usable exists for that key |
| `omp plugin install git:…` fails behind a corporate proxy | See below |

### Behind a TLS-intercepting proxy

`omp plugin install git:…` shells out to `bun install`, whose git client can fail to clone through a corporate proxy (`git clone` alone usually still works). Clone by hand and link the checkout:

```bash
git clone https://github.com/magic3007/omp-cliproxy-login ~/src/omp-cliproxy-login
cd ~/src/omp-cliproxy-login && omp plugin link .
```

## Development

```bash
git clone https://github.com/magic3007/omp-cliproxy-login
cd omp-cliproxy-login
omp plugin link .        # edits in src/ take effect immediately
```

Zero dependencies: the entry point is TypeScript source (`package.json#omp.extensions: ["src/index.ts"]`) loaded directly by omp's Bun runtime. Host types come through `import type` only; the one runtime host dependency is `getAgentDir()`, taken from the injected `pi.pi`.

`assets/` holds the shared artwork: `logo.png` (transparent symbol, for icons and social preview) and `banner.png` (the README hero).

Remove: `omp plugin disable omp-cliproxy-login` (keep, stop loading) or `omp plugin uninstall omp-cliproxy-login`.

See [CHANGELOG.md](CHANGELOG.md) for release notes and [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request.

## License

[MIT](LICENSE)
