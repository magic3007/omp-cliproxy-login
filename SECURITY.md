# Security

## How this plugin handles your API keys

- Keys are typed at login and written to `~/.omp/agent/gateways-login.json`, created and kept at mode `0600` (owner read/write only).
- They are stored **in plaintext**, like omp's own credential store. Anyone who can read your home directory can read them.
- The plugin reads no environment variables and sends keys nowhere except to the gateway base URL you entered, as `Authorization: Bearer <key>` and `x-api-key: <key>`.
- Keys are never written to logs. Log lines carry the gateway name, its base URL and model counts only.
- Deleting a gateway's object from the config file removes its key. There is no second copy in omp's credential store.

## Reporting a vulnerability

Report privately through a [GitHub security advisory](https://github.com/magic3007/omp-gateway/security/advisories/new) — not a public issue. Credential-handling problems and accidental key exposure count.

Expect an acknowledgement within a week. Fixes ship in a patch release with the advisory published after it.
