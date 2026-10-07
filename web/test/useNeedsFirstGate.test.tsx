import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NeedsFirstDialog } from '@/components/tasks/NeedsFirstDialog';
import { useNeedsFirstGate } from '@/hooks/useNeedsFirstGate';
import type { Todo, TodoStatus } from '@/types/todo';

const t = (id: string, status: Todo['status'] = 'todo', needsFirst?: string[]): Todo =>
  ({ id, text: `Task ${id}`, status, createdAt: 0, listId: 'l1', order: 0, quadrant: 'do', ...(needsFirst ? { needsFirst } : {}) });

/** The gate wired to the pop-up the way App wires it, with a button that asks to complete some tasks. */
function Harness({ todos, apply, ids, onResult }: { todos: Todo[]; apply: (id: string, s: TodoStatus) => Promise<void>; ids: string[]; onResult: (ok: boolean) => void }) {
  const gate = useNeedsFirstGate(todos, apply);
  return (
    <>
      <button onClick={() => { void gate.guardCompletion(ids).then(onResult); }}>complete</button>
      <NeedsFirstDialog groups={gate.prompt?.groups ?? null} total={gate.prompt?.total ?? 0} listName={() => 'Work'} onDecide={gate.decide} />
    </>
  );
}

function setup(todos: Todo[], ids: string[]) {
  const apply = vi.fn(async (_id: string, _status: TodoStatus) => {});
  const onResult = vi.fn();
  render(<Harness todos={todos} apply={apply} ids={ids} onResult={onResult} />);
  return { apply, onResult, ask: () => fireEvent.click(screen.getByText('complete')) };
}

describe('the "needs first" gate', () => {
  it('lets a task with nothing open to wait on be completed without a question', async () => {
    const t1 = setup([t('a', 'todo', ['b', 'gone']), t('b', 'done')], ['a']);
    t1.ask();
    await waitFor(() => expect(t1.onResult).toHaveBeenCalledWith(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('lets a task with no links be completed without a question', async () => {
    const s = setup([t('a')], ['a']);
    s.ask();
    await waitFor(() => expect(s.onResult).toHaveBeenCalledWith(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('asks, and Cancel completes nothing', async () => {
    const s = setup([t('a', 'todo', ['b', 'c']), t('b'), t('c')], ['a']);
    s.ask();
    expect(await screen.findByText('Task a still needs 2 tasks first')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    await waitFor(() => expect(s.onResult).toHaveBeenCalledWith(false));
    expect(s.apply).not.toHaveBeenCalled();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('"Complete anyway" says yes and leaves the other tasks alone', async () => {
    const s = setup([t('a', 'todo', ['b']), t('b')], ['a']);
    s.ask();
    fireEvent.click(await screen.findByRole('button', { name: 'Complete anyway' }));
    await waitFor(() => expect(s.onResult).toHaveBeenCalledWith(true));
    expect(s.apply).not.toHaveBeenCalled();
  });

  it('"Finish them too" completes what is needed, deepest first, then says yes', async () => {
    const s = setup([t('a', 'todo', ['b', 'c']), t('b', 'todo', ['d']), t('c'), t('d')], ['a']);
    s.ask();
    fireEvent.click(await screen.findByRole('button', { name: 'Finish them too' }));
    await waitFor(() => expect(s.onResult).toHaveBeenCalledWith(true));
    expect(s.apply.mock.calls).toEqual([['d', 'done'], ['b', 'done'], ['c', 'done']]);
  });

  it('asks once for a whole selection and only about the tasks that are waiting', async () => {
    const s = setup([t('a', 'todo', ['x']), t('b'), t('c', 'todo', ['y']), t('x'), t('y')], ['a', 'b', 'c']);
    s.ask();
    expect(await screen.findByText('2 of the 3 selected tasks still need other tasks first')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Finish them too' }));
    await waitFor(() => expect(s.onResult).toHaveBeenCalledWith(true));
    expect(s.apply.mock.calls.map((c) => c[0])).toEqual(['x', 'y']);
  });

  it('does not ask about a task that is already done', async () => {
    const s = setup([t('a', 'done', ['b']), t('b')], ['a']);
    s.ask();
    await waitFor(() => expect(s.onResult).toHaveBeenCalledWith(true));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('closing the pop-up with Escape is a Cancel', async () => {
    const s = setup([t('a', 'todo', ['b']), t('b')], ['a']);
    s.ask();
    const dialog = await screen.findByRole('dialog');
    act(() => { fireEvent.keyDown(dialog, { key: 'Escape' }); });
    await waitFor(() => expect(s.onResult).toHaveBeenCalledWith(false));
  });
});
