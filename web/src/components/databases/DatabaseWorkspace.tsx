/**
 * One database, open: the view tabs and toolbar, the table or board, the record peek and the new-property
 * menu — with the state that belongs to it (fields, values, sort, filter, hidden columns, saved views).
 *
 * The Databases page shows one of these under its own header; a note shows one inline (`inline`),
 * where the table lives in the note's column instead of running edge to edge.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, Check, ChevronDown, Columns3, Eye, EyeOff, ListFilter, MoreHorizontal, Pencil, Plus, Search, SlidersHorizontal, Table2, Trash2, Type, X } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import { Popover, PopoverAnchor, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { topBarPill, topBarPrimary } from '@/components/shell/TopBar';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { anchorRectOf, type AnchorRect } from '@/components/fields/FieldsManager';
import { NewPropertyMenu } from '@/components/databases/NewPropertyMenu';
import { CHANGE_TYPE_KINDS, KIND_ICON, RecordTable } from '@/components/databases/RecordTable';
import { RecordBoard } from '@/components/databases/RecordBoard';
import { RecordPeek } from '@/components/databases/RecordPeek';
import { useLocalStorage } from '@/hooks/useLocalStorage';
import { useSavedViews } from '@/hooks/useSavedViews';
import { fieldApi, databaseApi, type ApiDatabase, type ApiDatabaseRow, type ApiSavedView, type FieldInput } from '@/lib/api';
import { LatestValueQueue } from '@/lib/latestValueQueue';
import { DEFAULT_FILTERS, FIELD_EMPTY, applyRecordFilters, isGroupableField, knownFieldFilters, matchesFieldFilters } from '@/lib/taskFilters';
import type { FieldDef, FieldValue } from '@/types/fields';
import type { DatabaseTaskLinking } from '@/pages/DatabasesPage';

/** recordId → fieldId → value, the same shape tasks use. */
export type RecordValues = Record<string, Record<string, FieldValue>>;

/**
 * The control that was just clicked, for a popover opened from a menu item —
 * by the time the handler runs, focus is still on it.
 */
function activeAnchor(): AnchorRect | null {
  const el = document.activeElement;
  return el instanceof HTMLElement ? anchorRectOf(el) : null;
}

/** What the workspace reads and writes from useDatabases: the open database's rows, and renaming it. */
export interface DatabaseStore {
  rows: ApiDatabaseRow[];
  rowsLoading: boolean;
  createRow: (input: { title: string }) => Promise<ApiDatabaseRow | null>;
  updateRow: (id: string, input: { title: string }) => Promise<unknown>;
  deleteRow: (id: string) => Promise<unknown>;
  updateDatabase: (id: string, input: { name?: string; icon?: string; titleLabel?: string }) => Promise<unknown>;
}

export interface WorkspaceHeaderContext {
  rowCount: number;
  fieldCount: number;
  /** The "New column" popover, hung from `anchor`. */
  openNewColumn: (anchor: AnchorRect | null) => void;
}

export interface DatabaseWorkspaceProps {
  database: ApiDatabase;
  store: DatabaseStore;
  linking?: DatabaseTaskLinking;
  /** In a note: no page padding, the table stays in the column, the footer line is dropped. */
  inline?: boolean;
  /** The page's own header, drawn above the toolbar with what it needs to say. */
  header?: (ctx: WorkspaceHeaderContext) => ReactNode;
  /** A board opens on the database's first board view (once its views have loaded). */
  startOn?: 'table' | 'board';
}

