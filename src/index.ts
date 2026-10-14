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
 *   **name**, a **base URL**, an **API key** and optional **extra model ids**,
 *   validates them with one model-list call, then stores the gateway and
 *   registers `<name>` as a provider.
 * - Every stored gateway is registered at load, so one installation fronts as
 *   many gateways as the config file lists (`litellm`, `volcengine`, …),
 *   each reachable as `<name>/<model id>`.
 * - Nothing is read from environment variables: everything comes from the login
 *   prompts and lives in the plugin's own config file (mode 0600).
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
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

/** Fallback context window for models the gateway does not report one for. */
const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Fallback output cap for models the gateway does not report one for. */
const DEFAULT_MAX_TOKENS = 64_000;

/** Network deadline for both the login probe and model discovery. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Catalog ids that are not chat models. Gateways list image, video and speech
 * models next to the chat ones; registering those as chat models would only
 * produce a broken selector entry, so they are dropped.
 */
const NON_CHAT_MODEL = /[-_/.](?:image|images|imagine|video|tts|voice|whisper|embed|embeddings|rerank|seedream|seedance)/i;

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
	/** Key typed at login. Absent when the entry was hand-written without one. */
	apiKey?: string;
	/** Model ids the gateway serves but does not list (aliases, plan-only names). */
	extraModels: string[];
}

/** One chat model of a gateway catalog. */
export interface GatewayModel {
	id: string;
	/** Human name; falls back to the id when the gateway reports no display name. */
	name: string;
	/** Context window the gateway reports, if any. */
	contextWindow?: number;
	/** Output cap the gateway reports, if any. */
	maxTokens?: number;
	/** False when the gateway reports text-only input. */
	acceptsImages: boolean;
}

/** `…/v1/models` for a gateway root written with or without a trailing `/v1`. */
function modelsEndpoint(baseUrl: string): string {
	const root = baseUrl.trim().replace(/\/+$/, "");
	return root.endsWith("/v1") ? `${root}/models` : `${root}/v1/models`;
}

/** First positive integer among `candidates`, else undefined. */
function firstPositive(...candidates: unknown[]): number | undefined {
	for (const value of candidates) {
		if (typeof value === "number" && Number.isInteger(value) && value > 0) return value;
	}
	return undefined;
}

