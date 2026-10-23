import { describe, it, expect } from 'vitest';
import { render, act } from '@testing-library/react';
import { EditorView } from '@codemirror/view';
import { CodeEditor } from '@/components/code/CodeEditor';

const viewOf = (c: HTMLElement) => EditorView.findFromDOM(c.querySelector('.cm-editor') as HTMLElement)!;
const enter = (v: EditorView) => act(() => { v.contentDOM.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })); });
const setup = async (value: string, caret: number, language = 'json', indent: '2' | '4' | 'tab' = '4') => {
  const { container } = render(<CodeEditor value={value} language={language} indent={indent} />);
  const view = viewOf(container);
  await act(async () => { await new Promise((r) => setTimeout(r, 300)); });
  act(() => view.dispatch({ selection: { anchor: caret } }));
  return view;
};

describe('Enter after an opening bracket', () => {
  it('adds the missing closer on its own line and puts the caret on the indented line between', async () => {
    const view = await setup('{', 1);
    enter(view);
    expect(view.state.doc.toString()).toBe('{\n    \n}');
    expect(view.state.selection.main.head).toBe(6);
  });

  it('keeps the line indentation, uses the chosen unit, and works for [ and (', async () => {
    const a = await setup('  "a": [', 8, 'json', '2');
    enter(a);
    expect(a.state.doc.toString()).toBe('  "a": [\n    \n  ]');
    const b = await setup('f(', 2, 'javascript');
    enter(b);
    expect(b.state.doc.toString()).toBe('f(\n    \n)');
    const t = await setup('{', 1, 'json', 'tab');
    enter(t);
    expect(t.state.doc.toString()).toBe('{\n\t\n}');
  });

  it('leaves a bracket that already has its partner, and a caret between a pair, to the normal Enter', async () => {
    const paired = await setup('{\n}', 1);
    enter(paired);
    expect(paired.state.doc.toString()).toBe('{\n    \n}');
    const between = await setup('{}', 1);
    enter(between);
    expect(between.state.doc.toString()).toBe('{\n    \n}');
  });

  it('does nothing when text follows the bracket on the line, or after any other character', async () => {
    const mid = await setup('{ "a": 1', 1);
    enter(mid);
    expect(mid.state.doc.toString()).toBe('{\n    "a": 1');
    const plain = await setup('abc', 3);
    enter(plain);
    expect(plain.state.doc.toString()).toBe('abc\n');
  });
});
