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
});
