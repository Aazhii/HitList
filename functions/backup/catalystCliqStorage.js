'use strict';

const catalyst = require('zcatalyst-sdk-node');

// Required schema: CliqLinks unique UserId AND unique SenderKey, with LinkId, Value (text <=10k).
// CliqRecords unique RecordKey, with Value (text <=10k), AccountId, DeviceId, Generation
// (big int), Status, CreatedAt (big int). Uniqueness must be enforced by the DB on insert.
const tableName = (value) => {
	if (typeof value !== 'string' || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(value)) throw new Error('invalid table configuration');
	return value;
};
const safe = (value, pattern) => {
	if (typeof value !== 'string' || !pattern.test(value)) throw new Error('invalid storage key');
	return value;
};
const recordKey = (value) => safe(value, /^(?:challenge|nonce|claim|consumed|command|result|replied):[a-f0-9]{64}$/);
const accountKey = (value) => safe(value, /^[0-9]{5,30}$/);
const senderKey = (value) => safe(value, /^[A-Za-z0-9_-]{1,64}:[A-Za-z0-9_-]{1,64}$/);
const deviceKey = (value) => safe(value, /^[A-Za-z0-9_-]{1,64}$/);
const linkKey = (value) => safe(value, /^[a-f0-9]{32}$/);
const serialized = (value) => {
	const text = JSON.stringify(value);
	if (typeof text !== 'string' || Buffer.byteLength(text) > 10_000) throw new Error('invalid storage value');
	return text;
};
const duplicate = (error) => /duplicate|unique|already.exists/i.test(`${error && error.code || ''} ${error && error.message || ''}`);

function createCatalystCliqStorage(req, { linksTable, recordsTable }) {
	const links = tableName(linksTable);
	const records = tableName(recordsTable);
	const app = catalyst.initialize(req, { type: 'advancedio', appName: 'backup', scope: 'admin' });
	const query = async (table, column, value, limit = 1, extra = '') => {
		const raw = await app.zcql().executeZCQLQuery(`SELECT * FROM ${table} WHERE ${column}='${value}' ${extra} LIMIT ${limit}`);
		return raw.map((entry) => entry[table]).filter(Boolean);
	};
	const rowFor = async (key) => (await query(records, 'RecordKey', recordKey(key)))[0] || null;
	const linkFor = (row) => row ? JSON.parse(row.Value) : null;
	const recordFor = (row) => row ? JSON.parse(row.Value) : null;
	return {
		async insertUnique(key, value) {
			const row = {
				RecordKey: recordKey(key), Value: serialized(value),
				AccountId: value.accountId ? accountKey(value.accountId) : '',
				DeviceId: value.deviceId ? deviceKey(value.deviceId) : '',
				Generation: Number.isSafeInteger(value.generation) ? value.generation : 0,
				Status: key.startsWith('command:') ? 'pending' : 'record', CreatedAt: Number.isSafeInteger(value.createdAt) ? value.createdAt : Date.now(),
			};
			try { await app.datastore().table(records).insertRow(row); return true; }
			catch (error) {
				if (duplicate(error) && await rowFor(key)) return false;
				throw new Error('cliq record insert failed');
			}
		},
		async get(key) { return recordFor(await rowFor(key)); },
		async set(key, value) {
			const row = await rowFor(key);
			if (!row) throw new Error('cliq record missing');
			await app.datastore().table(records).updateRow({ ROWID: row.ROWID, Value: serialized(value), Status: key.startsWith('command:') && value.status === 'terminal' ? 'terminal' : row.Status });
		},
		async remove(key) {
			const row = await rowFor(key);
			if (row) await app.datastore().table(records).deleteRow(row.ROWID);
		},
		async listPending(accountId, deviceId, generation, limit) {
			if (!Number.isSafeInteger(generation) || generation <= 0 || !Number.isInteger(limit) || limit < 1 || limit > 50) throw new Error('invalid pending query');
			const rows = await query(records, 'AccountId', accountKey(accountId), limit, `AND DeviceId='${deviceKey(deviceId)}' AND Generation=${generation} AND Status='pending' ORDER BY CreatedAt ASC`);
			return rows.map(recordFor);
		},
		async linkByAccount(accountId) { return linkFor((await query(links, 'UserId', accountKey(accountId)))[0]); },
		async linkBySender(key) { return linkFor((await query(links, 'SenderKey', senderKey(key)))[0]); },
		async createLink(link) {
			const row = { UserId: accountKey(link.accountId), SenderKey: senderKey(link.senderKey), LinkId: linkKey(link.linkId), Value: serialized(link) };
			try { await app.datastore().table(links).insertRow(row); return true; }
			catch (error) {
				if (duplicate(error) && (await this.linkByAccount(link.accountId) || await this.linkBySender(link.senderKey))) return false;
				throw new Error('cliq link insert failed');
			}
		},
		async deleteLink(link) {
			await app.zcql().executeZCQLQuery(`DELETE FROM ${links} WHERE UserId='${accountKey(link.accountId)}' AND SenderKey='${senderKey(link.senderKey)}' AND LinkId='${linkKey(link.linkId)}'`);
		},
	};
}

module.exports = { createCatalystCliqStorage };