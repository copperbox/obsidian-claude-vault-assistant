import { describe, it, expect, vi, beforeEach } from "vitest";
import { VaultRefresher } from "../vault-refresher";

function createMockApp() {
	const mockFile = { path: "notes/test.md" };
	const adapter = {
		exists: vi.fn().mockResolvedValue(true),
		read: vi.fn().mockResolvedValue("updated content"),
	};
	const vault = {
		adapter,
		getAbstractFileByPath: vi.fn().mockReturnValue(mockFile),
		modify: vi.fn().mockResolvedValue(undefined),
		trigger: vi.fn(),
	};
	return { app: { vault } as unknown as Parameters<VaultRefresher["refreshModifiedFiles"]>[0], vault, adapter, mockFile };
}

describe("VaultRefresher", () => {
	let refresher: VaultRefresher;

	beforeEach(() => {
		refresher = new VaultRefresher();
	});

	describe("trackToolUse", () => {
		it("tracks Write tool file paths", () => {
			refresher.trackToolUse("Write", "notes/new.md");
			expect(refresher.getModifiedPaths()).toContain("notes/new.md");
		});

		it("tracks Edit tool file paths", () => {
			refresher.trackToolUse("Edit", "src/main.ts");
			expect(refresher.getModifiedPaths()).toContain("src/main.ts");
		});

		it("does not track Read tool", () => {
			refresher.trackToolUse("Read", "some/file.md");
			expect(refresher.getModifiedPaths().size).toBe(0);
		});

		it("does not track Grep tool", () => {
			refresher.trackToolUse("Grep", "/pattern/");
			expect(refresher.getModifiedPaths().size).toBe(0);
		});

		it("does not track Glob tool", () => {
			refresher.trackToolUse("Glob");
			expect(refresher.getModifiedPaths().size).toBe(0);
		});

		it("ignores tool_use without filePath", () => {
			refresher.trackToolUse("Write");
			expect(refresher.getModifiedPaths().size).toBe(0);
		});

		it("deduplicates paths", () => {
			refresher.trackToolUse("Edit", "notes/test.md");
			refresher.trackToolUse("Write", "notes/test.md");
			expect(refresher.getModifiedPaths().size).toBe(1);
		});
	});

	describe("clear", () => {
		it("clears all tracked paths", () => {
			refresher.trackToolUse("Write", "a.md");
			refresher.trackToolUse("Edit", "b.md");
			refresher.clear();
			expect(refresher.getModifiedPaths().size).toBe(0);
		});
	});

	describe("refreshModifiedFiles", () => {
		it("reads and modifies existing files in vault", async () => {
			const { app, vault, adapter } = createMockApp();
			refresher.trackToolUse("Write", "notes/test.md");

			await refresher.refreshModifiedFiles(app);

			expect(adapter.exists).toHaveBeenCalledWith("notes/test.md");
			expect(adapter.read).toHaveBeenCalledWith("notes/test.md");
			expect(vault.getAbstractFileByPath).toHaveBeenCalledWith("notes/test.md");
			expect(vault.modify).toHaveBeenCalledWith(
				{ path: "notes/test.md" },
				"updated content"
			);
		});

		it("triggers create for new files not in vault cache", async () => {
			const { app, vault, adapter } = createMockApp();
			vault.getAbstractFileByPath.mockReturnValue(null);
			refresher.trackToolUse("Write", "notes/brand-new.md");

			await refresher.refreshModifiedFiles(app);

			expect(vault.trigger).toHaveBeenCalledWith("create", { path: "notes/brand-new.md" });
			expect(vault.modify).not.toHaveBeenCalled();
		});

		it("triggers delete for files that no longer exist on disk", async () => {
			const { app, vault, adapter } = createMockApp();
			adapter.exists.mockResolvedValue(false);
			const deletedFile = { path: "notes/deleted.md" };
			vault.getAbstractFileByPath.mockReturnValue(deletedFile);
			refresher.trackToolUse("Edit", "notes/deleted.md");

			await refresher.refreshModifiedFiles(app);

			expect(vault.trigger).toHaveBeenCalledWith("delete", deletedFile);
			expect(adapter.read).not.toHaveBeenCalled();
		});

		it("handles deleted file not in vault cache gracefully", async () => {
			const { app, vault, adapter } = createMockApp();
			adapter.exists.mockResolvedValue(false);
			vault.getAbstractFileByPath.mockReturnValue(null);
			refresher.trackToolUse("Edit", "notes/gone.md");

			await refresher.refreshModifiedFiles(app);

			expect(vault.trigger).not.toHaveBeenCalled();
			expect(vault.modify).not.toHaveBeenCalled();
		});

		it("does nothing when no files were modified", async () => {
			const { app, vault, adapter } = createMockApp();

			await refresher.refreshModifiedFiles(app);

			expect(adapter.exists).not.toHaveBeenCalled();
			expect(vault.modify).not.toHaveBeenCalled();
		});

		it("refreshes multiple files", async () => {
			const { app, vault, adapter } = createMockApp();
			refresher.trackToolUse("Write", "a.md");
			refresher.trackToolUse("Edit", "b.md");

			await refresher.refreshModifiedFiles(app);

			expect(adapter.exists).toHaveBeenCalledTimes(2);
		});

		it("continues refreshing even if one file fails", async () => {
			const { app, vault, adapter } = createMockApp();
			adapter.exists
				.mockResolvedValueOnce(true)
				.mockRejectedValueOnce(new Error("disk error"));
			adapter.read.mockResolvedValue("content");
			refresher.trackToolUse("Write", "good.md");
			refresher.trackToolUse("Write", "bad.md");

			// Should not throw thanks to Promise.allSettled
			await refresher.refreshModifiedFiles(app);

			expect(adapter.exists).toHaveBeenCalledTimes(2);
		});
	});
});
