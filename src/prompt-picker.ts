import { type App, SuggestModal } from "obsidian";
import type { RunScope } from "./run-types";
import type { PromptFile } from "./prompt-scanner";
import type { PromptOverrides } from "./frontmatter";

interface ScopeOption {
	action: "scope" | "chat";
	/** Set for action "scope"; absent for "chat". */
	scope?: RunScope;
	label: string;
	description: string;
}

export class ScopePickerModal extends SuggestModal<ScopeOption> {
	private options: ScopeOption[];
	private onSelect: (scope: RunScope) => void;
	private onOpenChat?: () => void;

	constructor(
		app: App,
		hasActiveNote: boolean,
		onSelect: (scope: RunScope) => void,
		onOpenChat?: () => void
	) {
		super(app);
		this.onSelect = onSelect;
		this.onOpenChat = onOpenChat;
		this.options = [
			{
				action: "scope",
				scope: "vault",
				label: "Run on Vault",
				description: "Claude can read and edit any file in the vault",
			},
		];
		if (hasActiveNote) {
			this.options.push({
				action: "scope",
				scope: "note",
				label: "Run on Active Note",
				description: "Claude is constrained to the currently open note",
			});
		}
		// When the caller supports it (the ribbon entry point), always offer
		// opening the chat -- regardless of whether an active note exists.
		if (onOpenChat) {
			this.options.push({
				action: "chat",
				label: "Open Claude chat",
				description: "Start a multi-turn conversation with Claude",
			});
		}
		this.setPlaceholder(onOpenChat ? "Choose an action..." : "Choose scope...");
	}

	getSuggestions(query: string): ScopeOption[] {
		if (!query) return this.options;
		const lower = query.toLowerCase();
		return this.options.filter((o) =>
			o.label.toLowerCase().includes(lower)
		);
	}

	renderSuggestion(option: ScopeOption, el: HTMLElement): void {
		el.createDiv({ text: option.label });
		el.createEl("small", { text: option.description });
	}

	onChooseSuggestion(option: ScopeOption): void {
		if (option.action === "chat") {
			this.onOpenChat?.();
			return;
		}
		if (option.scope) this.onSelect(option.scope);
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
		this.overridesMap = overridesMap ?? new Map<string, PromptOverrides>();
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
		const titleEl = el.createDiv({ text: prompt.name });
		const overrides = this.overridesMap.get(prompt.path);
		if (overrides && Object.keys(overrides).length > 0) {
			titleEl.createSpan({
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
	if (overrides.effort) badges.push(`effort: ${overrides.effort}`);
	if (overrides.permissionMode) badges.push(overrides.permissionMode);
	return badges.length > 0 ? ` [${badges.join(", ")}]` : "";
}
