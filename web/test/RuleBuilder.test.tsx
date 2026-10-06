import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { RuleBuilder, type RuleBuilderProps } from '@/components/automations/RuleBuilder';
import { RuleTemplates } from '@/components/automations/RuleTemplates';
import { RULE_TEMPLATES, emptySpec } from '@/lib/automationSpec';
import type { AutomationRule } from '@/types/automation';

function setup(over: Partial<RuleBuilderProps> = {}) {
  const props: RuleBuilderProps = {
    open: true, onOpenChange: vi.fn(), rule: null,
    start: { name: 'New rule', spec: emptySpec() },
    workspaces: [{ id: 'W'.repeat(43), name: 'Team' }],
    cliqEmail: 'me@zohocorp.com', cliqAvailable: true,
    onSave: vi.fn(async () => true), onSendTest: vi.fn(async () => 'sent'),
    ...over,
  };
  render(<RuleBuilder {...props} />);
  return props;
}

const template = (id: string) => RULE_TEMPLATES.find((t) => t.id === id)!.build();

describe('RuleBuilder', () => {
  it('saves a rule in the new shape, with the channel flags the older screens still read', async () => {
    const props = setup({ start: template('remind-before') });
    expect(screen.getByLabelText('Name')).toHaveValue('Remind me before it is due');
    await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalled());
    const input = vi.mocked(props.onSave).mock.calls[0][0];
    expect(input).toMatchObject({ name: 'Remind me before it is due', triggerType: 'custom', status: 'active', notifyInApp: true, notifyBrowser: true, notifyEmail: false });
    expect(input.spec?.triggers).toEqual([{ kind: 'date-reached', field: 'dueDate', offsets: [-60, -5] }]);
    expect(input.timezone).toBeTruthy();
    expect(props.onOpenChange).toHaveBeenCalledWith(false);
  });

  it('refuses to save and says what is missing', async () => {
    const props = setup();
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: '   ' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    expect(await screen.findByText('Give the rule a name.')).toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('adds a condition and sends it with the rule', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add a condition' }));
    const row = screen.getByRole('group', { name: 'Condition 1' });
    await userEvent.selectOptions(within(row).getByLabelText('Field'), 'category');
    await userEvent.selectOptions(within(row).getByLabelText('Is'), 'is');
    fireEvent.change(within(row).getByLabelText('Value'), { target: { value: 'Work' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalled());
    expect(vi.mocked(props.onSave).mock.calls[0][0].spec?.conditions).toEqual([{ field: 'category', op: 'is', value: 'Work' }]);
  });

  it('a condition with no value blocks saving', async () => {
    const props = setup();
    await userEvent.click(screen.getByRole('button', { name: 'Add a condition' }));
    const row = screen.getByRole('group', { name: 'Condition 1' });
    await userEvent.selectOptions(within(row).getByLabelText('Is'), 'contains');
    fireEvent.change(within(row).getByLabelText('Value'), { target: { value: '' } });
    await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    expect(await screen.findByText(/Give a value for/)).toBeInTheDocument();
    expect(props.onSave).not.toHaveBeenCalled();
  });

  it('configures the Cliq message, quiet hours and daily limit, and sends a test with the message', async () => {
    const props = setup({ start: template('overdue-cliq') });
    const action = screen.getByRole('group', { name: 'Action: Notify me via the Cliq bot' });
    expect(within(action).getByText(/Goes to me@zohocorp.com/)).toBeInTheDocument();
    fireEvent.change(within(action).getByLabelText('Message (optional)'), { target: { value: 'Late: {{title}}' } });
    expect(within(action).getByLabelText('Preview')).toHaveTextContent('Late: Send the quarterly report');
    fireEvent.change(within(action).getByLabelText('Quiet from'), { target: { value: '22:00' } });
    fireEvent.change(within(action).getByLabelText('Quiet until'), { target: { value: '07:00' } });
    fireEvent.change(within(action).getByLabelText('Messages a day'), { target: { value: '12' } });
    await userEvent.click(within(action).getByRole('switch', { name: 'One message for several tasks' }));

    await userEvent.click(within(action).getByRole('button', { name: 'Send a test with this message' }));
    expect(props.onSendTest).toHaveBeenCalledWith('Late: Send the quarterly report');
    expect(await within(action).findByText(/Look for a message from the HitList bot/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalled());
    const saved = vi.mocked(props.onSave).mock.calls[0][0];
    expect(saved.spec?.actions).toEqual([{ kind: 'notify-cliq', template: 'Late: {{title}}', combine: false, dailyCap: 12, quietFrom: '22:00', quietTo: '07:00' }]);
    expect(saved.notifyInApp).toBe(false);
  });

  it('says what is needed when there is no Cliq address, or when this is not the desktop app', () => {
    setup({ start: template('overdue-cliq'), cliqEmail: null });
    expect(screen.getAllByText(/needs your Cliq email/i).length).toBeGreaterThan(0);
    expect(screen.getByRole('button', { name: 'Send a test with this message' })).toBeDisabled();
  });

  it('in a browser the Cliq action is saved but says it will not send', () => {
    setup({ start: template('overdue-cliq'), cliqAvailable: false, onSendTest: undefined });
    expect(screen.getByText(/sent by the HitList desktop app/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Send a test with this message' })).toBeNull();
  });

  it('opens an existing rule, changes its status and what to do when the app was closed', async () => {
    const rule: AutomationRule = {
      id: 'r1', name: 'Existing', triggerType: 'custom', status: 'active', urgency: 'medium', notifyInApp: true, notifyBrowser: false,
      createdAt: 1, updatedAt: 1, spec: { ...emptySpec(), subjectId: 'task-1' },
    };
    const props = setup({ rule, start: null, subjectTitle: 'Write the report' });
    expect(screen.getByLabelText('Name')).toHaveValue('Existing');
    expect(screen.getByText(/Only “Write the report”/)).toBeInTheDocument();
    await userEvent.selectOptions(screen.getByLabelText('Status'), 'paused');
    await userEvent.selectOptions(screen.getByLabelText('Catch up'), '0');
    await userEvent.click(screen.getByRole('switch', { name: 'Include tasks that are already due' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalled());
    const saved = vi.mocked(props.onSave).mock.calls[0][0];
    expect(saved).toMatchObject({ status: 'paused', taskId: 'task-1' });
    expect(saved.spec?.options).toEqual({ catchUpMinutes: 0, catchUp: true });
  });

  it('keeps the dialog open and says so when saving fails', async () => {
    const props = setup({ onSave: vi.fn(async () => false) });
    await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    expect(await screen.findByText('The rule could not be saved. Try again.')).toBeInTheDocument();
    expect(props.onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('can look at a shared workspace and add and remove triggers and actions', async () => {
    const props = setup();
    await userEvent.selectOptions(screen.getByLabelText('Which tasks'), 'W'.repeat(43));
    await userEvent.selectOptions(screen.getByLabelText('Add another trigger'), 'status-becomes');
    await userEvent.selectOptions(screen.getByLabelText('Add another action'), 'set-status');
    expect(screen.getByRole('group', { name: 'Trigger: A task’s status becomes…' })).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole('button', { name: 'Remove this trigger' })[0]);
    await userEvent.click(screen.getByRole('button', { name: 'Create rule' }));
    await waitFor(() => expect(props.onSave).toHaveBeenCalled());
    const spec = vi.mocked(props.onSave).mock.calls[0][0].spec!;
    expect(spec.scope).toBe('W'.repeat(43));
    expect(spec.triggers.map((t) => t.kind)).toEqual(['status-becomes']);
    expect(spec.actions.map((a) => a.kind)).toEqual(['notify-in-app', 'set-status']);
  });
});

describe('RuleTemplates', () => {
  it('offers the starting points, marks the Cliq ones, and hands back the one chosen', async () => {
    const onPick = vi.fn();
    render(<RuleTemplates open onOpenChange={vi.fn()} cliqAvailable={false} onPick={onPick} />);
    const list = screen.getByRole('list', { name: 'Rule templates' });
    expect(within(list).getAllByRole('button')).toHaveLength(RULE_TEMPLATES.length);
    expect(within(list).getAllByText('Messages are sent by the desktop app.').length).toBe(RULE_TEMPLATES.filter((t) => t.usesCliq).length);
    await userEvent.click(within(list).getByRole('button', { name: /Tell me on Cliq when a task is overdue/ }));
    expect(onPick).toHaveBeenCalledWith(expect.objectContaining({ id: 'overdue-cliq' }));
  });
});
