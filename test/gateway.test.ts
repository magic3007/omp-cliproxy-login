import { describe, expect, test } from "bun:test";
import {
	classifyKeyReference,
	DEFAULT_API,
	modelsEndpoint,
	normalizeBaseUrl,
	normalizeGatewayName,
	parseEntries,
	parseModelIds,
	providerBaseUrl,
	referenceToStore,
	WIZARD_ID,
} from "../src/index.ts";

describe("normalizeBaseUrl", () => {
	test("keeps a gateway root as typed", () => {
		expect(normalizeBaseUrl("https://gw.example.com")).toBe("https://gw.example.com");
		expect(normalizeBaseUrl("https://gw.example.com/api/coding")).toBe("https://gw.example.com/api/coding");
	});

	test("drops trailing slashes, surrounding space and a trailing /v1", () => {
		expect(normalizeBaseUrl("  https://gw.example.com//  ")).toBe("https://gw.example.com");
		expect(normalizeBaseUrl("https://gw.example.com/v1")).toBe("https://gw.example.com");
		expect(normalizeBaseUrl("https://gw.example.com/v1/")).toBe("https://gw.example.com");
	});

	test("rejects input the derived endpoints could not use", () => {
		expect(() => normalizeBaseUrl("gw.example.com")).toThrow(/absolute URL/);
		expect(() => normalizeBaseUrl("ftp://gw.example.com")).toThrow(/scheme/);
		expect(() => normalizeBaseUrl("https://gw.example.com?key=abc")).toThrow(/without a query string/);
		expect(() => normalizeBaseUrl("https://gw.example.com#v1")).toThrow(/without a query string/);
	});
});

describe("modelsEndpoint", () => {
	test("asks a root for /v1/models exactly once", () => {
		expect(modelsEndpoint("https://gw.example.com")).toBe("https://gw.example.com/v1/models");
		expect(modelsEndpoint("https://gw.example.com/v1")).toBe("https://gw.example.com/v1/models");
		expect(modelsEndpoint("https://gw.example.com/api/coding/")).toBe("https://gw.example.com/api/coding/v1/models");
	});
});

describe("providerBaseUrl", () => {
	// The wires disagree: anthropic-messages appends /v1/messages, while
	// openai-completions appends /chat/completions only.
	test("hands the Anthropic wire the bare root", () => {
		expect(providerBaseUrl({ baseUrl: "https://gw.example.com/v1", api: DEFAULT_API })).toBe("https://gw.example.com");
	});

	test("hands the OpenAI wire the /v1 prefix", () => {
		expect(providerBaseUrl({ baseUrl: "https://gw.example.com", api: "openai-completions" })).toBe(
			"https://gw.example.com/v1",
		);
		expect(providerBaseUrl({ baseUrl: "https://gw.example.com/v1/", api: "openai-completions" })).toBe(
			"https://gw.example.com/v1",
		);
	});
});

describe("normalizeGatewayName", () => {
	test("lowercases and trims a usable name", () => {
		expect(normalizeGatewayName("  LiteLLM  ")).toBe("litellm");
		expect(normalizeGatewayName("gw-2.eu_west")).toBe("gw-2.eu_west");
	});

	test("rejects names that would break the model selector", () => {
		expect(() => normalizeGatewayName("Bad Name!")).toThrow(/not a usable gateway name/);
		expect(() => normalizeGatewayName("-leading")).toThrow(/not a usable gateway name/);
		expect(() => normalizeGatewayName("")).toThrow(/not a usable gateway name/);
	});

	test("rejects the login entry's own id", () => {
		expect(() => normalizeGatewayName(WIZARD_ID)).toThrow(/reserved/);
	});
});

describe("parseModelIds", () => {
	test("splits on commas and whitespace, dropping blanks and duplicates", () => {
		expect(parseModelIds("a, b  c,,  a")).toEqual(["a", "b", "c"]);
		expect(parseModelIds("   ")).toEqual([]);
	});
});

describe("classifyKeyReference", () => {
	// The three cases omp's own resolveConfigValue distinguishes, so a value
	// written here behaves the same way it would in models.yml.
	test("reads an exact environment variable name", () => {
		expect(classifyKeyReference("LITELLM_API_KEY", { LITELLM_API_KEY: "sk-1" })).toEqual({
			kind: "env",
			name: "LITELLM_API_KEY",
		});
	});

	test("falls back to a literal for a name nothing sets", () => {
		expect(classifyKeyReference("LITELLM_API_KEY", {})).toEqual({ kind: "literal", key: "LITELLM_API_KEY" });
	});

	test("runs a !command reference", () => {
		expect(classifyKeyReference("!  gpg -q -d keys.gpg", {})).toEqual({
			kind: "command",
			command: "gpg -q -d keys.gpg",
		});
	});

	test("keeps a pasted key as a literal", () => {
		expect(classifyKeyReference("sk-abc", { LITELLM_API_KEY: "sk-abc" })).toEqual({ kind: "literal", key: "sk-abc" });
	});
});

