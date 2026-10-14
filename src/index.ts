/**
 * CLIProxy Login — an omp extension that turns any CLIProxyAPI-style gateway into
 * a first-class `/login` provider.
 *
 * Behaviour:
 * - Registers provider {@link PROVIDER_ID} with an `oauth` login flow that asks
 *   for the gateway base URL and an API key. Both are typed by the user; nothing
 *   is read from the environment.
 * - Validates that pair against the gateway's model listing before storing the
 *   key, so a wrong URL or key fails at login instead of at the first request.
 * - Discovers the gateway's live catalog through `fetchDynamicModels`, so every
 *   model the key can reach shows up after login without editing config files.
 *
 * The provider speaks `anthropic-messages` (`POST /v1/messages`), the wire
 * CLIProxyAPI translates for every upstream it proxies.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { ExtensionAPI, ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

/** Provider id. Models read as `<PROVIDER_ID>/<model-id>`, e.g. `cliproxy/devin/claude-opus-4-7`. */
export const PROVIDER_ID = "cliproxy";

/** Gateway label used in prompts and in the `/login` picker. */
export const PROVIDER_LABEL = "CLIProxyAPI Gateway";

/** Label shown in the `/login` picker. */
export const PROVIDER_NAME = `${PROVIDER_LABEL} (API key)`;

/** File under the omp agent directory holding the gateway base URL this plugin was last logged in to. */
export const CONFIG_FILENAME = "cliproxy-login.json";

/** Wire used for inference; CLIProxyAPI serves `/v1/messages` for every upstream it proxies. */
export const DEFAULT_API = "anthropic-messages";

/** Fallback context window for models the gateway does not report one for. */
const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Fallback output cap for models the gateway does not report one for. */
const DEFAULT_MAX_TOKENS = 64_000;

/** Network deadline for both the login probe and model discovery. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Catalog entries that are not chat models. Gateways list image, video and
 * speech models next to the chat ones; registering those as chat models would
 * only produce a broken selector entry, so they are dropped.
 */
const NON_CHAT_MODEL = /[-_/.](?:image|images|imagine|video|tts|voice|whisper|embed|embeddings|rerank)/i;

/** One chat model of the gateway catalog. */
export interface GatewayModel {
	id: string;
	/** Human name; falls back to the id when the gateway reports no display name. */
	name: string;
}

/** Persisted plugin configuration. */
export interface GatewayConfig {
	/** Gateway root, e.g. `https://cliproxy.example.com`; a trailing `/v1` is accepted too. */
	baseUrl: string;
}

/** Boundary type for the gateway's `/v1/models` payload; only the read fields are declared. */
type ModelsPayload = { data?: Array<{ id?: unknown; display_name?: unknown }> };

/** `…/v1/models` for a gateway root written with or without a trailing `/v1`. */
function modelsEndpoint(baseUrl: string): string {
	const root = baseUrl.trim().replace(/\/+$/, "");
	return root.endsWith("/v1") ? `${root}/models` : `${root}/v1/models`;
}

/**
 * Validate and canonicalize a user-typed gateway URL.
 *
 * @throws when the text is not an absolute http(s) URL.
 */
export function normalizeBaseUrl(input: string): string {
	const trimmed = input.trim().replace(/\/+$/, "");
	let parsed: URL;
	try {
		parsed = new URL(trimmed);
	} catch {
		throw new Error(`"${input.trim()}" is not an absolute URL (expected e.g. https://your-cliproxy.example.com)`);
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		throw new Error(`unsupported URL scheme "${parsed.protocol}" (expected http or https)`);
	}
	return trimmed;
}

/**
 * Read the gateway's chat-model catalog, sorted by id and deduplicated.
 *
 * Both auth headers are sent: CLIProxyAPI accepts `Authorization: Bearer` on its
 * OpenAI-shaped routes and `x-api-key` on its Anthropic-shaped ones.
 *
 * @throws when the gateway rejects the key or answers with a non-2xx status.
 */
