import { describe, expect, it } from 'vitest';
import { createRateLimiter } from './rate-limit.js';

function clock() {
	let t = 1_000_000;
	return { now: () => t, advance: (ms: number) => (t += ms) };
}

describe('createRateLimiter', () => {
	it('allows until max failures, then blocks with a retry hint', () => {
		const c = clock();
		const limiter = createRateLimiter({ max: 3, windowMs: 60_000, now: c.now });
		for (let i = 0; i < 3; i++) {
			expect(limiter.check('k').allowed).toBe(true);
			limiter.fail('k');
			c.advance(1000);
		}
		const blocked = limiter.check('k');
		expect(blocked.allowed).toBe(false);
		// oldest failure was 3 s ago -> 57 s left
		expect(blocked.retryAfterSeconds).toBe(57);
	});

	it('recovers after the window passes', () => {
		const c = clock();
		const limiter = createRateLimiter({ max: 1, windowMs: 1000, now: c.now });
		limiter.fail('k');
		expect(limiter.check('k').allowed).toBe(false);
		c.advance(1001);
		expect(limiter.check('k').allowed).toBe(true);
	});

	it('tracks keys independently and reset clears one', () => {
		const limiter = createRateLimiter({ max: 1, windowMs: 60_000 });
		limiter.fail('a');
		expect(limiter.check('a').allowed).toBe(false);
		expect(limiter.check('b').allowed).toBe(true);
		limiter.reset('a');
		expect(limiter.check('a').allowed).toBe(true);
	});

	it('bounds memory by evicting the stalest key', () => {
		const limiter = createRateLimiter({ max: 1, windowMs: 60_000, maxKeys: 2 });
		limiter.fail('a');
		limiter.fail('b');
		limiter.fail('c');
		expect(limiter.check('a').allowed).toBe(true);
		expect(limiter.check('c').allowed).toBe(false);
	});
});
