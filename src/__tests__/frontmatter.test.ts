import { describe, it, expect } from "vitest";
import {
	parsePromptFrontmatter,
	hasOverrides,
	mergeOverrides,
} from "../frontmatter";
import { DEFAULT_SETTINGS } from "../settings";

describe("parsePromptFrontmatter", () => {
	it("returns content unchanged when no frontmatter", () => {
		const result = parsePromptFrontmatter("Just a prompt.");
		expect(result.content).toBe("Just a prompt.");
		expect(result.overrides).toEqual({});
	});

	it("strips frontmatter and extracts model override", () => {
		const raw = `---
model: sonnet
---
Do something.`;
		const result = parsePromptFrontmatter(raw);
		expect(result.content).toBe("Do something.");
		expect(result.overrides.model).toBe("sonnet");
	});

	it("extracts maxTurns override", () => {
		const raw = `---
maxTurns: 10
---
Prompt text.`;
		const result = parsePromptFrontmatter(raw);
		expect(result.overrides.maxTurns).toBe(10);
	});

	it("extracts maxBudget override", () => {
		const raw = `---
maxBudget: 0.50
---
Prompt text.`;
		const result = parsePromptFrontmatter(raw);
		expect(result.overrides.maxBudget).toBe(0.5);
	});

	it("extracts inline allowedTools array", () => {
		const raw = `---
allowedTools: [Read, Grep, Glob]
---
Prompt text.`;
		const result = parsePromptFrontmatter(raw);
		expect(result.overrides.allowedTools).toEqual(["Read", "Grep", "Glob"]);
	});

	it("extracts block-style allowedTools array", () => {
		const raw = `---
allowedTools:
  - Read
  - Grep
---
Prompt text.`;
		const result = parsePromptFrontmatter(raw);
		expect(result.overrides.allowedTools).toEqual(["Read", "Grep"]);
	});

	it("extracts multiple overrides", () => {
		const raw = `---
model: opus
maxTurns: 5
maxBudget: 2.0
allowedTools: [Read, Write]
---
Multi-override prompt.`;
		const result = parsePromptFrontmatter(raw);
		expect(result.content).toBe("Multi-override prompt.");
		expect(result.overrides).toEqual({
			model: "opus",
			maxTurns: 5,
			maxBudget: 2.0,
			allowedTools: ["Read", "Write"],
		});
	});

	it("ignores unknown frontmatter keys", () => {
		const raw = `---
title: My Prompt
model: haiku
unknownKey: value
---
Prompt.`;
		const result = parsePromptFrontmatter(raw);
		expect(result.overrides).toEqual({ model: "haiku" });
	});

	it("ignores invalid maxTurns (non-positive)", () => {
		const raw = `---
maxTurns: -5
---
Prompt.`;
		const result = parsePromptFrontmatter(raw);
		expect(result.overrides.maxTurns).toBeUndefined();
	});

	it("ignores invalid maxTurns (not a number)", () => {
		const raw = `---
maxTurns: abc
---
Prompt.`;
		const result = parsePromptFrontmatter(raw);
		expect(result.overrides.maxTurns).toBeUndefined();
	});

	it("ignores invalid maxBudget (non-positive)", () => {
		const raw = `---
maxBudget: 0
---
Prompt.`;
		const result = parsePromptFrontmatter(raw);
		expect(result.overrides.maxBudget).toBeUndefined();
	});

	it("handles empty frontmatter block", () => {
		const raw = `---
---
Prompt after empty frontmatter.`;
		const result = parsePromptFrontmatter(raw);
		expect(result.content).toBe("Prompt after empty frontmatter.");
		expect(result.overrides).toEqual({});
	});

	it("handles frontmatter with Windows line endings", () => {
		const raw = "---\r\nmodel: sonnet\r\n---\r\nPrompt.";
		const result = parsePromptFrontmatter(raw);
		expect(result.overrides.model).toBe("sonnet");
		expect(result.content).toBe("Prompt.");
	});
});

describe("hasOverrides", () => {
	it("returns false for empty overrides", () => {
		expect(hasOverrides({})).toBe(false);
	});

	it("returns true when overrides are present", () => {
		expect(hasOverrides({ model: "sonnet" })).toBe(true);
	});
});

describe("mergeOverrides", () => {
	it("returns settings unchanged when no overrides", () => {
		const result = mergeOverrides(DEFAULT_SETTINGS, {});
		expect(result).toEqual(DEFAULT_SETTINGS);
	});

	it("overrides model", () => {
		const result = mergeOverrides(DEFAULT_SETTINGS, { model: "opus" });
		expect(result.modelOverride).toBe("opus");
		expect(result.allowedTools).toEqual(DEFAULT_SETTINGS.allowedTools);
	});

	it("overrides allowedTools", () => {
		const result = mergeOverrides(DEFAULT_SETTINGS, { allowedTools: ["Read"] });
		expect(result.allowedTools).toEqual(["Read"]);
		expect(result.modelOverride).toBe("");
	});

	it("overrides maxTurns", () => {
		const result = mergeOverrides(DEFAULT_SETTINGS, { maxTurns: 10 });
		expect(result.maxTurns).toBe(10);
	});

	it("overrides maxBudget", () => {
		const result = mergeOverrides(DEFAULT_SETTINGS, { maxBudget: 1.5 });
		expect(result.maxBudget).toBe(1.5);
	});

	it("applies all overrides at once", () => {
		const result = mergeOverrides(DEFAULT_SETTINGS, {
			model: "haiku",
			allowedTools: ["Read", "Grep"],
			maxTurns: 5,
			maxBudget: 0.5,
		});
		expect(result.modelOverride).toBe("haiku");
		expect(result.allowedTools).toEqual(["Read", "Grep"]);
		expect(result.maxTurns).toBe(5);
		expect(result.maxBudget).toBe(0.5);
		// cliPath should remain unchanged
		expect(result.cliPath).toBe(DEFAULT_SETTINGS.cliPath);
	});

	it("does not mutate original settings", () => {
		const original = { ...DEFAULT_SETTINGS };
		mergeOverrides(DEFAULT_SETTINGS, { model: "opus" });
		expect(DEFAULT_SETTINGS).toEqual(original);
	});
});