export function DatabaseWorkspace({ database, store, linking, inline = false, header, startOn }: DatabaseWorkspaceProps) {
  const open = database;
  const { rows, rowsLoading, createRow, updateRow, deleteRow, updateDatabase } = store;
  const notify = useCallback((message: string) => toast.error(message, { duration: 3000 }), []);
  /**
   * The field a database's board groups by. Per database and per device —
   * unlike table/board itself, this isn't part of a saved view's layout.
   */
  const [boardFieldByDatabase, setBoardFieldByDatabase] = useLocalStorage<Record<string, string>>('hitlist-db-board-field-v1', {});

  const [fields, setFields] = useState<FieldDef[]>([]);
  const [values, setValues] = useState<RecordValues>({});
  const valuesRef = useRef<RecordValues>({});
  const valueQueue = useRef(new LatestValueQueue<FieldValue | null | undefined>());
  const updateValues = useCallback((update: (current: RecordValues) => RecordValues) => {
    const next = update(valuesRef.current);
    valuesRef.current = next;
    setValues(next);
  }, []);
  const [fieldsOpen, setFieldsOpen] = useState(false);
  const [fieldsTarget, setFieldsTarget] = useState<{ fieldId?: string; startNew?: boolean }>({});
  /** Where the fields popover hangs from — the control that opened it. */
  const [fieldsAnchor, setFieldsAnchor] = useState<AnchorRect | null>(null);

  // Saved views: tabs like "Needs Revisit" that apply a stored field filter.
  // Shares the same /views the Tasks side uses (Tasks' own views are simply
  // the ones with no scopeDatabaseId), filtered here to this database.
  const savedViews = useSavedViews(notify);
  const viewsForThisDb = useMemo(
    () => savedViews.views.filter((v) => v.scopeDatabaseId === database.id).sort((a, b) => a.viewOrder - b.viewOrder),
    [savedViews.views, database.id],
  );
  const [activeViewId, setActiveViewId] = useState<string | null>(null);
  const [fieldFilters, setFieldFilters] = useState<Record<string, string[]>>({});
  const [search, setSearch] = useState('');
  /** The toolbar's Filter (showcase 727–738): one column, "contains", some text. Ad hoc, like search. */
  const [filterOpen, setFilterOpen] = useState(false);
  /** The record open in the peek panel (the Title cell's page icon). */
  const [peekId, setPeekId] = useState<string | null>(null);
  const [textFilter, setTextFilter] = useState<{ col: string; text: string }>({ col: 'title', text: '' });
  // The column-menu table controls: hidden/sorted/grouped/calculated/frozen/
  // wrapped columns. Ad-hoc per open database for now, same as fieldFilters —
  // not yet round-tripped into a saved view's own stored display.
  const [hiddenFieldIds, setHiddenFieldIds] = useState<string[]>([]);
  const [sort, setSort] = useState<{ fieldId: string; dir: 1 | -1 } | null>(null);
  const [groupFieldId, setGroupFieldId] = useState<string | null>(null);
  const [calc, setCalc] = useState<Record<string, string>>({});
  const [frozenFieldId, setFrozenFieldId] = useState<string | null>(null);
  const [wrapFieldIds, setWrapFieldIds] = useState<string[]>([]);
  // The Title cell's page icon: a per-browser preference (default on), like the other list chrome.
  const [hidePageIcon, setHidePageIcon] = useState<boolean>(() => {
    try { return localStorage.getItem('hitlist.db.hidePageIcon') === '1'; } catch { return false; }
  });
  const togglePageIcon = useCallback(() => {
    setHidePageIcon((prev) => {
      try { localStorage.setItem('hitlist.db.hidePageIcon', prev ? '0' : '1'); } catch { /* storage unavailable: still works for this visit */ }
      return !prev;
    });
  }, []);
  /** fieldId -> px, from the view's long-declared-but-unused display.widths. */
  const [colWidths, setColWidths] = useState<Record<string, number>>({});
  // A different database, or a filter tweaked by hand: no tab is "the" view anymore.
  // The column menu's table controls outlive a visit: they are remembered per database in this
  // browser (a saved view, when one is applied, still carries its own copy).
  type TableControls = {
    hidden: string[]; sort: { fieldId: string; dir: 1 | -1 } | null; groupField: string | null;
    calc: Record<string, string>; frozenFieldId: string | null; wrapFieldIds: string[]; widths: Record<string, number>;
  };
  const [tableMemory, setTableMemory] = useLocalStorage<Record<string, TableControls>>('hitlist-db-table-controls-v1', {});
  const tableMemoryRef = useRef(tableMemory);
  // Declared before the effect that reads it, so it is current when that one runs.
  useEffect(() => { tableMemoryRef.current = tableMemory; });
  const memoryDbRef = useRef<string | null>(null);
  useEffect(() => {
    setActiveViewId(null); setFieldFilters({}); setSearch('');
    const kept = database.id ? tableMemoryRef.current[database.id] : undefined;
    setHiddenFieldIds(kept?.hidden ?? []); setSort(kept?.sort ?? null); setGroupFieldId(kept?.groupField ?? null);
    setCalc(kept?.calc ?? {}); setFrozenFieldId(kept?.frozenFieldId ?? null); setWrapFieldIds(kept?.wrapFieldIds ?? []);
    setColWidths(kept?.widths ?? {});
    memoryDbRef.current = database.id ?? null;
  }, [database.id]);
  useEffect(() => {
    const id = memoryDbRef.current;
    if (!id) return;
    setTableMemory((prev) => ({
      ...prev,
      [id]: { hidden: hiddenFieldIds, sort, groupField: groupFieldId, calc, frozenFieldId, wrapFieldIds, widths: colWidths },
    }));
  }, [hiddenFieldIds, sort, groupFieldId, calc, frozenFieldId, wrapFieldIds, colWidths, setTableMemory]);

  // Layout lives on the view, like Notion's own "Default view / By status
  // board" — not a separate per-device toggle. "Default view" is always table.
  const activeSavedView = viewsForThisDb.find((v) => v.id === activeViewId);
  const view = activeSavedView?.layout === 'board' ? 'board' : 'table';
  const boardField = database.id
    ? fields.find((f) => f.id === boardFieldByDatabase[database.id] && isGroupableField(f)) ?? null
    : null;
  const visibleRows = useMemo(() => {
    let filtered = applyRecordFilters(rows, fieldFilters, fields, values);
    const needle = textFilter.text.trim().toLowerCase();
    if (needle) {
      filtered = filtered.filter((r) => cellText(r, textFilter.col, fields, values).toLowerCase().includes(needle));
    }
    const q = search.trim().toLowerCase();
    if (!q) return filtered;
    return filtered.filter((r) => {
      if (r.title.toLowerCase().includes(q)) return true;
      const rowValues = values[r.id];
      if (!rowValues) return false;
      return fields.some((f) => {
        if (f.kind !== 'text') return false;
        const v = rowValues[f.id];
        return typeof v === 'string' && v.toLowerCase().includes(q);
      });
    });
  }, [rows, fieldFilters, fields, values, search, textFilter]);
  const sortedVisibleRows = useMemo(() => {
    if (!sort) return visibleRows;
    const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' });
    return [...visibleRows].sort((a, b) => {
      // "title" is the Title column, which is not a field.
      const av = sort.fieldId === 'title' ? a.title : values[a.id]?.[sort.fieldId];
      const bv = sort.fieldId === 'title' ? b.title : values[b.id]?.[sort.fieldId];
      if (av === undefined && bv === undefined) return 0;
      if (av === undefined) return 1;
      if (bv === undefined) return -1;
      const cmp = typeof av === 'number' && typeof bv === 'number' ? av - bv : collator.compare(String(av), String(bv));
      return cmp * sort.dir;
    });
  }, [visibleRows, values, sort]);
  // Fields not on the "show/hide" list. A frozen column stays where it is: the table pins
  // Title and everything up to it.
  const tableFields = useMemo(() => fields.filter((f) => !hiddenFieldIds.includes(f.id)), [fields, hiddenFieldIds]);



  // This database's fields and values. Both are the server's: a record's
  // columns are field definitions, and there is no offline copy of those.
  useEffect(() => {
    if (!database.id) { setFields([]); updateValues(() => ({})); return; }
    let cancelled = false;
    Promise.all([fieldApi.listFields(database.id), databaseApi.listFieldValues(database.id)])
      .then(([defs, rawValues]) => {
        if (cancelled) return;
        setFields([...defs].sort((a, b) => a.fieldOrder - b.fieldOrder || a.createdAt - b.createdAt));
        const map: RecordValues = {};
        for (const row of rawValues) {
          if (row.value === null) continue;
          (map[row.recordId] ??= {})[row.fieldId] = row.value;
        }
        updateValues(() => map);
      })
      .catch(() => { if (!cancelled) notify("Couldn't load this database's columns"); });
    return () => { cancelled = true; };
  }, [database.id, notify, updateValues]);

  const setValue = useCallback(async (recordId: string, fieldId: string, value: FieldValue | null) => {
    const before = valuesRef.current[recordId]?.[fieldId];
    const apply = (v: FieldValue | null | undefined) => updateValues((current) => {
      const row = { ...(current[recordId] ?? {}) };
      if (v === null || v === undefined) delete row[fieldId]; else row[fieldId] = v;
      return { ...current, [recordId]: row };
    });

    // A field this active filter checks: warn before the row vanishes from
    // view, since it's about to look exactly like the record was deleted.
    const activeFilters = knownFieldFilters(fieldFilters, fields);
    if (activeFilters.length > 0 && Object.prototype.hasOwnProperty.call(fieldFilters, fieldId)) {
      const currentValues = valuesRef.current[recordId];
      const nextValues = { ...(currentValues ?? {}) };
      if (value === null || value === undefined) delete nextValues[fieldId]; else nextValues[fieldId] = value;
      const wasVisible = matchesFieldFilters(currentValues, activeFilters);
      const staysVisible = matchesFieldFilters(nextValues, activeFilters);
      if (wasVisible && !staysVisible) {
        const record = rows.find((r) => r.id === recordId);
        const field = fields.find((f) => f.id === fieldId);
        toast(`"${record?.title ?? 'This record'}" no longer matches your ${field?.name ?? 'filter'} filter — it's hidden, not deleted. Clear the filter to see it.`, { duration: 4500 });
      }
    }

    await valueQueue.current.submit(
      `${recordId}:${fieldId}`,
      before,
      value,
      async () => (await databaseApi.setFieldValue(recordId, fieldId, value)).value,
      apply,
      () => notify("Couldn't save the value"),
    );
  }, [notify, updateValues, fieldFilters, fields, rows]);

  /** "+ Add" in a board column: create the record, then give it that column's value. */
  const addRecordInColumn = useCallback(async (title: string, columnKey: string) => {
    const created = await createRow({ title });
    if (!created || !boardField || !columnKey) return;
    const value: FieldValue | null =
      columnKey === FIELD_EMPTY ? null
      : boardField.kind === 'checkbox' ? true
      : boardField.kind === 'multi' ? [columnKey]
      : columnKey;
    await setValue(created.id, boardField.id, value);
  }, [createRow, boardField, setValue]);

  /** Insert a blank column right before/after `fieldId` — `handleInsertField`
   * sets this, then the normal FieldsManager create flow below reorders the new
   * column into position. Declared here, above the callback that reads it:
   * a ref mutated by one hook and read by an earlier one trips
   * react-hooks/immutability. */
  const insertTargetRef = useRef<{ fieldId: string; side: 'left' | 'right' } | null>(null);

  const handleCreateField = useCallback(async (input: FieldInput) => {
    if (!database.id) return null;
    try {
      const created = await fieldApi.createField(input, database.id);
      // "Insert left/right" from a column menu: land it beside that column,
      // not at the end — same renumber-everything-that-moved rule as duplicate.
      const insertTarget = insertTargetRef.current;
      insertTargetRef.current = null;
      if (insertTarget) {
        setFields((prev) => {
          const targetIndex = prev.findIndex((f) => f.id === insertTarget.fieldId);
          // Title is always first, so both sides of it land before the first field.
          const insertAt = insertTarget.fieldId === 'title' ? 0 : targetIndex === -1 ? prev.length : insertTarget.side === 'left' ? targetIndex : targetIndex + 1;
          const withoutNew = [...prev].sort((a, b) => a.fieldOrder - b.fieldOrder);
          const originalOrder = new Map(withoutNew.map((f) => [f.id, f.fieldOrder]));
          withoutNew.splice(insertAt, 0, created);
          const renumbered = withoutNew.map((f, idx) => ({ ...f, fieldOrder: idx }));
          void Promise.all(renumbered.map((f, idx) => (
            f.id === created.id || originalOrder.get(f.id) !== idx
              ? fieldApi.updateField(f.id, { name: f.name, kind: f.kind, options: f.options, showOnCard: f.showOnCard, fieldOrder: idx })
              : null
          )));
          return renumbered;
        });
      } else {
        setFields((prev) => [...prev, created].sort((a, b) => a.fieldOrder - b.fieldOrder));
      }
      return created;
    } catch {
      notify("Couldn't create the column");
      return null;
    }
  }, [database.id, notify]);

  const handleUpdateField = useCallback(async (id: string, input: FieldInput) => {
    try {
      const saved = await fieldApi.updateField(id, input);
      setFields((prev) => prev.map((f) => (f.id === id ? saved : f)));
      return saved;
    } catch {
      notify("Couldn't save the column");
      return null;
    }
  }, [notify]);

  /** A column's name, from its header menu. */
  const handleRenameField = useCallback((id: string, name: string) => {
    const f = fields.find((x) => x.id === id);
    if (f) void handleUpdateField(id, { name, kind: f.kind, options: f.options, showOnCard: f.showOnCard });
  }, [fields, handleUpdateField]);

  /** Edit options applies at once: ids are kept (so records keep their values), new ones get none. */
  const handleChangeFieldOptions = useCallback((id: string, options: FieldDef['options']) => {
    const f = fields.find((x) => x.id === id);
    if (!f) return;
    void handleUpdateField(id, {
      name: f.name, kind: f.kind, showOnCard: f.showOnCard,
      options: options.map((o) => ({ id: o.id || undefined, label: o.label, color: o.color })),
    });
  }, [fields, handleUpdateField]);

  /** Changing a column's type never touches a record's stored values — the
   * server just stops decoding ones written under the old kind (cloaked,
   * shown as empty) until this field's kind matches again. Switching back
   * restores them exactly. Options are passed through unchanged so a select/
   * multi field's choices survive a round trip through another kind. */
  const handleChangeFieldKind = useCallback(async (field: FieldDef, kind: FieldDef['kind']) => {
    try {
      const saved = await fieldApi.updateField(field.id, {
        name: field.name, kind, options: field.options, showOnCard: field.showOnCard,
      });
      setFields((prev) => prev.map((f) => (f.id === field.id ? saved : f)));
      // Re-fetch values: some now decode differently (cloaked or uncloaked).
      const raw = database.id ? await databaseApi.listFieldValues(database.id) : [];
      const map: RecordValues = {};
      for (const row of raw) { if (row.value !== null) (map[row.recordId] ??= {})[row.fieldId] = row.value; }
      updateValues(() => map);
    } catch {
      notify("Couldn't change the column's type");
    }
  }, [notify, database.id, updateValues]);

  /** A column was dragged to a new position: reorder locally, then persist each moved field's fieldOrder. */
  const handleReorderFields = useCallback((fieldIds: string[]) => {
    const byId = new Map(fields.map((f) => [f.id, f]));
    const next = fieldIds.map((id) => byId.get(id)).filter((f): f is FieldDef => !!f);
    if (next.length !== fields.length) return;
    setFields(next.map((f, i) => ({ ...f, fieldOrder: i })));
    Promise.all(
      next.map((f, i) => (f.fieldOrder === i ? null : fieldApi.updateField(f.id, {
        name: f.name, kind: f.kind, options: f.options, showOnCard: f.showOnCard, fieldOrder: i,
      }))),
    ).catch(() => notify("Couldn't save the new column order"));
  }, [fields, notify]);

  const handleDeleteField = useCallback(async (id: string) => {
    try {
      await fieldApi.deleteField(id);
      setFields((prev) => prev.filter((f) => f.id !== id));
      updateValues((prev) => Object.fromEntries(
        Object.entries(prev).map(([recordId, row]) => {
          const { [id]: _gone, ...rest } = row;
          return [recordId, rest];
        }),
      ));
      return true;
    } catch {
      notify("Couldn't delete the column");
      return false;
    }
  }, [notify, updateValues]);

  const handleApplyView = useCallback((v: ApiSavedView) => {
    setActiveViewId(v.id);
    setFieldFilters(v.filters.fields ?? {});
    setHiddenFieldIds(v.display.hidden ?? []);
    setSort(v.display.sort ?? null);
    setGroupFieldId(v.display.groupField ?? null);
    setCalc(v.display.calc ?? {});
    setFrozenFieldId(v.display.frozenFieldId ?? null);
    setWrapFieldIds(v.display.wrapFieldIds ?? []);
    setColWidths(v.display.widths ?? {});
    // A board view remembers which column its lanes come from (older ones do not: they keep the
    // database's last choice).
    const lanes = v.layout === 'board' ? v.filters.groupBy : '';
    const dbId = v.scopeDatabaseId ?? database.id;
    if (lanes && dbId) setBoardFieldByDatabase((prev) => ({ ...prev, [dbId]: lanes }));
  }, [database.id, setBoardFieldByDatabase]);

  const handleClearView = useCallback(() => {
    setActiveViewId(null);
    setFieldFilters({});
    setHiddenFieldIds([]); setSort(null); setGroupFieldId(null); setCalc({}); setFrozenFieldId(null); setWrapFieldIds([]);
  }, []);

  const handleChangeFieldFilter = useCallback((fieldId: string, choices: string[]) => {
    setActiveViewId(null);
    setFieldFilters((prev) => ({ ...prev, [fieldId]: choices }));
  }, []);

  const handleCreateView = useCallback(async (name: string, layout: 'table' | 'board') => {
    if (!database.id) return;
    const created = await savedViews.createView({
      name,
      layout,
      scopeListId: null,
      scopeDatabaseId: database.id,
      filters: {
        ...DEFAULT_FILTERS,
        fields: fieldFilters,
        groupBy: layout === 'board' ? (boardField?.id ?? fields.find(isGroupableField)?.id ?? '') : '',
      },
      showDone: false,
      display: {
        hidden: hiddenFieldIds, order: [], widths: colWidths,
        sort, groupField: groupFieldId, calc, frozenFieldId, wrapFieldIds,
      },
    });
    if (!created) return;
    setActiveViewId(created.id);
    toast.success(`Created "${created.name}"`, { duration: 2000 });
  }, [database.id, savedViews, fieldFilters, hiddenFieldIds, sort, groupFieldId, calc, frozenFieldId, wrapFieldIds, colWidths, boardField, fields]);

  /** These table controls changed while a saved view is applied: persist them
   * back to that view immediately, matching how picking a tag or filter
   * writes straight through rather than needing a separate "save" step. */
  const persistTableControls = useCallback((next: Partial<{
    hidden: string[]; sort: typeof sort; groupField: string | null; calc: Record<string, string>;
    frozenFieldId: string | null; wrapFieldIds: string[]; widths: Record<string, number>;
  }>) => {
    if (!activeSavedView) return;
    void savedViews.updateView(activeSavedView.id, {
      name: activeSavedView.name,
      layout: activeSavedView.layout,
      scopeListId: activeSavedView.scopeListId,
      scopeDatabaseId: activeSavedView.scopeDatabaseId,
      filters: activeSavedView.filters,
      showDone: activeSavedView.showDone,
      display: {
        hidden: next.hidden ?? activeSavedView.display.hidden,
        order: activeSavedView.display.order,
        widths: next.widths ?? activeSavedView.display.widths,
        sort: next.sort !== undefined ? next.sort : (activeSavedView.display.sort ?? null),
        groupField: next.groupField !== undefined ? next.groupField : (activeSavedView.display.groupField ?? null),
        calc: next.calc ?? activeSavedView.display.calc ?? {},
        frozenFieldId: next.frozenFieldId !== undefined ? next.frozenFieldId : (activeSavedView.display.frozenFieldId ?? null),
        wrapFieldIds: next.wrapFieldIds ?? activeSavedView.display.wrapFieldIds ?? [],
      },
    });
  }, [activeSavedView, savedViews]);

  const handleHideField = useCallback((fieldId: string) => {
    setHiddenFieldIds((prev) => {
      const next = prev.includes(fieldId) ? prev : [...prev, fieldId];
      persistTableControls({ hidden: next });
      return next;
    });
  }, [persistTableControls]);

  const handleShowField = useCallback((fieldId: string) => {
    setHiddenFieldIds((prev) => {
      const next = prev.filter((id) => id !== fieldId);
      persistTableControls({ hidden: next });
      return next;
    });
  }, [persistTableControls]);

  const handleSortField = useCallback((fieldId: string, dir: 1 | -1) => {
    const next = { fieldId, dir };
    setSort(next);
    persistTableControls({ sort: next });
  }, [persistTableControls]);

  const handleClearSort = useCallback(() => {
    setSort(null);
    persistTableControls({ sort: null });
  }, [persistTableControls]);

  const handleGroupField = useCallback((fieldId: string) => {
    setGroupFieldId((prev) => {
      const next = prev === fieldId ? null : fieldId;
      persistTableControls({ groupField: next });
      return next;
    });
  }, [persistTableControls]);

  const handleCalcField = useCallback((fieldId: string, key: string) => {
    setCalc((prev) => {
      const next = { ...prev };
      if (key) next[fieldId] = key; else delete next[fieldId];
      persistTableControls({ calc: next });
      return next;
    });
  }, [persistTableControls]);

  const handleFreezeField = useCallback((fieldId: string) => {
    setFrozenFieldId((prev) => {
      const next = prev === fieldId ? null : fieldId;
      persistTableControls({ frozenFieldId: next });
      return next;
    });
  }, [persistTableControls]);

  const handleWrapField = useCallback((fieldId: string) => {
    setWrapFieldIds((prev) => {
      const next = prev.includes(fieldId) ? prev.filter((id) => id !== fieldId) : [...prev, fieldId];
      persistTableControls({ wrapFieldIds: next });
      return next;
    });
  }, [persistTableControls]);

  const handleResizeField = useCallback((fieldId: string, width: number) => {
    setColWidths((prev) => {
      const next = { ...prev, [fieldId]: width };
      persistTableControls({ widths: next });
      return next;
    });
  }, [persistTableControls]);

  const handleInsertField = useCallback((fieldId: string, side: 'left' | 'right') => {
    insertTargetRef.current = { fieldId, side };
    setFieldsAnchor(activeAnchor());
   
    setFieldsOpen(true);
  }, []);

  const handleDuplicateField = useCallback(async (field: FieldDef) => {
    if (!database.id) return;
    const created = await fieldApi.createField({
      name: `${field.name} copy`, kind: field.kind, options: field.options, showOnCard: field.showOnCard,
    }, database.id);
    if (!created) return;
    const i = fields.findIndex((f) => f.id === field.id);
    const reordered = [...fields];
    reordered.splice(i + 1, 0, created);
    const originalOrder = new Map(fields.map((f) => [f.id, f.fieldOrder]));
    const renumbered = reordered.map((f, idx) => ({ ...f, fieldOrder: idx }));
    setFields(renumbered);
    // Every field whose position actually moved needs its new fieldOrder saved —
    // not just the new one, or the order wouldn't survive a reload.
    await Promise.all(renumbered.map((f, idx) => (
      f.id === created.id || originalOrder.get(f.id) !== idx
        ? fieldApi.updateField(f.id, { name: f.name, kind: f.kind, options: f.options, showOnCard: f.showOnCard, fieldOrder: idx })
        : null
    )));
    await Promise.all(rows.map(async (row) => {
      const v = valuesRef.current[row.id]?.[field.id];
      if (v === undefined) return;
      await databaseApi.setFieldValue(row.id, created.id, v);
      updateValues((prev) => ({ ...prev, [row.id]: { ...prev[row.id], [created.id]: v } }));
    }));
  }, [database.id, rows, fields, updateValues]);

  const handleDeleteView = useCallback(async (v: ApiSavedView) => {
    const ok = await savedViews.deleteView(v.id);
    if (!ok) return;
    if (activeViewId === v.id) handleClearView();
    toast(`Deleted view "${v.name}"`, { duration: 2000 });
  }, [savedViews, activeViewId, handleClearView]);


  // A block made with "Create board" opens on its board view, once — after that the tabs are the user's.
  const startedRef = useRef(false);
  useEffect(() => {
    if (startOn !== 'board' || startedRef.current || activeViewId) return;
    const board = viewsForThisDb.find((v) => v.layout === 'board');
    if (!board) return;
    startedRef.current = true;
    handleApplyView(board);
  }, [startOn, viewsForThisDb, activeViewId, handleApplyView]);

  const toolbar = (
    <>
      {/* One 36px row (showcase 601–612): view chips, the active sort / filter pills, then
          Filter · Sort · Search · Properties and a primary "New" that adds a record. */}
      <div className="relative mb-2 flex h-9 items-center gap-1">
        <DatabaseViewTabs
          views={viewsForThisDb}
          activeViewId={activeViewId}
          hasAdHocFilter={Object.values(fieldFilters).some((choices) => choices.length > 0)}
          online={savedViews.online}
          onApply={handleApplyView}
          onClear={handleClearView}
          onCreate={handleCreateView}
          onDelete={handleDeleteView}
        />
        <SortPill fields={fields} titleLabel={open.titleLabel} sort={sort} onClear={handleClearSort} />
        <FilterPill
          fields={fields}
          fieldFilters={fieldFilters}
          textFilter={textFilter}
          onClear={() => {
            setTextFilter((prev) => ({ ...prev, text: '' }));
            fields.forEach((f) => { if ((fieldFilters[f.id] ?? []).length) handleChangeFieldFilter(f.id, []); });
          }}
        />
        <div className="flex-1" />
        <FilterButton
          open={filterOpen}
          onOpenChange={setFilterOpen}
          fields={fields}
          titleLabel={open.titleLabel}
          filter={textFilter}
          onFilterChange={setTextFilter}
          matching={visibleRows.length}
          total={rows.length}
          active={textFilter.text.trim() !== '' || Object.values(fieldFilters).some((c) => c.length > 0)}
        />
        <SortButton fields={fields} titleLabel={open.titleLabel} sort={sort} onSort={handleSortField} onClear={handleClearSort} />
        <SearchButton value={search} onChange={setSearch} />
        <PropertiesButton fields={fields} titleLabel={open.titleLabel} hiddenFieldIds={hiddenFieldIds} onShow={handleShowField} onHide={handleHideField} onShowAll={() => hiddenFieldIds.forEach((id) => handleShowField(id))}
          lanes={view === 'board' ? { fields: fields.filter(isGroupableField), value: boardField?.id ?? '', onChange: (fieldId) => setBoardFieldByDatabase((prev) => ({ ...prev, [open.id]: fieldId })) } : undefined} />
        <button
          type="button"
          onClick={() => { void createRow({ title: 'Untitled' }); }}
          className={cn(topBarPrimary, 'ml-1')}
        >
          New
          <ChevronDown className="size-4" strokeWidth={1.75} aria-hidden />
        </button>
      </div>

      {view === 'board' ? (
        <RecordBoard
          rows={sortedVisibleRows}
          fields={fields}
          values={values}
          groupField={boardField}
          onGroupFieldChange={(fieldId) => setBoardFieldByDatabase((prev) => ({ ...prev, [open.id]: fieldId }))}
          onManageFields={() => { setFieldsAnchor(activeAnchor()); setFieldsOpen(true); }}
          onSetValue={(recordId, fieldId, value) => { void setValue(recordId, fieldId, value); }}
          onAdd={(title, columnKey) => { void addRecordInColumn(title, columnKey); }}
        />
      ) : (
        <RecordTable
          inline={inline}
          rows={sortedVisibleRows}
          fields={tableFields}
          titleLabel={open.titleLabel}
          onRenameTitleLabel={(label) => { void updateDatabase(open.id, { titleLabel: label }); }}
          values={values}
          loading={rowsLoading}
          linking={linking}
          onAdd={(title) => { void createRow({ title }); }}
          onRename={(recordId, title) => { void updateRow(recordId, { title }); }}
          onDelete={(recordId) => { void deleteRow(recordId); }}
          onSetValue={(recordId, fieldId, value) => { void setValue(recordId, fieldId, value); }}
          onRenameField={handleRenameField}
          onChangeFieldOptions={handleChangeFieldOptions}
          onFilterField={(fieldId) => { setTextFilter((prev) => ({ ...prev, col: fieldId })); setFilterOpen(true); }}
          onDeleteField={(fieldId) => { void handleDeleteField(fieldId); }}
          onCreateField={() => { setFieldsAnchor(activeAnchor()); setFieldsOpen(true); }}
          onReorderFields={handleReorderFields}
          sort={sort}
          onSortField={handleSortField}
          onClearSort={handleClearSort}
          groupFieldId={groupFieldId}
          onGroupField={handleGroupField}
          calc={calc}
          onCalcField={handleCalcField}
          frozenFieldId={frozenFieldId}
          onOpenRecord={setPeekId}
          showPageIcon={!hidePageIcon}
          onTogglePageIcon={togglePageIcon}
          onFreezeField={handleFreezeField}
          wrapFieldIds={wrapFieldIds}
          onWrapField={handleWrapField}
          colWidths={colWidths}
          onResizeField={handleResizeField}
          onHideField={handleHideField}
          onInsertField={handleInsertField}
          onDuplicateField={(field) => { void handleDuplicateField(field); }}
          onChangeFieldKind={(field, kind) => { void handleChangeFieldKind(field, kind); }}
        />
      )}
    </>
  );

  return (
    <>
      {header?.({ rowCount: rows.length, fieldCount: fields.length, openNewColumn: (anchor) => { setFieldsAnchor(anchor); setFieldsOpen(true); } })}
      {inline ? (
        <div>{toolbar}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden">
          <div className="px-4 pt-4 pb-12 md:px-12">
            {toolbar}
            <p className="mt-[13px] text-[12px] text-a-faint">
              No reminders or automations here — those live on tasks.
            </p>
          </div>
        </div>
      )}

      {peekId && rows.some((r) => r.id === peekId) && (
        <RecordPeek
          record={rows.find((r) => r.id === peekId)!}
          databaseName={open.name}
          fields={tableFields}
          values={values[peekId]}
          linking={linking}
          onClose={() => setPeekId(null)}
          onRename={(title) => { void updateRow(peekId, { title }); }}
          onSetValue={(fieldId, value) => { void setValue(peekId, fieldId, value); }}
          onDelete={() => { void deleteRow(peekId); setPeekId(null); }}
        />
      )}

      <NewPropertyMenu
        open={fieldsOpen}
        onOpenChange={setFieldsOpen}
        anchor={fieldsAnchor}
        kinds={CHANGE_TYPE_KINDS}
        kindIcon={KIND_ICON}
        onCreate={handleCreateField}
      />
    </>
  );
}

