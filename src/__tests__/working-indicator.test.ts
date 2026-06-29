import { describe, it, expect, vi } from "vitest";
import {
	WorkingIndicator,
	formatElapsed,
	formatWorkingMeta,
} from "../working-indicator";

/** Minimal fake of an Obsidian element supporting the helpers we use. */
function makeFakeEl(): Record<string, unknown> {
	const children: unknown[] = [];
	const el: Record<string, unknown> = {
		children,
		text: "",
		lastChild: null,
		createDiv: () => appendChild(makeFakeEl()),
		createSpan: () => appendChild(makeFakeEl()),
		setText: (t: string) => {
			el.text = t;
		},
		appendChild: (child: unknown) => appendChild(child),
		remove: vi.fn(),
	};
	function appendChild(child: unknown): unknown {
		const i = children.indexOf(child);
		if (i >= 0) children.splice(i, 1);
		children.push(child);
		el.lastChild = child;
		return child;
	}
	return el;
}

/** Controllable clock: manual `now`, captured interval callbacks. */
function makeFakeClock() {
	let nowMs = 0;
	const callbacks: Array<(() => void) | null> = [];
	return {
		clock: {
			now: () => nowMs,
			setInterval: (cb: () => void) => {
				callbacks.push(cb);
				return callbacks.length; // 1-based id
			},
			clearInterval: (id: number) => {
				callbacks[id - 1] = null;
			},
		},
		advance: (ms: number) => {
			nowMs += ms;
		},
		tick: () => callbacks.forEach((cb) => cb?.()),
		activeCount: () => callbacks.filter(Boolean).length,
	};
}

describe("formatElapsed", () => {
	it("shows seconds under a minute", () => {
		expect(formatElapsed(0)).toBe("0s");
		expect(formatElapsed(5400)).toBe("5s");
		expect(formatElapsed(59_000)).toBe("59s");
	});

	it("shows minutes and zero-padded seconds at/over a minute", () => {
		expect(formatElapsed(60_000)).toBe("1m 00s");
		expect(formatElapsed(65_000)).toBe("1m 05s");
		expect(formatElapsed(125_000)).toBe("2m 05s");
	});

	it("never goes negative", () => {
		expect(formatElapsed(-100)).toBe("0s");
	});
});

describe("formatWorkingMeta", () => {
	it("omits tokens until at least one is counted", () => {
		expect(formatWorkingMeta(12_000, 0)).toBe("12s");
	});

	it("appends a thousands-separated token count when present", () => {
		expect(formatWorkingMeta(12_000, 1234)).toBe("12s - 1,234 tokens");
	});
});

describe("WorkingIndicator", () => {
	it("renders elapsed time on construction and on tick", () => {
		const container = makeFakeEl();
		const { clock, advance, tick } = makeFakeClock();
		const indicator = new WorkingIndicator(container as never, { clock });

		expect(indicator.peekMeta()).toBe("0s");

		advance(7000);
		tick();
		expect(indicator.peekMeta()).toBe("7s");
	});

	it("reflects token updates immediately", () => {
		const container = makeFakeEl();
		const { clock, advance } = makeFakeClock();
		const indicator = new WorkingIndicator(container as never, { clock });

		advance(3000);
		indicator.setTokens(2048);
		expect(indicator.peekMeta()).toBe("3s - 2,048 tokens");
	});

	it("bump re-appends itself as the last child", () => {
		const container = makeFakeEl();
		const { clock } = makeFakeClock();
		const indicator = new WorkingIndicator(container as never, { clock });
		const root = (container as { lastChild: unknown }).lastChild;

		// Simulate new content appended after the indicator.
		(container as { createDiv: () => unknown }).createDiv();
		expect((container as { lastChild: unknown }).lastChild).not.toBe(root);

		indicator.bump();
		expect((container as { lastChild: unknown }).lastChild).toBe(root);
	});

	it("stop clears the timer and removes the element", () => {
		const container = makeFakeEl();
		const { clock, advance, tick, activeCount } = makeFakeClock();
		const indicator = new WorkingIndicator(container as never, { clock });
		const root = (container as { lastChild: Record<string, unknown> }).lastChild;

		indicator.stop();
		expect(activeCount()).toBe(0);
		expect(root.remove).toHaveBeenCalledOnce();

		// Further ticks must not update after stop.
		advance(5000);
		tick();
		expect(indicator.peekMeta()).toBe("0s");
	});

	it("stop is idempotent", () => {
		const container = makeFakeEl();
		const { clock } = makeFakeClock();
		const indicator = new WorkingIndicator(container as never, { clock });
		indicator.stop();
		expect(() => indicator.stop()).not.toThrow();
	});
});
