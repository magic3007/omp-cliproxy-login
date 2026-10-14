import { describe, expect, test } from "bun:test";
import {
	classifyKeyReference,
	DEFAULT_API,
	modelsEndpoint,
	normalizeBaseUrl,
	normalizeGatewayName,
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
		expect(classifyKeyReference("KAFARA_API_KEY", { KAFARA_API_KEY: "sk-1" })).toEqual({
			kind: "env",
			name: "KAFARA_API_KEY",
		});
	});

	test("falls back to a literal for a name nothing sets", () => {
		expect(classifyKeyReference("KAFARA_API_KEY", {})).toEqual({ kind: "literal", key: "KAFARA_API_KEY" });
	});

	test("runs a !command reference", () => {
		expect(classifyKeyReference("!  gpg -q -d keys.gpg", {})).toEqual({
			kind: "command",
			command: "gpg -q -d keys.gpg",
		});
	});

	test("keeps a pasted key as a literal", () => {
		expect(classifyKeyReference("sk-abc", { KAFARA_API_KEY: "sk-abc" })).toEqual({ kind: "literal", key: "sk-abc" });
	});
});

describe("referenceToStore", () => {
	test("stores a pasted key as the environment variable already holding it", () => {
		expect(referenceToStore("sk-abc", "sk-abc", { KAFARA_API_KEY: "sk-abc" })).toBe("KAFARA_API_KEY");
	});

	test("stores a reference as typed", () => {
		expect(referenceToStore("KAFARA_API_KEY", "sk-abc", { KAFARA_API_KEY: "sk-abc" })).toBe("KAFARA_API_KEY");
		expect(referenceToStore("!pass show gw", "sk-abc", {})).toBe("!pass show gw");
	});

	test("stores a pasted key nothing holds as typed", () => {
		expect(referenceToStore("sk-abc", "sk-abc", { OTHER_API_KEY: "sk-xyz" })).toBe("sk-abc");
	});
});