interface DatabaseViewTabsProps {
  views: ApiSavedView[];
  activeViewId: string | null;
  /** An unsaved per-field filter is narrowing the table, with no tab "owning" it. */
  hasAdHocFilter: boolean;
  online: boolean;
  onApply: (view: ApiSavedView) => void;
  onClear: () => void;
  onCreate: (name: string, layout: 'table' | 'board') => Promise<void>;
  onDelete: (view: ApiSavedView) => void;
}

/** DS IconButton sm: 28px, 4px radius, secondary ink, a --gray-100 wash on hover. */
const ICON_BUTTON = 'flex size-7 flex-shrink-0 items-center justify-center rounded-[4px] transition-colors duration-[120ms]';
const ICON_BUTTON_IDLE = 'text-a-muted hover:bg-a-line-soft hover:text-a-ink';

const TAB = cn(
  'flex h-8 flex-shrink-0 items-center gap-2 rounded-[8px] px-3 text-[14px] whitespace-nowrap transition-colors duration-[120ms]',
);

/** table-2 / columns-3 — the showcase's literal per-layout icon (line 1751). */
const LAYOUT_ICON = { table: Table2, board: Columns3 } as const;

/**
 * "Default" + one pill per saved view — Notion's "Default view / Needs
 * Revisit / By Status Board" row. A tab applies its stored field filter and
 * switches to its own layout; "+" saves whatever the filter row below is
 * currently set to as a new one.
 */
