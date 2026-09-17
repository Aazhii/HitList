import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createSqliteStore } from '../../server/store/sqlite.ts';
import { listInbox } from '../../server/notifications/inbox.ts';
import { enqueue } from '../../server/notifications/queue.ts';
import { runSweep } from '../../server/notifications/sweep.ts';
import { readTrialFeatures } from '../../server/trialFeatures.ts';
import {
  type AutomationRule,
  findDueRules,
  insertRule,
  setStepsColumnAvailable,
} from '../../server/automations/rules.ts';
import { findTaskRules } from '../../server/automations/taskTriggers.ts';
import {
  type DatabaseRow,
  type KaizenDatabase,
  insertDatabase,
  insertRow,
  listRows,
  setDatabaseDateFieldAvailable,
} from '../../server/databases.ts';
import {
  type FieldDef,
  insertDef,
  listDefs,
  listProps,
  setFieldsDatabaseAvailable,
  setProp,
} from '../../server/fields.ts';
import {
  DEFAULT_DISPLAY,
  type SavedView,
  insertView,
  listViews,
  setViewDisplayAvailable,
} from '../../server/views.ts';
import { TRIAL_FEATURES_TABLE } from '../../server/catalyst/schema.ts';

describe('SQLite-backed store', () => {
  let store: ReturnType<typeof createSqliteStore>;

  beforeEach(() => {
    store = createSqliteStore(':memory:');
    setStepsColumnAvailable(true);
    setDatabaseDateFieldAvailable(true);
    setFieldsDatabaseAvailable(true);
    setViewDisplayAvailable(true);
    vi.stubEnv('NOTIFY_FROM_EMAIL', '');
    vi.stubEnv('NOTIFY_DISABLED_CHANNELS', '');
  });

  afterEach(() => {
    store.close();
    setStepsColumnAvailable(false);
    setDatabaseDateFieldAvailable(false);
    setFieldsDatabaseAvailable(false);
    setViewDisplayAvailable(false);
    vi.unstubAllEnvs();
  });

  it('runs the queue and in-app inbox flow against SQLite', async () => {
    const created = await enqueue(store.app, {
      ownerId: 'user-1',
      fireAt: Date.now() - 1000,
      dedupeKey: 'queue-1',
      kind: 'TASK_REMINDER',
      sourceType: 'TASK',
      sourceId: 'task-1',
      channels: ['inapp'],
      title: 'Prepare the deck',
      body: 'Due in 30 minutes.',
      payload: { email: 'user@example.com' },
    });

    expect(created).toBe(true);
    expect(await enqueue(store.app, {
      ownerId: 'user-1',
      fireAt: Date.now() - 1000,
      dedupeKey: 'queue-1',
      kind: 'TASK_REMINDER',
      sourceType: 'TASK',
      sourceId: 'task-1',
      channels: ['inapp'],
      title: 'Prepare the deck',
      body: 'Due in 30 minutes.',
    })).toBe(false);

    const report = await runSweep(store.app);
    expect(report.delivered).toBe(1);

    const inbox = await listInbox(store.app, 'user-1');
    expect(inbox).toHaveLength(1);
    expect(inbox[0].title).toBe('Prepare the deck');
  });

  it('supports current rule query patterns including IN and due filters', async () => {
    const now = Date.now();
    const base: AutomationRule = {
      id: 'rule-1',
      ownerId: 'user-1',
      name: 'Warn me',
      description: '',
      taskId: '',
      triggerType: 'due-date',
      status: 'active',
      urgency: 'medium',
      offsetValue: 60,
      offsetUnit: 'minutes',
      offsetSteps: [-60, 0],
      recurrenceFreq: 'daily',
      recurrenceTime: '',
      recurrenceDayOfWeek: 0,
      recurrenceDayOfMonth: 1,
      notifyInApp: true,
      notifyBrowser: false,
      notifyEmail: false,
      ownerTimezone: 'UTC',
      ownerEmail: '',
      lastTriggeredAt: 0,
      nextTriggerAt: now - 1000,
      createdAt: now,
      updatedAt: now,
    };

    await insertRule(store.app, base);
    await insertRule(store.app, { ...base, id: 'rule-2', triggerType: 'status-change', nextTriggerAt: 0 });
    await insertRule(store.app, { ...base, id: 'rule-3', status: 'paused', nextTriggerAt: now - 500 });
    await insertRule(store.app, { ...base, id: 'rule-4', ownerId: 'user-2', nextTriggerAt: now - 500 });

    expect((await findTaskRules(store.app, 'user-1')).map((rule) => rule.id).sort())
      .toEqual(['rule-1', 'rule-2']);
    expect((await findDueRules(store.app, now)).map((rule) => rule.id))
      .toEqual(['rule-1', 'rule-4']);
  });

  it('pages databases, rows, fields and views through SQLite', async () => {
    const database: KaizenDatabase = {
      id: 'db-1',
      ownerId: 'user-1',
      name: 'Reading list',
      icon: '📚',
      dateFieldId: 'due-field',
      dbOrder: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    await insertDatabase(store.app, database);

    for (let i = 0; i < 305; i++) {
      const record: DatabaseRow = {
        id: `row-${i}`,
        ownerId: 'user-1',
        databaseId: database.id,
        title: `Row ${i}`,
        rowOrder: i,
        createdAt: i,
        updatedAt: i,
      };
      await insertRow(store.app, record);
    }
    expect((await listRows(store.app, 'user-1', database.id)).length).toBe(305);

    const field: FieldDef = {
      id: 'due-field',
      ownerId: 'user-1',
      databaseId: database.id,
      name: 'Due',
      kind: 'date',
      options: [],
      fieldOrder: 0,
      showOnCard: true,
      createdAt: 1,
      updatedAt: 1,
    };
    await insertDef(store.app, field);
    await setProp(store.app, 'user-1', 'row-0', field.id, '2030-01-01');

    expect((await listDefs(store.app, 'user-1', database.id)).map((def) => def.id)).toEqual(['due-field']);
    expect((await listProps(store.app, 'user-1')).map((prop) => prop.taskId)).toContain('row-0');

    const view: SavedView = {
      id: 'view-1',
      ownerId: 'user-1',
      name: 'Calendar',
      layout: 'calendar',
      scopeListId: '',
      filters: {
        search: '',
        status: '',
        quadrant: '',
        due: '',
        dueAfter: '',
        dueBefore: '',
        sortBy: 'order',
        sortDir: 'asc',
        fields: {},
        groupBy: '',
      },
      showDone: false,
      display: { ...DEFAULT_DISPLAY, order: ['title', 'dueDate'] },
      viewOrder: 0,
      createdAt: 1,
      updatedAt: 1,
    };
    await insertView(store.app, view);
    expect((await listViews(store.app, 'user-1'))[0].display.order).toEqual(['title', 'dueDate']);
  });

  it('reads trial feature flags from SQLite', async () => {
    await store.app.datastore().table(TRIAL_FEATURES_TABLE).insertRow({
      FeatureKey: 'notifications',
      Enabled: 'false',
      UpdatedAt: '1',
    });

    expect(await readTrialFeatures(store.app)).toEqual({
      notifications: false,
      automations: true,
    });
  });
});
