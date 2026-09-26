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

  if (diffMs < 0) {
    const absMins = Math.abs(diffMins);
    if (absMins < 60) return { ...base, label: `${Math.round(absMins)}m overdue`, isOverdue: true };
    const absHrs = Math.floor(absMins / 60);
    if (absHrs < 24) return { ...base, label: `${absHrs}h overdue`, isOverdue: true };
    return { ...base, label: `${Math.floor(absHrs / 24)}d overdue`, isOverdue: true };
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
      return { ...base, label: `Today ${time}`, isToday: true };
    }
    return { ...base, label: 'Due today', isToday: true };
  }

  if (diffDays < 2) return { ...base, label: 'Due tomorrow', isSoon: true };
  if (diffDays <= 7) return { ...base, label: `Due in ${Math.ceil(diffDays)}d`, isSoon: true };

  return { ...base, label: dueTs.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) };
}

export type DueTone = 'urgent' | 'soon' | 'plain';

/**
 * The handoff's chip tones (§7h): overdue or due today → the "Do First" ink;
 * due soon → the "Schedule" ink; anything further out stays plain.
 *
 * "Due in 45 minutes" counts as today, so it takes the urgent tone. Mapping the
 * two-hour flag to "soon" would colour a task due in 45 minutes more calmly
 * than one due this evening.
 */
export function dueTone(info: DueInfo): DueTone {
  if (info.isOverdue || info.isToday) return 'urgent';
  if (info.isSoon) return 'soon';
  return 'plain';
}

/** Chip classes per tone. 12.5px pills, per §7h. */
export const DUE_TONE_CLASS: Record<DueTone, string> = {
  urgent: 'bg-q-do-bg text-q-do font-semibold',
  soon: 'bg-q-schedule-bg text-q-schedule font-semibold',
  plain: 'text-a-muted shadow-[inset_0_0_0_1px_var(--a-line)]',
};
