/**
 * Creates the HitList tables and columns in a Catalyst project.
 *
 *   pnpm catalyst:setup            # create anything missing, then report
 *   pnpm catalyst:setup --dry-run  # report only, change nothing
 *
 * Why a script rather than the runtime provisioner this replaces: the server
 * used to create columns on every boot by reaching into private SDK fields
 * (`table.requester.send`) to POST undocumented endpoints, typing every column
 * as `text` because it had no type information. Schema changes belong in an
 * explicit, reviewable step, not in the request path.
 *
 * Credentials, in order of preference:
 *   1. CATALYST_* in .env.local — see .env.example
 *   2. ~/.catalystrc            — written by `catalyst login`
 *
 * The Data Store admin API is REST; the Node SDK exposes no createTable.
 */
import { SCHEMA, type ColumnSpec } from '../server/catalyst/schema.ts';
import { api, resolveTarget, withRetry, type Target } from './lib/catalystAdmin.ts';

const DRY_RUN = process.argv.includes('--dry-run');

function columnPayload(col: ColumnSpec) {
  return {
    column_name: col.name,
    data_type: col.type,
    ...(col.maxLength ? { max_length: col.maxLength } : {}),
    is_mandatory: col.mandatory ? 'true' : 'false',
    is_unique:    col.unique ? 'true' : 'false',
    search_index_enabled: 'false',
    audit_consent: 'false',
  };
}

/** Looks a table up by name, retrying while creation settles server-side. */
async function resolveTableId(target: Target, name: string, attempts = 6): Promise<string | null> {
  for (let i = 0; i < attempts; i++) {
    const tables = await api(target, 'GET', '/table') as Array<Record<string, unknown>>;
    const match = (tables ?? []).find((t) => String(t['table_name']) === name);
    if (match) return String(match['table_id']);
    await new Promise((r) => setTimeout(r, 1000 * (i + 1)));
  }
  return null;
}

async function main(): Promise<void> {
  const target = await resolveTarget('setup');
  if (DRY_RUN) console.log('[setup] dry run — nothing will be created');
  console.log('');

  const existing = await api(target, 'GET', '/table') as Array<Record<string, unknown>>;
  const byName = new Map<string, string>();
  for (const t of existing ?? []) {
    byName.set(String(t['table_name']), String(t['table_id']));
  }
  console.log(`[setup] ${byName.size} existing table(s): ${[...byName.keys()].join(', ') || '(none)'}\n`);

  let created = 0;
  for (const table of SCHEMA) {
    let tableId: string | undefined = byName.get(table.name);

    if (!tableId) {
      console.log(`[setup] table ${table.name}: MISSING`);
      if (DRY_RUN) { console.log('          would create it and all columns\n'); continue; }
      await api(target, 'POST', '/table', { table_name: table.name, table_scope: 'GLOBAL' });
      created++;

      // Do not trust table_id from the create response — it came back one less
      // than the table's real id, and the column endpoint then 404s with
      // INVALID_ID. Re-list and match on the name, which is authoritative.
      // Creation also settles asynchronously, so allow a few attempts.
      tableId = (await resolveTableId(target, table.name)) ?? undefined;
      if (!tableId) {
        throw new Error(
          `Created ${table.name} but it did not appear in the table list. ` +
          `Check the Catalyst console before re-running.`
        );
      }
      console.log(`          created (id ${tableId})`);
    } else {
      console.log(`[setup] table ${table.name}: ok (id ${tableId})`);
    }

    const cols = await api(target, 'GET', `/table/${tableId}/column`) as Array<Record<string, unknown>>;
    const have = new Set((cols ?? []).map((c) => String(c['column_name'])));
    const missing = table.columns.filter((c) => !have.has(c.name));

    if (!missing.length) { console.log('          all columns present\n'); continue; }

    console.log(`          ${missing.length} missing column(s): ${missing.map((c) => c.name).join(', ')}`);
    if (DRY_RUN) { console.log(''); continue; }

    for (const col of missing) {
      try {
        await withRetry(
          () => api(target, 'POST', `/table/${tableId}/column`, [columnPayload(col)]),
          `create column ${table.name}.${col.name}`,
        );
        console.log(`            + ${col.name} (${col.type})`);
        created++;
      } catch (e) {
        const msg = String(e);
        if (/already exists|duplicate/i.test(msg)) {
          console.log(`            ~ ${col.name} already exists`);
        } else if (/reserved keyword/i.test(msg)) {
          throw new Error(
            `Catalyst rejects the column name "${col.name}" as a reserved keyword.\n` +
            `  Rename it in server/catalyst/schema.ts (and in the server's row ` +
            `converters) — this is why Priority is stored as TaskPriority.`
          );
        } else {
          throw new Error(`Failed to create column ${table.name}.${col.name}: ${msg}`);
        }
      }
    }
    console.log('');
  }

  console.log(DRY_RUN
    ? '[setup] dry run complete.'
    : `[setup] done — ${created} object(s) created.`);
  console.log(
    '\nIf writes still fail with a permission error, grant the App User role\n' +
    'INSERT/UPDATE/DELETE on these tables in the console: Catalyst grants\n' +
    'SELECT only by default, which silently breaks every write.'
  );
}

main().catch((e) => {
  console.error(`\n[setup] ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
