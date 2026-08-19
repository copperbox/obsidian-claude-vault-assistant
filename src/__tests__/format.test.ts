import { describe, it, expect } from "vitest";
import {
	sumUsageTokens,
	outputTokensFromUsage,
	contextTokensFromUsage,
	formatTokens,
	formatResultMeta,
} from "../format";

describe("sumUsageTokens", () => {
	it("sums prompt, output, and both cache buckets", () => {
		expect(
			sumUsageTokens({
				input_tokens: 10,
				output_tokens: 20,
				cache_creation_input_tokens: 5,
				cache_read_input_tokens: 100,
			})
		).toBe(135);
	});

	it("treats missing fields as zero", () => {
		expect(sumUsageTokens({ input_tokens: 10, output_tokens: 20 })).toBe(30);
	});

	it("returns undefined when there is no usage object", () => {
		expect(sumUsageTokens(undefined)).toBeUndefined();
		expect(sumUsageTokens(null)).toBeUndefined();
		expect(sumUsageTokens("nope")).toBeUndefined();
	});

	it("returns undefined when the usage object has no numeric fields", () => {
		expect(sumUsageTokens({})).toBeUndefined();
		expect(sumUsageTokens({ input_tokens: "10" })).toBeUndefined();
	});
});

describe("outputTokensFromUsage", () => {
	it("returns the output_tokens field", () => {
		expect(outputTokensFromUsage({ input_tokens: 10, output_tokens: 20 })).toBe(
			20
		);
	});

	it("returns 0 when output_tokens is missing or non-numeric", () => {
		expect(outputTokensFromUsage({ input_tokens: 10 })).toBe(0);
		expect(outputTokensFromUsage({ output_tokens: "20" })).toBe(0);
	});

	it("returns 0 when there is no usage object", () => {
		expect(outputTokensFromUsage(undefined)).toBe(0);
		expect(outputTokensFromUsage(null)).toBe(0);
		expect(outputTokensFromUsage("nope")).toBe(0);
	});
});

describe("formatTokens", () => {
	it("adds thousands separators", () => {
		expect(formatTokens(0)).toBe("0");
		expect(formatTokens(999)).toBe("999");
		expect(formatTokens(1000)).toBe("1,000");
		expect(formatTokens(1234567)).toBe("1,234,567");
	});

	it("rounds fractional counts", () => {
		expect(formatTokens(1500.6)).toBe("1,501");
	});
});

describe("formatResultMeta", () => {
	it("joins cost, duration, and tokens with ' - '", () => {
		expect(
			formatResultMeta({ costUsd: 0.0123, durationMs: 4500, tokens: 12345 })
		).toBe("$0.0123 - 4.5s - 12,345 tokens");
	});

	it("omits missing fields", () => {
		expect(formatResultMeta({ durationMs: 2000 })).toBe("2.0s");
		expect(formatResultMeta({ costUsd: 0.5, tokens: 100 })).toBe(
			"$0.5000 - 100 tokens"
		);
	});

	it("returns an empty string when nothing is available", () => {
		expect(formatResultMeta({})).toBe("");
	});
});

describe("contextTokensFromUsage", () => {
	it("sums prompt, cache buckets and output into context occupancy", () => {
		expect(
			contextTokensFromUsage({
				input_tokens: 10,
				cache_creation_input_tokens: 500,
				cache_read_input_tokens: 40000,
				output_tokens: 90,
			})
		).toBe(40600);
	});

	it("returns 0 when usage is missing or malformed", () => {
		expect(contextTokensFromUsage(undefined)).toBe(0);
		expect(contextTokensFromUsage("nope")).toBe(0);
		expect(contextTokensFromUsage({})).toBe(0);
	});
});
