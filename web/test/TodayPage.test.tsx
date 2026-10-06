import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { TodayPage } from '@/pages/TodayPage';
import type { Todo } from '@/types/todo';

let n = 0;
const task = (over: Partial<Todo>): Todo => ({
  id: `t${++n}`, text: `Task ${n}`, status: 'todo', createdAt: 0, listId: 'w', order: n, quadrant: 'do', ...over,
});
const lists = [{ id: 'w', name: 'Work', color: 'violet', createdAt: 1 }];
const props = () => ({
  lists, onStatusChange: vi.fn(), onOpenTask: vi.fn(), onOpenTasks: vi.fn(),
  dailyLine: { enabled: false, seenDay: '', onSeen: vi.fn(), onTurnOff: vi.fn() },
});

describe('TodayPage', () => {
  it('shows the one next task large and the two after it', () => {
    const tasks = [task({ text: 'Write the brief', quadrant: 'do' }), task({ text: 'Plan Q4', quadrant: 'schedule' }),
      task({ text: 'Reply to Sam', quadrant: 'delegate' }), task({ text: 'Tidy desk', quadrant: 'eliminate' })];
    render(<TodayPage todos={tasks} {...props()} />);
    expect(screen.getByRole('heading', { name: 'Write the brief' })).toBeInTheDocument();
    expect(screen.getByText('Plan Q4')).toBeInTheDocument();
    expect(screen.getByText('Reply to Sam')).toBeInTheDocument();
    expect(screen.queryByText('Tidy desk')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: /1 more open/ })).toBeInTheDocument();
  });

  it('starts, finishes and opens the next task', () => {
    const t = task({ text: 'Ship it' });
    const p = props();
    render(<TodayPage todos={[t]} {...p} />);
    fireEvent.click(screen.getByRole('button', { name: /Start/ }));
    expect(p.onStatusChange).toHaveBeenCalledWith(t.id, 'in-progress');
    fireEvent.click(screen.getByRole('button', { name: /Mark done/ }));
    expect(p.onStatusChange).toHaveBeenCalledWith(t.id, 'done');
    fireEvent.click(screen.getByRole('button', { name: 'Open' }));
    expect(p.onOpenTask).toHaveBeenCalledWith(t);
  });

  it('lists overdue tasks immediately and allows collapsing them', () => {
    const late = task({ text: 'Pay invoice', dueDate: '2020-01-01' });
    render(<TodayPage todos={[late, task({})]} {...props()} />);
    const chip = screen.getByRole('button', { name: /1 overdue/ });
    expect(screen.getByRole('list', { name: 'Overdue tasks' })).toHaveTextContent('Pay invoice');
    expect(chip).toHaveAttribute('aria-expanded', 'true');
    fireEvent.click(chip);
    expect(screen.queryByRole('list', { name: 'Overdue tasks' })).not.toBeInTheDocument();
    expect(chip).toHaveAttribute('aria-expanded', 'false');
  });

  it('shows a newly added past-date task even outside the first three ranked tasks', () => {
    const tasks = Array.from({ length: 3 }, () => task({ dueDate: '2019-01-01' }));
    const p = props();
    const { rerender } = render(<TodayPage todos={tasks} {...p} />);
    const added = task({ text: 'New overdue task', dueDate: '2020-01-01' });
    rerender(<TodayPage todos={[...tasks, added]} {...p} />);
    expect(screen.getByRole('list', { name: 'Overdue tasks' })).toHaveTextContent(added.text);
    fireEvent.click(screen.getByRole('button', { name: /New overdue task/ }));
    expect(p.onOpenTask).toHaveBeenCalledWith(added);
  });

  it('says so when nothing is open', () => {
    render(<TodayPage todos={[task({ status: 'done' })]} {...props()} />);
    expect(screen.getByText('Nothing left for today')).toBeInTheDocument();
  });

  it('shows the daily line once, dismisses it for the day, and can turn it off', () => {
    const p = props();
    p.dailyLine.enabled = true;
    const yesterday = new Date(); yesterday.setDate(yesterday.getDate() - 1);
    const t = task({ text: 'Ship it' });
    const finished = task({ status: 'done', completedAt: yesterday.getTime() });
    render(<TodayPage todos={[t, finished]} {...p} />);
    const line = screen.getByRole('note', { name: 'Daily summary' });
    expect(line).toHaveTextContent('Yesterday you finished 1 task.');
    expect(line).toHaveTextContent("Today's one thing: Ship it.");
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss for today' }));
    expect(p.dailyLine.onSeen).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole('button', { name: 'Turn off' }));
    expect(p.dailyLine.onTurnOff).toHaveBeenCalled();
  });

  it('shows no daily line when it is off or already seen today', () => {
    render(<TodayPage todos={[task({})]} {...props()} />);
    expect(screen.queryByRole('note', { name: 'Daily summary' })).not.toBeInTheDocument();
  });
});
