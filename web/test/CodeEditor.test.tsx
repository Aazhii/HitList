import { describe, it, expect, vi } from 'vitest';
import { render, waitFor, act } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { CodeEditor } from '@/components/code/CodeEditor';

const viewOf = (container: HTMLElement) => EditorView.findFromDOM(container.querySelector('.cm-editor') as HTMLElement)!;
const press = (view: EditorView, key: string, init: KeyboardEventInit = {}) => {
  act(() => { view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init })); });
};
const select = (view: EditorView, anchor: number, head = anchor) => act(() => view.dispatch({ selection: { anchor, head } }));

describe('code editor', () => {
  it('shows the text, reports typing, and does not echo a change made from outside', () => {
    const onChange = vi.fn();
    const { container, rerender } = render(<CodeEditor value="hello" onChange={onChange} />);
    const view = viewOf(container);
    expect(view.state.doc.toString()).toBe('hello');
    act(() => view.dispatch({ changes: { from: 5, insert: '!' }, userEvent: 'input.type' }));
    expect(onChange).toHaveBeenCalledWith('hello!');
    onChange.mockClear();
    rerender(<CodeEditor value="from outside" onChange={onChange} />);
    expect(view.state.doc.toString()).toBe('from outside');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('Tab indents with the chosen unit, Shift+Tab takes it back', () => {
    const { container, rerender } = render(<CodeEditor value="a" indent="4" />);
    const view = viewOf(container);
    select(view, 1);
    press(view, 'Tab');
    expect(view.state.doc.toString()).toBe('    a');
    press(view, 'Tab', { shiftKey: true });
    expect(view.state.doc.toString()).toBe('a');
    rerender(<CodeEditor value="a" indent="tab" />);
    select(view, 0);
    press(view, 'Tab');
    expect(view.state.doc.toString()).toBe('\ta');
  });

  it('Tab on several selected lines indents each of them', () => {
    const { container } = render(<CodeEditor value={'x\ny\nz'} indent="2" />);
    const view = viewOf(container);
    select(view, 0, 5);
    press(view, 'Tab');
    expect(view.state.doc.toString()).toBe('  x\n  y\n  z');
  });

  it('Enter keeps the indentation of the line, and goes one level deeper after an opening brace in code', async () => {
    const { container } = render(<CodeEditor value={'function f() {'} language="javascript" indent="2" />);
    const view = viewOf(container);
    // Wait for the language: the editor starts plain and gains it when it has loaded.
    await waitFor(() => expect(container.querySelector('.cm-line span')).not.toBeNull());
    select(view, view.state.doc.length);
    press(view, 'Enter');
    expect(view.state.doc.toString()).toBe('function f() {\n  ');
  });

  it('colours code by language, and shows plain text as plain', async () => {
    const js = render(<CodeEditor value={'const x = 1; // note'} language="javascript" />);
    await waitFor(() => expect(js.container.querySelectorAll('.cm-line span').length).toBeGreaterThan(2));
    const plain = render(<CodeEditor value={'const x = 1; // note'} language="plaintext" />);
    expect(plain.container.querySelectorAll('.cm-line span').length).toBe(0);
  });

  it('switching language re-colours the same text', async () => {
    const { container, rerender } = render(<CodeEditor value={'SELECT name FROM t WHERE id = 1'} language="plaintext" />);
    expect(container.querySelectorAll('.cm-line span').length).toBe(0);
    rerender(<CodeEditor value={'SELECT name FROM t WHERE id = 1'} language="sql" />);
    await waitFor(() => expect(container.querySelectorAll('.cm-line span').length).toBeGreaterThan(0));
  });

  it('read-only keeps the text but refuses edits', () => {
    const { container } = render(<CodeEditor value="locked" readOnly />);
    const view = viewOf(container);
    select(view, 6);
    press(view, 'Tab');
    expect(view.state.doc.toString()).toBe('locked');
    expect(view.contentDOM.getAttribute('contenteditable')).toBe('false');
  });
});