function DatabaseViewTabs({ views, activeViewId, hasAdHocFilter, online, onApply, onClear, onCreate, onDelete }: DatabaseViewTabsProps) {
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const isDefault = activeViewId === null && !hasAdHocFilter;

  return (
    <div className="flex min-w-0 flex-shrink items-center gap-1">
      <button
        type="button"
        onClick={onClear}
        aria-current={isDefault ? 'true' : undefined}
        title={activeViewId === null && hasAdHocFilter ? 'A field filter below is narrowing this table — click to clear it' : undefined}
        className={cn(TAB, isDefault ? 'bg-a-blue-tint font-semibold text-a-accent' : 'font-medium text-a-faint hover:bg-a-line-soft')}
      >
        <Table2 className="size-4" strokeWidth={1.75} aria-hidden />
        Default view
      </button>
      {views.map((v) => {
        const active = v.id === activeViewId;
        const LayoutIcon = LAYOUT_ICON[v.layout === 'board' ? 'board' : 'table'];
        return (
          <div key={v.id} className="group relative">
            <button
              type="button"
              onClick={() => onApply(v)}
              aria-current={active ? 'true' : undefined}
              className={cn(TAB, 'pr-6', active ? 'bg-a-blue-tint font-semibold text-a-accent' : 'font-medium text-a-faint hover:bg-a-line-soft')}
            >
              <LayoutIcon className="size-4" strokeWidth={1.75} aria-hidden />
              {v.name}
            </button>
            <DropdownMenu onOpenChange={(isOpen) => { if (!isOpen) setConfirmDeleteId(null); }}>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  aria-label={`Options for view ${v.name}`}
                  className="absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded-[4px] text-a-faint opacity-0 transition-opacity duration-[120ms] group-hover:opacity-100 hover:text-a-ink"
                >
                  <X className="size-3" strokeWidth={1.75} />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-48">
                {confirmDeleteId === v.id ? (
                  <DropdownMenuItem variant="destructive" onClick={() => onDelete(v)}>
                    <Trash2 className="size-3.5" /> Delete for good
                  </DropdownMenuItem>
                ) : (
                  <DropdownMenuItem variant="destructive" onSelect={(e) => { e.preventDefault(); setConfirmDeleteId(v.id); }}>
                    <Trash2 className="size-3.5" /> Delete view…
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        );
      })}
      {online && <NewViewButton onCreate={onCreate} />}
    </div>
  );
}

function NewViewButton({ onCreate }: { onCreate: (name: string, layout: 'table' | 'board') => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [layout, setLayout] = useState<'table' | 'board'>('table');
  const [saving, setSaving] = useState(false);

  const submit = async () => {
    const trimmed = name.trim();
    if (!trimmed || saving) return;
    setSaving(true);
    await onCreate(trimmed, layout);
    setSaving(false);
    setName('');
    setLayout('table');
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Save the current filter as a new view"
          className={cn(ICON_BUTTON, ICON_BUTTON_IDLE)}
        >
          <Plus className="size-4" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[260px] p-3">
        <div className="space-y-2.5">
          <p className="text-[11px] text-a-muted">Saves the filters below as a new tab.</p>
          <Input
            autoFocus
            value={name}
            maxLength={100}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') void submit(); }}
            placeholder="e.g. Needs Revisit"
            aria-label="View name"
            className="h-8 rounded-[4px] text-[14px]"
          />
          <div role="radiogroup" aria-label="Layout" className="flex gap-1.5">
            {([['table', Table2, 'Table'], ['board', Columns3, 'Board']] as const).map(([value, Icon, label]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={layout === value}
                onClick={() => setLayout(value)}
                className={cn(
                  'flex h-8 flex-1 items-center justify-center gap-1.5 rounded-[8px] text-[13px] font-medium transition-colors duration-[120ms]',
                  layout === value ? 'bg-a-accent-tint text-a-accent-700' : 'text-a-faint hover:bg-a-row-hover hover:text-a-ink',
                )}
              >
                <Icon className="size-4" strokeWidth={1.75} aria-hidden />
                {label}
              </button>
            ))}
          </div>
          <button
            type="button"
            onClick={() => void submit()}
            disabled={!name.trim() || saving}
            className="h-8 w-full rounded-[6px] bg-a-accent text-[14px] font-semibold text-a-surface transition-colors duration-[120ms] hover:bg-a-accent-600 disabled:opacity-50"
          >
            {saving ? <Check className="mx-auto size-3.5 animate-pulse" /> : 'Save as view'}
          </button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/**
 * Filter records (showcase 727–738): choose a column, "contains", type a value. The column is
 * the title or any field; a select or multi-select matches on its option names.
 */
function FilterButton({
  open, onOpenChange, fields, titleLabel, filter, onFilterChange, matching, total, active,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  fields: FieldDef[];
  titleLabel: string;
  filter: { col: string; text: string };
  onFilterChange: (filter: { col: string; text: string }) => void;
  matching: number;
  total: number;
  active: boolean;
}) {
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      {TOOLBAR_RIGHT_ANCHOR}
      <button
        type="button"
        data-toolbar-trigger
        aria-label={`Filter${active ? ' (active)' : ''}`}
        aria-expanded={open}
        onClick={() => onOpenChange(!open)}
        className={cn(ICON_BUTTON, active || open ? 'bg-a-blue-tint text-a-accent' : ICON_BUTTON_IDLE)}
      >
        <ListFilter className="size-4" strokeWidth={1.75} />
      </button>
      <PopoverContent role="dialog" aria-label="Filter" align="end" sideOffset={-2} onInteractOutside={ignoreOwnButton} className="w-[340px] gap-2.5 p-3">
        <span className="font-semibold text-a-ink">Filter records</span>
        <div className="grid grid-cols-2 gap-2">
          <Select value={filter.col} onValueChange={(col) => onFilterChange({ ...filter, col })}>
            <SelectTrigger size="sm" className="w-full" aria-label="Column">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="title">{titleLabel}</SelectItem>
              {fields.map((f) => <SelectItem key={f.id} value={f.id}>{f.name}</SelectItem>)}
            </SelectContent>
          </Select>
          <div className="flex h-7 items-center rounded-[4px] border border-a-line bg-a-bg px-2.5 text-a-muted">contains</div>
        </div>
        <Input
          className="h-7 px-2"
          value={filter.text}
          onChange={(e) => onFilterChange({ ...filter, text: e.target.value })}
          placeholder="Type a value…"
          aria-label="Filter value"
          autoFocus
        />
        <div className="flex items-center justify-between">
          <span className="text-[12px] text-a-faint">{filter.text.trim() ? `${matching} of ${total} records` : `${total} record${total === 1 ? '' : 's'}`}</span>
          <button type="button" className={topBarPill} onClick={() => onFilterChange({ ...filter, text: '' })}>Clear filter</button>
        </div>
      </PopoverContent>
    </Popover>
  );
}

/** The text a record shows in one column — what "contains" searches. */
function cellText(row: ApiDatabaseRow, col: string, fields: FieldDef[], values: RecordValues): string {
  if (col === 'title') return row.title;
  const f = fields.find((x) => x.id === col);
  const v = values[row.id]?.[col];
  if (!f || v === undefined || v === null) return '';
  if (f.kind === 'select' || f.kind === 'multi') {
    const ids = Array.isArray(v) ? v : [String(v)];
    return ids.map((id) => f.options.find((o) => o.id === id)?.label ?? '').join(' ');
  }
  if (f.kind === 'checkbox') return v ? 'Yes' : 'No';
  return String(v);
}

/**
 * A toolbar popover is controlled, with a plain button: Radix drops a custom anchor when the
 * popover also has a PopoverTrigger, and these hang from the toolbar's right edge, not from the
 * button. Clicks on the button itself must not count as "outside", or it could never close.
 */
const ignoreOwnButton = (e: Event) => {
  if ((e.target as HTMLElement | null)?.closest?.('[data-toolbar-trigger]')) e.preventDefault();
};

/** The toolbar's right edge: Filter, Sort and Properties all hang from it (showcase `top:34px; right:0`). */
const TOOLBAR_RIGHT_ANCHOR = <PopoverAnchor asChild><span aria-hidden className="pointer-events-none absolute right-0 bottom-0 h-px w-px" /></PopoverAnchor>;

/** Sort by (showcase 716–726): each column with an ascending and a descending button. */
function SortButton({
  fields, titleLabel, sort, onSort, onClear,
}: { fields: FieldDef[]; titleLabel: string; sort: { fieldId: string; dir: 1 | -1 } | null; onSort: (fieldId: string, dir: 1 | -1) => void; onClear: () => void }) {
  const [open, setOpen] = useState(false);
  const rows = [{ id: 'title', name: titleLabel, Icon: Type }, ...fields.map((f) => ({ id: f.id, name: f.name, Icon: KIND_ICON[f.kind] }))];
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {TOOLBAR_RIGHT_ANCHOR}
      <button
        type="button"
        data-toolbar-trigger
        aria-label="Sort"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(ICON_BUTTON, sort || open ? 'bg-a-blue-tint text-a-accent' : ICON_BUTTON_IDLE)}
      >
        <ArrowUpDown className="size-4" strokeWidth={1.75} />
      </button>
      <PopoverContent role="dialog" aria-label="Sort" align="end" sideOffset={-2} onInteractOutside={ignoreOwnButton} className="w-[270px] gap-0 p-1.5 text-[14px]">
        <div className="px-2 py-1.5 font-semibold text-a-ink">Sort by</div>
        {rows.map(({ id, name, Icon }) => (
          <div key={id} className="flex min-h-[30px] items-center gap-2 px-2 py-0.5">
            <Icon className="size-[15px] flex-shrink-0 text-a-faint" strokeWidth={1.75} aria-hidden />
            <span className="flex-1 text-[13px] text-a-ink">{name}</span>
            {([1, -1] as const).map((dir) => {
              const on = sort?.fieldId === id && sort.dir === dir;
              const Arrow = dir === 1 ? ArrowUp : ArrowDown;
              return (
                <button
                  key={dir}
                  type="button"
                  aria-label={`${name} ${dir === 1 ? 'ascending' : 'descending'}`}
                  aria-pressed={on}
                  onClick={() => (on ? onClear() : onSort(id, dir))}
                  className={cn(ICON_BUTTON, on ? 'bg-a-blue-tint text-a-accent' : ICON_BUTTON_IDLE)}
                >
                  <Arrow className="size-4" strokeWidth={1.75} />
                </button>
              );
            })}
          </div>
        ))}
      </PopoverContent>
    </Popover>
  );
}

/** "Sorted by X ×" — showcase 604: a 24px pill in the brand tint. */
function SortPill({ fields, titleLabel, sort, onClear }: { fields: FieldDef[]; titleLabel: string; sort: { fieldId: string; dir: 1 | -1 } | null; onClear: () => void }) {
  const name = !sort ? null : sort.fieldId === 'title' ? titleLabel : fields.find((f) => f.id === sort.fieldId)?.name ?? null;
  if (!name) return null;
  return <ActivePill label={`Sorted by ${name}`} removeLabel="Remove sort" onClear={onClear} />;
}

/** The filter pill (showcase 605): what is filtering, and ×. */
function FilterPill({ fields, fieldFilters, textFilter, onClear }: {
  fields: FieldDef[]; fieldFilters: Record<string, string[]>; textFilter: { col: string; text: string }; onClear: () => void;
}) {
  const text = textFilter.text.trim();
  if (text) {
    const colName = textFilter.col === 'title' ? 'Title' : fields.find((f) => f.id === textFilter.col)?.name ?? 'Column';
    return <ActivePill label={`${colName} contains “${text}”`} removeLabel="Remove filter" onClear={onClear} />;
  }
  const active = fields.filter((f) => (fieldFilters[f.id] ?? []).length > 0);
  if (active.length === 0) return null;
  const first = active[0];
  const labels = (fieldFilters[first.id] ?? []).map((c) => first.options.find((o) => o.id === c)?.label ?? (c === FIELD_EMPTY ? 'Empty' : c)).join(', ');
  const extra = active.length > 1 ? ` +${active.length - 1}` : '';
  return <ActivePill label={`${first.name}: ${labels}${extra}`} removeLabel="Remove filter" onClear={onClear} />;
}

function ActivePill({ label, removeLabel, onClear }: { label: string; removeLabel: string; onClear: () => void }) {
  return (
    // design-check-ignore: pill — showcase 604 draws these at border-radius:99px.
    <span className="inline-flex h-6 flex-shrink-0 items-center gap-1.5 rounded-full bg-a-blue-tint pr-1.5 pl-2 text-[12px] font-medium whitespace-nowrap text-a-accent-700">
      {label}
      <button type="button" aria-label={removeLabel} onClick={onClear} className="inline-flex p-0.5">
        <X className="size-3" strokeWidth={1.75} />
      </button>
    </span>
  );
}

/** Filters visible rows by title, or a text field's value — the showcase's "search" toolbar icon (line 609). */
function SearchButton({ value, onChange }: { value: string; onChange: (value: string) => void }) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label={`Search records${value ? ` (searching "${value}")` : ''}`}
          className={cn(
            ICON_BUTTON,
            value ? 'bg-a-blue-tint text-a-accent' : ICON_BUTTON_IDLE,
          )}
        >
          <Search className="size-4" strokeWidth={1.75} />
        </button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-64 p-2">
        <Input
          autoFocus
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder="Search records…"
          aria-label="Search records"
          className="h-8 text-[14px]"
        />
      </PopoverContent>
    </Popover>
  );
}

