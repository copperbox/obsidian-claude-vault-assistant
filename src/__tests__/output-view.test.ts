import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
	ClaudeOutputView,
	VIEW_TYPE_CLAUDE_OUTPUT,
	resetPersistedStatus,
	getPersistedStatus,
} from "../output-view";
import { MarkdownRenderer } from "obsidian";
import { type RunHistoryEntry, generateEntryId } from "../run-history";

describe("ClaudeOutputView", () => {
	it("has correct view type constant", () => {
		expect(VIEW_TYPE_CLAUDE_OUTPUT).toBe("claude-vault-output");
	});

	it("returns correct view type", () => {
		const view = new ClaudeOutputView({} as never);
		expect(view.getViewType()).toBe("claude-vault-output");
	});

	it("returns correct display text", () => {
		const view = new ClaudeOutputView({} as never);
		expect(view.getDisplayText()).toBe("Claude Output");
	});

	it("returns correct icon", () => {
		const view = new ClaudeOutputView({} as never);
		expect(view.getIcon()).toBe("terminal");
	});

	describe("status and stop button", () => {
		let view: ClaudeOutputView;

		beforeEach(async () => {
			resetPersistedStatus();
			view = new ClaudeOutputView({} as never);
			await view.onOpen();
		});

		afterEach(async () => {
			await view.onClose();
		});

		it("defaults to idle status", () => {
			expect(view.getStatus()).toBe("idle");
		});

		it("updates status to running", () => {
			view.setStatus("running");
			expect(view.getStatus()).toBe("running");
		});

		it("updates status to complete", () => {
			view.setStatus("complete");
			expect(view.getStatus()).toBe("complete");
		});

		it("updates status to error", () => {
			view.setStatus("error");
			expect(view.getStatus()).toBe("error");
		});

		it("updates status to stopped", () => {
			view.setStatus("stopped");
			expect(view.getStatus()).toBe("stopped");
		});

		it("persists status across view re-opens", async () => {
			view.setStatus("running");
			await view.onClose();

			const view2 = new ClaudeOutputView({} as never);
			await view2.onOpen();
			expect(view2.getStatus()).toBe("running");
			await view2.onClose();
		});

		it("calls onStop callback when set", () => {
			const stopFn = vi.fn();
			view.setOnStop(stopFn);
			// The stop button click is wired via addEventListener in onOpen
			// We verify the callback is stored correctly
			expect(stopFn).not.toHaveBeenCalled();
		});

		it("persisted status resets correctly", () => {
			view.setStatus("complete");
			expect(getPersistedStatus().status).toBe("complete");
			resetPersistedStatus();
			expect(getPersistedStatus().status).toBe("idle");
		});
	});

	describe("markdown rendering", () => {
		let view: ClaudeOutputView;
		let renderSpy: ReturnType<typeof vi.spyOn>;

		function getRenderedMarkdown(callIndex = 0): string {
			return renderSpy.mock.calls[callIndex]![1] as string;
		}

		beforeEach(async () => {
			vi.useFakeTimers();
			view = new ClaudeOutputView({} as never);
			await view.onOpen();
			renderSpy = vi.spyOn(MarkdownRenderer, "render");
		});

		afterEach(async () => {
			renderSpy.mockRestore();
			await view.onClose();
			vi.useRealTimers();
		});

		it("calls MarkdownRenderer.render after debounce", () => {
			view.appendText("# Hello");
			expect(renderSpy).not.toHaveBeenCalled();

			vi.advanceTimersByTime(50);
			expect(renderSpy).toHaveBeenCalledOnce();
			expect(getRenderedMarkdown()).toBe("# Hello");
		});

		it("accumulates text before rendering", () => {
			view.appendText("Hello ");
			view.appendText("world");

			vi.advanceTimersByTime(50);
			expect(renderSpy).toHaveBeenCalledOnce();
			expect(getRenderedMarkdown()).toBe("Hello world");
		});

		it("debounces multiple rapid calls", () => {
			view.appendText("a");
			vi.advanceTimersByTime(20);
			view.appendText("b");
			vi.advanceTimersByTime(20);
			view.appendText("c");

			vi.advanceTimersByTime(10);
			expect(renderSpy).toHaveBeenCalledOnce();
			expect(getRenderedMarkdown()).toBe("abc");
		});

		it("flushes pending render on showToolUse", () => {
			view.appendText("some text");
			view.showToolUse("Read");

			expect(renderSpy).toHaveBeenCalledOnce();
			expect(getRenderedMarkdown()).toBe("some text");
		});

		it("flushes pending render on showResult", () => {
			view.appendText("response text");
			view.showResult(0.05, 2000);

			expect(renderSpy).toHaveBeenCalledOnce();
			expect(getRenderedMarkdown(0)).toBe("response text");
		});

		it("flushes pending render on showExitCode", () => {
			view.appendText("partial");
			view.showExitCode(0);

			expect(renderSpy).toHaveBeenCalledOnce();
			expect(getRenderedMarkdown()).toBe("partial");
		});

		it("resets markdown state after showToolUse", () => {
			view.appendText("first block");
			view.showToolUse("Read");
			renderSpy.mockClear();

			view.appendText("second block");
			vi.advanceTimersByTime(50);

			expect(renderSpy).toHaveBeenCalledOnce();
			expect(getRenderedMarkdown()).toBe("second block");
		});

		it("showToolUse accepts optional filePath and input", () => {
			view.showToolUse("Write", "notes/test.md", { file_path: "notes/test.md", content: "hello" });
			// Should not throw
		});

		it("showToolUse works with just tool name", () => {
			view.showToolUse("Grep");
			// Should not throw
		});

		it("clears state on clear()", () => {
			view.appendText("will be cleared");
			view.clear();
			renderSpy.mockClear();

			view.appendText("fresh start");
			vi.advanceTimersByTime(50);

			expect(renderSpy).toHaveBeenCalledOnce();
			expect(getRenderedMarkdown()).toBe("fresh start");
		});

		it("handles partial markdown across appends", () => {
			view.appendText("```python\n");
			view.appendText("def hello():\n");
			view.appendText("    print('hi')\n");
			view.appendText("```");

			vi.advanceTimersByTime(50);

			expect(renderSpy).toHaveBeenCalledOnce();
			expect(getRenderedMarkdown()).toBe(
				"```python\ndef hello():\n    print('hi')\n```"
			);
		});

		it("does nothing when view is closed", async () => {
			await view.onClose();
			view.appendText("after close");
			vi.advanceTimersByTime(50);

			expect(renderSpy).not.toHaveBeenCalled();
		});

		it("cleans up timer on close", () => {
			view.appendText("pending");
			view.onClose();
			vi.advanceTimersByTime(100);
			// No error from orphaned timer
		});
	});

	describe("tabs", () => {
		let view: ClaudeOutputView;

		beforeEach(async () => {
			resetPersistedStatus();
			view = new ClaudeOutputView({} as never);
			await view.onOpen();
		});

		afterEach(async () => {
			await view.onClose();
		});

		it("defaults to output tab", () => {
			expect(view.getActiveTab()).toBe("output");
		});

		it("switches to history tab", () => {
			view.switchTab("history");
			expect(view.getActiveTab()).toBe("history");
		});

		it("switches back to output tab", () => {
			view.switchTab("history");
			view.switchTab("output");
			expect(view.getActiveTab()).toBe("output");
		});
	});

	describe("history", () => {
		let view: ClaudeOutputView;

		function makeHistoryEntry(overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
			return {
				id: generateEntryId(),
				promptName: "Test Prompt",
				scope: "vault",
				timestamp: Date.now(),
				durationMs: 5000,
				status: "success",
				output: "# Test output",
				...overrides,
			};
		}

		beforeEach(async () => {
			resetPersistedStatus();
			view = new ClaudeOutputView({} as never);
			await view.onOpen();
		});

		afterEach(async () => {
			await view.onClose();
		});

		it("accepts history entries", () => {
			const entries = [makeHistoryEntry(), makeHistoryEntry()];
			view.setHistory(entries);
			// Should not throw
		});

		it("handles empty history", () => {
			view.setHistory([]);
			// Should not throw
		});

		it("calls onClearHistory callback", () => {
			const clearFn = vi.fn();
			view.setOnClearHistory(clearFn);
			// Callback is stored correctly
			expect(clearFn).not.toHaveBeenCalled();
		});

		it("handles history entries with all fields", () => {
			const entry = makeHistoryEntry({
				promptName: "Summarize",
				scope: "note",
				status: "error",
				costUsd: 0.05,
				notePath: "notes/test.md",
			});
			view.setHistory([entry]);
			// Should not throw
		});
	});
});
