/**
 * Reads or sets the app-wide switches in KaizenTrialFeatures.
 *
 *   pnpm catalyst:features                                  # list
 *   pnpm catalyst:features notifications=false --dry-run    # show what would change
 *   pnpm catalyst:features notifications=false automations=false
 *
 * The same edit can be made by hand in the Data Store console. Either way the
 * running server picks it up within a minute — no redeploy. See
 * server/trialFeatures.ts for what each switch does.
 *
 * Only ever inserts a missing row or updates Enabled on an existing one.
 */
import { api, resolveTarget } from './lib/catalystAdmin.ts';
import { TRIAL_FEATURES_TABLE } from '../server/catalyst/schema.ts';
import { TRIAL_FEATURE_KEYS, parseEnabled, type TrialFeatureKey } from '../server/trialFeatures.ts';

const DRY_RUN = process.argv.includes('--dry-run');
const assignments = process.argv.slice(2).filter((a) => !a.startsWith('--'));

const wanted = new Map<TrialFeatureKey, boolean>();
for (const a of assignments) {
  const [key, value] = a.split('=');
  const enabled = parseEnabled(value);
  if (!TRIAL_FEATURE_KEYS.includes(key as TrialFeatureKey) || enabled === null) {
    console.error(`Expected key=true|false with key one of ${TRIAL_FEATURE_KEYS.join(', ')}; got "${a}"`);
    process.exit(1);
  }
  wanted.set(key as TrialFeatureKey, enabled);
}

const target = await resolveTarget('features');

async function readRows(): Promise<Array<{ ROWID: string; FeatureKey: string; Enabled: string }>> {
  const data = await api(target, 'POST', '/query', {
    query: `SELECT ROWID, FeatureKey, Enabled FROM ${TRIAL_FEATURES_TABLE} LIMIT 100`,
  }) as Array<Record<string, Record<string, unknown>>>;
  return (data ?? []).map((r) => {
    const row = r[TRIAL_FEATURES_TABLE] ?? r;
    return { ROWID: String(row['ROWID']), FeatureKey: String(row['FeatureKey']), Enabled: String(row['Enabled']) };
  });
}

function show(rows: Awaited<ReturnType<typeof readRows>>): void {
  for (const key of TRIAL_FEATURE_KEYS) {
    const row = rows.find((r) => r.FeatureKey.trim().toLowerCase() === key);
    const state = row ? (parseEnabled(row.Enabled) ?? true) : true;
    console.log(`  ${key.padEnd(14)} ${state ? 'on ' : 'off'}${row ? '' : '  (no row — counts as on)'}`);
  }
}

const rows = await readRows();
console.log(`[features] ${TRIAL_FEATURES_TABLE} now:`);
show(rows);

if (wanted.size === 0) process.exit(0);

const now = Date.now();
for (const [key, enabled] of wanted) {
  const row = rows.find((r) => r.FeatureKey.trim().toLowerCase() === key);
  if (row && parseEnabled(row.Enabled) === enabled) {
    console.log(`[features] ${key} is already ${enabled}`);
    continue;
  }
  if (DRY_RUN) {
    console.log(`[features] would ${row ? 'update' : 'insert'} ${key} = ${enabled}`);
    continue;
  }
  if (row) {
    await api(target, 'PATCH', `/table/${TRIAL_FEATURES_TABLE}/row`, [{ ROWID: row.ROWID, Enabled: enabled, UpdatedAt: now }]);
  } else {
    await api(target, 'POST', `/table/${TRIAL_FEATURES_TABLE}/row`, [{ FeatureKey: key, Enabled: enabled, UpdatedAt: now }]);
  }
  console.log(`[features] ${row ? 'updated' : 'inserted'} ${key} = ${enabled}`);
}

if (!DRY_RUN) {
  console.log(`[features] ${TRIAL_FEATURES_TABLE} after:`);
  show(await readRows());
}
