import tsparser from "@typescript-eslint/parser";
import { defineConfig } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";
import { DEFAULT_ACRONYMS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/acronyms.js";

export default defineConfig([
	{ ignores: ["src/__tests__/**", "src/__mocks__/**"] },
	...obsidianmd.configs.recommended,
	{
		files: ["src/**/*.ts"],
		languageOptions: {
			parser: tsparser,
			parserOptions: { project: "./tsconfig.json" },
			globals: {
				console: "readonly",
				document: "readonly",
				setTimeout: "readonly",
				clearTimeout: "readonly",
				activeWindow: "readonly",
				activeDocument: "readonly",
				window: "readonly",
				Buffer: "readonly",
				process: "readonly",
				NodeJS: "readonly",
				Notification: "readonly",
				AsyncIterable: "readonly",
				AsyncIterator: "readonly",
			},
		},
		rules: {
			"obsidianmd/ui/sentence-case": ["error", {
				brands: [
					...DEFAULT_BRANDS,
					"Claude",
					"Claude Code",
					"Sonnet",
					"Opus",
					"Haiku",
					"Read",
					"Grep",
					"Glob",
					"Write",
					"Edit",
				],
				acronyms: [
					...DEFAULT_ACRONYMS,
					"USD",
				],
				ignoreWords: ["claude"],
				ignoreRegex: ["PROMPT-"],
			}],
		},
	},
]);
