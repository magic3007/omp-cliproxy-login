# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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

[0.1.0]: https://github.com/magic3007/omp-cliproxy-login/releases/tag/v0.1.0
