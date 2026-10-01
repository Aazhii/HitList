'use strict';

/**
 * The backup rules, with no Catalyst in them: storage is passed in, so these can be tested with a fake.
 *
 *   index: { latest(userId), list(userId), add(entry), remove(userId, entry) }   (one row per backup)
 *   files: { put(userId, name, bytes) -> fileId, get(fileId) -> bytes, remove(fileId) }
 *
 * Isolation: every read and write goes through the index, filtered by `userId`, and the file id used is always
 * one taken from that user's own entry. A user id is never accepted from the request body.
 */
const KEEP = 7;
const MAX_BYTES = 25 * 1024 * 1024;

class BackupError extends Error {
	constructor(status, code, message) {
		super(message || code);
		this.status = status;
		this.code = code;
	}
}

const isGzip = (bytes) => bytes.length > 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;

function createBackupService({ index, files, now = () => Date.now(), keep = KEEP, maxBytes = MAX_BYTES }) {
	return {
		/** Stores a snapshot unless the newest one already has the same content hash. */
		async save(userId, bytes, hash) {
			if (!/^[0-9a-f]{64}$/.test(String(hash || ''))) throw new BackupError(400, 'bad_hash', 'x-content-hash must be a SHA-256 in hex');
			if (!bytes || bytes.length === 0) throw new BackupError(400, 'empty', 'The backup is empty');
			if (bytes.length > maxBytes) throw new BackupError(413, 'too_large', `A backup may be at most ${maxBytes} bytes`);
			if (!isGzip(bytes)) throw new BackupError(400, 'not_gzip', 'The backup must be gzip-compressed');

			const newest = await index.latest(userId);
			if (newest && newest.hash === hash) return { stored: false, entry: newest };

			const at = now();
			const fileId = await files.put(userId, `${userId}_${at}_${hash.slice(0, 8)}.json.gz`, bytes);
			const entry = await index.add({ userId, at, hash, size: bytes.length, fileId });

			// Only after the new backup is safely stored: drop the ones beyond the newest `keep`.
			const all = await index.list(userId);
			for (const old of all.slice(keep)) {
				await files.remove(old.fileId);
				await index.remove(userId, old);
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

module.exports = { createBackupService, BackupError, KEEP, MAX_BYTES };
