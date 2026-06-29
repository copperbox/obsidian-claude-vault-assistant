/**
 * A single-activity gate shared between the one-off prompt runner and the
 * interactive chat. Only one Claude activity may run at a time: a one-off run
 * holds the lock for its whole run, while a chat holds it only for the duration
 * of an in-flight turn (an idle, open chat leaves the lock free so one-off
 * prompts still work).
 */
export class ActivityLock {
	private busyLabel: string | null = null;

	get isBusy(): boolean {
		return this.busyLabel !== null;
	}

	/** Human-readable description of the current activity, or null if idle. */
	get label(): string | null {
		return this.busyLabel;
	}

	/**
	 * Try to take the lock. Returns true if acquired, false if another activity
	 * already holds it.
	 */
	tryAcquire(label: string): boolean {
		if (this.busyLabel !== null) return false;
		this.busyLabel = label;
		return true;
	}

	/** Release the lock. Safe to call when not held. */
	release(): void {
		this.busyLabel = null;
	}
}
