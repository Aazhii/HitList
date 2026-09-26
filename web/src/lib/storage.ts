import type { AppState, Todo, KaizenList, KaizenStats, TodoStatus, Quadrant } from '@/types/todo';

const BASE_STORAGE_KEY = 'kaizen-app-v3';
const CURRENT_VERSION = 3;

// ── Per-user storage key ──────────────────────────────────────────────────────

let _activeUserId: string | null = null;

export function setActiveUserId(userId: string | null): void {
  _activeUserId = userId;
}

/** The signed-in user App set, for other per-user storage such as notes. */
export function getActiveUserId(): string | null {
  return _activeUserId;
}

function getStorageKey(): string {
  return _activeUserId ? `${BASE_STORAGE_KEY}-${_activeUserId}` : BASE_STORAGE_KEY;
}

// Legacy key for migration (pre-auth data)
const STORAGE_KEY = BASE_STORAGE_KEY;

// ── Helpers ─────────────────────────────────────────────────────────────────

function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysAgoStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function daysFromNowStr(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

const DEFAULT_LIST_ID = 'list-daily';
const WORK_LIST_ID = 'list-work';
const HEALTH_LIST_ID = 'list-health';

// ── Seed ────────────────────────────────────────────────────────────────────

export function createSeedState(): AppState {
  const now = Date.now();

  const lists: KaizenList[] = [
    { id: DEFAULT_LIST_ID, name: 'Daily Growth', createdAt: now - 1000 * 60 * 60 * 24 * 5, color: 'emerald' },
    { id: WORK_LIST_ID, name: 'Work Focus', createdAt: now - 1000 * 60 * 60 * 24 * 3, color: 'blue' },
    { id: HEALTH_LIST_ID, name: 'Health & Wellness', createdAt: now - 1000 * 60 * 60 * 24 * 2, color: 'rose' },
  ];

  const todos: Todo[] = [
    // ── DO FIRST (Urgent + Important) ──────────────────────────────────────
    {
      id: 'seed-1',
      text: 'Prepare slides for the 3pm client presentation',
      status: 'in-progress',
      createdAt: now - 1000 * 60 * 90,
      category: 'work',
      dueDate: todayStr(),
      dueTime: '15:00',
      listId: WORK_LIST_ID,
      order: 0,
      quadrant: 'do',
      note: 'Cover Q3 results, roadmap, and pricing. Deck is in Google Drive.',
    },
    {
      id: 'seed-2',
      text: 'Fix critical login bug reported by users',
      status: 'todo',
      createdAt: now - 1000 * 60 * 60,
      category: 'work',
      dueDate: todayStr(),
      dueTime: '12:00',
      listId: WORK_LIST_ID,
      order: 1,
      quadrant: 'do',
      note: 'Auth token expiry issue on mobile. Ticket #4821.',
    },
    {
      id: 'seed-3',
      text: 'Reply to urgent email from project stakeholder',
      status: 'done',
      createdAt: now - 1000 * 60 * 60 * 3,
      completedAt: now - 1000 * 60 * 60 * 2,
      category: 'work',
      dueDate: todayStr(),
      listId: WORK_LIST_ID,
      order: 2,
      quadrant: 'do',
    },

    // ── SCHEDULE (Not Urgent + Important) ──────────────────────────────────
    {
      id: 'seed-4',
      text: 'Write quarterly personal growth reflection',
      status: 'todo',
      createdAt: now - 1000 * 60 * 60 * 24,
      category: 'personal',
      dueDate: daysFromNowStr(5),
      listId: DEFAULT_LIST_ID,
      order: 0,
      quadrant: 'schedule',
      note: 'Review goals set in January. What worked, what didn\'t, what to adjust.',
    },
    {
      id: 'seed-5',
      text: 'Plan next sprint with the engineering team',
      status: 'todo',
      createdAt: now - 1000 * 60 * 60 * 5,
      category: 'work',
      dueDate: daysFromNowStr(3),
      listId: WORK_LIST_ID,
      order: 1,
      quadrant: 'schedule',
    },
    {
      id: 'seed-6',
      text: 'Read "Deep Work" — finish chapters 4–6',
      status: 'in-progress',
      createdAt: now - 1000 * 60 * 60 * 48,
      category: 'learning',
      dueDate: daysFromNowStr(7),
      listId: DEFAULT_LIST_ID,
      order: 2,
      quadrant: 'schedule',
      note: 'Focus on the rhythmic scheduling philosophy.',
    },
    {
      id: 'seed-7',
      text: 'Set up weekly review habit — Sunday evenings',
      status: 'todo',
      createdAt: now - 1000 * 60 * 60 * 72,
      category: 'personal',
      dueDate: daysFromNowStr(10),
      listId: DEFAULT_LIST_ID,
      order: 3,
      quadrant: 'schedule',
    },

    // ── DELEGATE (Urgent + Not Important) ──────────────────────────────────
    {
      id: 'seed-8',
      text: 'Schedule team standup for next week',
      status: 'todo',
      createdAt: now - 1000 * 60 * 30,
      category: 'work',
      dueDate: todayStr(),
      dueTime: '17:00',
      listId: WORK_LIST_ID,
      order: 0,
      quadrant: 'delegate',
    },
    {
      id: 'seed-9',
      text: 'Respond to non-critical Slack messages',
      status: 'done',
      createdAt: now - 1000 * 60 * 60 * 2,
      completedAt: now - 1000 * 60 * 45,
      category: 'work',
      listId: WORK_LIST_ID,
      order: 1,
      quadrant: 'delegate',
    },
    {
      id: 'seed-10',
      text: 'Book meeting room for Friday retrospective',
      status: 'todo',
      createdAt: now - 1000 * 60 * 60,
      category: 'work',
      dueDate: daysFromNowStr(1),
      listId: WORK_LIST_ID,
      order: 2,
      quadrant: 'delegate',
    },

    // ── ELIMINATE (Not Urgent + Not Important) ─────────────────────────────
    {
      id: 'seed-11',
      text: 'Reorganize desktop icons and folder structure',
      status: 'todo',
      createdAt: now - 1000 * 60 * 60 * 24 * 2,
      category: 'personal',
      listId: DEFAULT_LIST_ID,
      order: 0,
      quadrant: 'eliminate',
    },
    {
      id: 'seed-12',
      text: 'Browse new productivity apps on Product Hunt',
      status: 'todo',
      createdAt: now - 1000 * 60 * 60 * 24 * 3,
      category: 'learning',
      listId: DEFAULT_LIST_ID,
      order: 1,
      quadrant: 'eliminate',
    },

    // ── Reminder demo tasks (for in-app notification seeding) ──────────────
    {
      id: 'seed-remind-1',
      text: 'Send project status update to stakeholders',
      status: 'todo',
      createdAt: now - 1000 * 60 * 20,
      category: 'work',
      dueDate: (() => {
        const d = new Date(now + 8 * 60 * 1000);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })(),
      dueTime: (() => {
        const d = new Date(now + 8 * 60 * 1000);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      })(),
      listId: WORK_LIST_ID,
      order: 10,
      quadrant: 'do',
      reminderEnabled: true,
      reminderMinutesBefore: 15,
      note: 'Include sprint velocity, blockers, and next milestone date.',
    },
    {
      id: 'seed-remind-2',
      text: 'Review and merge open pull requests',
      status: 'todo',
      createdAt: now - 1000 * 60 * 60 * 4,
      category: 'work',
      dueDate: (() => {
        const d = new Date(now - 2.5 * 60 * 60 * 1000);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })(),
      dueTime: (() => {
        const d = new Date(now - 2.5 * 60 * 60 * 1000);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      })(),
      listId: WORK_LIST_ID,
      order: 11,
      quadrant: 'do',
      reminderEnabled: true,
      reminderMinutesBefore: 15,
      note: 'Three PRs waiting: auth refactor, dashboard fix, and API pagination.',
    },
    {
      id: 'seed-remind-3',
      text: 'Confirm venue booking for team offsite',
      status: 'todo',
      createdAt: now - 1000 * 60 * 45,
      category: 'work',
      dueDate: (() => {
        const d = new Date(now + 25 * 60 * 1000);
        return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      })(),
      dueTime: (() => {
        const d = new Date(now + 25 * 60 * 1000);
        return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
      })(),
      listId: WORK_LIST_ID,
      order: 12,
      quadrant: 'delegate',
      reminderEnabled: true,
      reminderMinutesBefore: 30,
    },

    // ── Health list ────────────────────────────────────────────────────────
    {
      id: 'seed-h1',
      text: 'Drink 8 glasses of water today',
      status: 'done',
      createdAt: now - 1000 * 60 * 60 * 5,
      completedAt: now - 1000 * 60 * 60 * 4,
      category: 'health',
      listId: HEALTH_LIST_ID,
      order: 0,
      quadrant: 'schedule',
    },
    {
      id: 'seed-h2',
      text: 'Do a 15-minute morning stretch',
      status: 'todo',
      createdAt: now - 1000 * 60 * 60 * 4,
      category: 'health',
      dueDate: daysFromNowStr(1),
      listId: HEALTH_LIST_ID,
      order: 1,
      quadrant: 'schedule',
    },
  ];

  // Seed completedAt timestamps spread over last 7 days for streak panel
  const extraCompletions: Todo[] = [
    {
      id: 'seed-hist-1',
      text: 'Meditate for 5 minutes',
      status: 'done',
      createdAt: now - 1000 * 60 * 60 * 24 * 6,
      completedAt: new Date(daysAgoStr(6) + 'T10:00:00').getTime(),
      category: 'health',
      listId: DEFAULT_LIST_ID,
      order: 5,
      quadrant: 'schedule',
    },
    {
      id: 'seed-hist-2',
      text: 'Read an article on a new topic',
      status: 'done',
      createdAt: now - 1000 * 60 * 60 * 24 * 5,
      completedAt: new Date(daysAgoStr(5) + 'T14:00:00').getTime(),
      category: 'learning',
      listId: DEFAULT_LIST_ID,
      order: 6,
      quadrant: 'schedule',
    },
    {
      id: 'seed-hist-3',
      text: 'Write in journal',
      status: 'done',
      createdAt: now - 1000 * 60 * 60 * 24 * 4,
      completedAt: new Date(daysAgoStr(4) + 'T09:00:00').getTime(),
      category: 'personal',
      listId: DEFAULT_LIST_ID,
      order: 7,
      quadrant: 'schedule',
    },
    {
      id: 'seed-hist-4',
      text: 'Practice a new skill for 20 minutes',
      status: 'done',
      createdAt: now - 1000 * 60 * 60 * 24 * 3,
      completedAt: new Date(daysAgoStr(3) + 'T16:00:00').getTime(),
      category: 'learning',
      listId: DEFAULT_LIST_ID,
      order: 8,
      quadrant: 'do',
    },
    {
      id: 'seed-hist-5',
      text: 'Connect with a friend or family member',
      status: 'done',
      createdAt: now - 1000 * 60 * 60 * 24 * 2,
      completedAt: new Date(daysAgoStr(2) + 'T18:00:00').getTime(),
      category: 'personal',
      listId: DEFAULT_LIST_ID,
      order: 9,
      quadrant: 'schedule',
    },
    {
      id: 'seed-hist-6',
      text: 'Reflect on yesterday\'s wins',
      status: 'done',
      createdAt: now - 1000 * 60 * 60 * 24,
      completedAt: new Date(daysAgoStr(1) + 'T08:00:00').getTime(),
      category: 'personal',
      listId: DEFAULT_LIST_ID,
      order: 10,
      quadrant: 'schedule',
    },
  ];

  const stats: KaizenStats = {
    streak: 7,
    totalCompleted: 14,
    todayCompleted: 1,
  };

  return {
    lists,
    activeListId: WORK_LIST_ID,
    todos: [...todos, ...extraCompletions],
    stats,
    lastStreakDay: todayStr(),
    version: CURRENT_VERSION,
  };
}

// ── Migration ──────────────────────────────────────────────────────────────

function migrateTodo(raw: Record<string, unknown>, defaultListId: string, index: number): Todo {
  return {
    id: String(raw.id ?? crypto.randomUUID()),
    text: String(raw.text ?? ''),
    status: (['todo', 'in-progress', 'done'].includes(raw.status as string)
      ? raw.status
      : 'todo') as TodoStatus,
    createdAt: typeof raw.createdAt === 'number' ? raw.createdAt : Date.now(),
    completedAt: typeof raw.completedAt === 'number' ? raw.completedAt : undefined,
    note: typeof raw.note === 'string' ? raw.note : undefined,
    dueDate: typeof raw.dueDate === 'string' ? raw.dueDate : undefined,
    dueTime: typeof raw.dueTime === 'string' ? raw.dueTime : undefined,
    category: typeof raw.category === 'string' ? raw.category : undefined,
    listId: typeof raw.listId === 'string' ? raw.listId : defaultListId,
    order: typeof raw.order === 'number' ? raw.order : index,
    quadrant: (['do', 'schedule', 'delegate', 'eliminate'].includes(raw.quadrant as string)
      ? raw.quadrant
      : 'schedule') as Quadrant,
    // Reminder settings were absent here, so every load silently dropped them.
    // mockApi calls loadAppState() on each operation, which meant enabling a
    // reminder was erased by the very next read — the setting never survived
    // long enough to be scheduled, let alone delivered.
    reminderEnabled: typeof raw.reminderEnabled === 'boolean' ? raw.reminderEnabled : undefined,
    reminderMinutesBefore:
      typeof raw.reminderMinutesBefore === 'number' ? raw.reminderMinutesBefore : undefined,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

export function loadAppState(): AppState {
  try {
    const key = getStorageKey();
    const raw = window.localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<AppState>;
      if (parsed.version === CURRENT_VERSION && Array.isArray(parsed.lists) && Array.isArray(parsed.todos)) {
        const lists = parsed.lists as KaizenList[];
        const activeListId = lists.find((l) => l.id === parsed.activeListId)
          ? parsed.activeListId!
          : lists[0]?.id ?? DEFAULT_LIST_ID;

        return {
          lists,
          activeListId,
          todos: (parsed.todos as unknown as Record<string, unknown>[]).map((t, i) =>
            migrateTodo(t, activeListId, i)
          ),
          stats: parsed.stats ?? { streak: 0, totalCompleted: 0, todayCompleted: 0 },
          lastStreakDay: parsed.lastStreakDay ?? '',
          version: CURRENT_VERSION,
        };
      }
    }

    // Fresh seed (old versions get fresh seed with matrix data)
    return createSeedState();
  } catch {
    return createSeedState();
  }
}

export function saveAppState(state: AppState): void {
  try {
    window.localStorage.setItem(getStorageKey(), JSON.stringify(state));
  } catch { /* ignore */ }
}
