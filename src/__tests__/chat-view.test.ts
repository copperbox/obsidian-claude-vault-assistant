import { describe, it, expect, vi, beforeEach } from "vitest";
import {
	ClaudeChatView,
	vaultLinkFromAnchor,
	buildModelOptions,
	noteDisplayName,
	type ChatViewDeps,
} from "../chat-view";
import { ActivityLock } from "../activity-lock";
import { DEFAULT_SETTINGS } from "../settings";
import { WorkspaceLeaf, MarkdownRenderer } from "obsidian";

function makeFakeSession() {
	return {
		start: vi.fn(async () => {}),
		send: vi.fn(),
		interrupt: vi.fn(async () => {}),
		dispose: vi.fn(async () => {}),
		setModel: vi.fn(async () => {}),
		isTurnActive: false,
		sessionAllowedTools: [],
	};
}

function makeView(overrides?: Partial<ChatViewDeps>) {
	const lock = new ActivityLock();
	const fakeSession = makeFakeSession();
	const deps: ChatViewDeps = {
		getSettings: () => ({ ...DEFAULT_SETTINGS }),
		getVaultPath: () => "/vault",
		lock,
		createSession: vi.fn(() => fakeSession as never),
		...overrides,
	};
	const view = new ClaudeChatView(new WorkspaceLeaf() as never);
	view.setDeps(deps);
	void view.onOpen();
	return { view, deps, lock, fakeSession };
}

describe("vaultLinkFromAnchor", () => {
	it("uses the wiki-link target from data-href", () => {
		expect(
			vaultLinkFromAnchor({
				internal: true,
				dataHref: "My Note",
				href: "app://obsidian.md/My%20Note",
			})
		).toBe("My Note");
	});

	it("decodes an app:// markdown-link href", () => {
		expect(
			vaultLinkFromAnchor({
				internal: false,
				dataHref: null,
				href: "app://obsidian.md/Daily%20Notes/2026-06-28",
			})
		).toBe("Daily Notes/2026-06-28");
	});

	it("strips query and hash from an app:// href", () => {
		expect(
			vaultLinkFromAnchor({
				internal: false,
				dataHref: null,
				href: "app://obsidian.md/note.md?1700000000#heading",
			})
		).toBe("note.md");
	});

	it("falls back to href for an internal link without data-href", () => {
		expect(
			vaultLinkFromAnchor({ internal: true, dataHref: null, href: "Note" })
		).toBe("Note");
	});

	it("returns null for external links", () => {
		expect(
			vaultLinkFromAnchor({
				internal: false,
				dataHref: null,
				href: "https://example.com",
			})
		).toBeNull();
	});

	it("returns null when there is nothing to resolve", () => {
		expect(
			vaultLinkFromAnchor({ internal: false, dataHref: null, href: null })
		).toBeNull();
	});
});

describe("buildModelOptions", () => {
	it("offers Default plus the common aliases", () => {
		expect(buildModelOptions("").map((o) => o.value)).toEqual([
			"",
			"opus",
			"sonnet",
			"haiku",
		]);
	});

	it("appends a custom override value not in the base list", () => {
		const values = buildModelOptions("claude-opus-4-8").map((o) => o.value);
		expect(values).toContain("claude-opus-4-8");
		expect(values).toHaveLength(5);
	});

	it("does not duplicate an override that matches an alias", () => {
		expect(buildModelOptions("opus")).toHaveLength(4);
	});
});

describe("noteDisplayName", () => {
	it("strips folders and the .md extension", () => {
		expect(noteDisplayName("Daily/2026-06-30.md")).toBe("2026-06-30");
	});

	it("returns a bare name unchanged", () => {
		expect(noteDisplayName("note")).toBe("note");
	});
});

