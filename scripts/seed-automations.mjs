/**
 * Creates a starter set of automation rules for one owner.
 *
 *   node --import tsx scripts/seed-automations.mjs --owner <OwnerId> --email <address> [--tz Asia/Kolkata] [--apply]
 *
 * Why this exists: the rules UI is the normal way to make these, and anyone
 * can edit or delete them there afterwards. This is for setting a user up with
 * the two rules that cover what task reminders do not — a task's own reminder
 * fires once BEFORE its due time and nothing fires after it, so without an
 * `overdue` rule a task can pass its due time in silence.
 *
 * Dry run by default; --apply writes. Idempotent, and deliberately by TRIGGER
 * rather than by name: an owner who already has an active all-tasks rule for a
 * trigger does not want a second one firing beside it, whatever they called
 * theirs. So re-running adds nothing, and neither does running it for someone
 * who has already set this up by hand.
 *
 * OwnerId is the value in the user's own rows (KaizenTasks.OwnerId), not the
 * user_id the admin user list shows — the two are not the same number. Find it
 * with: SELECT OwnerId FROM KaizenTasks.
 */
import { randomUUID } from 'node:crypto';
import { accessTokenFromCli, readCatalystRc } from '../server/catalyst/cliCredentials.ts';
import { endpointsFor } from '../server/catalyst/dc.ts';
import { RULES_TABLE } from '../server/catalyst/schema.ts';

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

const OWNER = arg('owner');
const EMAIL = arg('email') ?? '';
const TZ = arg('tz') ?? 'Asia/Kolkata';
const APPLY = process.argv.includes('--apply');

if (!OWNER) {
  console.error('Usage: --owner <OwnerId> --email <address> [--tz <IANA zone>] [--apply]');
  process.exit(1);
}

/**
 * The starter rules.
 *
 * `description` is the notification's body; the task's title is appended to
 * it, so each reads as a sentence about that task.
 */
const RULES = [
  {
    name: 'Overdue alert',
    description: 'Now overdue',
    triggerType: 'overdue',
    urgency: 'high',
    offsetValue: 0,
    offsetUnit: 'minutes',
  },
  {
    name: 'Due tomorrow',
    description: 'Due tomorrow',
    triggerType: 'due-date',
    urgency: 'medium',
    offsetValue: 1,
    offsetUnit: 'days',
  },
];

const project = readCatalystRc();
const creds = await accessTokenFromCli(true);
if (!project || !creds) {
  console.error('No Catalyst CLI login. Run: catalyst login');
  process.exit(1);
}
const { console: consoleUrl } = endpointsFor(creds.dataCentre);

async function api(method, path, body) {
  const res = await fetch(`${consoleUrl}/baas/v1/project/${project.projectId}${path}`, {
    method,
    headers: {
      Authorization: `Zoho-oauthtoken ${creds.accessToken}`,
      'CATALYST-ORG': project.orgId,
      Environment: process.env['CATALYST_ENVIRONMENT'] ?? 'Development',
      'Content-Type': 'application/json',
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${path} -> ${res.status}: ${text.slice(0, 300)}`);
  return text ? JSON.parse(text) : null;
}

const quote = (v) => `'${String(v).replace(/'/g, "''")}'`;

const existing = (await api('POST', '/query', {
  query: `SELECT RuleId,Name,TriggerType,RuleStatus,TaskId FROM ${RULES_TABLE} WHERE OwnerId = ${quote(OWNER)}`,
}))?.data?.map((r) => r[RULES_TABLE]) ?? [];

console.log(`${project.projectName}: owner ${OWNER} has ${existing.length} rule(s)${APPLY ? '' : '  (dry run)'}\n`);

const now = Date.now();
let created = 0;

for (const spec of RULES) {
  const already = existing.find(
    (r) => r.TriggerType === spec.triggerType
      && (r.TaskId ?? '') === ''
      && r.RuleStatus === 'active',
  );
  if (already) {
    console.log(`  ${spec.name}: skipped — "${already.Name}" already covers ${spec.triggerType} for every task`);
    continue;
  }

  console.log(`  ${spec.name}: ${spec.triggerType}, "${spec.description} — <task>", in-app + browser`);
  if (!APPLY) continue;

  // The same columns, in the same shapes, that the server's own writer uses
  // — see toRow() in server/automations/rules.ts. NextTriggerAt stays 0:
  // these hang off a task's dates, so giving them one would put them in the
  // sweep's planning query, where they have nothing to do.
  await api('POST', `/table/${RULES_TABLE}/row`, [{
    RuleId: randomUUID(),
    OwnerId: OWNER,
    Name: spec.name,
    Description: spec.description,
    TaskId: '',
    TriggerType: spec.triggerType,
    RuleStatus: 'active',
    Urgency: spec.urgency,
    OffsetValue: String(spec.offsetValue),
    OffsetUnit: spec.offsetUnit,
    RecurrenceFreq: 'daily',
    RecurrenceTime: '',
    RecurrenceDayOfWeek: '0',
    RecurrenceDayOfMonth: '1',
    NotifyInApp: 'true',
    NotifyBrowser: 'true',
    // Email delivery needs NOTIFY_FROM_EMAIL on the service; without it the
    // channel skips. Turn this on in the UI once a sender is configured.
    NotifyEmail: 'false',
    OwnerTimezone: TZ,
    OwnerEmail: EMAIL,
    LastTriggeredAt: '0',
    NextTriggerAt: '0',
    CreatedAt: String(now),
    UpdatedAt: String(now),
  }]);
  created++;
  console.log('            created');
}

console.log(APPLY
  ? `\nDone — ${created} rule(s) created. They reach existing tasks the next time ` +
    'the owner opens the app, which runs the backfill.'
  : '\nRe-run with --apply to write.');
