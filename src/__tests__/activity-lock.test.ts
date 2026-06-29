import { describe, it, expect, beforeEach } from "vitest";
import { ActivityLock } from "../activity-lock";

describe("ActivityLock", () => {
	let lock: ActivityLock;

	beforeEach(() => {
		lock = new ActivityLock();
	});

	it("starts idle", () => {
		expect(lock.isBusy).toBe(false);
		expect(lock.label).toBeNull();
	});

	it("acquires when free and exposes the label", () => {
		expect(lock.tryAcquire("vault prompt")).toBe(true);
		expect(lock.isBusy).toBe(true);
		expect(lock.label).toBe("vault prompt");
	});

	it("refuses a second acquire while held", () => {
		expect(lock.tryAcquire("chat turn")).toBe(true);
		expect(lock.tryAcquire("vault prompt")).toBe(false);
		// Original holder's label is unchanged.
		expect(lock.label).toBe("chat turn");
	});

	it("can be re-acquired after release", () => {
		lock.tryAcquire("chat turn");
		lock.release();
		expect(lock.isBusy).toBe(false);
		expect(lock.tryAcquire("vault prompt")).toBe(true);
		expect(lock.label).toBe("vault prompt");
	});

	it("release is safe when not held", () => {
		expect(() => lock.release()).not.toThrow();
		expect(lock.isBusy).toBe(false);
	});
});
