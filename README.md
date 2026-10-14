<div align="center">

**English** · [简体中文](README.zh-CN.md)

</div>

# omp-cliproxy-login

An [omp](https://github.com/oh-my-pi/oh-my-pi) extension that adds a **login entry for any CLIProxyAPI gateway**: type the gateway URL and an API key, and every chat model that key can reach appears in omp.

Works with any CLIProxyAPI deployment (the ones that ship a `management.html` panel).

## What you get

| Item | Value |
| --- | --- |
| Login entry | `/login` (TUI) or `omp login` (terminal) → `CLIProxyAPI Gateway (API key)` |
| Login input | ① gateway URL (e.g. `https://your-cliproxy.example.com`) ② API key |
| Credential source | typed by you at login; **never** read from environment variables or config files |
| Model prefix | `cliproxy/<gateway model id>`, e.g. `cliproxy/devin/claude-opus-4-7`, `cliproxy/grok-4.7` |
| Wire | `anthropic-messages` (`POST /v1/messages`) |
| Model source | `GET <gateway>/v1/models`, re-fetched on login and discovery refresh |

Login flow: pick the provider → type the gateway URL → type the API key → the extension immediately validates the pair with one `/v1/models` call. A bad input fails the login and stores nothing:

- Bad URL: `"xxx" is not an absolute URL (...)`
- Bad key: `the gateway rejected this API key (HTTP 401)`

The URL is remembered in `~/.omp/agent/cliproxy-login.json`, so the next login prefills it (press Enter to keep it):

```json
{ "baseUrl": "https://your-cliproxy.example.com" }
```

## Install

```bash
omp plugin install git:https://github.com/magic3007/omp-cliproxy-login
omp plugin doctor          # the entry should be ok
```

Local development (edits take effect immediately):

```bash
cd <repo>
omp plugin link .
```

### Behind a TLS-intercepting proxy

`omp plugin install git:…` shells out to `bun install`, whose git client can fail to clone through a corporate proxy (`git clone` alone usually still works). Clone by hand and link the checkout:

```bash
git clone https://github.com/magic3007/omp-cliproxy-login ~/src/omp-cliproxy-login
cd ~/src/omp-cliproxy-login && omp plugin link .
```

Remove: `omp plugin disable omp-cliproxy-login`, or `omp plugin uninstall omp-cliproxy-login`.

## Use

```bash
omp login                  # pick interactively, or: omp login cliproxy
# type the gateway URL, then the sk-… key
omp models list | grep '^cliproxy'                 # the gateway's chat models
omp -p --model cliproxy/devin/claude-opus-4-7 "reply with exactly: OK"
```

Inside the TUI, `/login` and `/logout` are the same entry points.

## Required: allow-list

omp's `enabledModels` is a **strict allow-list**; a logged-in model is still unselectable while it is missing from it. Add to `~/.omp/agent/config.yml`:

```yaml
enabledModels:
  - cliproxy/*        # or list each cliproxy/devin/claude-opus-4-7 … individually
```

Optional role alias:

```yaml
modelRoles:
  cliproxy-opus: cliproxy/devin/claude-opus-4-7:auto
```

## Behaviour notes

- **Non-chat models are filtered out.** Gateways list image, video and speech models (`gpt-image-*`, `grok-imagine-*`, `grok-tts`, `gemini-*-image`, …) next to the chat ones; the extension drops them by id keyword (`NON_CHAT_MODEL` in `src/index.ts`) so the picker only holds usable chat models.
- **Metadata defaults.** `/v1/models` reports no context or output limits, so every model is registered with 200k / 64k, `reasoning: true`, `input: [text, image]`.
- **No models while logged out.** Discovery fails loudly instead of reporting an empty catalog — an empty "success" would be cached as authoritative and hide the models unlocked by a later login.
- **Switching gateways.** Type a new URL in the next `/login`; the provider is re-registered immediately, no restart needed.
- **One gateway per install.** To run two gateways, install the repo twice with different `PROVIDER_ID`s, or declare the second one in `~/.omp/agent/models.yml`.

## Implementation notes

- Zero dependencies; the entry point is TypeScript source (`package.json#omp.extensions`) loaded directly by omp's Bun runtime.
- Host types are imported with `import type` only; at runtime the extension uses just `getAgentDir()` from the injected `pi.pi`.
