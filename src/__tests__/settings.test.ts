import { describe, it, expect } from "vitest";
import { DEFAULT_SETTINGS, parseSettings, type PluginSettings } from "../settings";

describe("DEFAULT_SETTINGS", () => {
	it("has correct default values", () => {
		expect(DEFAULT_SETTINGS.allowedTools).toEqual(["Read", "Grep", "Glob", "Write", "Edit"]);
		expect(DEFAULT_SETTINGS.cliPath).toBe("claude");
		expect(DEFAULT_SETTINGS.maxTurns).toBe(50);
		expect(DEFAULT_SETTINGS.maxBudget).toBeNull();
		expect(DEFAULT_SETTINGS.modelOverride).toBe("");
		expect(DEFAULT_SETTINGS.maxHistoryEntries).toBe(50);
	});
});

describe("parseSettings", () => {
	it("returns defaults when data is null", () => {
		const result = parseSettings(null);
		expect(result).toEqual(DEFAULT_SETTINGS);
	});

	it("returns defaults when data is undefined", () => {
		const result = parseSettings(undefined);
		expect(result).toEqual(DEFAULT_SETTINGS);
	});

	it("merges partial data with defaults", () => {
		const result = parseSettings({ cliPath: "/usr/local/bin/claude" });
		expect(result.cliPath).toBe("/usr/local/bin/claude");
		expect(result.allowedTools).toEqual(DEFAULT_SETTINGS.allowedTools);
		expect(result.maxTurns).toBe(50);
		expect(result.maxBudget).toBeNull();
		expect(result.modelOverride).toBe("");
	});

	it("preserves all overridden fields", () => {
		const overrides: PluginSettings = {
			allowedTools: ["Read", "Grep"],
			cliPath: "/opt/claude",
			maxTurns: 10,
			maxBudget: 5.0,
			modelOverride: "sonnet",
			maxHistoryEntries: 25,
		};
		const result = parseSettings(overrides);
		expect(result).toEqual(overrides);
	});

	it("preserves maxBudget when set to a number", () => {
		const result = parseSettings({ maxBudget: 2.5 });
		expect(result.maxBudget).toBe(2.5);
	});

	it("preserves maxBudget null", () => {
		const result = parseSettings({ maxBudget: null });
		expect(result.maxBudget).toBeNull();
	});
});
