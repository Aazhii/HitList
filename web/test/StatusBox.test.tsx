/**
 * The shared status control.
 *
 * It replaces three visual controls, so what matters is that it is one honest
 * checkbox to assistive tech in all three states, and that it passes clicks
 * through — the callers decide what "advance" means.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { StatusBox } from '@/components/ui/status-box';

describe('StatusBox', () => {
  it('is an unchecked checkbox when to do', () => {
    render(<StatusBox state="todo" label="Write report" />);
    const box = screen.getByRole('checkbox', { name: 'Write report' });
    expect(box).toHaveAttribute('aria-checked', 'false');
  });

  it('is a mixed checkbox when in progress', () => {
    render(<StatusBox state="in-progress" label="Write report" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'mixed');
  });

  it('is a checked checkbox when done', () => {
    render(<StatusBox state="done" label="Write report" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('aria-checked', 'true');
  });

  it('calls onClick', () => {
    const onClick = vi.fn();
    render(<StatusBox state="todo" label="Write report" onClick={onClick} />);
    fireEvent.click(screen.getByRole('checkbox'));
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('is a button, so it never submits a surrounding form', () => {
    render(<StatusBox state="todo" label="x" />);
    expect(screen.getByRole('checkbox')).toHaveAttribute('type', 'button');
  });
});
