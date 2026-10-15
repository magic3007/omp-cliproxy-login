/**
 * Gateway Login — configure any "base URL + API key" model gateway as an omp provider.
 *
 * No vendor is privileged: anything that answers `GET <base URL>/v1/models` and
 * speaks Anthropic Messages (or OpenAI Chat Completions) works — CLIProxyAPI,
 * LiteLLM, one-api, new-api, the Volcengine Ark coding plan, an in-house
 * router.
 *
 * Behaviour:
 * - The `/login` picker carries one entry, {@link WIZARD_LABEL}, that asks for a
 *   **name**, a **base URL**, a **key reference** and optional **extra model
 *   ids**, validates them with one model-list call, then stores the gateway and
 *   registers `<name>` as a provider.
 * - Every stored gateway is registered at load, so one installation fronts as
 *   many gateways as the config file lists (`litellm`, `volcengine`, …),
 *   each reachable as `<name>/<model id>`.
 * - A gateway's `apiKey` is a **key reference**, resolved by omp exactly like
 *   every other config value (`resolveConfigValue`): `!command` runs and yields
 *   its stdout, an exact environment variable name yields that variable, and
 *   anything else is the literal key. So the config file can be tracked in a
 *   dotfiles repository: it names `LITELLM_API_KEY`, or `!gpg -q -d keys.gpg`,
 *   and the secret stays in the environment or in an encrypted store.
 *   See `SECURITY.md`.
 */
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import type { ExtensionAPI, ExtensionContext, ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

/**
 * Provider id of the login entry that adds or updates gateways. Reserved: it
 * never serves inference, and cannot be used as a gateway name.
 */
export const WIZARD_ID = "gateway";

/** Label of that entry in the `/login` picker. */
export const WIZARD_LABEL = "Custom gateway (name + base URL + API key)";

/** File under the omp agent directory holding every configured gateway. */
export const CONFIG_FILENAME = "gateways-login.json";

/** Wire used unless a gateway overrides it in the config file. */
export const DEFAULT_API = "anthropic-messages";

/** Wire values a gateway may declare. */
const API_KINDS: Record<string, true> = { "anthropic-messages": true, "openai-completions": true };

/** Gateway names become provider ids and model prefixes, so they stay selector-safe. */
const GATEWAY_NAME_PATTERN = /^[a-z0-9][a-z0-9._-]{0,62}$/;

/** Answer to the extra-models prompt that clears a stored list. */
const CLEAR_EXTRAS = "-";

/** Prefix of a command key reference: `!cmd` runs `cmd` and takes its stdout. */
const COMMAND_PREFIX = "!";

/** An exact environment variable name (`$envExact`), e.g. `LITELLM_API_KEY`. */
const ENV_NAME_PATTERN = /^[A-Za-z_][A-Za-z0-9_]*$/;

/** Fallback context window for models the gateway does not report one for. */
const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Fallback output cap for models the gateway does not report one for. */
const DEFAULT_MAX_TOKENS = 64_000;

/** Network deadline for both the login probe and model discovery. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Catalog ids that are not chat models. Gateways list image, video and speech
 * models next to the chat ones; registering those as chat models would only
 * produce a broken selector entry, so they are dropped. Matched at an id
 * boundary *or* at the start, because ids like `tts-1` and `whisper-1` carry no
 * prefix.
 */
const NON_CHAT_MODEL =
	/(?:^|[-_/.])(?:image|images|imagine|video|tts|voice|whisper|embed|embeddings|rerank|dall-e|seedream|seedance)/i;

/** Catalog `status` values marking a model the gateway no longer serves. */
const DEAD_STATUS = /^(?:shutdown|deprecated|retired|deleted|offline)$/i;

/** One configured gateway. */
export interface GatewayEntry {
	/** Provider id and model prefix, e.g. `litellm` in `litellm/claude-opus-4-1`. */
	name: string;
	/** Gateway root, e.g. `https://gw.example.com`; a trailing `/v1` is accepted too. */
	baseUrl: string;
	/** `anthropic-messages` (default) or `openai-completions`. */
	api: string;
	/**
	 * Key reference: an exact environment variable name, a `!command` whose
	 * stdout is the key, or a literal key. Resolved by omp when the key is used
	 * ({@link resolveKey} repeats it for the login probe). Absent when the entry
	 * was hand-written without one.
	 */
	apiKey?: string;
	/** Model ids the gateway serves but does not list (aliases, plan-only names). */
	extraModels: string[];
}

/** Outcome of validating one `providers[]` row: an entry, or why it is unusable. */
type RowResult = { entry: GatewayEntry } | { problem: string };

function parseRow(raw: unknown, index: number): RowResult {
	const at = `providers[${index}]`;
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return { problem: `${at} is not an object` };
	const row = raw as Record<string, unknown>;
	if (typeof row.name !== "string") return { problem: `${at} has no "name" string` };
	const name = row.name.trim().toLowerCase();
	if (!GATEWAY_NAME_PATTERN.test(name)) return { problem: `${at}: "${row.name}" is not a usable gateway name` };
	if (typeof row.baseUrl !== "string" || gatewayRoot(row.baseUrl).length === 0) {
		return { problem: `${at} ("${name}") has no "baseUrl" string` };
	}
	if (row.api !== undefined && (typeof row.api !== "string" || API_KINDS[row.api] !== true)) {
		return { problem: `${at} ("${name}"): "api" must be ${Object.keys(API_KINDS).join(" or ")}` };
	}
	if (row.apiKey !== undefined && typeof row.apiKey !== "string") {
		return { problem: `${at} ("${name}"): "apiKey" is not a string` };
	}
	if (
		row.extraModels !== undefined &&
		(!Array.isArray(row.extraModels) || row.extraModels.some(id => typeof id !== "string"))
	) {
		return { problem: `${at} ("${name}"): "extraModels" is not an array of strings` };
	}
	const apiKey = typeof row.apiKey === "string" ? row.apiKey.trim() : "";
	return {
		entry: {
			name,
			baseUrl: gatewayRoot(row.baseUrl),
			api: typeof row.api === "string" ? row.api : DEFAULT_API,
			...(apiKey.length > 0 ? { apiKey } : {}),
			extraModels: parseModelIds(((row.extraModels as string[] | undefined) ?? []).join(",")),
		},
	};
}

/**
 * Parse the config file row by row, so that one hand-edit mistake costs that
 * gateway only. A file-level schema would be worse than useless here: the login
 * flow writes back what it reads, so a single malformed row would otherwise
 * erase every other gateway.
 *
 * @returns the usable entries, and one problem string per row that was skipped
 * (including later rows that repeat a name).
 * @throws when the text is not JSON, or `providers` is present but not an array.
 */
export function parseEntries(text: string): { entries: GatewayEntry[]; problems: string[] } {
	const raw: unknown = JSON.parse(text);
	if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
		throw new Error('config file must hold a JSON object with a "providers" array');
	}
	const providers = (raw as Record<string, unknown>).providers;
	if (providers === undefined) return { entries: [], problems: [] };
	if (!Array.isArray(providers)) throw new Error('"providers" must be an array');
	const entries: GatewayEntry[] = [];
	const problems: string[] = [];
	const seen = new Set<string>();
	for (const [index, row] of providers.entries()) {
		const result = parseRow(row, index);
		if ("problem" in result) {
			problems.push(result.problem);
			continue;
		}
		if (seen.has(result.entry.name)) {
			problems.push(`providers[${index}]: "${result.entry.name}" is already configured above`);
			continue;
		}
		seen.add(result.entry.name);
		entries.push(result.entry);
	}
	return { entries, problems };
}

