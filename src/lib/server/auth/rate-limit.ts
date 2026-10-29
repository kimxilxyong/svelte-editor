/**
 * @fileoverview In-memory sliding-window rate limiter used to slow down password guessing.
 *
 * State lives in process memory: it resets on restart and is not shared between server instances.
 * That is acceptable for the brute-force protection of a single-node app; deployments behind several
 * instances should add a shared limiter at the proxy.
 *
 * Only *failures* are counted: {@link RateLimiter.check} asks "may this key try again?",
 * {@link RateLimiter.fail} records a failed attempt and {@link RateLimiter.reset} forgets the key
 * after a success.
 */

/** Options for {@link createRateLimiter}. */
export type RateLimiterOptions = {
	/** Failures allowed inside one window before the key is blocked. */
	max: number;
	/** Window length in milliseconds. */
	windowMs: number;
	/** Clock injection for tests; defaults to `Date.now`. */
	now?: () => number;
	/** Maximum number of tracked keys; the oldest are evicted first (memory bound). Default 10 000. */
	maxKeys?: number;
};

/** Result of {@link RateLimiter.check}. */
export type RateLimitDecision = {
	/** Whether another attempt is currently allowed. */
	allowed: boolean;
	/** Seconds until the oldest failure leaves the window (0 when allowed). */
	retryAfterSeconds: number;
};

/** A sliding-window failure limiter. */
export type RateLimiter = {
	/** Whether `key` may attempt now. Does not record anything. */
	check(key: string): RateLimitDecision;
	/** Records one failed attempt for `key`. */
	fail(key: string): void;
	/** Forgets all failures of `key` (call after a successful attempt). */
	reset(key: string): void;
};

/**
 * Creates an independent limiter.
 * @param options - Limit, window and optional clock.
 * @returns A {@link RateLimiter}.
 * @example
 * const limiter = createRateLimiter({ max: 5, windowMs: 15 * 60_000 });
 * if (!limiter.check(key).allowed) throw new Error('slow down');
 * limiter.fail(key);
 */
export function createRateLimiter(options: RateLimiterOptions): RateLimiter {
	const { max, windowMs } = options;
	const now = options.now ?? Date.now;
	const maxKeys = options.maxKeys ?? 10_000;
	/** key → timestamps (ms) of failures inside the window, ascending. */
	const failures = new Map<string, number[]>();

	/** Drops expired timestamps; removes the key entirely when nothing is left. */
	function prune(key: string): number[] {
		const list = failures.get(key);
		if (!list) return [];
		const cutoff = now() - windowMs;
		const fresh = list.filter((t) => t > cutoff);
		if (fresh.length === 0) failures.delete(key);
		else if (fresh.length !== list.length) failures.set(key, fresh);
		return fresh;
	}

	return {
		check(key) {
			const list = prune(key);
			if (list.length < max) return { allowed: true, retryAfterSeconds: 0 };
			const waitMs = list[list.length - max] + windowMs - now();
			return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil(waitMs / 1000)) };
		},
		fail(key) {
			const list = prune(key);
			list.push(now());
			failures.set(key, list);
			// Bound memory so an attacker rotating keys cannot grow the map forever; Map keeps
			// insertion order, so the first key is the stalest.
			if (failures.size > maxKeys) {
				const oldest = failures.keys().next().value;
				if (oldest !== undefined) failures.delete(oldest);
			}
		},
		reset(key) {
			failures.delete(key);
		}
	};
}

/** Login failures per `ip + email`: 5 per 15 minutes. */
export const loginLimiter: RateLimiter = createRateLimiter({ max: 5, windowMs: 15 * 60_000 });

/** Login failures per IP across all emails: 30 per 15 minutes (stops credential stuffing). */
export const loginIpLimiter: RateLimiter = createRateLimiter({ max: 30, windowMs: 15 * 60_000 });
