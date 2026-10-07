import { useState } from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { NeedsFirstPicker } from '@/components/tasks/NeedsFirstPicker';
import type { Todo } from '@/types/todo';

const t = (id: string, text: string, status: Todo['status'] = 'todo', needsFirst?: string[]): Todo =>
  ({ id, text, status, createdAt: 0, listId: 'l1', order: 0, quadrant: 'do', ...(needsFirst ? { needsFirst } : {}) });
const todos = [t('me', 'Ship release', 'todo', ['x']), t('a', 'Write notes'), t('b', 'Run tests'), t('d', 'Done thing', 'done'), t('x', 'Upstream', 'todo', ['me2'])];

function Box(props: { taskId?: string; todos?: Todo[]; initial?: string[]; onCreate?: (title: string) => Promise<string | null>; withNew?: boolean; seen?: (v: { ids: string[]; newTitles: string[] }) => void }) {
  const [ids, setIds] = useState(props.initial ?? []);
  const [titles, setTitles] = useState<string[]>([]);
  props.seen?.({ ids, newTitles: titles });
  return <NeedsFirstPicker taskId={props.taskId} todos={props.todos ?? todos} ids={ids} onIdsChange={setIds}
    onCreate={props.onCreate} {...(props.withNew ? { newTitles: titles, onNewTitlesChange: setTitles } : {})} listName={() => 'Work'} />;
}
const type = (text: string) => fireEvent.change(screen.getByLabelText('Add a task that needs to be done first'), { target: { value: text } });

describe('NeedsFirstPicker', () => {
  it('searches open tasks, never the task itself or a done one, and adds on click', () => {
    render(<Box taskId="me" />);
    type('e');
    const list = screen.getByRole('listbox');
    expect(list).toHaveTextContent('Write notes');
    expect(list).not.toHaveTextContent('Ship release');
    expect(list).not.toHaveTextContent('Done thing');
    fireEvent.click(screen.getByRole('button', { name: /Write notes/ }));
    expect(screen.getByRole('list', { name: 'Needs first' })).toHaveTextContent('Write notes');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('does not offer a task that would make two tasks wait on each other', () => {
    // "Upstream" (x) is needed by "Ship release" (me); so x must not be able to need "me".
    render(<Box taskId="x" />);
    type('Ship');
    expect(screen.queryByRole('listbox')).toBeNull();
  });

  it('Enter picks the first match; a chip can be removed', () => {
    render(<Box taskId="me" />);
    type('run');
    fireEvent.keyDown(screen.getByLabelText('Add a task that needs to be done first'), { key: 'Enter' });
    expect(screen.getByRole('list', { name: 'Needs first' })).toHaveTextContent('Run tests');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Run tests from needs first' }));
    expect(screen.queryByRole('list', { name: 'Needs first' })).toBeNull();
  });

  it('shows what is done as done, and ignores a prerequisite that no longer exists', () => {
    render(<Box taskId="me" initial={['d', 'gone', 'a']} />);
    const chips = screen.getByRole('list', { name: 'Needs first' });
    expect(chips).toHaveTextContent('Done thing');
    expect(chips).toHaveTextContent('Write notes');
    expect(chips.querySelectorAll('li')).toHaveLength(2);
  });

  it('makes a new task straight away when asked (editing)', async () => {
    const onCreate = vi.fn(async () => 'new-id');
    const seen = vi.fn();
    render(<Box taskId="me" onCreate={onCreate} seen={seen} todos={[...todos, t('new-id', 'Fresh one')]} />);
    type('Fresh one!');
    fireEvent.click(screen.getByRole('button', { name: 'Create “Fresh one!” as a new task' }));
    await waitFor(() => expect(onCreate).toHaveBeenCalledWith('Fresh one!'));
    await waitFor(() => expect(seen).toHaveBeenLastCalledWith({ ids: ['new-id'], newTitles: [] }));
  });

  it('keeps new tasks as titles until the task is saved (Add task dialog) and does not offer an existing title to create', () => {
    const seen = vi.fn();
    render(<Box withNew seen={seen} />);
    type('write notes');
    expect(screen.queryByRole('button', { name: /Create/ })).toBeNull(); // it exists: pick it instead
    type('Brand new');
    fireEvent.click(screen.getByRole('button', { name: 'Create “Brand new” as a new task' }));
    expect(seen).toHaveBeenLastCalledWith({ ids: [], newTitles: ['Brand new'] });
    expect(screen.getByRole('list', { name: 'Needs first' })).toHaveTextContent('Brand new');
    fireEvent.click(screen.getByRole('button', { name: 'Remove Brand new from needs first' }));
    expect(seen).toHaveBeenLastCalledWith({ ids: [], newTitles: [] });
  });
});