/** One chat model of a gateway catalog. */
export interface GatewayModel {
	id: string;
	/** Display name the gateway reports, if any. */
	displayName?: string;
	/** Context window the gateway reports, if any. */
	contextWindow?: number;
	/** Output cap the gateway reports, if any. */
	maxTokens?: number;
	/** False when the gateway reports text-only input. */
	acceptsImages: boolean;
}

/**
 * Give every model of one gateway catalog a human name; ids, and so selectors,
 * never change. A display name the gateway reports is kept as is. Otherwise
 * the name is the id without its upstream-source prefix — `devin/claude-opus-5-5`
 * reads `claude-opus-5-5`, as omp's own OpenRouter catalog names
 * `anthropic/claude-opus-4.1` "Claude Opus 4.1". When that short name is not
 * unique in the catalog (`devin/gpt-6-luna` beside `gpt-6-luna`), a prefixed
 * id names its source in parentheses, `gpt-6-luna (devin)`, and an unprefixed
 * id keeps itself, so the two routes stay distinguishable.
 */
export function nameModels<T extends Pick<GatewayModel, "id" | "displayName">>(
	models: readonly T[],
): (T & { name: string })[] {
	const derived = models.map((model): { name: string; source?: string } => {
		if (model.displayName !== undefined) return { name: model.displayName };
		const slash = model.id.lastIndexOf("/");
		// A leading or trailing slash separates no source from a model.
		if (slash <= 0 || slash === model.id.length - 1) return { name: model.id };
		return { name: model.id.slice(slash + 1), source: model.id.slice(0, slash) };
	});
	const uses = new Map<string, number>();
	for (const { name } of derived) uses.set(name, (uses.get(name) ?? 0) + 1);
	return models.map((model, index) => {
		const { name, source } = derived[index] ?? { name: model.id };
		const shared = (uses.get(name) ?? 0) > 1;
		return { ...model, name: shared && source !== undefined ? `${name} (${source})` : name };
	});
}

