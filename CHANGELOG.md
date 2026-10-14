# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - 2026-10-14

### Changed

- **Renamed** the repository, package and plugin to `omp-gateway` (was `omp-gateway-login`). Uninstall the old id once: `omp plugin uninstall omp-gateway-login`, then install `git:https://github.com/magic3007/omp-gateway`.
- Docs and prompt examples use vendor-neutral gateway names; the config file (`~/.omp/agent/gateways-login.json`) and its format are unchanged.

## [0.2.0] - 2026-10-14

Any "base URL + API key" gateway, and more than one at a time.

### Added

- The login entry now asks for a **gateway name** alongside the base URL and API key, and registers `<name>` as the provider — `litellm/claude-opus-4-1`, `volcengine/ark-code-latest`.
- Unlimited gateways per installation: one entry per name in `~/.omp/agent/gateways-login.json`, all registered at load.
- Optional **extra model ids** for gateways that serve names their `/v1/models` does not list (e.g. the Volcengine Ark coding plan's `ark-code-latest`, `doubao-seed-2.0-pro`, `glm-5.3`).
- Per-gateway `api` override (`anthropic-messages` or `openai-completions`) for the config file.
- Catalog metadata is used when a gateway reports it: context window and output cap from `token_limits`/`max_input_tokens`/`context_length`/`max_tokens`, image input from `modalities.input_modalities`.
- Dead catalog entries (`status: Shutdown`/`Deprecated`/`Retired`/`Deleted`/`Offline`) and non-chat task types (`task_type` without `TextGeneration`) are filtered out.

### Changed

- **Renamed** the repository, package and plugin to `omp-gateway-login` (was `omp-cliproxy-login`), and the config file to `~/.omp/agent/gateways-login.json` (was `providers-login.json`). CLIProxyAPI is one gateway among many, not the subject.
- **Breaking:** the provider is no longer fixed to `cliproxy`; the model prefix is the name you type.
- **Breaking:** configuration moved from `~/.omp/agent/cliproxy-login.json` (URL only) to `~/.omp/agent/gateways-login.json` (all gateways, keys included). Delete the old file; re-add each gateway through the login entry.
- Login validation failures leave the config file untouched.

## [0.1.0] - 2026-10-14

First release.

### Added

- `CLIProxyAPI Gateway (API key)` entry in `/login` (TUI) and `omp login` (terminal) for any CLIProxyAPI deployment.
- Login flow that asks for the gateway URL and an API key, validates the pair against `GET /v1/models` before storing the key, and remembers the URL in `~/.omp/agent/cliproxy-login.json` (mode `0600`).
- Provider `cliproxy` with `anthropic-messages` transport and `fetchDynamicModels` discovery, so the gateway's live chat-model catalog appears after login without editing `models.yml`.
- Non-chat catalog entries (image, video, speech) filtered out by id keyword.
- Provider re-registration when a login supplies a different gateway URL — no restart needed.
- Bilingual docs: `README.md` (English) and `README.zh-CN.md`, plus generated logo/banner artwork under `assets/`.

### Fixed

- Discovery no longer reports an empty catalog while logged out. That empty success was cached as authoritative and hid the models a later login unlocked until the cache TTL expired.

[0.3.0]: https://github.com/magic3007/omp-gateway/releases/tag/v0.3.0
[0.2.0]: https://github.com/magic3007/omp-gateway/releases/tag/v0.2.0
[0.1.0]: https://github.com/magic3007/omp-gateway/releases/tag/v0.1.0
