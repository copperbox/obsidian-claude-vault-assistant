import { describe, it, expect } from "vitest";
import { buildPromptText } from "../run-types";

describe("buildPromptText", () => {
	it("returns the body unchanged for vault scope", () => {
		expect(buildPromptText("vault", "do the thing")).toBe("do the thing");
	});

	it("prepends the note restriction for note scope", () => {
		expect(buildPromptText("note", "summarize", "Notes/a.md")).toBe(
			"Only make edits to this note: Notes/a.md\nsummarize"
		);
	});

	it("throws for note scope without a path", () => {
		expect(() => buildPromptText("note", "x")).toThrow();
	});
});