/** The gateway rejected the key (HTTP 401/403): a distinct type, so the login flow can explain why. */
class AuthFailure extends Error {}

/**
 * Gateway root without a trailing slash or `/v1`: the two wires disagree on
 * where `/v1` belongs, so every entry is stored as the root and the suffix is
 * added per use ({@link modelsEndpoint}, {@link providerBaseUrl}).
 */
function gatewayRoot(baseUrl: string): string {
	return baseUrl
		.trim()
		.replace(/\/+$/, "")
		.replace(/\/v1$/, "");
}

/** Catalog endpoint of a gateway root. */
export function modelsEndpoint(baseUrl: string): string {
	return `${gatewayRoot(baseUrl)}/v1/models`;
}

/**
 * Base URL to hand omp for a wire. `anthropic-messages` appends `/v1/messages`
 * to what it is given, while `openai-completions` appends `/chat/completions`
 * only — so the OpenAI wire needs the `/v1` the Anthropic wire must not see.
 */
export function providerBaseUrl(entry: Pick<GatewayEntry, "baseUrl" | "api">): string {
	const root = gatewayRoot(entry.baseUrl);
	return entry.api === "openai-completions" ? `${root}/v1` : root;
}

/** First positive integer among `candidates`, else undefined. */
function firstPositive(...candidates: unknown[]): number | undefined {
	for (const value of candidates) {
		if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
	}
	return undefined;
}

/**
 * Validate and canonicalize a typed gateway URL into a gateway root.
 *
 * @throws when the text is not an absolute http(s) URL, or carries a query or
 * fragment that the derived endpoints would silently drop.
 */
export function normalizeBaseUrl(input: string): string {
	const trimmed = input.trim().replace(/\/+$/, "");
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error(`"${input.trim()}" is not an absolute URL (expected e.g. https://your-gateway.example.com)`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`unsupported URL scheme "${parsed.protocol}" (expected http or https)`);
	}
	if (parsed.search.length > 0 || parsed.hash.length > 0) {
		throw new Error(`"${trimmed}" must be a plain base URL, without a query string or fragment`);
	}
	return gatewayRoot(trimmed);
}

/**
 * Validate and canonicalize a typed gateway name.
 *
 * @throws when the text cannot be used as a provider id / model prefix.
 */
export function normalizeGatewayName(input: string): string {
	const name = input.trim().toLowerCase();
	if (name === WIZARD_ID) {
		throw new Error(`"${WIZARD_ID}" is reserved for the login entry; pick another name`);
	}
	if (!GATEWAY_NAME_PATTERN.test(name)) {
		throw new Error(`"${input.trim()}" is not a usable gateway name (use letters, digits, ".", "_" or "-")`);
	}
	return name;
}

