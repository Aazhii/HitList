import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { CodeEditor } from '@/components/code/CodeEditor';
import { selectInsideBrackets } from '@/components/code/bracketSelect';

const viewOf = (c: HTMLElement) => EditorView.findFromDOM(c.querySelector('.cm-editor') as HTMLElement)!;
const selected = (v: EditorView) => v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);
const settle = () => act(async () => { await new Promise((r) => setTimeout(r, 300)); });

describe('double-click inside brackets', () => {
  const text = '{\n  "a": [1, 2],\n  "b": {"c": "}"}\n}';

  it('selects what is between the brackets, from either bracket, then the brackets too', async () => {
    const { container } = render(<CodeEditor value={text} language="json" />);
    const view = viewOf(container);
    await settle();
    act(() => { selectInsideBrackets(view, text.indexOf('[') + 1); });
    expect(selected(view)).toBe('1, 2');
    act(() => { selectInsideBrackets(view, text.indexOf(']')); });
    expect(selected(view)).toBe('[1, 2]');
    act(() => { selectInsideBrackets(view, text.indexOf(']') + 1); });
    expect(selected(view)).toBe('1, 2');
  });

  it('the outer braces take every line inside them, and a brace inside a string is not a bracket', async () => {
    const { container } = render(<CodeEditor value={text} language="json" />);
    const view = viewOf(container);
    await settle();
    act(() => { selectInsideBrackets(view, 0); });
    expect(selected(view)).toBe(text.slice(1, text.length - 1));
    act(() => { selectInsideBrackets(view, text.indexOf('{"c"') + 1); });
    expect(selected(view)).toBe('"c": "}"');
  });

  it('does nothing away from a bracket', async () => {
    const { container } = render(<CodeEditor value={text} language="json" />);
    const view = viewOf(container);
    await settle();
    let handled = true;
    act(() => { handled = selectInsideBrackets(view, text.indexOf('"a"') + 2); });
    expect(handled).toBe(false);
  });
});
