import { filterToolInput } from "./tool-render";
import type { PermissionDecision, PermissionRequest } from "./permission-types";

/** Handle to a rendered permission card, allowing it to be resolved in code. */
export interface PermissionCardHandle {
	el: HTMLElement;
	/**
	 * Resolve the card programmatically (e.g. to cancel a pending prompt on Stop
	 * or view close). Idempotent and a no-op once the user has already answered.
	 */
	cancel: (decision?: PermissionDecision) => void;
}

export interface RenderPermissionCardOptions {
	/**
	 * Noun for the "allow for the rest of this ..." scope. Defaults to "chat";
	 * the one-off output view passes "run".
	 */
	sessionScopeNoun?: string;
}

/**
 * Render an in-view tool permission card into `container` and resolve `onDecide`
 * when the user clicks a button (or when the returned handle is cancelled).
 * Shared by the chat view and the one-off output view.
 */
export function renderPermissionCard(
	container: HTMLElement,
	req: PermissionRequest,
	onDecide: (decision: PermissionDecision) => void,
	opts?: RenderPermissionCardOptions
): PermissionCardHandle {
	const noun = opts?.sessionScopeNoun ?? "chat";

	const card = container.createDiv({ cls: "claude-chat-permission" });
	card.createDiv({
		cls: "claude-chat-permission-title",
		text: req.title ?? `Allow Claude to use ${req.toolName}?`,
	});
	if (req.description) {
		card.createDiv({
			cls: "claude-chat-permission-desc",
			text: req.description,
		});
	}
	if (req.input && Object.keys(req.input).length > 0) {
		const body = card.createDiv({ cls: "claude-chat-permission-input" });
		body.createEl("pre", {
			text: JSON.stringify(filterToolInput(req.toolName, req.input), null, 2),
		});
	}

	const actions = card.createDiv({ cls: "claude-chat-permission-actions" });
	let answered = false;
	const choose = (decision: PermissionDecision) => {
		if (answered) return;
		answered = true;
		card.addClass(`claude-chat-permission-${decision}`);
		actions.empty();
		actions.createSpan({
			cls: "claude-chat-permission-resolved",
			text: decisionLabel(decision, noun),
		});
		onDecide(decision);
	};

	const once = actions.createEl("button", {
		text: "Allow once",
		cls: "claude-chat-permission-btn",
	});
	once.addEventListener("click", () => choose("once"));
	const session = actions.createEl("button", {
		text: `Allow for this ${noun}`,
		cls: "claude-chat-permission-btn",
	});
	session.addEventListener("click", () => choose("session"));
	const deny = actions.createEl("button", {
		text: "Deny",
		cls: "claude-chat-permission-btn claude-chat-permission-btn-deny",
	});
	deny.addEventListener("click", () => choose("deny"));

	return { el: card, cancel: (decision = "deny") => choose(decision) };
}

function decisionLabel(decision: PermissionDecision, noun: string): string {
	switch (decision) {
		case "once":
			return "Allowed once";
		case "session":
			return `Allowed for this ${noun}`;
		case "deny":
			return "Denied";
	}
}
