/**
 * MomentumBar + TodayHistoryPanel tests
 * Covers: render stats, progress, streak, click handler, history panel open/close
 */
import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MomentumBar } from '@/components/MomentumBar';
import { TodayHistoryPanel } from '@/components/TodayHistoryPanel';
import type { KaizenStats, Todo } from '@/types/todo';

const defaultStats: KaizenStats = {
  streak: 3,
  totalCompleted: 42,
  todayCompleted: 5,
};

beforeEach(() => {
  vi.clearAllMocks();
});

// ── MomentumBar ───────────────────────────────────────────────────────────────

describe('MomentumBar', () => {
  it('renders today and all-time completed counts', () => {
    render(<MomentumBar stats={defaultStats} total={10} done={5} />);
    expect(screen.getByText('5')).toBeInTheDocument(); // todayCompleted
    expect(screen.getByText('42')).toBeInTheDocument(); // totalCompleted
  });

  it('renders streak count', () => {
    render(<MomentumBar stats={defaultStats} total={10} done={5} />);
    expect(screen.getByText(/3 days/i)).toBeInTheDocument();
  });

  it('renders 0% progress when no tasks', () => {
    render(<MomentumBar stats={defaultStats} total={0} done={0} />);
    expect(screen.getByText('0%')).toBeInTheDocument();
  });

  it('renders 100% progress and "All done!" badge when all tasks complete', () => {
    render(<MomentumBar stats={defaultStats} total={5} done={5} />);
    expect(screen.getByText('100%')).toBeInTheDocument();
    expect(screen.getByText(/all done/i)).toBeInTheDocument();
  });

  it('calls onViewHistory when clicked', () => {
    const onViewHistory = vi.fn();
    render(<MomentumBar stats={defaultStats} total={10} done={5} onViewHistory={onViewHistory} />);
    const bar = screen.getByRole('button', { name: /view today/i });
    fireEvent.click(bar);
    expect(onViewHistory).toHaveBeenCalled();
  });

  it('calls onViewHistory on Enter key press', () => {
    const onViewHistory = vi.fn();
    render(<MomentumBar stats={defaultStats} total={10} done={5} onViewHistory={onViewHistory} />);
    const bar = screen.getByRole('button', { name: /view today/i });
    fireEvent.keyDown(bar, { key: 'Enter' });
    expect(onViewHistory).toHaveBeenCalled();
  });

  it('does not render as a button when onViewHistory is not provided', () => {
    render(<MomentumBar stats={defaultStats} total={10} done={5} />);
    expect(screen.queryByRole('button', { name: /view today/i })).not.toBeInTheDocument();
  });

  it('renders singular "day" for streak of 1', () => {
    const stats = { ...defaultStats, streak: 1 };
    render(<MomentumBar stats={stats} total={5} done={2} />);
    expect(screen.getByText('1 day')).toBeInTheDocument();
  });
});

// ── TodayHistoryPanel ─────────────────────────────────────────────────────────

function makeDoneTodo(overrides: Partial<Todo> = {}): Todo {
  return {
    id: 'done-1',
    text: 'Completed task',
    note: '',
    status: 'done',
    quadrant: 'do',
    order: 0,
    createdAt: Date.now() - 3600_000,
    completedAt: Date.now(),
    listId: 'list-1',
    reminderEnabled: false,
    ...overrides,
  };
}

describe('TodayHistoryPanel', () => {
  it('renders completed tasks when open', () => {
    const todos = [makeDoneTodo({ text: 'Finished task' })];
    render(<TodayHistoryPanel open={true} todos={todos} onClose={vi.fn()} />);
    expect(screen.getByText('Finished task')).toBeInTheDocument();
  });

  it('shows empty state when no tasks completed today', () => {
    render(<TodayHistoryPanel open={true} todos={[]} onClose={vi.fn()} />);
    expect(screen.getByText(/no tasks completed yet/i)).toBeInTheDocument();
  });

  it('shows correct count in header', () => {
    const todos = [
      makeDoneTodo({ id: '1', text: 'Task 1' }),
      makeDoneTodo({ id: '2', text: 'Task 2' }),
    ];
    render(<TodayHistoryPanel open={true} todos={todos} onClose={vi.fn()} />);
    expect(screen.getByText(/2 tasks completed today/i)).toBeInTheDocument();
  });

  it('calls onClose when close button is clicked', () => {
    const onClose = vi.fn();
    render(<TodayHistoryPanel open={true} todos={[]} onClose={onClose} />);
    const closeBtn = screen.getByRole('button', { name: /close panel/i });
    fireEvent.click(closeBtn);
    expect(onClose).toHaveBeenCalled();
  });

  it('does not show tasks completed on previous days', () => {
    const yesterday = Date.now() - 25 * 3600_000;
    const todos = [
      makeDoneTodo({ id: '1', text: 'Yesterday task', completedAt: yesterday }),
      makeDoneTodo({ id: '2', text: 'Today task', completedAt: Date.now() }),
    ];
    render(<TodayHistoryPanel open={true} todos={todos} onClose={vi.fn()} />);
    expect(screen.getByText('Today task')).toBeInTheDocument();
    expect(screen.queryByText('Yesterday task')).not.toBeInTheDocument();
  });
});
