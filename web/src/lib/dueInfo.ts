/**
 * Due-date labels and tones, shared by the task row and the matrix card.
 *
 * Moved out of MatrixTaskCard.tsx, which re-exports it. This is the live,
 * time-aware formatter; the unmounted TodoItem had a second, date-only one with
 * a different return shape.
 */

export interface DueInfo {
  label: string;
  isOverdue: boolean;
  /** Within 2 hours. Only possible when a due time is set. */
  isUrgentSoon: boolean;
  isToday: boolean;
  /** Due tomorrow or within the week — close, but not today. */
  isSoon: boolean;
}

export function getDueInfo(dueDate?: string, dueTime?: string): DueInfo | null {
  if (!dueDate) return null;

  const now = new Date();
  // No time means the end of that day.
  const dueTs = dueTime ? new Date(`${dueDate}T${dueTime}:00`) : new Date(`${dueDate}T23:59:59`);

  const diffMs = dueTs.getTime() - now.getTime();
  const diffMins = diffMs / 60000;
  const diffDays = diffMs / (1000 * 60 * 60 * 24);

  const base = { isOverdue: false, isUrgentSoon: false, isToday: false, isSoon: false };

  // The design names the date rather than counting down from it: "Overdue ·
  // Sep 27" reads at a glance, "2d overdue" makes you do arithmetic to find out
  // which day you missed (showcase 1232).
  if (diffMs < 0) {
    const absMins = Math.abs(diffMins);
    if (absMins < 60) return { ...base, label: `${Math.round(absMins)}m overdue`, isOverdue: true };
    if (absMins < 60 * 24) return { ...base, label: `${Math.floor(absMins / 60)}h overdue`, isOverdue: true };
    return { ...base, label: `Overdue · ${shortDate(dueTs)}`, isOverdue: true };
  }

  if (diffMins <= 120 && dueTime) {
    if (diffMins < 60) {
      return { ...base, label: `${Math.round(diffMins)}m left`, isUrgentSoon: true, isToday: true };
    }
    return {
      ...base,
      label: `${Math.floor(diffMins / 60)}h ${Math.round(diffMins % 60)}m left`,
      isUrgentSoon: true,
      isToday: true,
    };
  }

  const todayMidnight = new Date();
  todayMidnight.setHours(0, 0, 0, 0);
  const tomorrowMidnight = new Date(todayMidnight);
  tomorrowMidnight.setDate(tomorrowMidnight.getDate() + 1);

  if (dueTs < tomorrowMidnight) {
    if (dueTime) {
      const time = dueTs.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' });
      return { ...base, label: `Today, ${time}`, isToday: true };
    }
    return { ...base, label: 'Today', isToday: true };
  }

  if (diffDays < 2) return { ...base, label: 'Tomorrow', isSoon: true };

  // Past tomorrow the design shows the date itself, not a countdown
  // (showcase 1234-1237: "Oct 2", "Oct 9", "Oct 5").
  return { ...base, label: shortDate(dueTs), isSoon: diffDays <= 7 };
}

function shortDate(d: Date): string {
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export type DueTone = 'urgent' | 'soon' | 'plain';

/**
 * The prototype's three due states (showcase 1272):
 *   over -> #b83232, soon -> #C0741A, ok -> --text-tertiary.
 *
 * "Soon" here means today — the thing you act on now. A date later this week is
 * just a date; colouring it would spend the one warm colour on something that
 * is not yet urgent, which is how everything ends up looking urgent.
 */
export function dueTone(info: DueInfo): DueTone {
  if (info.isOverdue) return 'urgent';
  if (info.isToday) return 'soon';
  return 'plain';
}

/**
 * Plain coloured text, no background. The design renders a due date as
 * `<span style="color:…;font-weight:…">` (showcase 202) — a tinted pill per row
 * turns a list of tasks into a list of badges.
 */
export const DUE_TONE_CLASS: Record<DueTone, string> = {
  urgent: 'text-a-attention font-semibold',
  soon: 'text-a-amber font-semibold',
  plain: 'text-a-muted',
};
