import { describe, it, expect } from 'vitest';
import type { NoteBlock } from '@/types/notes';
import {
  backlinks, detectLinkTrigger, insertNoteLink, linksIn, noteLinkHref, noteLinkMarkdown, parseNoteLink,
} from '@/lib/noteLinks';
import { findInlineLinks, stripInline } from '@/lib/inlineMarkdown';

const para = (content: string, extra: Partial<NoteBlock> = {}): NoteBlock => ({ id: `p-${content.length}-${Math.random()}`, type: 'paragraph', content, ...extra });
const ID = '5f0d2c5e-1a2b-4c3d-8e9f-0123456789ab';

describe('note links', () => {
  it('a link is a markdown link with a hitlist address that parses back', () => {
    expect(noteLinkHref('note', ID)).toBe(`hitlist://note/${ID}`);
    expect(parseNoteLink(`hitlist://note/${ID}`)).toEqual({ kind: 'note', id: ID });
    expect(parseNoteLink(`hitlist://file/${ID}`)).toEqual({ kind: 'file', id: ID });
    for (const bad of ['https://example.com', 'hitlist://other/x', 'hitlist://note/', 'hitlist://note/a/b', 'not a url', 'javascript:alert(1)']) {
      expect(parseNoteLink(bad), bad).toBeNull();
    }
  });

  it('the inline parser reads it as a link and shows only the title', () => {
    const text = `see ${noteLinkMarkdown('note', ID, 'Road map')} now`;
    const links = findInlineLinks(text);
    expect(links).toHaveLength(1);
    expect(parseNoteLink(links[0].href)).toEqual({ kind: 'note', id: ID });
    expect(stripInline(text)).toBe('see Road map now');
    // A made-up scheme is still not a link.
    expect(findInlineLinks('[x](evil://note/a)')).toHaveLength(0);
  });

  it('makes a title safe to sit inside the brackets', () => {
    expect(noteLinkMarkdown('note', ID, 'A [b] c\nd')).toBe(`[A b c d](hitlist://note/${ID})`);
    expect(noteLinkMarkdown('file', ID, '   ')).toBe(`[Untitled](hitlist://file/${ID})`);
  });
});

describe('the [[ trigger', () => {
  it('opens right after [[ and follows what is typed', () => {
    expect(detectLinkTrigger('see [[', 6)).toEqual({ at: 4, query: '' });
    expect(detectLinkTrigger('see [[road ma', 13)).toEqual({ at: 4, query: 'road ma' });
    expect(detectLinkTrigger('x', 1)).toBeNull();
    expect(detectLinkTrigger('a [ b', 5)).toBeNull();
  });
  it('closes once it is finished or broken', () => {
    expect(detectLinkTrigger('[[done]] more', 13)).toBeNull();
    expect(detectLinkTrigger('[[a\nb', 5)).toBeNull();
    expect(detectLinkTrigger('[[' + 'x'.repeat(100), 102)).toBeNull();
  });
  it('replaces [[query with the finished link and puts the caret after it', () => {
    const out = insertNoteLink('see [[road and more', 10, { at: 4, query: 'road' }, 'note', ID, 'Roadmap');
    expect(out.content).toBe(`see [Roadmap](hitlist://note/${ID}) and more`);
    expect(out.caret).toBe(4 + `[Roadmap](hitlist://note/${ID})`.length);
  });
});

describe('linked from', () => {
  const notes = [
    { id: 'a', blocks: [para(`go to ${noteLinkMarkdown('note', 'target', 'T')}`)] },
    { id: 'b', blocks: [para('nothing')] },
    { id: 'c', blocks: [para(`${noteLinkMarkdown('note', 'target', 'T')} and ${noteLinkMarkdown('note', 'target', 'again')}`)] },
    { id: 'target', blocks: [para(`self ${noteLinkMarkdown('note', 'target', 'me')}`)] },
    { id: 'd', blocks: [{ id: 'x', type: 'code', content: `[T](hitlist://note/target)` } as NoteBlock] },
    { id: 'e', blocks: [{ id: 'y', type: 'page', content: 't', pageId: 'target' } as NoteBlock] },
  ];
  it('lists every other note that links to it, once each, in order', () => {
    expect(backlinks(notes, 'target').map((n) => n.id)).toEqual(['a', 'c']);
  });
  it('ignores code, the note itself and a parent\'s page block (that is the breadcrumb)', () => {
    const ids = backlinks(notes, 'target').map((n) => n.id);
    expect(ids).not.toContain('d');
    expect(ids).not.toContain('target');
    expect(ids).not.toContain('e');
  });
  it('knows links to files, including an embedded file', () => {
    const l = linksIn([para(noteLinkMarkdown('file', 'f1', 'script')), { id: 'z', type: 'codefile', content: '', fileId: 'f2' } as NoteBlock]);
    expect(l).toEqual([{ kind: 'file', id: 'f1' }, { kind: 'file', id: 'f2' }]);
    expect(backlinks([{ id: 'n', blocks: [para(noteLinkMarkdown('file', 'f1', 's'))] }], 'f1', 'file')).toHaveLength(1);
    expect(backlinks([{ id: 'n', blocks: [para(noteLinkMarkdown('file', 'f1', 's'))] }], 'f1', 'note')).toHaveLength(0);
  });
});