/** Split a comma/whitespace-separated id list, dropping blanks and duplicates. */
export function parseModelIds(input: string): string[] {
	return [...new Set(input.split(/[\s,]+/).filter(id => id.length > 0))];
}

/** Environment a key reference is resolved against; injectable so tests need no real environment. */
type Env = Record<string, string | undefined>;

/**
 * What a stored key reference names, without touching the environment — the
 * same three cases omp's own config-value resolver (`resolveConfigValue`)
 * distinguishes, so a value written here behaves identically in `models.yml`:
 * `!command` to run, an exact environment variable name to read, or the literal
 * key. A name nothing sets is a literal, as it is for omp.
 */
export function classifyKeyReference(
	reference: string,
	env: Env = process.env,
): { kind: "command"; command: string } | { kind: "env"; name: string } | { kind: "literal"; key: string } {
	if (reference.startsWith(COMMAND_PREFIX)) return { kind: "command", command: reference.slice(1).trim() };
	return env[reference] === undefined ? { kind: "literal", key: reference } : { kind: "env", name: reference };
}

/**
 * The reference to store for a key the user just supplied. A literal key that an
 * environment variable already holds is stored as that variable's name, so a
 * config file tracked in a dotfiles repository carries no secret; a reference,
 * or a literal nothing holds, is stored as typed.
 */
export function referenceToStore(typed: string, key: string, env: Env = process.env): string {
	if (classifyKeyReference(typed, env).kind !== "literal") return typed;
	for (const [name, value] of Object.entries(env)) {
		if (value === key) return name;
	}
	return typed;
}

/**
 * One sentence on how the key ended up stored, so that a literal secret — or a
 * variable name nothing sets, which omp then sends as the key itself — is never
 * written silently.
 */
function keyStorageNote(stored: string, typed: string, env: Env = process.env): string {
	if (stored !== typed) {
		return ` Key stored as the reference ${stored} — that environment variable already holds it; export it wherever you start omp.`;
	}
	if (stored.startsWith(COMMAND_PREFIX)) return ` Key stored as the command reference ${stored}.`;
	if (env[stored] !== undefined) return ` Key stored as the reference ${stored}.`;
	if (ENV_NAME_PATTERN.test(stored)) return ` Nothing sets ${stored}, so omp sends that name itself as the key.`;
	return ` The config file now holds the key itself; name an environment variable, or use "${COMMAND_PREFIX}command", to keep it out.`;
}

