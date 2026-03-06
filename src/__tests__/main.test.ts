import { describe, it, expect } from "vitest";

describe("ClaudeVaultAssistant", () => {
	it("should be importable", async () => {
		// Verify the module can be imported without errors
		const mod = await import("../main");
		expect(mod.default).toBeDefined();
	});
});