/**
 * Validate and canonicalize a typed gateway URL.
 *
 * @throws when the text is not an absolute http(s) URL.
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
	return trimmed;
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

export default function gatewayLogin(pi: ExtensionAPI): void {
	const z = pi.zod;
	const configFile = join(pi.pi.getAgentDir(), CONFIG_FILENAME);
	/** Live model registry, captured from the first session event, for post-login discovery. */
	let registry: ExtensionContext["modelRegistry"] | undefined;
	pi.on("session_start", (_event, ctx) => {
		registry = ctx.modelRegistry;
	});

	/** Shape of the plugin's config file. */
	const GatewayFileSchema = z.object({
		providers: z
			.array(
				z.object({
					name: z.string(),
					baseUrl: z.string(),
					api: z.string().optional(),
					apiKey: z.string().optional(),
					extraModels: z.array(z.string()).optional(),
				}),
			)
			.optional(),
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

	/** Configured gateways; unreadable or malformed rows are skipped rather than failing the load. */
	const readEntries = (): GatewayEntry[] => {
		let text: string;
		try {
			text = readFileSync(configFile, "utf-8");
		} catch {
			// Missing config: the login entry is the only thing left to offer.
			return [];
		}
		let raw: unknown;
		try {
			raw = JSON.parse(text);
		} catch (error) {
			pi.logger.warn("gateway login: config file is not valid JSON", {
				file: configFile,
				error: error instanceof Error ? error.message : String(error),
			});
			return [];
		}
		const parsed = GatewayFileSchema.safeParse(raw);
		if (!parsed.success) {
			pi.logger.warn("gateway login: config file has an unexpected shape", { file: configFile });
			return [];
		}
		const entries: GatewayEntry[] = [];
		for (const row of parsed.data.providers ?? []) {
			const name = row.name.trim().toLowerCase();
			const baseUrl = row.baseUrl.trim().replace(/\/+$/, "");
			if (!GATEWAY_NAME_PATTERN.test(name) || baseUrl.length === 0) continue;
			const api = row.api !== undefined && API_KINDS[row.api] === true ? row.api : DEFAULT_API;
			const apiKey = row.apiKey?.trim();
			const extraModels = parseModelIds((row.extraModels ?? []).join(","));
			entries.push({ name, baseUrl, api, ...(apiKey ? { apiKey } : {}), extraModels });
		}
		return entries;
	};

	const writeEntries = (entries: GatewayEntry[]): void => {
		mkdirSync(dirname(configFile), { recursive: true });
		writeFileSync(configFile, `${JSON.stringify({ providers: entries }, null, 2)}\n`, { mode: 0o600 });
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
				throw new Error(`the gateway rejected this API key (HTTP ${response.status})${suffix}`);
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
				name: displayName.length > 0 ? displayName : id,
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
		const extras = extraModels
			.filter(id => !listed.has(id))
			.map(id => ({ id, name: id, acceptsImages: true }));
		return [...discovered, ...extras];
	};

	/**
	 * Register (or re-register) one gateway. Called at load for every configured
	 * entry, and again after a login changes it, because the registry snapshots
	 * `baseUrl`/`apiKey` into the models it derives.
	 */
	const registerGateway = (entry: GatewayEntry): void => {
		pi.registerProvider(entry.name, {
			baseUrl: entry.baseUrl,
			api: entry.api,
			apiKey: entry.apiKey,
			async fetchDynamicModels(resolvedKey): Promise<readonly ProviderModelConfig[]> {
				// Fail instead of reporting an empty catalog: an empty *success* is
				// cached as an authoritative "this gateway serves nothing" result,
				// which then suppresses discovery until the cache TTL expires.
				if (!resolvedKey) {
					throw new Error(`no API key stored for gateway "${entry.name}"; add one from /login → "${WIZARD_LABEL}"`);
				}
				const models = catalogFor(await listModels(resolvedKey, entry.baseUrl), entry.extraModels);
				pi.logger.debug("gateway login: discovered models", {
					gateway: entry.name,
					baseUrl: entry.baseUrl,
					count: models.length,
				});
				return models.map(model => ({
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

	for (const entry of readEntries()) registerGateway(entry);

	pi.registerProvider(WIZARD_ID, {
		oauth: {
			name: WIZARD_LABEL,
			async login(callbacks) {
				const saved = readEntries();
				const name = normalizeGatewayName(
					await callbacks.onPrompt({
						message: "Name this gateway (it becomes the model prefix, e.g. litellm/claude-opus-4-1)",
						placeholder: saved.length > 0 ? saved.map(entry => entry.name).join(", ") : "litellm",
					}),
				);
				const existing = saved.find(entry => entry.name === name);

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

				const keyAnswer = await callbacks.onPrompt({
					message:
						existing?.apiKey === undefined
							? `Paste the API key "${name}" serves`
							: `Paste a new API key for "${name}" (Enter keeps the stored one)`,
					placeholder: "sk-…",
					secret: true,
					allowEmpty: existing?.apiKey !== undefined,
				});
				const apiKey = keyAnswer.trim().length > 0 ? keyAnswer.trim() : (existing?.apiKey ?? "");
				if (apiKey.length === 0) throw new Error(`an API key is required for "${name}"`);

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

				const models = catalogFor(await listModels(apiKey, baseUrl), extraModels);
				if (models.length === 0) {
					throw new Error(`"${baseUrl}" returned no chat models for this API key, and no extra ids were given`);
				}

				const entry: GatewayEntry = { name, baseUrl, api: existing?.api ?? DEFAULT_API, apiKey, extraModels };
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
					`Saved gateway "${name}" (${models.length} chat models) to ${configFile}; select them as ${name}/<id>.`,
				);
				// Nothing for omp's credential store: the key lives in this plugin's own
				// file, so the login entry leaves no second copy behind.
				return "";
			},
		},
	});
}
