/**
 * The database a note's "Create database" / "Create board" makes: the prototype's blank one (showcase
 * 373–380) — a Name column, Tags, Status and Date, and three empty "Untitled" records. A board also gets
 * a "By status board" view, so the block can open on it.
 */
import { databaseApi, fieldApi, viewApi, type ApiDatabase } from '@/lib/api';
import { DEFAULT_FILTERS } from '@/lib/taskFilters';

export type InlineLayout = 'table' | 'board';

export async function createInlineDatabase(layout: InlineLayout): Promise<ApiDatabase> {
  const db = await databaseApi.create({ name: 'Untitled database', icon: '', titleLabel: 'Name' });
  await fieldApi.createField({
    name: 'Tags', kind: 'multi', showOnCard: true,
    options: [{ label: 'Idea', color: 'purple' }, { label: 'Research', color: 'blue' }, { label: 'Draft', color: 'yellow' }],
  }, db.id);
  const status = await fieldApi.createField({
    name: 'Status', kind: 'select',
    options: [{ label: 'Not started', color: 'gray' }, { label: 'In progress', color: 'blue' }, { label: 'Done', color: 'green' }],
  }, db.id);
  await fieldApi.createField({ name: 'Date', kind: 'date' }, db.id);
  for (let i = 0; i < 3; i++) await databaseApi.createRow(db.id, { title: 'Untitled' });
  if (layout === 'board') {
    await viewApi.create({
      name: 'By status board', layout: 'board', scopeListId: null, scopeDatabaseId: db.id,
      filters: { ...DEFAULT_FILTERS, groupBy: status.id }, showDone: false,
    });
  }
  return db;
}
