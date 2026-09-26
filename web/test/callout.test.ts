/**
 * The callout block — the one addition in the redesign, and additive only.
 */
import { describe, it, expect } from 'vitest';
import { createEmptyBlock, getNotePreview, BLOCK_TYPE_LABELS } from '@/types/notes';
import { filterSlashCommands } from '@/components/notes/SlashMenu';
import { supportedMarks } from '@/components/notes/InlineText';

describe('callout', () => {
  it('starts with an emoji and the terracotta tone', () => {
    const block = createEmptyBlock('callout');
    expect(block.type).toBe('callout');
    expect(block.emoji).toBe('💡');
    expect(block.tone).toBe('accent');
  });

  it('adds no callout fields to other blocks', () => {
    const block = createEmptyBlock('paragraph');
    expect(block).not.toHaveProperty('emoji');
    expect(block).not.toHaveProperty('tone');
  });

  it('is reachable from the slash menu', () => {
    expect(filterSlashCommands('call').map((c) => c.type)).toContain('callout');
  });

  it('has a label', () => {
    expect(BLOCK_TYPE_LABELS.callout).toBe('Callout');
  });

  it('takes every inline mark', () => {
    expect(supportedMarks('callout')).toEqual(['bold', 'italic', 'underline', 'strike']);
  });

  it('contributes to note previews', () => {
    const note = {
      id: 'n', title: 't', createdAt: 0, updatedAt: 0,
      blocks: [{ ...createEmptyBlock('callout'), content: 'Budget **first**' }],
    };
    expect(getNotePreview(note)).toBe('Budget first');
  });
});
