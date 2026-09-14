import type { ReactNode } from 'react';

/**
 * The outermost frame: the icon rail, then the active view.
 *
 * On desktop the rail is a 64px column on the left. Below `md` it becomes a bar
 * along the bottom — `flex-col-reverse` puts it there while keeping it first in
 * the DOM, so it stays first in the tab order.
 */
export function AppShell({ rail, children }: { rail: ReactNode; children: ReactNode }) {
  return (
    <div className="flex h-svh min-h-0 flex-col-reverse bg-a-bg text-a-ink md:flex-row">
      {rail}
      <div className="flex min-h-0 min-w-0 flex-1">{children}</div>
    </div>
  );
}
