import { describe, it, expect, beforeEach } from "vitest";
import { Vault } from "../__mocks__/obsidian";
import {
	extractPromptName,
	scanPromptFiles,
	readPromptContent,
} from "../prompt-scanner";

describe("extractPromptName", () => {
	it("extracts name from valid prompt filename", () => {
		expect(extractPromptName("PROMPT-organize.md")).toBe("organize");
	});

	it("extracts multi-word hyphenated names", () => {
		expect(extractPromptName("PROMPT-clean-up-imports.md")).toBe(
			"clean-up-imports"
		);
	});

	it("returns null for non-prompt files", () => {
		expect(extractPromptName("README.md")).toBeNull();
		expect(extractPromptName("notes.md")).toBeNull();
	});

	it("returns null for files with wrong prefix casing", () => {
		expect(extractPromptName("prompt-organize.md")).toBeNull();
		expect(extractPromptName("Prompt-organize.md")).toBeNull();
	});

	it("returns null for PROMPT- without a name", () => {
		expect(extractPromptName("PROMPT-.md")).toBeNull();
	});

	it("returns null for PROMPT prefix without .md extension", () => {
		expect(extractPromptName("PROMPT-organize.txt")).toBeNull();
		expect(extractPromptName("PROMPT-organize")).toBeNull();
	});
});

describe("scanPromptFiles", () => {
	let vault: Vault;

	beforeEach(() => {
		vault = new Vault();
	});

	it("returns prompt files at vault root", async () => {
		vault._addFile("PROMPT-organize.md", "/");
		vault._addFile("PROMPT-refactor.md", "/");

		const result = await scanPromptFiles(vault as never);

		expect(result).toEqual([
			{ name: "organize", path: "PROMPT-organize.md" },
			{ name: "refactor", path: "PROMPT-refactor.md" },
		]);
	});

	it("ignores prompt files in subdirectories", async () => {
		vault._addFile("PROMPT-organize.md", "/");
		vault._addFile("PROMPT-nested.md", "subfolder");

		const result = await scanPromptFiles(vault as never);

		expect(result).toHaveLength(1);
		expect(result[0]!.name).toBe("organize");
	});

	it("ignores non-prompt markdown files at root", async () => {
		vault._addFile("README.md", "/");
		vault._addFile("PROMPT-organize.md", "/");

		const result = await scanPromptFiles(vault as never);

		expect(result).toHaveLength(1);
		expect(result[0]!.name).toBe("organize");
	});

	it("returns empty array when no prompt files exist", async () => {
		vault._addFile("README.md", "/");

		const result = await scanPromptFiles(vault as never);

		expect(result).toEqual([]);
	});

	it("returns results sorted alphabetically by name", async () => {
		vault._addFile("PROMPT-zebra.md", "/");
		vault._addFile("PROMPT-alpha.md", "/");
		vault._addFile("PROMPT-middle.md", "/");

		const result = await scanPromptFiles(vault as never);

		expect(result.map((p) => p.name)).toEqual([
			"alpha",
			"middle",
			"zebra",
		]);
	});
});

describe("readPromptContent", () => {
	let vault: Vault;

	beforeEach(() => {
		vault = new Vault();
	});

	it("reads content of a prompt file", async () => {
		vault._addFile(
			"PROMPT-organize.md",
			"/",
			"Organize my vault notes by topic."
		);

		const content = await readPromptContent(
			vault as never,
			"PROMPT-organize.md"
		);

		expect(content).toBe("Organize my vault notes by topic.");
	});

	it("throws when file does not exist", async () => {
		await expect(
			readPromptContent(vault as never, "PROMPT-missing.md")
		).rejects.toThrow("Prompt file not found: PROMPT-missing.md");
	});
});
