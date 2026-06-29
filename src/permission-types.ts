/**
 * DOM-free permission contract shared by the SDK driver (chat-session), the
 * permission card UI (permission-card), and the views that host it. Kept in its
 * own module so none of those consumers import each other just for these types.
 */

/** What the user chose in the in-view permission prompt. */
export type PermissionDecision = "once" | "session" | "deny";

export interface PermissionRequest {
	toolName: string;
	input: Record<string, unknown>;
	toolUseId: string;
	title?: string;
	description?: string;
}

export type RequestPermission = (
	req: PermissionRequest
) => Promise<PermissionDecision>;
