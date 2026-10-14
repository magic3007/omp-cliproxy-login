# Security

## How this plugin handles your API keys

A gateway's `apiKey` in `~/.omp/agent/gateways-login.json` is a **key reference**, not necessarily a key. omp resolves it with its own config-value rules (`resolveConfigValue`), the same ones `models.yml` uses:

| Reference | Example | Where the secret lives |
| --- | --- | --- |
| Environment variable name | `LITELLM_API_KEY` | your shell environment (`~/.zshrc`, a keychain export, …) |
| Command | `!gpg -q -d ~/.omp/keys/gateway.gpg` | stdout of the command — an encrypted file, `pass`, `op read`, a keychain lookup |
| Literal key | `sk-…` | the config file itself, in plaintext |

So the config file can be tracked in a dotfiles repository: write a reference and the file carries no secret. The plugin itself reads no environment variables and sends keys nowhere except to the gateway base URL you entered, as `Authorization: Bearer <key>` and `x-api-key: <key>`.

- The login entry asks for the key **or a reference to one**, resolves it, and validates it against the gateway before storing anything.
- A pasted literal key that an environment variable already holds is stored as that variable's name; the login output says which one. A literal that nothing holds is stored as typed, and the login output says so — the plugin never puts a secret in the file silently.
- The file is created and kept at mode `0600`. If you store literal keys, that mode is the only protection: anyone who can read your home directory can read them.
- An environment variable name that nothing sets is used as the literal key, as it is for omp. Prefer `!command` if you want a missing secret to fail loudly.
- Keys are never written to logs. Log lines carry the gateway name, its base URL and model counts only.
- Deleting a gateway's object from the config file removes its reference. There is no second copy in omp's credential store.
- A `!command` reference is executable configuration: it runs as your user, through `/bin/sh -c`, every time omp needs the key (and once more at login). Keep the file at `0600` and never paste a reference you did not write.
- Terminal `omp login` echoes what you type. Paste a literal key in omp's own `/login` dialog, which masks it, or type a reference instead.

## Reporting a vulnerability

Report privately through a [GitHub security advisory](https://github.com/magic3007/omp-gateway/security/advisories/new) — not a public issue. Credential-handling problems and accidental key exposure count.

Expect an acknowledgement within a week. Fixes ship in a patch release with the advisory published after it.
