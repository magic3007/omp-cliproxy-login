/**
 * Kafara Login — an omp extension that turns a CLIProxyAPI-style gateway into a
 * first-class `/login` provider.
 *
 * Behaviour:
 * - Registers provider {@link PROVIDER_ID} with an `oauth` login flow that only
 *   asks for an API key (typed by the user; nothing is read from the environment).
 * - Validates that key against the gateway's model listing before storing it, so a
 *   wrong key fails at login instead of at the first request.
 * - Discovers the gateway's live catalog through `fetchDynamicModels`, so every
 *   model the key can reach shows up after login without editing config files.
 *
 * The provider speaks `anthropic-messages` (`POST /v1/messages`), the wire this
 * gateway translates for every upstream it proxies.
 */
import type { ExtensionAPI, ProviderModelConfig } from "@oh-my-pi/pi-coding-agent";

/** Provider id. Models read as `<PROVIDER_ID>/<model-id>`, e.g. `kafara/devin/claude-opus-4-7`. */
export const PROVIDER_ID = "kafara";

/** Gateway label used in prompts. */
export const PROVIDER_LABEL = "Kafara Gateway";

/** Label shown in the `/login` picker. */
export const PROVIDER_NAME = `${PROVIDER_LABEL} (API key)`;

/** Gateway root ending in `/v1`; the anthropic transport strips that suffix for `/v1/messages`. */
export const BASE_URL = "https://ai.kafara.men/v1";

/** Fallback context window for models the gateway does not report one for. */
const DEFAULT_CONTEXT_WINDOW = 200_000;

/** Fallback output cap for models the gateway does not report one for. */
const DEFAULT_MAX_TOKENS = 64_000;

/** Network deadline for both the login probe and model discovery. */
const REQUEST_TIMEOUT_MS = 20_000;

/**
 * Catalog entries that are not chat models. The gateway lists image, video and
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

/** Boundary type for the gateway's `/v1/models` payload; only the read fields are declared. */
type ModelsPayload = { data?: Array<{ id?: unknown; display_name?: unknown }> };

/** `…/v1/models` for a gateway root written with or without a trailing `/v1`. */
function modelsEndpoint(baseUrl: string): string {
	const root = baseUrl.trim().replace(/\/+$/, "");
	return root.endsWith("/v1") ? `${root}/models` : `${root}/v1/models`;
}

/**
 * Read the gateway's chat-model catalog, sorted by id and deduplicated.
 *
 * Both auth headers are sent: CLIProxyAPI accepts `Authorization: Bearer` on its
 * OpenAI-shaped routes and `x-api-key` on its Anthropic-shaped ones.
 *
 * @throws when the gateway rejects the key or answers with a non-2xx status.
 */
export async function listGatewayModels(apiKey: string, baseUrl: string = BASE_URL): Promise<GatewayModel[]> {
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

export default function kafaraLogin(pi: ExtensionAPI): void {
	pi.registerProvider(PROVIDER_ID, {
		baseUrl: BASE_URL,
		api: "anthropic-messages",
		oauth: {
			name: PROVIDER_NAME,
			async login(callbacks) {
				const answer = await callbacks.onPrompt({
					message: `Paste your ${PROVIDER_LABEL} API key`,
					placeholder: "sk-…",
					secret: true,
				});
				const apiKey = answer.trim();
				if (apiKey.length === 0) throw new Error("an API key is required to log in");

				const models = await listGatewayModels(apiKey);
				if (models.length === 0) {
					throw new Error("the gateway returned no chat models for this API key");
				}
				callbacks.onProgress?.(`Gateway key accepted; ${models.length} chat models available.`);
				return apiKey;
			},
		},
		async fetchDynamicModels(apiKey): Promise<readonly ProviderModelConfig[]> {
			// Unauthenticated: report nothing, so discovery never offers unusable models.
			if (!apiKey) return [];
			const models = await listGatewayModels(apiKey);
			pi.logger.debug("kafara login: discovered gateway models", { count: models.length });
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
}
