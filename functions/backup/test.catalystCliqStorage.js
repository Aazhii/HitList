'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createCatalystCliqStorage } = require('./catalystCliqStorage');

const KEY = `command:${'a'.repeat(64)}`;

/** A Data Store that records every query, so what a request costs in fetches is visible. */
function fakeSdk(rows = []) {
	const queries = [];
	const table = {
		insertRow: async (row) => { rows.push({ ROWID: String(rows.length + 1), ...row }); },
		updateRow: async (row) => { Object.assign(rows.find((r) => r.ROWID === row.ROWID), row); },
		deleteRow: async (id) => { rows.splice(rows.findIndex((r) => r.ROWID === id), 1); },
	};
	return {
		queries, rows,
		initialize: () => ({
			zcql: () => ({
				executeZCQLQuery: async (sql) => {
					queries.push(sql);
					const key = /RecordKey='([^']+)'/.exec(sql);
					return rows.filter((r) => !key || r.RecordKey === key[1]).map((r) => ({ Records: r }));
				},
			}),
			datastore: () => ({ table: () => table }),
		}),
	};
}
const storage = (sdk) => createCatalystCliqStorage({}, { linksTable: 'Links', recordsTable: 'Records', sdk });

test('a record read twice in one request is fetched once', async () => {
	const sdk = fakeSdk([{ ROWID: '7', RecordKey: KEY, Value: JSON.stringify({ status: 'pending' }), Status: 'pending' }]);
	const store = storage(sdk);

	assert.deepEqual(await store.get(KEY), { status: 'pending' });
	// Writing it back needs the row id, which the read already found: acknowledging a command used to pay for both.
	await store.set(KEY, { status: 'terminal' });
	assert.equal(sdk.queries.length, 1);
	assert.equal(sdk.rows[0].Status, 'terminal');
});

test('a write is not served from the request\'s own earlier read', async () => {
	const sdk = fakeSdk([{ ROWID: '7', RecordKey: KEY, Value: JSON.stringify({ status: 'pending' }), Status: 'pending' }]);
	const store = storage(sdk);

	await store.get(KEY);
	await store.set(KEY, { status: 'terminal' });
	// The next read sees what was written, not the copy from before it.
	assert.deepEqual(await store.get(KEY), { status: 'terminal' });
	assert.equal(sdk.queries.length, 2);

	await store.remove(KEY);
	assert.equal(await store.get(KEY), null);
});

test('each request starts with nothing remembered', async () => {
	const sdk = fakeSdk([{ ROWID: '7', RecordKey: KEY, Value: JSON.stringify({ status: 'pending' }), Status: 'pending' }]);
	await storage(sdk).get(KEY);
	await storage(sdk).get(KEY);
	assert.equal(sdk.queries.length, 2, 'a second caller must not be answered from the first one\'s read');
});
