import { useState } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ReminderStepList } from '@/components/automations/ReminderStepList';

function Harness({ initial }: { initial: number[] }) {
  const [steps, setSteps] = useState(initial);
  return <><ReminderStepList steps={steps} onChange={setSteps} /><output data-testid="steps">{JSON.stringify(steps)}</output></>;
}
const steps = () => JSON.parse(screen.getByTestId('steps').textContent!);

describe('ReminderStepList', () => {
  it('lists each step in words', () => {
    render(<Harness initial={[-60, 0, 30]} />);
    expect(screen.getByRole('button', { name: 'Edit step 1' })).toHaveTextContent('1 hour before due');
    expect(screen.getByRole('button', { name: 'Edit step 2' })).toHaveTextContent('At due time');
    expect(screen.getByRole('button', { name: 'Edit step 3' })).toHaveTextContent('30 minutes after due');
  });

  it('adds a preset, keeping the steps in order, and removes one', async () => {
    render(<Harness initial={[0]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Add step' }));
    await userEvent.click(await screen.findByRole('button', { name: '1 hour before' }));
    expect(steps()).toEqual([-60, 0]);
    fireEvent.click(screen.getByRole('button', { name: 'Remove step 2' }));
    expect(steps()).toEqual([-60]);
  });

  it('offers no more once there are five', () => {
    render(<Harness initial={[-1440, -60, -15, -5, 0]} />);
    expect(screen.getByRole('button', { name: 'Add step' })).toBeDisabled();
  });

  it('edits a step\'s amount and unit', async () => {
    render(<Harness initial={[-30]} />);
    await userEvent.click(screen.getByRole('button', { name: 'Edit step 1' }));
    fireEvent.change(await screen.findByRole('spinbutton', { name: 'Step 1 amount' }), { target: { value: '2' } });
    expect(steps()).toEqual([-2]);
  });
});
