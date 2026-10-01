'use strict';

/**
 * The real storage behind backupService: the files live in one File Store folder, and a Data Store table, `Backups`,
 * holds one row per backup (the index). The user id is validated as digits before it goes into a query, and the
 * caller must already have been verified; nothing here reads a user id from a request.
 *
 * Data Store table to create once, in the console (Data Store -> Create Table):
 *   Backups:  UserId (Text), BackedUpAt (Big Int), Hash (Text), SizeBytes (Big Int), FileId (Text)
 */
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
// Storage uses Catalyst's standard Node SDK, which ships Data Store and File Store consistently. (The newer split
// packages could not be used here: the File Store one pulls in its own older copy of the auth code, which does not
// see the credentials the newer auth package sets up.)
const catalyst = require('zcatalyst-sdk-node');

const TABLE = 'Backups';
const FOLDER_NAME = 'backups';

const digits = (id) => { if (!/^[0-9]{5,30}$/.test(String(id))) throw new Error('bad user id'); return String(id); };
const rowOf = (r) => { const row = r[TABLE] || r; return { rowId: String(row.ROWID), userId: row.UserId, at: Number(row.BackedUpAt), hash: row.Hash, size: Number(row.SizeBytes), fileId: row.FileId }; };

async function createCatalystStorage(req) {
	// Storage is the service's own business, so it runs with the project's rights, after the caller was verified.
	const app = catalyst.initialize(req, { type: 'advancedio', appName: 'backup', scope: 'admin' });
	const datastore = app.datastore();
	const filestore = app.filestore();
	let folder;
	const getFolder = async () => {
		if (folder) return folder;
		const found = (await filestore.getAllFolders()).map((f) => (typeof f.toJSON === 'function' ? f.toJSON() : f)).find((f) => f.folder_name === FOLDER_NAME);
		const details = found || (await filestore.createFolder(FOLDER_NAME));
		const id = details.id || (typeof details.toJSON === 'function' && details.toJSON().id);
		folder = filestore.folder(id);
		return folder;
	};
	const query = async (userId, limit) =>
		(await app.zcql().executeZCQLQuery(`SELECT * FROM ${TABLE} WHERE UserId='${digits(userId)}' ORDER BY BackedUpAt DESC LIMIT ${limit}`)).map(rowOf);

	return {
		index: {
			latest: async (userId) => (await query(userId, 1))[0] || null,
			list: async (userId) => query(userId, 100),
			add: async ({ userId, at, hash, size, fileId }) => rowOf(await datastore.table(TABLE).insertRow({
				UserId: digits(userId), BackedUpAt: at, Hash: hash, SizeBytes: size, FileId: String(fileId),
			})),
			// One request for the whole batch.
			removeMany: async (_userId, entries) => { if (entries.length) await datastore.table(TABLE).deleteRows(entries.map((e) => e.rowId)); },
		},
		files: {
			put: async (_userId, name, bytes) => {
				const tmp = path.join(os.tmpdir(), `${Date.now()}-${Math.random().toString(36).slice(2)}-${name}`);
				fs.writeFileSync(tmp, bytes);
				try {
					const saved = await (await getFolder()).uploadFile({ code: fs.createReadStream(tmp), name });
					return String(saved.id);
				} finally { fs.rmSync(tmp, { force: true }); }
			},
			get: async (fileId) => {
				return Buffer.from(await (await getFolder()).downloadFile(String(fileId)));
			},
			remove: async (fileId) => { await (await getFolder()).deleteFile(String(fileId)); },
		},
	};
}

module.exports = { createCatalystStorage };