export async function listGatewayModels(apiKey: string, baseUrl: string): Promise<GatewayModel[]> {
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

	const payload: ModelsPayload = await response.json();
	const models: GatewayModel[] = [];
	const seen = new Set<string>();
	for (const entry of Array.isArray(payload.data) ? payload.data : []) {
		const id = typeof entry?.id === "string" ? entry.id.trim() : "";
		if (id.length === 0 || seen.has(id) || NON_CHAT_MODEL.test(id)) continue;
		seen.add(id);
		const displayName = typeof entry?.display_name === "string" ? entry.display_name.trim() : "";
		models.push({ id, name: displayName.length > 0 ? displayName : id });
	}
	return models.sort((a, b) => a.id.localeCompare(b.id));
}

export default function cliproxyLogin(pi: ExtensionAPI): void {
	const configFile = join(pi.pi.getAgentDir(), CONFIG_FILENAME);

	/** Saved gateway URL, or undefined when the plugin has not been configured yet. */
	const readBaseUrl = (): string | undefined => {
		let raw: GatewayConfig;
		try {
			raw = JSON.parse(readFileSync(configFile, "utf-8"));
		} catch {
			// Missing or unreadable config: the login flow asks for the URL.
			return undefined;
		}
		const baseUrl = typeof raw?.baseUrl === "string" ? raw.baseUrl.trim() : "";
		return baseUrl.length > 0 ? baseUrl : undefined;
	};

	const saveBaseUrl = (baseUrl: string): void => {
		writeFileSync(configFile, `${JSON.stringify({ baseUrl }, null, 2)}\n`, { mode: 0o600 });
	};

	/**
	 * Register (or re-register) the provider against the currently saved gateway
	 * URL. Called at load and again when a login stores a different URL, because
	 * the registry snapshots `baseUrl` into every model it derives.
	 */
	const register = (): void => {
		pi.registerProvider(PROVIDER_ID, {
			baseUrl: readBaseUrl(),
			api: DEFAULT_API,
			oauth: {
				name: PROVIDER_NAME,
				async login(callbacks) {
					const saved = readBaseUrl();
					const answer = await callbacks.onPrompt({
						message: `Paste your ${PROVIDER_LABEL} base URL`,
						placeholder: saved ?? "https://your-cliproxy.example.com",
						allowEmpty: saved !== undefined,
					});
					const typed = answer.trim();
					if (typed.length === 0 && saved === undefined) {
						throw new Error("a gateway base URL is required to log in");
					}
					const baseUrl = normalizeBaseUrl(typed.length > 0 ? typed : (saved ?? ""));

					const keyAnswer = await callbacks.onPrompt({
						message: `Paste the ${PROVIDER_LABEL} API key it serves`,
						placeholder: "sk-…",
						secret: true,
					});
					const apiKey = keyAnswer.trim();
					if (apiKey.length === 0) throw new Error("an API key is required to log in");

					const models = await listGatewayModels(apiKey, baseUrl);
					if (models.length === 0) {
						throw new Error(`the gateway at ${baseUrl} returned no chat models for this API key`);
					}

					if (baseUrl !== saved) {
						mkdirSync(pi.pi.getAgentDir(), { recursive: true });
						saveBaseUrl(baseUrl);
						register();
						callbacks.onProgress?.(`Saved gateway ${baseUrl} to ${configFile}.`);
					}
					callbacks.onProgress?.(`${models.length} chat models available.`);
					return apiKey;
				},
			},
			async fetchDynamicModels(apiKey): Promise<readonly ProviderModelConfig[]> {
				const baseUrl = readBaseUrl();
				// Not configured / not logged in: fail instead of reporting an empty
				// catalog. An empty success is cached as an authoritative "this
				// gateway serves nothing" result, which suppresses every later
				// discovery until the cache TTL expires — including the refresh
				// right after a successful login.
				if (!baseUrl) {
					throw new Error(`no ${PROVIDER_LABEL} URL configured yet; run /login to add one`);
				}
				if (!apiKey) {
					throw new Error(`not logged in to ${baseUrl}; run /login to add an API key`);
				}
				const models = await listGatewayModels(apiKey, baseUrl);
				pi.logger.debug("cliproxy login: discovered gateway models", { baseUrl, count: models.length });
				return models.map(model => ({
					id: model.id,
					name: model.name,
					reasoning: true,
					input: ["text", "image"] as ProviderModelConfig["input"],
					cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
					contextWindow: DEFAULT_CONTEXT_WINDOW,
					maxTokens: DEFAULT_MAX_TOKENS,
				}));
			},
		});
	};

	register();
}
