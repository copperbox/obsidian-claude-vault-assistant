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
		setPermissionMode: vi.fn(async () => {}),
		getContextUsage: vi.fn(async () => ({
			usedTokens: 60_000,
			maxTokens: 200_000,
		})),
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

	it("starts the session with the settings' effort and permission mode", async () => {
		const { view, deps } = makeView({
			getSettings: () => ({
				...DEFAULT_SETTINGS,
				effort: "xhigh" as const,
				permissionMode: "acceptEdits" as const,
			}),
		});
		// Rebuild header controls now that deps carry non-default settings.
		await view.onOpen();
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "hi";

		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		const config = (deps.createSession as ReturnType<typeof vi.fn>).mock
			.calls[0]![0] as { settings: { effort: string; permissionMode: string } };
		expect(config.settings.effort).toBe("xhigh");
		expect(config.settings.permissionMode).toBe("acceptEdits");
	});

	it("applies a permission mode change live to a running session", async () => {
		const { view, fakeSession } = makeView();
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "hi";
		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		(view as unknown as { permissionSelect: { value: string } }).permissionSelect.value =
			"plan";
		(view as unknown as { handlePermissionChange: () => void }).handlePermissionChange();

		expect(fakeSession.setPermissionMode).toHaveBeenCalledWith("plan");
	});

	it("defers an effort change to the next session", async () => {
		const { view, fakeSession } = makeView();
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "hi";
		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		(view as unknown as { effortSelect: { value: string } }).effortSelect.value =
			"low";
		(view as unknown as { handleEffortChange: () => void }).handleEffortChange();

		// No live SDK switch exists for effort; only the selection changes.
		expect(fakeSession.setModel).not.toHaveBeenCalled();
		expect(
			(view as unknown as { selectedEffort: string }).selectedEffort
		).toBe("low");
	});

	it("records a history entry with session id after a turn", async () => {
		const saveHistoryEntry = vi.fn();
		const { view, deps } = makeView({ saveHistoryEntry });
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "hello world";
		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		const config = (deps.createSession as ReturnType<typeof vi.fn>).mock
			.calls[0]![0] as {
			callbacks: {
				onSystemInit: (i: { sessionId?: string }) => void;
				onAssistantText: (t: string) => void;
				onResult: (r: Record<string, unknown>) => void;
				onTurnEnd: () => void;
			};
		};
		config.callbacks.onSystemInit({ sessionId: "sess-1" });
		config.callbacks.onAssistantText("Sure thing.");
		config.callbacks.onResult({
			costUsd: 0.02,
			tokens: 100,
			durationMs: 1500,
			isError: false,
			subtype: "success",
		});
		config.callbacks.onTurnEnd();

		expect(saveHistoryEntry).toHaveBeenCalledOnce();
		const entry = saveHistoryEntry.mock.calls[0]![0] as Record<string, unknown>;
		expect(entry.promptName).toBe("hello world");
		expect(entry.sessionId).toBe("sess-1");
		expect(entry.costUsd).toBe(0.02);
		expect(entry.tokens).toBe(100);
		expect(entry.status).toBe("success");
		expect(String(entry.output)).toContain("Sure thing.");
	});

	it("accumulates cost and tokens across turns into the same entry", async () => {
		const saveHistoryEntry = vi.fn();
		const { view, deps } = makeView({ saveHistoryEntry });
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "hello";
		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		const config = (deps.createSession as ReturnType<typeof vi.fn>).mock
			.calls[0]![0] as {
			callbacks: {
				onResult: (r: Record<string, unknown>) => void;
				onTurnEnd: () => void;
			};
		};
		config.callbacks.onResult({ costUsd: 0.01, tokens: 50, isError: false, subtype: "success" });
		config.callbacks.onTurnEnd();
		config.callbacks.onResult({ costUsd: 0.03, tokens: 70, isError: false, subtype: "success" });
		config.callbacks.onTurnEnd();

		expect(saveHistoryEntry).toHaveBeenCalledTimes(2);
		const first = saveHistoryEntry.mock.calls[0]![0] as { id: string; costUsd: number };
		const second = saveHistoryEntry.mock.calls[1]![0] as {
			id: string;
			costUsd: number;
			tokens: number;
		};
		expect(second.id).toBe(first.id);
		expect(second.costUsd).toBeCloseTo(0.04);
		expect(second.tokens).toBe(120);
	});

	it("syncs the context ring to the CLI's exact usage after a turn", async () => {
		const saveHistoryEntry = vi.fn();
		const { view, deps, fakeSession } = makeView({ saveHistoryEntry });
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "hi";
		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		const config = (deps.createSession as ReturnType<typeof vi.fn>).mock
			.calls[0]![0] as { callbacks: { onTurnEnd: () => void } };
		config.callbacks.onTurnEnd();
		await new Promise((r) => setTimeout(r, 0));

		expect(fakeSession.getContextUsage).toHaveBeenCalled();
		expect(
			(view as unknown as { contextMaxTokens: number }).contextMaxTokens
		).toBe(200_000);

		// The exact usage is upserted into the same history entry once known.
		const last = saveHistoryEntry.mock.calls.at(-1)![0] as Record<string, unknown>;
		expect(last.contextTokens).toBe(60_000);
		expect(last.contextWindow).toBe(200_000);
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

describe("ClaudeChatView.startPromptChat", () => {
	beforeEach(() => vi.clearAllMocks());

	function makeLaunch() {
		return {
			promptName: "Daily",
			message: "Summarize my day.",
			settings: {
				...DEFAULT_SETTINGS,
				modelOverride: "opus",
				effort: "low" as const,
				permissionMode: "acceptEdits" as const,
				allowedTools: ["Read"],
			},
			extraSystemPrompt: "Vault house rules.",
		};
	}

	it("starts a session with the merged settings and auto-submits the prompt", async () => {
		const { view, deps, fakeSession, lock } = makeView();

		await view.startPromptChat(makeLaunch());

		const config = (deps.createSession as ReturnType<typeof vi.fn>).mock
			.calls[0]![0] as {
			settings: Record<string, unknown>;
			extraSystemPrompt?: string;
		};
		expect(config.settings.modelOverride).toBe("opus");
		expect(config.settings.effort).toBe("low");
		expect(config.settings.permissionMode).toBe("acceptEdits");
		expect(config.settings.allowedTools).toEqual(["Read"]);
		expect(config.extraSystemPrompt).toBe("Vault house rules.");
		expect(fakeSession.start).toHaveBeenCalledOnce();
		expect(fakeSession.send).toHaveBeenCalledWith("Summarize my day.");
		expect(lock.isBusy).toBe(true);
	});

	it("syncs the header dropdown selections to the launch settings", async () => {
		const { view } = makeView();

		await view.startPromptChat(makeLaunch());

		const v = view as unknown as {
			selectedModel: string;
			selectedEffort: string;
			selectedPermissionMode: string;
		};
		expect(v.selectedModel).toBe("opus");
		expect(v.selectedEffort).toBe("low");
		expect(v.selectedPermissionMode).toBe("acceptEdits");
	});

	it("does not start when another activity holds the lock", async () => {
		const { view, deps, lock } = makeView();
		lock.tryAcquire("something else");

		await view.startPromptChat(makeLaunch());

		expect(deps.createSession).not.toHaveBeenCalled();
	});

	it("uses the prompt name for the history entry", async () => {
		const saveHistoryEntry = vi.fn();
		const { view, deps } = makeView({ saveHistoryEntry });

		await view.startPromptChat(makeLaunch());
		const config = (deps.createSession as ReturnType<typeof vi.fn>).mock
			.calls[0]![0] as {
			callbacks: { onResult: (r: Record<string, unknown>) => void; onTurnEnd: () => void };
		};
		config.callbacks.onResult({ isError: false, subtype: "success" });
		config.callbacks.onTurnEnd();

		const entry = saveHistoryEntry.mock.calls[0]![0] as { promptName: string };
		expect(entry.promptName).toBe("Daily");
	});

	it("notifies once when the auto-submitted first turn settles", async () => {
		const notifyRunComplete = vi.fn();
		const { view, deps } = makeView({ notifyRunComplete });

		await view.startPromptChat(makeLaunch());
		const config = (deps.createSession as ReturnType<typeof vi.fn>).mock
			.calls[0]![0] as {
			callbacks: { onResult: (r: Record<string, unknown>) => void; onTurnEnd: () => void };
		};
		config.callbacks.onResult({ isError: false, subtype: "success" });
		config.callbacks.onTurnEnd();
		config.callbacks.onResult({ isError: false, subtype: "success" });
		config.callbacks.onTurnEnd();

		expect(notifyRunComplete).toHaveBeenCalledTimes(1);
		expect(notifyRunComplete.mock.calls[0]![0]).toBe("Daily");
		expect(notifyRunComplete.mock.calls[0]![1]).toBe("complete");
	});
});

describe("ClaudeChatView.resumeFromHistory", () => {
	beforeEach(() => vi.clearAllMocks());

	function makeEntry(overrides: Record<string, unknown> = {}) {
		return {
			id: "entry-1",
			promptName: "Old chat",
			timestamp: 1700000000000,
			durationMs: 4000,
			status: "success" as const,
			costUsd: 0.05,
			tokens: 500,
			output: "Prior answer.",
			sessionId: "sess-old",
			...overrides,
		};
	}

	it("resumes the stored session id on the next send", async () => {
		const { view, deps, fakeSession } = makeView();

		await view.resumeFromHistory(makeEntry());
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "continue";
		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		const config = (deps.createSession as ReturnType<typeof vi.fn>).mock
			.calls[0]![0] as { resumeSessionId?: string };
		expect(config.resumeSessionId).toBe("sess-old");
		expect(fakeSession.send).toHaveBeenCalledWith("continue");
	});

	it("keeps updating the original history entry", async () => {
		const saveHistoryEntry = vi.fn();
		const { view, deps } = makeView({ saveHistoryEntry });

		await view.resumeFromHistory(makeEntry());
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "continue";
		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		const config = (deps.createSession as ReturnType<typeof vi.fn>).mock
			.calls[0]![0] as {
			callbacks: { onResult: (r: Record<string, unknown>) => void; onTurnEnd: () => void };
		};
		config.callbacks.onResult({
			costUsd: 0.01,
			tokens: 100,
			isError: false,
			subtype: "success",
		});
		config.callbacks.onTurnEnd();

		const entry = saveHistoryEntry.mock.calls[0]![0] as Record<string, unknown>;
		expect(entry.id).toBe("entry-1");
		expect(entry.promptName).toBe("Old chat");
		expect(entry.costUsd).toBeCloseTo(0.06);
		expect(entry.tokens).toBe(600);
		expect(entry.sessionId).toBe("sess-old");
		expect(String(entry.output)).toContain("Prior answer.");
	});

	it("restores the context gauge from the resumed entry", async () => {
		const { view } = makeView();

		await view.resumeFromHistory(
			makeEntry({ contextTokens: 120_000, contextWindow: 200_000 })
		);

		const v = view as unknown as {
			contextUsedTokens: number;
			contextMaxTokens: number;
		};
		expect(v.contextUsedTokens).toBe(120_000);
		expect(v.contextMaxTokens).toBe(200_000);
	});

	it("refuses to resume an entry without a session id", async () => {
		const { view, deps } = makeView();

		await view.resumeFromHistory(makeEntry({ sessionId: undefined }));
		(view as unknown as { inputEl: { value: string } }).inputEl.value = "hi";
		await (view as unknown as { handleSend: () => Promise<void> }).handleSend();

		const config = (deps.createSession as ReturnType<typeof vi.fn>).mock
			.calls[0]![0] as { resumeSessionId?: string };
		expect(config.resumeSessionId).toBeUndefined();
	});
});
