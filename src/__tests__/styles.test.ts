import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import path from "path";

const css = readFileSync(
	path.resolve(__dirname, "../../styles.css"),
	"utf8"
);

/** Returns the body of the first CSS rule for `selector`, or "" if absent. */
function ruleBody(selector: string): string {
	const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
	const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`));
	return match?.[1] ?? "";
}

describe("styles.css text selection", () => {
	// Obsidian disables text selection in plugin views by default. The output
	// must opt back in so users can select and copy it (e.g. for debugging).
	it("enables text selection on the output content", () => {
		const body = ruleBody(".claude-output-content");
		expect(body).toContain("user-select: text");
		expect(body).toContain("-webkit-user-select: text");
	});

	it("enables text selection on the error block", () => {
		const body = ruleBody(".claude-output-error");
		expect(body).toContain("user-select: text");
		expect(body).toContain("-webkit-user-select: text");
	});

	it("enables text selection on the chat transcript", () => {
		const body = ruleBody(".claude-chat-transcript");
		expect(body).toContain("user-select: text");
		expect(body).toContain("-webkit-user-select: text");
	});

	it("enables text selection on the chat input", () => {
		const body = ruleBody(".claude-chat-input");
		expect(body).toContain("user-select: text");
		expect(body).toContain("-webkit-user-select: text");
	});
});

describe("styles.css code block frame", () => {
	// Obsidian's reading-view code frame is scoped to .markdown-rendered, which
	// the panes aren't inside. The shared pre rule (output + chat) must draw the
	// frame so it's clear where a code block starts and stops.
	it("frames fenced code blocks in the output and chat panes", () => {
		const body = ruleBody(".claude-chat-msg-assistant pre");
		expect(body).toContain("background-color: var(--code-background)");
		expect(body).toContain("border:");
		expect(body).toContain("border-radius:");
		expect(body).toContain("padding:");
	});

	it("positions the language label in the corner of the block", () => {
		const body = ruleBody(".claude-code-lang");
		expect(body).toContain("position: absolute");
		expect(body).toContain("top:");
		expect(body).toContain("right:");
	});
});
