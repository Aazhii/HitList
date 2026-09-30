/** "Linked view of a database": the databases there are, to pick one from. Opens where the slash menu was. */
import { useEffect, useState } from 'react';
import { Table2 } from 'lucide-react';
import { databaseApi, type ApiDatabase } from '@/lib/api';

export function DatabasePicker({
  position, onPick, onClose,
}: { position: { top: number; left: number }; onPick: (database: ApiDatabase) => void; onClose: () => void }) {
  const [databases, setDatabases] = useState<ApiDatabase[] | null>(null);

  useEffect(() => {
    let live = true;
    databaseApi.list().then((all) => { if (live) setDatabases(all); }).catch(() => { if (live) setDatabases([]); });
    return () => { live = false; };
  }, []);

  useEffect(() => {
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest('[data-db-picker]')) onClose(); };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    // Attached a tick late: the press that chose "Linked view" is still travelling and would close this at once.
    const attach = window.setTimeout(() => document.addEventListener('mousedown', onDown), 0);
    document.addEventListener('keydown', onKey);
    return () => { window.clearTimeout(attach); document.removeEventListener('mousedown', onDown); document.removeEventListener('keydown', onKey); };
  }, [onClose]);

  return (
    <div
      data-db-picker
      role="listbox"
      aria-label="Databases"
      className="fixed z-50 max-h-[320px] w-[300px] overflow-auto rounded-[8px] border border-a-line bg-a-surface p-1.5 text-[14px] text-a-ink shadow-[var(--a-shadow-lg)] animate-fade-in"
      style={{ top: position.top, left: Math.max(8, position.left) }}
    >
      <p className="px-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.06em] text-a-faint">Link a database</p>
      {databases === null && <p className="px-2 py-2 text-[13px] text-a-faint">Loading…</p>}
      {databases?.length === 0 && <p className="px-2 py-2 text-[13px] text-a-faint">No databases yet. Create one from the Databases page, or with Create database.</p>}
      {databases?.map((d) => (
        <button
          key={d.id}
          type="button"
          role="option"
          aria-selected={false}
          aria-label={`Link ${d.name}`}
          onClick={() => onPick(d)}
          className="flex min-h-[30px] w-full items-center gap-2.5 rounded-[6px] px-2 py-1 text-left hover:bg-a-line-soft"
        >
          {d.icon ? <span className="w-4 text-center leading-none" aria-hidden>{d.icon}</span> : <Table2 className="size-4 text-a-muted" strokeWidth={1.75} aria-hidden />}
          <span className="min-w-0 flex-1 truncate">{d.name}</span>
        </button>
      ))}
    </div>
  );
}