describe("ClaudeChatView", () => {
	beforeEach(() => vi.clearAllMocks());

	it("exposes view metadata", () => {
		const view = new ClaudeChatView(new WorkspaceLeaf() as never);
		expect(view.getViewType()).toBe("claude-vault-chat");
		expect(view.getDisplayText()).toBe("Claude chat");
		expect(view.getIcon()).toBeTruthy();
	});

	it("onOpen then onClose does not throw", async () => {
		const { view } = makeView();
		await expect(view.onClose()).resolves.toBeUndefined();
	});

	it("sends a turn: acquires the lock and drives the session", async () => {
		const { view, lock, fakeSession, deps } = makeView();
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "hello";

		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		expect(deps.createSession).toHaveBeenCalledOnce();
		expect(fakeSession.start).toHaveBeenCalledOnce();
		expect(fakeSession.send).toHaveBeenCalledWith("hello");
		// Lock stays held until the turn ends.
		expect(lock.isBusy).toBe(true);
	});

	it("prepends the active note as context when it is included", async () => {
		const { view, fakeSession } = makeView({
			getActiveNotePath: () => "Daily/2026-06-30.md",
		});
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "hello";

		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		expect(fakeSession.send).toHaveBeenCalledOnce();
		const sent = (fakeSession.send as ReturnType<typeof vi.fn>).mock
			.calls[0]![0] as string;
		expect(sent).toContain("[[Daily/2026-06-30]]");
		expect(sent.endsWith("hello")).toBe(true);
	});

	it("renders the context caption through Markdown so its wiki link is clickable", async () => {
		const renderSpy = vi.spyOn(MarkdownRenderer, "render");
		const { view } = makeView({
			getActiveNotePath: () => "Daily/2026-06-30.md",
		});
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "hello";

		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		const captionRender = renderSpy.mock.calls.find((c) =>
			String(c[1]).startsWith("Context:")
		);
		expect(captionRender).toBeDefined();
		expect(String(captionRender![1])).toContain("[[Daily/2026-06-30]]");
	});

	it("sends only the user text when the active note is unchecked", async () => {
		const { view, fakeSession } = makeView({
			getActiveNotePath: () => "Daily/2026-06-30.md",
		});
		(view as unknown as { includeActiveNote: boolean }).includeActiveNote =
			false;
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "hello";

		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		expect(fakeSession.send).toHaveBeenCalledWith("hello");
	});

	it("starts the session with the selected model", async () => {
		const { view, deps } = makeView();
		(view as unknown as { modelSelect: { value: string } }).modelSelect.value =
			"opus";
		(view as unknown as { handleModelChange: () => void }).handleModelChange();
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "hi";

		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		const firstCall = (deps.createSession as ReturnType<typeof vi.fn>).mock
			.calls[0];
		const config = firstCall![0] as { settings: { modelOverride: string } };
		expect(config.settings.modelOverride).toBe("opus");
	});

	it("applies a model change live to a running session", async () => {
		const { view, fakeSession } = makeView();
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "hi";
		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		(view as unknown as { modelSelect: { value: string } }).modelSelect.value =
			"sonnet";
		(view as unknown as { handleModelChange: () => void }).handleModelChange();

		expect(fakeSession.setModel).toHaveBeenCalledWith("sonnet");
	});

	it("does not send when another activity holds the lock", async () => {
		const { view, lock, deps } = makeView();
		lock.tryAcquire("vault prompt");
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "hello";

		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		expect(deps.createSession).not.toHaveBeenCalled();
		expect(lock.label).toBe("vault prompt");
	});

	it("ignores empty input", async () => {
		const { view, deps } = makeView();
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "   ";

		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		expect(deps.createSession).not.toHaveBeenCalled();
	});

	it("releases the lock and disposes the session on close", async () => {
		const { view, lock, fakeSession } = makeView();
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "hello";
		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();
		expect(lock.isBusy).toBe(true);

		await view.onClose();

		expect(fakeSession.dispose).toHaveBeenCalled();
		expect(lock.isBusy).toBe(false);
	});
});