export default function gatewayLogin(pi: ExtensionAPI): void {
	const z = pi.zod;
	const configFile = join(pi.pi.getAgentDir(), CONFIG_FILENAME);
	/** Live model registry, captured from the first session event, for post-login discovery. */
	let registry: ExtensionContext["modelRegistry"] | undefined;
	pi.on("session_start", (_event, ctx) => {
		registry = ctx.modelRegistry;
	});

	/**
	 * Shape of a `<base URL>/v1/models` response. Only `id` is required; the
	 * optional metadata differs per gateway, so it is kept `unknown` and narrowed
	 * where read.
	 */
	const ModelsSchema = z.object({
		data: z
			.array(
				z.object({
					id: z.string(),
					display_name: z.unknown().optional(),
					status: z.unknown().optional(),
					task_type: z.unknown().optional(),
					modalities: z.unknown().optional(),
					token_limits: z.unknown().optional(),
					max_input_tokens: z.unknown().optional(),
					max_tokens: z.unknown().optional(),
					context_length: z.unknown().optional(),
				}),
			)
			.optional(),
	});

	/**
	 * Configured gateways, or `undefined` when the file exists but cannot be
	 * parsed at all. Row-level problems are logged and skipped; the caller
	 * decides whether skipping is safe (loading: yes — writing back: no).
	 */
	const readEntries = (): { entries: GatewayEntry[]; problems: string[] } | undefined => {
		let text: string;
		try {
			text = readFileSync(configFile, "utf-8");
		} catch {
			// Missing config: the login entry is the only thing left to offer.
			return { entries: [], problems: [] };
		}
		let parsed: { entries: GatewayEntry[]; problems: string[] };
		try {
			parsed = parseEntries(text);
		} catch (error) {
			pi.logger.warn("gateway login: config file cannot be parsed", {
				file: configFile,
				error: error instanceof Error ? error.message : String(error),
			});
			return undefined;
		}
		for (const problem of parsed.problems) {
			pi.logger.warn("gateway login: skipped a config row", { file: configFile, problem });
		}
		return parsed;
	};

	const writeEntries = (entries: GatewayEntry[]): void => {
		mkdirSync(dirname(configFile), { recursive: true });
		writeFileSync(configFile, `${JSON.stringify({ providers: entries }, null, 2)}\n`, { mode: 0o600 });
		// `mode` only applies when the file is created; an existing (or
		// hand-edited) file keeps its own permissions until chmod'ed.
		chmodSync(configFile, 0o600);
	};

	/**
	 * Materialize a key reference with the rules omp applies to every config
	 * value: `!command` runs and yields its stdout, an exact environment variable
	 * name yields that variable, anything else is the literal key. omp resolves
	 * the stored reference again for every request; the plugin repeats the rules
	 * only where it needs the key material itself — the login probe.
	 *
	 * @returns the key, or undefined when a command reference printed nothing.
	 */
	const resolveKey = async (reference: string): Promise<string | undefined> => {
		const classified = classifyKeyReference(reference);
		if (classified.kind !== "command") {
			return classified.kind === "env" ? process.env[classified.name] : classified.key;
		}
		const windows = process.platform === "win32";
		const { stdout, code } = await pi.exec(windows ? "cmd" : "/bin/sh", [windows ? "/c" : "-c", classified.command], {
			timeout: REQUEST_TIMEOUT_MS,
		});
		const value = stdout.trim();
		return code === 0 && value.length > 0 ? value : undefined;
	};

	/** Read a gateway's chat-model catalog, sorted by id and deduplicated. */
	const listModels = async (apiKey: string, baseUrl: string): Promise<GatewayModel[]> => {
		const response = await fetch(modelsEndpoint(baseUrl), {
			headers: { Authorization: `Bearer ${apiKey}`, "x-api-key": apiKey, Accept: "application/json" },
			signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		});
		if (!response.ok) {
			const detail = (await response.text().catch(() => "")).trim().slice(0, 300);
			const suffix = detail ? `: ${detail}` : "";
			if (response.status === 401 || response.status === 403) {
				throw new AuthFailure(`the gateway rejected this API key (HTTP ${response.status})${suffix}`);
			}
			throw new Error(`listing models failed (HTTP ${response.status})${suffix}`);
		}
		const body: unknown = await response.json();
		const parsed = ModelsSchema.safeParse(body);
		if (!parsed.success) {
			throw new Error(`${modelsEndpoint(baseUrl)} did not return a model list`);
		}
		const models: GatewayModel[] = [];
		const seen = new Set<string>();
		for (const row of parsed.data.data ?? []) {
			const id = row.id.trim();
			if (id.length === 0 || seen.has(id) || NON_CHAT_MODEL.test(id)) continue;
			if (typeof row.status === "string" && DEAD_STATUS.test(row.status)) continue;
			// Gateways that declare task types (Ark) mark non-chat models explicitly.
			if (Array.isArray(row.task_type) && !row.task_type.includes("TextGeneration")) continue;
			seen.add(id);

			const limits = typeof row.token_limits === "object" && row.token_limits !== null ? row.token_limits : {};
			const contextWindow = firstPositive(
				"context_window" in limits ? limits.context_window : undefined,
				row.max_input_tokens,
				row.context_length,
			);
			const maxTokens = firstPositive(
				"max_output_token_length" in limits ? limits.max_output_token_length : undefined,
				row.max_tokens,
			);
			const inputs =
				typeof row.modalities === "object" && row.modalities !== null && "input_modalities" in row.modalities
					? row.modalities.input_modalities
					: undefined;
			const displayName = typeof row.display_name === "string" ? row.display_name.trim() : "";
			models.push({
				id,
				...(displayName.length > 0 ? { displayName } : {}),
				...(contextWindow !== undefined ? { contextWindow } : {}),
				...(maxTokens !== undefined ? { maxTokens } : {}),
				acceptsImages: !Array.isArray(inputs) || inputs.includes("image"),
			});
		}
		return models.sort((a, b) => a.id.localeCompare(b.id));
	};

	/** Discovered models plus the entry's extra ids the catalog does not already list. */
	const catalogFor = (discovered: GatewayModel[], extraModels: string[]): GatewayModel[] => {
		const listed = new Set(discovered.map(model => model.id));
		const extras = extraModels.filter(id => !listed.has(id)).map(id => ({ id, acceptsImages: true }));
		return [...discovered, ...extras];
	};

	/**
	 * Register (or re-register) one gateway. Called at load for every configured
	 * entry, and again after a login changes it, because the registry snapshots
	 * `baseUrl`/`apiKey` into the models it derives.
	 */
	const registerGateway = (entry: GatewayEntry): void => {
		pi.registerProvider(entry.name, {
			baseUrl: providerBaseUrl(entry),
			api: entry.api,
			apiKey: entry.apiKey,
			async fetchDynamicModels(resolvedKey): Promise<readonly ProviderModelConfig[]> {
				// Fail instead of reporting an empty catalog: an empty *success* is
				// cached as an authoritative "this gateway serves nothing" result,
				// which then suppresses discovery until the cache TTL expires.
				if (!resolvedKey) {
					throw new Error(
						`no key for gateway "${entry.name}": its stored reference resolves to nothing; set one from /login → "${WIZARD_LABEL}"`,
					);
				}
				let models: GatewayModel[];
				try {
					models = catalogFor(await listModels(resolvedKey, entry.baseUrl), entry.extraModels);
				} catch (error) {
					// omp swallows discovery errors, so an unreachable gateway or a
					// rejected key would otherwise show up only as models quietly
					// missing from the selector.
					pi.logger.warn("gateway login: model discovery failed", {
						gateway: entry.name,
						endpoint: modelsEndpoint(entry.baseUrl),
						error: error instanceof Error ? error.message : String(error),
					});
					throw error;
				}
				pi.logger.debug("gateway login: discovered models", {
					gateway: entry.name,
					baseUrl: entry.baseUrl,
					count: models.length,
				});
				return nameModels(models).map(model => ({
					id: model.id,
					name: model.name,
					reasoning: true,
					input: (model.acceptsImages ? ["text", "image"] : ["text"]) as ProviderModelConfig["input"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: model.contextWindow ?? DEFAULT_CONTEXT_WINDOW,
					maxTokens: model.maxTokens ?? DEFAULT_MAX_TOKENS,
				}));
			},
		});
	};

	for (const entry of readEntries()?.entries ?? []) registerGateway(entry);

	pi.registerProvider(WIZARD_ID, {
		oauth: {
			name: WIZARD_LABEL,
			async login(callbacks) {
				const stored = readEntries();
				// The login flow writes back what it reads, so it must refuse to
				// run on a file it cannot fully account for: a skipped row would
				// silently disappear from disk.
				if (stored === undefined) {
					throw new Error(`${configFile} cannot be parsed; fix or move it, then log in again`);
				}
				if (stored.problems.length > 0) {
					throw new Error(
						`${configFile} has unusable rows, which logging in would erase; fix them first:\n  ${stored.problems.join("\n  ")}`,
					);
				}
				const saved = stored.entries;
				const name = normalizeGatewayName(
					await callbacks.onPrompt({
						message: "Name this gateway (it becomes the model prefix, e.g. litellm/claude-opus-4-1)",
						placeholder: saved.length > 0 ? saved.map(entry => entry.name).join(", ") : "litellm",
					}),
				);
				const existing = saved.find(entry => entry.name === name);
				// A name that already belongs to another provider (`anthropic`,
				// a models.yml block, …) would take over its models and its key
				// resolution, so only names this plugin owns may be reused. The
				// terminal login path has no session registry and cannot check.
				if (existing === undefined && registry?.hasProvider(name) === true) {
					throw new Error(`"${name}" is already a provider in this omp install; pick another name`);
				}

				const urlAnswer = await callbacks.onPrompt({
					message: `Paste the base URL of "${name}"`,
					placeholder: existing?.baseUrl ?? "https://your-gateway.example.com",
					allowEmpty: existing !== undefined,
				});
				const typedUrl = urlAnswer.trim();
				if (typedUrl.length === 0 && existing === undefined) {
					throw new Error(`a base URL is required for "${name}"`);
				}
				const baseUrl = normalizeBaseUrl(typedUrl.length > 0 ? typedUrl : (existing?.baseUrl ?? ""));

				// A stored literal key is never echoed back to the terminal: the
				// prompt names the stored value only when it is a reference.
				const storedReference = existing?.apiKey;
				const keeps =
					storedReference === undefined
						? ""
						: classifyKeyReference(storedReference).kind === "literal"
							? " (Enter keeps the stored key)"
							: ` (Enter keeps ${storedReference})`;
				const keyAnswer = (
					await callbacks.onPrompt({
						message:
							storedReference === undefined
								? `Paste the API key "${name}" serves, or a reference: an environment variable name exported wherever you start omp, or !command`
								: `Paste a new key or key reference for "${name}"${keeps}`,
						placeholder: "LITELLM_API_KEY",
						secret: true,
						allowEmpty: storedReference !== undefined,
					})
				).trim();
				const reference = keyAnswer.length > 0 ? keyAnswer : (existing?.apiKey ?? "");
				if (reference.length === 0) throw new Error(`a key or key reference is required for "${name}"`);
				const apiKey = await resolveKey(reference);
				if (apiKey === undefined) {
					throw new Error(`"${reference}" produced no key: the command printed nothing or failed`);
				}

				const extrasAnswer = (
					await callbacks.onPrompt({
						message:
							existing === undefined || existing.extraModels.length === 0
								? "Extra model ids the gateway serves but does not list (comma-separated; Enter for none)"
								: `Extra model ids (Enter keeps ${existing.extraModels.join(", ")}; "${CLEAR_EXTRAS}" clears)`,
						placeholder: "ark-code-latest, glm-5.3",
						allowEmpty: true,
					})
				).trim();
				const extraModels =
					extrasAnswer === CLEAR_EXTRAS
						? []
						: extrasAnswer.length > 0
							? parseModelIds(extrasAnswer)
							: (existing?.extraModels ?? []);

				let models: GatewayModel[];
				try {
					models = catalogFor(await listModels(apiKey, baseUrl), extraModels);
				} catch (error) {
					// A variable name nothing sets is a literal key, for omp as for
					// this plugin — so the gateway sees the name itself and answers
					// 401. Say that instead of blaming the key.
					const classified = classifyKeyReference(reference);
					if (classified.kind === "literal" && ENV_NAME_PATTERN.test(reference) && error instanceof AuthFailure) {
						throw new Error(
							`nothing sets ${reference} in this shell, so "${reference}" was sent as the key itself and "${baseUrl}" rejected it; export it before starting omp, paste the key, or use "${COMMAND_PREFIX}command"`,
						);
					}
					throw error;
				}
				if (models.length === 0) {
					throw new Error(`"${baseUrl}" returned no chat models for this API key, and no extra ids were given`);
				}

				const storedKey = referenceToStore(reference, apiKey);
				const entry: GatewayEntry = { name, baseUrl, api: existing?.api ?? DEFAULT_API, apiKey: storedKey, extraModels };
				writeEntries(
					[...saved.filter(candidate => candidate.name !== name), entry].sort((a, b) =>
						a.name.localeCompare(b.name),
					),
				);
				registerGateway(entry);
				// Best-effort: the terminal login path has no session registry, and the
				// next omp process discovers gateways on its own.
				await registry?.refreshProvider(name, "online").catch(() => undefined);
				callbacks.onProgress?.(
					`Saved gateway "${name}" (${models.length} chat models) to ${configFile}; select them as ${name}/<id>.${keyStorageNote(storedKey, reference)}`,
				);
				// Nothing for omp's credential store: the config file holds the key
				// reference, and omp resolves it per request like any config value.
				return "";
			},
		},
	});
}