describe("referenceToStore", () => {
	test("stores a pasted key as the environment variable already holding it", () => {
		expect(referenceToStore("sk-abc", "sk-abc", { LITELLM_API_KEY: "sk-abc" })).toBe("LITELLM_API_KEY");
	});

	test("stores a reference as typed", () => {
		expect(referenceToStore("LITELLM_API_KEY", "sk-abc", { LITELLM_API_KEY: "sk-abc" })).toBe("LITELLM_API_KEY");
		expect(referenceToStore("!pass show gw", "sk-abc", {})).toBe("!pass show gw");
	});

	test("stores a pasted key nothing holds as typed", () => {
		expect(referenceToStore("sk-abc", "sk-abc", { OTHER_API_KEY: "sk-xyz" })).toBe("sk-abc");
	});
});

describe("parseEntries", () => {
	const row = (name: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
		name,
		baseUrl: `https://${name}.example.com`,
		...extra,
	});

	test("keeps the good rows when one row is unusable", () => {
		// The login flow writes back what it reads: a file-level schema would
		// turn one hand-edit mistake into the loss of every other gateway.
		const parsed = parseEntries(
			JSON.stringify({
				providers: [row("alpha"), row("beta", { extraModels: "a,b" }), row("gamma")],
			}),
		);
		expect(parsed.entries.map(entry => entry.name)).toEqual(["alpha", "gamma"]);
		expect(parsed.problems).toEqual(['providers[1] ("beta"): "extraModels" is not an array of strings']);
	});

	test("reports every unusable shape instead of guessing", () => {
		const parsed = parseEntries(
			JSON.stringify({
				providers: [
					"not-an-object",
					{ baseUrl: "https://a.example.com" },
					row("Bad Name"),
					{ name: "noc", baseUrl: "   " },
					row("delta", { api: "openai_completions" }),
					row("echo", { apiKey: 42 }),
				],
			}),
		);
		expect(parsed.entries).toEqual([]);
		expect(parsed.problems).toEqual([
			"providers[0] is not an object",
			'providers[1] has no "name" string',
			'providers[2]: "Bad Name" is not a usable gateway name',
			'providers[3] ("noc") has no "baseUrl" string',
			'providers[4] ("delta"): "api" must be anthropic-messages or openai-completions',
			'providers[5] ("echo"): "apiKey" is not a string',
		]);
	});

	test("skips a repeated name, keeping the first", () => {
		const parsed = parseEntries(
			JSON.stringify({ providers: [row("alpha", { apiKey: "FIRST_KEY" }), row("ALPHA", { apiKey: "SECOND_KEY" })] }),
		);
		expect(parsed.entries).toHaveLength(1);
		expect(parsed.entries[0]?.apiKey).toBe("FIRST_KEY");
		expect(parsed.problems).toEqual(['providers[1]: "alpha" is already configured above']);
	});

	test("normalizes the rows it keeps", () => {
		const parsed = parseEntries(
			JSON.stringify({
				providers: [
					{
						name: "  Alpha ",
						baseUrl: "https://alpha.example.com/v1/",
						api: "openai-completions",
						apiKey: "  LITELLM_API_KEY  ",
						extraModels: ["a", " a ", "", "b"],
					},
				],
			}),
		);
		expect(parsed.problems).toEqual([]);
		expect(parsed.entries[0]).toEqual({
			name: "alpha",
			baseUrl: "https://alpha.example.com",
			api: "openai-completions",
			apiKey: "LITELLM_API_KEY",
			extraModels: ["a", "b"],
		});
	});

	test("treats a missing providers array as an empty file", () => {
		expect(parseEntries("{}")).toEqual({ entries: [], problems: [] });
	});

	test("refuses a file it cannot account for, so the caller never overwrites it", () => {
		expect(() => parseEntries("{ not json")).toThrow();
		expect(() => parseEntries("[]")).toThrow(/providers/);
		expect(() => parseEntries(JSON.stringify({ providers: {} }))).toThrow(/must be an array/);
	});
});
