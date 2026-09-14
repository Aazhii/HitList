import { api, resolveTarget } from './lib/catalystAdmin.ts';

const QUEUE_TABLE_ID = '69251000000097013';
const OWNER = 'cron-smoke-test';

async function main() {
  const t = await resolveTarget('smoke');
  const now = Date.now();

  if (process.argv.includes('--seed')) {
    // A bare array, not { data: [...] } — see docs/catalyst/03-datastore.md.
    const r = await api(t, 'POST', `/table/${QUEUE_TABLE_ID}/row`, [{
      QueueId: `smoke-${now}`,
      OwnerId: OWNER,
      FireAt: String(now - 1000),
      Status: 'PENDING',
      DedupeKey: `smoke:${now}`,
      Kind: 'TASK_REMINDER',
      SourceType: 'TASK',
      SourceId: 'smoke',
      Channels: 'inapp',
      Title: 'Cron smoke test',
      Body: 'If this reaches the inbox, the cron fired.',
      Payload: '{}',
      AttemptCount: '0',
      SentAt: '0',
      CreatedAt: String(now),
      UpdatedAt: String(now),
    }]);
    console.log('seeded:', JSON.stringify(r).slice(0, 200));
    return;
  }

  const results = await api(t, 'POST', '/query', {
    query:
      "SELECT QueueId, Status, SentAt, AttemptCount, LastError " +
      "FROM KaizenNotificationQueue WHERE OwnerId = '" + OWNER + "'",
  }) as Array<Record<string, Record<string, string>>>;

  const mine = results.map((r) => r['KaizenNotificationQueue'] ?? {});
  if (!mine.length) { console.log('no smoke rows found'); return; }
  for (const r of mine) {
    console.log(
      `${r.QueueId}  Status=${r.Status}  SentAt=${r.SentAt}  ` +
      `attempts=${r.AttemptCount}  err=${r.LastError ?? ''}`,
    );
  }
}
main();
