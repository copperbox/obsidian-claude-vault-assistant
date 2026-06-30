/**
 * An inline "Claude is working" indicator shown at the bottom of the chat
 * transcript and the one-off output pane while a turn is in flight. The label
 * gently pulses (opacity, via CSS) and a live meta line shows elapsed time and a
 * running token count, mirroring how the CLI reports progress.
 */

import { formatTokens } from "./format";

const TICK_MS = 1000;
const DEFAULT_LABEL = "Claude is working...";

/**
 * Clock + timer hooks. Injectable so tests can drive ticks deterministically;
 * defaults to wall-clock time and the window interval timers.
 */
export interface WorkingIndicatorClock {
	now: () => number;
	setInterval: (callback: () => void, ms: number) => number;
	clearInterval: (id: number) => void;
}

export interface WorkingIndicatorOptions {
	/** Defaults to "Claude is working". */
	label?: string;
	/** Injectable for tests; defaults to wall-clock + window timers. */
	clock?: Partial<WorkingIndicatorClock>;
}

/** Format the elapsed time as "12s" under a minute, else "1m 05s". */
export function formatElapsed(elapsedMs: number): string {
	const totalSec = Math.max(0, Math.floor(elapsedMs / 1000));
	if (totalSec < 60) return `${totalSec}s`;
	const min = Math.floor(totalSec / 60);
	const sec = totalSec % 60;
	return `${min}m ${sec.toString().padStart(2, "0")}s`;
}

/**
 * Build the live meta line beside the working dots, e.g. "12s" or
 * "1m 05s - 1,234 tokens". The token count is omitted until at least one
 * output token has been counted, so the line stays clean at the very start.
 */
export function formatWorkingMeta(elapsedMs: number, tokens: number): string {
	const elapsed = formatElapsed(elapsedMs);
	if (tokens > 0) {
		return `${elapsed} - ${formatTokens(tokens)} tokens`;
	}
	return elapsed;
}

function resolveClock(
	partial?: Partial<WorkingIndicatorClock>
): WorkingIndicatorClock {
	return {
		now: partial?.now ?? (() => Date.now()),
		setInterval:
			partial?.setInterval ?? ((cb, ms) => window.setInterval(cb, ms)),
		clearInterval: partial?.clearInterval ?? ((id) => window.clearInterval(id)),
	};
}

/**
 * Owns a single working-indicator element appended to a container. The caller
 * is responsible for `stop()`ing it when the turn ends (which clears the timer
 * and removes the element). Construct a new one per turn.
 */
export class WorkingIndicator {
	private readonly container: HTMLElement;
	private readonly clock: WorkingIndicatorClock;
	private readonly root: HTMLElement;
	private readonly metaEl: HTMLElement;
	private readonly startedAt: number;
	private tokens = 0;
	private timer: number | null = null;
	private meta = "";

	constructor(container: HTMLElement, options: WorkingIndicatorOptions = {}) {
		this.container = container;
		this.clock = resolveClock(options.clock);
		this.startedAt = this.clock.now();

		this.root = container.createDiv({ cls: "claude-working" });
		// The label itself pulses (opacity) via CSS to signal active work.
		this.root.createSpan({
			cls: "claude-working-label",
			text: options.label ?? DEFAULT_LABEL,
		});
		this.metaEl = this.root.createSpan({ cls: "claude-working-meta" });

		this.render();
		this.timer = this.clock.setInterval(() => this.render(), TICK_MS);
	}

	/** Update the live token total and re-render the meta line immediately. */
	setTokens(tokens: number): void {
		this.tokens = tokens;
		this.render();
	}

	/**
	 * Move the indicator back to the end of its container so it stays the last
	 * element after new transcript content is appended above it.
	 */
	bump(): void {
		if (this.container.lastChild !== this.root) {
			this.container.appendChild(this.root);
		}
	}

	/** Stop the timer and remove the element from the DOM. Idempotent. */
	stop(): void {
		if (this.timer !== null) {
			this.clock.clearInterval(this.timer);
			this.timer = null;
		}
		this.root.remove();
	}

	/** The last rendered meta string. Exposed for tests. */
	peekMeta(): string {
		return this.meta;
	}

	private render(): void {
		this.meta = formatWorkingMeta(this.clock.now() - this.startedAt, this.tokens);
		this.metaEl.setText(this.meta);
	}
}