/** Properties (showcase 707–715): every column with an eye, and "Show all". */
function PropertiesButton({
  fields, titleLabel, hiddenFieldIds, onShow, onHide, onShowAll, lanes,
}: {
  fields: FieldDef[]; titleLabel: string; hiddenFieldIds: string[]; onShow: (id: string) => void; onHide: (id: string) => void; onShowAll: () => void;
  /** Board layout only: which column the lanes come from (the prototype fixes this per view; here it can change). */
  lanes?: { fields: FieldDef[]; value: string; onChange: (fieldId: string) => void };
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      {TOOLBAR_RIGHT_ANCHOR}
      <button
        type="button"
        data-toolbar-trigger
        aria-label={`Show or hide columns${hiddenFieldIds.length ? ` (${hiddenFieldIds.length} hidden)` : ''}`}
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={cn(ICON_BUTTON, hiddenFieldIds.length || open ? 'bg-a-blue-tint text-a-accent' : ICON_BUTTON_IDLE)}
      >
        <SlidersHorizontal className="size-4" strokeWidth={1.75} />
      </button>
      <PopoverContent role="dialog" aria-label="Properties" align="end" sideOffset={-2} onInteractOutside={ignoreOwnButton} className="w-[270px] gap-0 p-1.5 text-[14px]">
        <div className="flex items-center px-2 py-1.5">
          <span className="flex-1 font-semibold text-a-ink">Properties</span>
          <button type="button" onClick={onShowAll} className="text-[13px] text-a-accent-600 hover:underline">Show all</button>
        </div>
        {/* The title is always shown. */}
        <div className="flex min-h-[30px] items-center gap-2.5 px-2 py-[5px] text-a-ink">
          <Type className="size-[15px] flex-shrink-0 text-a-faint" strokeWidth={1.75} aria-hidden />
          <span className="flex-1">{titleLabel}</span>
          <Eye className="size-4 text-a-faint" strokeWidth={1.75} aria-hidden />
        </div>
        {fields.map((f) => {
          const hidden = hiddenFieldIds.includes(f.id);
          const Icon = KIND_ICON[f.kind];
          return (
            <button
              key={f.id}
              type="button"
              onClick={() => (hidden ? onShow(f.id) : onHide(f.id))}
              className="flex min-h-[30px] w-full items-center gap-2.5 rounded-[4px] px-2 py-[5px] text-left leading-[normal] text-a-ink transition-colors duration-[120ms] hover:bg-a-line-soft"
            >
              <Icon className="size-[15px] flex-shrink-0 text-a-faint" strokeWidth={1.75} aria-hidden />
              <span className="flex-1">{f.name}</span>
              {hidden ? <EyeOff className="size-4 text-a-faint" strokeWidth={1.75} /> : <Eye className="size-4 text-a-faint" strokeWidth={1.75} />}
            </button>
          );
        })}
        {lanes && lanes.fields.length > 0 && (
          <>
            <div className="my-1 h-px bg-a-line-soft" />
            <div className="px-2 py-1.5 text-[12px] text-a-faint">Board columns come from</div>
            {lanes.fields.map((f) => (
              <button
                key={f.id}
                type="button"
                onClick={() => lanes.onChange(f.id)}
                className="flex min-h-[30px] w-full items-center gap-2.5 rounded-[4px] px-2 py-[5px] text-left leading-[normal] text-a-ink transition-colors duration-[120ms] hover:bg-a-line-soft"
              >
                <span className="flex-1">{f.name}</span>
                {lanes.value === f.id && <Check className="size-[15px] text-a-accent" strokeWidth={1.75} aria-hidden />}
              </button>
            ))}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
