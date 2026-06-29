import { createRequire } from "module";

let patched = false;

/**
 * Work around a cross-realm incompatibility between the Claude Agent SDK and
 * Obsidian's Electron renderer.
 *
 * Obsidian plugins run in the renderer, where `AbortController` / `AbortSignal`
 * / `EventTarget` are the DOM (Blink) implementations. The SDK creates an
 * `AbortController` and immediately calls `events.setMaxListeners(n, signal)` on
 * its signal. Node's `setMaxListeners` does a strict `instanceof` against its
 * own internal `EventTarget`, which the DOM signal is not -- so it throws
 * "The 'eventTargets' argument must be an instance of EventEmitter or
 * EventTarget. Received an instance of AbortSignal".
 *
 * We wrap `setMaxListeners` so a target Node rejects is simply skipped. The only
 * consequence of skipping is a possible (benign) max-listeners warning, which
 * does not apply to DOM event targets anyway. Real Node emitters/targets still
 * go through the original implementation unchanged. Idempotent.
 */
export function patchElectronEventTarget(): void {
	if (patched) return;
	patched = true;
	try {
		const nodeRequire = createRequire(import.meta.url);
		const events = nodeRequire("events") as {
			setMaxListeners: (n: number, ...targets: unknown[]) => unknown;
		};
		const original = events.setMaxListeners;
		if (typeof original !== "function") return;

		events.setMaxListeners = (n: number, ...targets: unknown[]) => {
			if (targets.length === 0) return original(n);
			try {
				return original(n, ...targets);
			} catch {
				for (const target of targets) {
					try {
						original(n, target);
					} catch {
						// Target (e.g. a DOM AbortSignal) is not a Node event
						// target; skip it rather than crash the caller.
					}
				}
				return undefined;
			}
		};
	} catch {
		// `events` not resolvable (e.g. non-Electron test env); nothing to do.
	}
}
