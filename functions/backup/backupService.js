'use strict';

/**
 * The backup rules, with no Catalyst in them: storage is passed in, so these can be tested with a fake.
 *
 *   index: { latest(userId), list(userId), add(entry), removeMany(userId, entries) }   (one row per backup)
 *   files: { put(userId, name, bytes) -> fileId, get(fileId) -> bytes, remove(fileId) }
 *
 * Isolation: every read and write goes through the index, filtered by `userId`, and the file id used is always
 * one taken from that user's own entry. A user id is never accepted from the request body.
 */
const KEEP = 7;
// Old backups are removed in batches once a user has twice KEEP; recent entries remain for daily-limit accounting.
const MAX_BYTES = 25 * 1024 * 1024;
const MAX_PER_DAY = 10;
const DAY_MS = 24 * 60 * 60 * 1000;
const BACKUP_REASONS = new Set(['manual', 'signed-in', 'sign-out', 'scheduled', 'update']);

class BackupError extends Error {
	constructor(status, code, message, extra) {
		super(message || code);
		this.status = status;
		this.code = code;
		this.extra = extra || {};
	}
}

const isGzip = (bytes) => bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

function createBackupService({ index, files, now = () => Date.now(), keep = KEEP, maxBytes = MAX_BYTES, maxPerDay = MAX_PER_DAY }) {
	const pruneAt = keep * 2;
	return {
		/** Stores a snapshot unless the newest one already has the same content hash. */
		async save(userId, bytes, hash, reason = 'manual') {
			if (!BACKUP_REASONS.has(reason)) throw new BackupError(400, 'bad_reason', 'Unknown backup trigger');
			if (!/^[0-9a-f]{64}$/.test(String(hash || ''))) throw new BackupError(400, 'bad_hash', 'x-content-hash must be a SHA-256 in hex');
			if (!bytes || bytes.length === 0) throw new BackupError(400, 'empty', 'The backup is empty');
			if (bytes.length > maxBytes) throw new BackupError(413, 'too_large', `A backup may be at most ${maxBytes} bytes`);
			if (!isGzip(bytes)) throw new BackupError(400, 'not_gzip', 'The backup must be gzip-compressed');

			// One query serves both the unchanged check and the pruning below.
			const existing = await index.list(userId);
			const newest = existing[0];
			if (newest && newest.hash === hash) return { stored: false, entry: newest };

			const at = now();
			// Only successfully stored, changed snapshots consume the rolling daily allowance.
			const recent = existing.filter((entry) => (!entry.reason || entry.reason === 'manual') && entry.at > at - DAY_MS);
			if (reason === 'manual' && recent.length >= maxPerDay) {
				const retryAt = recent[maxPerDay - 1].at + DAY_MS;
				throw new BackupError(429, 'daily_limit', `At most ${maxPerDay} manual backups a day. Try again later.`, { retryAt });
			}
			const fileId = await files.put(userId, `${userId}_${at}_${hash.slice(0, 8)}.json.gz`, bytes);
			const entry = await index.add({ userId, at, hash, size: bytes.length, fileId, reason });

			// Keep recent entries for daily-cap accounting even when they exceed snapshot retention.
			const all = [entry, ...existing];
			if (all.length >= pruneAt) {
				const old = all.slice(keep).filter((entry) => entry.at <= at - DAY_MS || (entry.reason && entry.reason !== 'manual'));
				for (const o of old) await files.remove(o.fileId);
				if (old.length) await index.removeMany(userId, old);
			}
			return { stored: true, entry };
		},

		async list(userId) {
			return (await index.list(userId)).map(({ at, hash, size }) => ({ at, hash, size }));
		},

		/** The newest backup, with its bytes, or null when this user has none. */
		async latest(userId) {
			const entry = await index.latest(userId);
			if (!entry) return null;
			return { entry, bytes: await files.get(entry.fileId) };
		},
	};
}

module.exports = { createBackupService, BackupError, KEEP, MAX_BYTES, MAX_PER_DAY };
