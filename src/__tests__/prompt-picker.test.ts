import { describe, it, expect, vi } from "vitest";
import { PromptPickerModal, ScopePickerModal, filterPrompts, formatOverrideBadges } from "../prompt-picker";
import type { PromptFile } from "../prompt-scanner";
import type { PromptOverrides } from "../frontmatter";

const samplePrompts: PromptFile[] = [
	{ name: "organize", path: "PROMPT-organize.md" },
	{ name: "summarize", path: "PROMPT-summarize.md" },
	{ name: "review-code", path: "PROMPT-review-code.md" },
	{ name: "daily-note", path: "PROMPT-daily-note.md" },
];

describe("filterPrompts", () => {
	it("returns all prompts when query is empty", () => {
		expect(filterPrompts(samplePrompts, "")).toEqual(samplePrompts);
	});

	it("filters by case-insensitive substring match", () => {
		const result = filterPrompts(samplePrompts, "org");
		expect(result).toEqual([{ name: "organize", path: "PROMPT-organize.md" }]);
	});

	it("matches multiple results", () => {
		const result = filterPrompts(samplePrompts, "e");
		expect(result.map((p) => p.name)).toEqual([
			"organize",
			"summarize",
			"review-code",
			"daily-note",
		]);
	});

	it("is case-insensitive", () => {
		const result = filterPrompts(samplePrompts, "DAILY");
		expect(result).toEqual([{ name: "daily-note", path: "PROMPT-daily-note.md" }]);
	});

	it("returns empty array when nothing matches", () => {
		expect(filterPrompts(samplePrompts, "xyz")).toEqual([]);
	});
});

describe("PromptPickerModal", () => {
	it("getSuggestions delegates to filter logic", () => {
		const modal = new PromptPickerModal(
			{} as never,
			samplePrompts,
			vi.fn(),
			vi.fn()
		);
		expect(modal.getSuggestions("")).toEqual(samplePrompts);
		expect(modal.getSuggestions("sum")).toEqual([
			{ name: "summarize", path: "PROMPT-summarize.md" },
		]);
	});

	it("onChooseSuggestion reads content and calls callback", async () => {
		const readContent = vi.fn().mockResolvedValue("# Do the thing");
		const onSelect = vi.fn();
		const modal = new PromptPickerModal(
			{} as never,
			samplePrompts,
			readContent,
			onSelect
		);

		await modal.onChooseSuggestion(samplePrompts[0]!);

		expect(readContent).toHaveBeenCalledWith("PROMPT-organize.md");
		expect(onSelect).toHaveBeenCalledWith({
			name: "organize",
			path: "PROMPT-organize.md",
			content: "# Do the thing",
		});
	});

	it("renders suggestion with name and path", () => {
		const modal = new PromptPickerModal(
			{} as never,
			samplePrompts,
			vi.fn(),
			vi.fn()
		);

		const createdEls: { tag: string; opts: Record<string, unknown> }[] = [];
		const mockInner = {
			createEl: (tag: string, opts: Record<string, unknown>) => {
				createdEls.push({ tag, opts });
			},
		};
		const el = {
			createEl: (tag: string, opts: Record<string, unknown>) => {
				createdEls.push({ tag, opts });
				return mockInner;
			},
		} as unknown as HTMLElement;

		modal.renderSuggestion(samplePrompts[0]!, el);

		expect(createdEls).toEqual([
			{ tag: "div", opts: { text: "organize" } },
			{ tag: "small", opts: { text: "PROMPT-organize.md", cls: "prompt-picker-path" } },
		]);
	});

	it("renders override badges when overrides exist", () => {
		const overridesMap = new Map<string, PromptOverrides>([
			["PROMPT-organize.md", { model: "opus", maxTurns: 5 }],
		]);
		const modal = new PromptPickerModal(
			{} as never,
			samplePrompts,
			vi.fn(),
			vi.fn(),
			overridesMap
		);

		const createdEls: { tag: string; opts: Record<string, unknown> }[] = [];
		const mockInner = {
			createEl: (tag: string, opts: Record<string, unknown>) => {
				createdEls.push({ tag, opts });
			},
		};
		const el = {
			createEl: (tag: string, opts: Record<string, unknown>) => {
				createdEls.push({ tag, opts });
				return mockInner;
			},
		} as unknown as HTMLElement;

		modal.renderSuggestion(samplePrompts[0]!, el);

		expect(createdEls).toHaveLength(3);
		expect(createdEls[1]).toEqual({
			tag: "span",
			opts: { text: " [opus, 5 turns]", cls: "prompt-picker-overrides" },
		});
	});
});

describe("ScopePickerModal", () => {
	it("shows only vault option when no active note", () => {
		const modal = new ScopePickerModal({} as never, false, vi.fn());
		const suggestions = modal.getSuggestions("");
		expect(suggestions).toHaveLength(1);
		expect(suggestions[0]!.scope).toBe("vault");
	});

	it("shows both options when active note exists", () => {
		const modal = new ScopePickerModal({} as never, true, vi.fn());
		const suggestions = modal.getSuggestions("");
		expect(suggestions).toHaveLength(2);
		expect(suggestions[0]!.scope).toBe("vault");
		expect(suggestions[1]!.scope).toBe("note");
	});

	it("calls onSelect with chosen scope", () => {
		const onSelect = vi.fn();
		const modal = new ScopePickerModal({} as never, true, onSelect);
		const suggestions = modal.getSuggestions("");
		modal.onChooseSuggestion(suggestions[1]!);
		expect(onSelect).toHaveBeenCalledWith("note");
	});

	it("filters suggestions by query", () => {
		const modal = new ScopePickerModal({} as never, true, vi.fn());
		const results = modal.getSuggestions("Active");
		expect(results).toHaveLength(1);
		expect(results[0]!.scope).toBe("note");
	});
});

describe("formatOverrideBadges", () => {
	it("returns empty string for no overrides", () => {
		expect(formatOverrideBadges({})).toBe("");
	});

	it("formats model override", () => {
		expect(formatOverrideBadges({ model: "sonnet" })).toBe(" [sonnet]");
	});

	it("formats multiple overrides", () => {
		expect(formatOverrideBadges({
			model: "opus",
			allowedTools: ["Read", "Grep"],
			maxTurns: 10,
			maxBudget: 2.5,
		})).toBe(" [opus, 2 tools, 10 turns, $2.5]");
	});
});
