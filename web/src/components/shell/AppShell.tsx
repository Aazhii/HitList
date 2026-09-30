import type { ReactNode } from 'react';

/**
 * The outermost frame: the sidebar, then the active view.
 *
 * On desktop the sidebar is a 248px column on the left. Below `md` it becomes a
 * bar along the bottom — `flex-col-reverse` puts it there while keeping it first
 * in the DOM, so it stays first in the tab order.
 *
 * The frame is white because the content column is white (showcase 107) and the
 * page's wrappers are all transparent, so whatever this paints shows through.
 * The sidebar paints its own grey ground.
 */
export function AppShell({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-svh min-h-0 flex-col-reverse bg-a-surface text-a-ink md:flex-row">
      {rail}
      <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  );
}
