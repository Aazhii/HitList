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

  it('arrows past the first or last line are handed to the caller; inside the text they move the caret', () => {
    const onEdge = vi.fn();
    const { container } = render(<CodeEditor value={'one\ntwo\nthree'} onEdge={onEdge} />);
    const view = viewOf(container);
    select(view, 5); // on the middle line
    press(view, 'ArrowUp');
    press(view, 'ArrowDown');
    expect(onEdge).not.toHaveBeenCalled();
    select(view, 1); // first line
    press(view, 'ArrowUp');
    expect(onEdge).toHaveBeenLastCalledWith('up');
    select(view, view.state.doc.length); // last line
    press(view, 'ArrowDown');
    expect(onEdge).toHaveBeenLastCalledWith('down');
    // a selection, or Shift, keeps the arrow for the editor
    onEdge.mockClear();
    select(view, 0, 3);
    press(view, 'ArrowUp');
    select(view, 1);
    press(view, 'ArrowUp', { shiftKey: true });
    expect(onEdge).not.toHaveBeenCalled();
  });

  it('indents by 4 spaces unless told otherwise', () => {
    const { container } = render(<CodeEditor value="a" />);
    const view = viewOf(container);
    select(view, 1);
    press(view, 'Tab');
    expect(view.state.doc.toString()).toBe('    a');
  });

  it.each([['javascript', '// '], ['python', '# '], ['sql', '-- '], ['plaintext', '// ']])('Ctrl/Cmd + / comments and uncomments the lines in %s', async (language, mark) => {
    const { container } = render(<CodeEditor value={'a = 1\nb = 2'} language={language} />);
    const view = viewOf(container);
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    select(view, 0, 11);
    press(view, '/', { ctrlKey: true });
    expect(view.state.doc.toString()).toBe(`${mark}a = 1\n${mark}b = 2`);
    press(view, '/', { ctrlKey: true });
    expect(view.state.doc.toString()).toBe('a = 1\nb = 2');
  });

  it('a JSON editor is marked so its keys and strings get the Postman colours', async () => {
    const { container } = render(<CodeEditor value={'{"a": "b"}'} language="json" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(container.querySelector('.cm-editor')).toHaveClass('cm-lang-json');
    const other = render(<CodeEditor value="x" language="python" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(other.container.querySelector('.cm-editor')).not.toHaveClass('cm-lang-json');
  });

  it('JSON warns where a brace, a quote or a comma is missing, and only while something is wrong', async () => {
    const { container } = render(<CodeEditor value={'{"a": {"b": 1}'} language="json" />);
    const view = viewOf(container);
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(container.querySelector('.cm-json-problem')?.textContent).toBe('Line 1: Missing } to close this {');
    expect(container.querySelector('.cm-json-error')).not.toBeNull();
    act(() => view.dispatch({ changes: { from: view.state.doc.length, insert: '}' } }));
    expect(container.querySelector('.cm-json-problem')).toBeNull();
    expect(container.querySelector('.cm-json-error')).toBeNull();
    act(() => view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: '{\n  "a": "hello,\n  "b": 2\n}' } }));
    expect(container.querySelector('.cm-json-problem')?.textContent).toContain('Line 2: This string is missing its closing quote');
  });

  it('other languages show no JSON warnings', async () => {
    const { container } = render(<CodeEditor value={'{"a": {'} language="python" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    expect(container.querySelector('.cm-json-problem')).toBeNull();
  });

  it('JSON keys and values keep their own colours even when the text is not valid JSON', async () => {
    const broken = '{\n  "data": [\n    "Name" : "merge",\n    "n": 1,\n    "ok": true,\n    "x": {"id": "{{Id}}"}\n  ]\n}';
    const { container } = render(<CodeEditor value={broken} language="json" />);
    await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
    const text = (selector: string) => Array.from(container.querySelectorAll(`.cm-content ${selector}`)).filter((el) => !el.querySelector(selector)).map((el) => el.textContent);
    expect(text('.cm-json-key')).toEqual(['"data"', '"Name"', '"n"', '"ok"', '"x"', '"id"']);
    expect(text('.cm-json-value')).toEqual(['"merge"', '1', 'true', '"{{Id}}"']);
  });
});
