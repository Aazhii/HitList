import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AutomationList } from '@/components/automations/AutomationList';
import { emptySpec } from '@/lib/automationSpec';
import type { AutomationRule } from '@/types/automation';

const base: AutomationRule = {
  id: 'r1', name: 'Overdue on Cliq', triggerType: 'custom', status: 'active', urgency: 'medium',
  notifyInApp: false, notifyBrowser: false, createdAt: 1, updatedAt: 1,
};

const props = { loading: false, filter: 'all' as const, onNew: vi.fn(), onEdit: vi.fn(), onToggle: vi.fn(), onDelete: vi.fn(), onRunNow: vi.fn() };

describe('AutomationList', () => {
  it('describes a rule in plain words: when, only if, then', () => {
    const spec = {
      ...emptySpec(),
      conditions: [{ field: 'category' as const, op: 'is' as const, value: 'Work' }],
      actions: [{ kind: 'notify-cliq' as const, combine: true }],
    };
    render(<AutomationList {...props} rules={[{ ...base, spec }]} />);
    const text = screen.getByText(/A task’s due date/).textContent ?? '';
    expect(text).toContain('Only if Category is “Work”');
    expect(text).toContain('Then: Message me on Cliq');
  });

  it('shows why a rule stopped working', () => {
    render(<AutomationList {...props} rules={[{ ...base, spec: emptySpec(), error: 'Stopped after 5 tries; check the rule and run it again.' }]} />);
    expect(screen.getByRole('alert')).toHaveTextContent('Stopped after 5 tries');
  });

  it('still describes an older rule that has no spec', () => {
    render(<AutomationList {...props} rules={[{ ...base, triggerType: 'due-date', offsetMinutes: [-60], notifyInApp: true }]} />);
    expect(screen.getByText(/In-app/)).toBeInTheDocument();
  });
});
