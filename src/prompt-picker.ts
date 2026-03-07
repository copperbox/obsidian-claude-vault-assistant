import { type App, SuggestModal } from "obsidian";
import type { RunScope } from "./claude-runner";
import type { PromptFile } from "./prompt-scanner";
import type { PromptOverrides } from "./frontmatter";

interface ScopeOption {
	scope: RunScope;
	label: string;
	description: string;
}

export class ScopePickerModal extends SuggestModal<ScopeOption> {
	private options: ScopeOption[];
	private onSelect: (scope: RunScope) => void;

	constructor(
		app: App,
		hasActiveNote: boolean,
		onSelect: (scope: RunScope) => void
	) {
		super(app);
		this.onSelect = onSelect;
		this.options = [
			{
				scope: "vault",
				label: "Run on Vault",
				description: "Claude can read and edit any file in the vault",
			},
		];
		if (hasActiveNote) {
			this.options.push({
				scope: "note",
				label: "Run on Active Note",
				description: "Claude is constrained to the currently open note",
			});
		}
		this.setPlaceholder("Choose scope…");
	}

	getSuggestions(query: string): ScopeOption[] {
		if (!query) return this.options;
		const lower = query.toLowerCase();
		return this.options.filter((o) =>
			o.label.toLowerCase().includes(lower)
		);
	}

	renderSuggestion(option: ScopeOption, el: HTMLElement): void {
		el.createEl("div", { text: option.label });
		el.createEl("small", { text: option.description });
	}

	onChooseSuggestion(option: ScopeOption): void {
		this.onSelect(option.scope);
	}
}

export interface PromptPickerResult {
	name: string;
	path: string;
	content: string;
}

type PromptPickerCallback = (result: PromptPickerResult) => void;

export class PromptPickerModal extends SuggestModal<PromptFile> {
	private prompts: PromptFile[];
	private readContent: (path: string) => Promise<string>;
	private onSelect: PromptPickerCallback;
	private overridesMap: Map<string, PromptOverrides>;

	constructor(
		app: App,
		prompts: PromptFile[],
		readContent: (path: string) => Promise<string>,
		onSelect: PromptPickerCallback,
		overridesMap?: Map<string, PromptOverrides>
	) {
		super(app);
		this.prompts = prompts;
		this.readContent = readContent;
		this.onSelect = onSelect;
		this.overridesMap = overridesMap ?? new Map();
		this.setPlaceholder(
			prompts.length > 0
				? "Select a prompt to run…"
				: "No PROMPT-*.md files found in vault root"
		);
	}

	getSuggestions(query: string): PromptFile[] {
		if (!query) return this.prompts;
		const lower = query.toLowerCase();
		return this.prompts.filter((p) =>
			p.name.toLowerCase().includes(lower)
		);
	}

	renderSuggestion(prompt: PromptFile, el: HTMLElement): void {
		const titleEl = el.createEl("div", { text: prompt.name });
		const overrides = this.overridesMap.get(prompt.path);
		if (overrides && Object.keys(overrides).length > 0) {
			titleEl.createEl("span", {
				text: formatOverrideBadges(overrides),
				cls: "prompt-picker-overrides",
			});
		}
		el.createEl("small", { text: prompt.path, cls: "prompt-picker-path" });
	}

	onChooseSuggestion(prompt: PromptFile): void {
		void this.readContent(prompt.path).then((content) => {
			this.onSelect({
				name: prompt.name,
				path: prompt.path,
				content,
			});
		});
	}
}

export function filterPrompts(prompts: PromptFile[], query: string): PromptFile[] {
	if (!query) return prompts;
	const lower = query.toLowerCase();
	return prompts.filter((p) => p.name.toLowerCase().includes(lower));
}

export function formatOverrideBadges(overrides: PromptOverrides): string {
	const badges: string[] = [];
	if (overrides.model) badges.push(overrides.model);
	if (overrides.allowedTools) badges.push(`${overrides.allowedTools.length} tools`);
	if (overrides.maxTurns) badges.push(`${overrides.maxTurns} turns`);
	if (overrides.maxBudget) badges.push(`$${overrides.maxBudget}`);
	return badges.length > 0 ? ` [${badges.join(", ")}]` : "";
}
