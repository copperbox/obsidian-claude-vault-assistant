import type { Vault } from "obsidian";

const PROMPT_PREFIX = "PROMPT-";
const PROMPT_SUFFIX = ".md";
const PROMPT_PATTERN = new RegExp(
	`^${PROMPT_PREFIX}(.+)${PROMPT_SUFFIX.replace(".", "\\.")}$`
);

export interface PromptFile {
	name: string;
	path: string;
}

export function extractPromptName(filename: string): string | null {
	const match = filename.match(PROMPT_PATTERN);
	return match?.[1] ?? null;
}

export async function scanPromptFiles(vault: Vault): Promise<PromptFile[]> {
	const files = vault.getMarkdownFiles();
	const prompts: PromptFile[] = [];

	for (const file of files) {
		if (file.parent?.path !== "/") continue;
		const name = extractPromptName(file.name);
		if (name) {
			prompts.push({ name, path: file.path });
		}
	}

	prompts.sort((a, b) => a.name.localeCompare(b.name));
	return prompts;
}

export async function readPromptContent(
	vault: Vault,
	path: string
): Promise<string> {
	const file = vault.getFileByPath(path);
	if (!file) {
		throw new Error(`Prompt file not found: ${path}`);
	}
	return vault.read(file);
}
