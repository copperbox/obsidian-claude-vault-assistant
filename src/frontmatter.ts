import type { PluginSettings } from "./settings";

export interface PromptOverrides {
	allowedTools?: string[];
	model?: string;
	maxTurns?: number;
	maxBudget?: number;
}

export interface ParsedPrompt {
	content: string;
	overrides: PromptOverrides;
}

const FRONTMATTER_RE = /^---\r?\n([\s\S]*?\r?\n)?---\r?\n?/;

export function parsePromptFrontmatter(rawContent: string): ParsedPrompt {
	const match = rawContent.match(FRONTMATTER_RE);
	if (!match) {
		return { content: rawContent, overrides: {} };
	}

	const yamlBlock = match[1] ?? "";
	const content = rawContent.slice(match[0].length);
	const overrides = parseOverrides(yamlBlock);

	return { content, overrides };
}

function parseOverrides(yaml: string): PromptOverrides {
	const overrides: PromptOverrides = {};
	const lines = yaml.split(/\r?\n/);

	for (const line of lines) {
		const colonIdx = line.indexOf(":");
		if (colonIdx === -1) continue;

		const key = line.slice(0, colonIdx).trim();
		const value = line.slice(colonIdx + 1).trim();

		switch (key) {
			case "allowedTools": {
				const parsed = parseYamlArray(value, lines, lines.indexOf(line));
				if (parsed.length > 0) {
					overrides.allowedTools = parsed;
				}
				break;
			}
			case "model":
				if (value) overrides.model = value;
				break;
			case "maxTurns": {
				const n = parseInt(value, 10);
				if (!isNaN(n) && n > 0) overrides.maxTurns = n;
				break;
			}
			case "maxBudget": {
				const n = parseFloat(value);
				if (!isNaN(n) && n > 0) overrides.maxBudget = n;
				break;
			}
		}
	}

	return overrides;
}

function parseYamlArray(inlineValue: string, lines: string[], startIdx: number): string[] {
	// Inline format: [Read, Grep, Glob]
	const inlineMatch = inlineValue.match(/^\[(.+)\]$/);
	if (inlineMatch) {
		return inlineMatch[1]!
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s.length > 0);
	}

	// Block format:
	// allowedTools:
	//   - Read
	//   - Grep
	if (inlineValue === "") {
		const items: string[] = [];
		for (let i = startIdx + 1; i < lines.length; i++) {
			const itemMatch = lines[i]!.match(/^\s+-\s+(.+)$/);
			if (itemMatch) {
				items.push(itemMatch[1]!.trim());
			} else {
				break;
			}
		}
		return items;
	}

	return [];
}

export function hasOverrides(overrides: PromptOverrides): boolean {
	return Object.keys(overrides).length > 0;
}

export function mergeOverrides(settings: PluginSettings, overrides: PromptOverrides): PluginSettings {
	return {
		...settings,
		...(overrides.allowedTools !== undefined && { allowedTools: overrides.allowedTools }),
		...(overrides.model !== undefined && { modelOverride: overrides.model }),
		...(overrides.maxTurns !== undefined && { maxTurns: overrides.maxTurns }),
		...(overrides.maxBudget !== undefined && { maxBudget: overrides.maxBudget }),
	};
}
