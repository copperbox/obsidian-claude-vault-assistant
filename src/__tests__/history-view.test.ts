import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ClaudeHistoryView, VIEW_TYPE_CLAUDE_HISTORY } from "../history-view";
import { type RunHistoryEntry, generateEntryId } from "../run-history";

function makeEntry(overrides: Partial<RunHistoryEntry> = {}): RunHistoryEntry {
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

describe("ClaudeHistoryView", () => {
	it("keeps the legacy output view type so saved layouts still resolve", () => {
		expect(VIEW_TYPE_CLAUDE_HISTORY).toBe("claude-vault-output");
	});

	it("exposes view metadata", () => {
		const view = new ClaudeHistoryView({} as never);
		expect(view.getViewType()).toBe("claude-vault-output");
		expect(view.getDisplayText()).toBe("Claude history");
		expect(view.getIcon()).toBe("history");
	});

	describe("with an open view", () => {
		let view: ClaudeHistoryView;

		beforeEach(async () => {
			view = new ClaudeHistoryView({} as never);
			await view.onOpen();
		});

		afterEach(async () => {
			await view.onClose();
		});

		it("accepts history entries", () => {
			view.setHistory([makeEntry(), makeEntry()]);
			// Should not throw
		});

		it("handles empty history", () => {
			view.setHistory([]);
			// Should not throw
		});

		it("stores the clear and resume callbacks without invoking them", () => {
			const clearFn = vi.fn();
			const resumeFn = vi.fn();
			view.setOnClearHistory(clearFn);
			view.setOnResume(resumeFn);
			view.setHistory([makeEntry({ sessionId: "sess-1" })]);
			expect(clearFn).not.toHaveBeenCalled();
			expect(resumeFn).not.toHaveBeenCalled();
		});

		it("opens a resumable entry directly in chat on click", () => {
			const resumeFn = vi.fn();
			view.setOnResume(resumeFn);
			const entry = makeEntry({ sessionId: "sess-1" });

			(view as unknown as {
				handleEntryClick: (e: RunHistoryEntry) => void;
			}).handleEntryClick(entry);

			expect(resumeFn).toHaveBeenCalledWith(entry);
		});

		it("falls back to the read-only replay for entries without a session id", () => {
			const resumeFn = vi.fn();
			view.setOnResume(resumeFn);

			(view as unknown as {
				handleEntryClick: (e: RunHistoryEntry) => void;
			}).handleEntryClick(makeEntry());

			expect(resumeFn).not.toHaveBeenCalled();
		});

		it("renders an entry detail with and without a resumable session", () => {
			view.setOnResume(vi.fn());
			const show = (
				view as unknown as { showEntry: (e: RunHistoryEntry) => void }
			).showEntry.bind(view);
			show(makeEntry({ sessionId: "sess-1", prompt: "stored prompt" }));
			show(makeEntry());
			view.showList();
			// Should not throw in either shape
		});

		it("handles entries with all optional fields", () => {
			view.setHistory([
				makeEntry({
					promptName: "Summarize",
					scope: "note",
					status: "error",
					costUsd: 0.05,
					tokens: 12345,
					notePath: "notes/test.md",
					sessionId: "sess-2",
				}),
			]);
			// Should not throw
		});
	});
});
