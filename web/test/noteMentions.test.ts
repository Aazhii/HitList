import { describe, expect, it } from 'vitest';
import {
  MAX_TASK_TITLE,
  canMention,
  detectMentionTrigger,
  removeMentionTrigger,
  taskTitleFromBlock,
} from '@/lib/noteMentions';

describe('detectMentionTrigger', () => {
  it('fires at the start of a block', () => {
    expect(detectMentionTrigger('@', 1)).toEqual({ at: 0, query: '' });
    expect(detectMentionTrigger('@wor', 4)).toEqual({ at: 0, query: 'wor' });
  });

  it('fires after whitespace', () => {
    expect(detectMentionTrigger('Buy milk @', 10)).toEqual({ at: 9, query: '' });
    expect(detectMentionTrigger('line\n@do', 8)).toEqual({ at: 5, query: 'do' });
  });

  it('does not fire inside an email address or a word', () => {
    expect(detectMentionTrigger('mail a@b.com', 8)).toBeNull();
    expect(detectMentionTrigger('mail a@', 7)).toBeNull();
  });

  it('closes once a space follows the query', () => {
    expect(detectMentionTrigger('@do first', 9)).toBeNull();
  });

  it('only looks behind the caret', () => {
    expect(detectMentionTrigger('text @do', 4)).toBeNull();
  });
});

describe('removeMentionTrigger', () => {
  it('removes the trigger and the space before it', () => {
    const v = 'Buy milk @do';
    const t = detectMentionTrigger(v, v.length)!;
    expect(removeMentionTrigger(v, t)).toEqual({ content: 'Buy milk', caret: 8 });
  });

  it('keeps text after the trigger', () => {
    const v = 'Buy @ milk';
    const t = detectMentionTrigger(v, 5)!;
    expect(removeMentionTrigger(v, t).content).toBe('Buy milk');
  });
});

describe('taskTitleFromBlock', () => {
  it('strips formatting and collapses whitespace', () => {
    expect(taskTitleFromBlock('  **Call**   the\n*bank*  ')).toBe('Call the bank');
  });

  it('is empty for an empty block', () => {
    expect(taskTitleFromBlock('  ')).toBe('');
  });

  it('caps the title at what the API accepts', () => {
    const title = taskTitleFromBlock('x'.repeat(400));
    expect(title.length).toBe(MAX_TASK_TITLE);
    expect(title.endsWith('…')).toBe(true);
  });
});

describe('canMention', () => {
  it('excludes code, tables and dividers', () => {
    expect(canMention('paragraph')).toBe(true);
    expect(canMention('todo')).toBe(true);
    expect(canMention('code')).toBe(false);
    expect(canMention('table')).toBe(false);
    expect(canMention('divider')).toBe(false);
  });
});
