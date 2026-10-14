# Contributing

Thanks for taking a look. This is a small, dependency-free omp extension, so the bar for changes is "does it keep the login flow honest and the catalog usable".

## Development setup

```bash
git clone https://github.com/magic3007/omp-gateway
cd omp-gateway
bun install              # dev only: TypeScript and the omp host types
omp plugin link .        # omp loads src/index.ts straight from the checkout; edits take effect on the next omp start
```

Checks, both run in CI:

```bash
bun run typecheck        # tsc --noEmit against the omp host types
bun test                 # pure URL/name/id helpers
```

Then exercise the real thing rather than a unit harness:

```bash
omp login gateway                                       # name + base URL + API key (+ extra ids)
omp models list <name>                                  # discovered catalog
omp -p --model <name>/<model-id> --mode json "say OK"   # check message_end reports provider=<name>
```

A `message_end` event naming `provider: <name>` proves the request went through that gateway; a `retry_fallback_succeeded` event means it failed and fell back to another provider.

## Ground rules

- **No secrets in the repo.** No real key may land in a commit, a test fixture or a doc example. Keys enter only at run time, through the login prompt or the key reference it stores.
- **No runtime dependencies.** The extension is loaded as TypeScript source by omp's Bun runtime; host types stay behind `import type`, and validation uses the injected `pi.zod`. `devDependencies` (TypeScript, host types) are fine — they never reach a user's install.
- **Keep the gateway generic.** Nothing may assume a particular vendor beyond "answers `GET <base URL>/v1/models`" — a vendor-specific quirk belongs behind a documented default, like the Ark status/`task_type` filters.
- **Verify against a live gateway** before sending a pull request: a logged-in catalog listing and one successful call, for at least one gateway you actually have access to.
- Match the existing style: tabs, double quotes, host types (`ExtensionAPI`, `ExtensionContext`, `ProviderModelConfig`) imported with `import type` from `@oh-my-pi/pi-coding-agent`.

## Releasing

1. Bump `version` in `package.json`.
2. Add the version's section to `CHANGELOG.md`, with its link at the bottom.
3. `git tag -a vX.Y.Z -m "vX.Y.Z" && git push origin master --tags`.
4. Create the GitHub release from the tag, pasting that CHANGELOG section.

## Reporting issues

Open an issue with:

- omp version (`omp --version`) and OS,
- the exact commands you ran,
- what you expected versus what happened,
- the relevant log lines from `~/.omp/logs/` — redact your API key and gateway host if you prefer.

Security-relevant reports (credential handling, accidental exposure of a key) should go through a private [security advisory](https://github.com/magic3007/omp-gateway/security/advisories/new) instead of a public issue.
