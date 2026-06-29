import { describe, it, expect } from "vitest";
import {
	filterToolInput,
	renderToolCall,
	renderToolResult,
} from "../tool-render";

/**
 * Minimal DOM stub mirroring the subset of the Obsidian element API the
 * renderers touch. Records created children so tests can assert structure.
 */
function makeEl(tag = "div"): Record<string, unknown> {
	const el: Record<string, unknown> = {
		tag,
		children: [] as Record<string, unknown>[],
		attrs: {} as Record<string, string>,
		classes: new Set<string>(),
		text: "",
	};
	const apply = (child: Record<string, unknown>, opts?: { cls?: string; text?: string }) => {
		if (opts?.cls) {
			for (const c of opts.cls.split(/\s+/)) {
				if (c) (child.classes as Set<string>).add(c);
			}
		}
		if (opts?.text) child.text = opts.text;
		(el.children as Record<string, unknown>[]).push(child);
		return child;
	};
	el.createEl = (t: string, opts?: { cls?: string; text?: string }) =>
		apply(makeEl(t), opts);
	el.createDiv = (opts?: { cls?: string; text?: string }) =>
		apply(makeEl("div"), opts);
	el.createSpan = (opts?: { cls?: string; text?: string }) =>
		apply(makeEl("span"), opts);
	el.setAttr = (name: string, value: string) => {
		(el.attrs as Record<string, string>)[name] = value;
	};
	el.addClass = (cls: string) => (el.classes as Set<string>).add(cls);
	el.removeClass = (cls: string) => (el.classes as Set<string>).delete(cls);
	el.setText = (t: string) => {
		el.text = t;
	};
	return el;
}

describe("filterToolInput", () => {
	it("summarizes Write content by length", () => {
		const out = filterToolInput("Write", {
			file_path: "a.md",
			content: "hello world",
		});
		expect(out).toEqual({ file_path: "a.md", content: "(11 chars)" });
	});

	it("summarizes Edit old/new strings by length", () => {
		const out = filterToolInput("Edit", {
			file_path: "a.md",
			old_string: "abc",
			new_string: "abcd",
		});
		expect(out).toEqual({
			file_path: "a.md",
			old_string: "(3 chars)",
			new_string: "(4 chars)",
		});
	});

	it("passes through input for other tools unchanged", () => {
		const input = { pattern: "foo", path: "src" };
		expect(filterToolInput("Grep", input)).toBe(input);
	});
});

describe("renderToolCall / renderToolResult", () => {
	it("renders a pending call then flips to success", () => {
		const container = makeEl();
		const els = renderToolCall(container as unknown as HTMLElement, {
			toolName: "Read",
			filePath: "foo.md",
			input: { file_path: "foo.md" },
		});
		expect((els.statusEl as unknown as { classes: Set<string> }).classes).toContain(
			"claude-tool-call-status-pending"
		);

		renderToolResult(els, false, "ok");
		const status = els.statusEl as unknown as {
			classes: Set<string>;
			text: string;
		};
		expect(status.classes.has("claude-tool-call-status-pending")).toBe(false);
		expect(status.classes.has("claude-tool-call-status-success")).toBe(true);
	});

	it("opens details and marks summary on error", () => {
		const container = makeEl();
		const els = renderToolCall(container as unknown as HTMLElement, {
			toolName: "Read",
			filePath: "missing.md",
		});
		renderToolResult(els, true, "not found");
		const details = els.details as unknown as { attrs: Record<string, string> };
		const summary = els.summary as unknown as { classes: Set<string> };
		expect(details.attrs).toHaveProperty("open");
		expect(summary.classes.has("claude-tool-call-summary-error")).toBe(true);
	});
});
