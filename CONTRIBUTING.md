# Contributing

Thanks for taking a look. This is a small, dependency-free omp extension, so the bar for changes is "does it keep the login flow honest and the catalog usable".

## Development setup

```bash
git clone https://github.com/magic3007/omp-gateway-login
cd omp-gateway-login
omp plugin link .        # omp loads src/index.ts straight from the checkout; edits take effect on the next omp start
```

Then exercise the real thing rather than a unit harness:

```bash
omp login gateway                                              # name + base URL + API key (+ extra ids)
omp models list | grep -E '^<name> '                            # discovered catalog
omp -p --model <name>/<model-id> --mode json "say OK"           # check message_end reports provider=<name>
```

A `message_end` event naming `provider: <name>` proves the request went through that gateway; a `retry_fallback_succeeded` event means it failed and fell back to another provider.

## Ground rules

- **No credentials in the repo.** The API key comes from the login prompt at run time, never from an environment variable, a config file committed anywhere, or a test fixture.
- **No new runtime dependencies.** The extension is loaded as TypeScript source by omp's Bun runtime; host types stay behind `import type`, and validation uses the injected `pi.zod`.
- **Keep the gateway generic.** Nothing may assume a particular vendor beyond "answers `GET <base URL>/v1/models`" — a vendor-specific quirk belongs behind a documented default, like the Ark status/`task_type` filters.
- **Verify against a live gateway** before sending a pull request: a logged-in catalog listing and one successful call, for at least one gateway you actually have access to.
- Match the existing style: tabs, double quotes, `ProviderConfig` types from `@oh-my-pi/pi-coding-agent`.

## Reporting issues

Open an issue with:

- omp version (`omp --version`) and OS,
- the exact commands you ran,
- what you expected versus what happened,
- the relevant log lines from `~/.omp/logs/` — redact your API key and gateway host if you prefer.

Security-relevant reports (credential handling, accidental exposure of a key) should go through a private [security advisory](https://github.com/magic3007/omp-gateway-login/security/advisories/new) instead of a public issue.
