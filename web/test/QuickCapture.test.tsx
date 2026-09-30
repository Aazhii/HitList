import { fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { QuickCapture } from '@/components/QuickCapture';

describe('QuickCapture', () => {
  it('shows what it read and adds that on Enter', () => {
    const onAdd = vi.fn();
    const onOpenChange = vi.fn();
    render(<QuickCapture open onOpenChange={onOpenChange} listName="Work" onAdd={onAdd} />);
    const box = screen.getByRole('textbox', { name: 'New task' });
    fireEvent.change(box, { target: { value: 'Send invoice 2026-12-01 3pm !schedule' } });
    expect(screen.getByText('Send invoice')).toBeInTheDocument();
    expect(screen.getByText('Schedule')).toBeInTheDocument();
    expect(screen.getByText('in Work')).toBeInTheDocument();
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(onAdd).toHaveBeenCalledWith({ title: 'Send invoice', quadrant: 'schedule', dueDate: '2026-12-01', dueTime: '15:00' });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('does nothing on Enter with an empty line', () => {
    const onAdd = vi.fn();
    render(<QuickCapture open onOpenChange={vi.fn()} onAdd={onAdd} />);
    fireEvent.keyDown(screen.getByRole('textbox', { name: 'New task' }), { key: 'Enter' });
    expect(onAdd).not.toHaveBeenCalled();
  });
});
