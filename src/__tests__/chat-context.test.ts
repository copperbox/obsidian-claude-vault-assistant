import { describe, it, expect } from "vitest";
import {
	pathToWikiLink,
	buildContextPreamble,
	composeMessage,
} from "../chat-context";

describe("pathToWikiLink", () => {
	it("drops a trailing .md extension", () => {
		expect(pathToWikiLink("note.md")).toBe("note");
	});

	it("keeps the folder structure", () => {
		expect(pathToWikiLink("Daily/2026-06-30.md")).toBe("Daily/2026-06-30");
	});

	it("is case-insensitive on the extension", () => {
		expect(pathToWikiLink("Note.MD")).toBe("Note");
	});

	it("leaves a path without an .md extension unchanged", () => {
		expect(pathToWikiLink("folder/note")).toBe("folder/note");
	});
});

describe("buildContextPreamble", () => {
	it("returns an empty string when there are no notes", () => {
		expect(buildContextPreamble([])).toBe("");
	});

	it("references a single note as a wiki link with 'it'", () => {
		expect(buildContextPreamble(["Daily/2026-06-30.md"])).toBe(
			"Currently viewing in Obsidian: [[Daily/2026-06-30]]. Read it if relevant to my question."
		);
	});

	it("references multiple notes with 'them'", () => {
		expect(buildContextPreamble(["a.md", "b.md"])).toBe(
			"Currently viewing in Obsidian: [[a]], [[b]]. Read them if relevant to my question."
		);
	});
});

describe("composeMessage", () => {
	it("prepends the preamble with a blank line between it and the user text", () => {
		expect(composeMessage("PRE", "hello")).toBe("PRE\n\nhello");
	});

	it("returns the user text unchanged when the preamble is empty", () => {
		expect(composeMessage("", "hello")).toBe("hello");
	});
});
