'use strict';

/**
 * A small per-person limit on how fast the bot may be asked to send, so one signed-in account cannot flood Cliq. Kept in memory:
 * it resets when the function restarts, which is fine for a safeguard (the desktop already sends at most ten a minute).
 */
function createRateLimit({ limit = 60, windowMs = 60_000, now = Date.now } = {}) {
	const seen = new Map();
	return {
		/** True if this person may send now; counts the send. */
		allow(userId) {
			const t = now();
			const recent = (seen.get(userId) || []).filter((at) => t - at < windowMs);
			if (recent.length >= limit) { seen.set(userId, recent); return false; }
			recent.push(t);
			seen.set(userId, recent);
			if (seen.size > 5000) for (const [key, times] of seen) if (!times.some((at) => t - at < windowMs)) seen.delete(key);
			return true;
		},
	};
}

module.exports = { createRateLimit };
