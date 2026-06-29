import { describe, it, expect, afterAll } from "vitest";
import { EventEmitter, setMaxListeners as origSetMaxListeners } from "events";
import { createRequire } from "module";
import { patchElectronEventTarget } from "../electron-compat";

const nodeRequire = createRequire(import.meta.url);
const events = nodeRequire("events") as {
	setMaxListeners: (n: number, ...targets: unknown[]) => unknown;
};

afterAll(() => {
	// Restore so the patched wrapper doesn't leak into other test files.
	events.setMaxListeners = origSetMaxListeners as never;
});

describe("patchElectronEventTarget", () => {
	it("swallows targets Node rejects (simulating a DOM AbortSignal)", () => {
		patchElectronEventTarget();
		// A plain object is rejected by the real setMaxListeners exactly like a
		// cross-realm DOM AbortSignal would be.
		expect(() => events.setMaxListeners(20, {} as never)).not.toThrow();
	});

	it("still applies to real Node event emitters", () => {
		patchElectronEventTarget();
		const emitter = new EventEmitter();
		events.setMaxListeners(33, emitter);
		expect(emitter.getMaxListeners()).toBe(33);
	});

	it("is idempotent", () => {
		const before = events.setMaxListeners;
		patchElectronEventTarget();
		expect(events.setMaxListeners).toBe(before);
	});
});
