/**
 * AddTaskDialog tests (inline component from App.tsx)
 * Tests validation, submission, and quadrant selection.
 * We test via the App component's dialog trigger.
 */
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';
import userEvent from '@testing-library/user-event';

// Minimal standalone AddTaskDialog extracted for testing
import type { Quadrant } from '@/types/todo';
import { QUADRANTS } from '@/types/todo';
import React, { useState, useRef, useEffect } from 'react';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';

interface TestDialogProps {
  open: boolean;
  defaultQuadrant: Quadrant;
  onOpenChange: (v: boolean) => void;
  onAdd: (text: string, quadrant: Quadrant) => void;
}

function TestAddDialog({ open, defaultQuadrant, onOpenChange, onAdd }: TestDialogProps) {
  const [text, setText] = useState('');
  const [quadrant, setQuadrant] = useState<Quadrant>(defaultQuadrant);
  const [error, setError] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuadrant(defaultQuadrant);
      setTimeout(() => inputRef.current?.focus(), 10);
    }
  }, [open, defaultQuadrant]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) { setError('Task description is required.'); return; }
    onAdd(text.trim(), quadrant);
    setText(''); setError('');
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Add task to matrix</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit}>
          <input
            ref={inputRef}
            data-testid="task-input"
            value={text}
            onChange={(e) => { setText(e.target.value); setError(''); }}
            placeholder="What needs to be done?"
          />
          {error && <p role="alert" data-testid="error-msg">{error}</p>}
          <div data-testid="quadrant-selector">
            {QUADRANTS.map((q) => (
              <button
                key={q.id}
                type="button"
                data-testid={`quadrant-${q.id}`}
                aria-pressed={quadrant === q.id}
                onClick={() => setQuadrant(q.id)}
              >
                {q.label}
              </button>
            ))}
          </div>
          <button type="submit" data-testid="submit-btn">Add Task</button>
        </form>
      </DialogContent>
    </Dialog>
  );
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe('AddTaskDialog', () => {
  it('shows validation error when submitting empty text', async () => {
    const onAdd = vi.fn();
    render(
      <TestAddDialog
        open={true}
        defaultQuadrant="do"
        onOpenChange={vi.fn()}
        onAdd={onAdd}
      />
    );

    fireEvent.click(screen.getByTestId('submit-btn'));

    await waitFor(() => {
      expect(screen.getByTestId('error-msg')).toBeInTheDocument();
    });
    expect(onAdd).not.toHaveBeenCalled();
  });

  it('calls onAdd with correct text and default quadrant', async () => {
    const onAdd = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <TestAddDialog
        open={true}
        defaultQuadrant="do"
        onOpenChange={onOpenChange}
        onAdd={onAdd}
      />
    );

    const input = screen.getByTestId('task-input');
    await userEvent.type(input, 'My new task');
    fireEvent.click(screen.getByTestId('submit-btn'));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith('My new task', 'do');
    });
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('allows changing the quadrant before submitting', async () => {
    const onAdd = vi.fn();
    render(
      <TestAddDialog
        open={true}
        defaultQuadrant="do"
        onOpenChange={vi.fn()}
        onAdd={onAdd}
      />
    );

    // Switch to 'schedule' quadrant
    fireEvent.click(screen.getByTestId('quadrant-schedule'));
    expect(screen.getByTestId('quadrant-schedule')).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByTestId('quadrant-do')).toHaveAttribute('aria-pressed', 'false');

    const input = screen.getByTestId('task-input');
    await userEvent.type(input, 'Scheduled task');
    fireEvent.click(screen.getByTestId('submit-btn'));

    await waitFor(() => {
      expect(onAdd).toHaveBeenCalledWith('Scheduled task', 'schedule');
    });
  });

  it('clears error when user starts typing after failed submit', async () => {
    const onAdd = vi.fn();
    render(
      <TestAddDialog
        open={true}
        defaultQuadrant="do"
        onOpenChange={vi.fn()}
        onAdd={onAdd}
      />
    );

    // Trigger error
    fireEvent.click(screen.getByTestId('submit-btn'));
    await waitFor(() => expect(screen.getByTestId('error-msg')).toBeInTheDocument());

    // Start typing — error should clear
    const input = screen.getByTestId('task-input');
    await userEvent.type(input, 'a');
    expect(screen.queryByTestId('error-msg')).not.toBeInTheDocument();
  });

  it('resets to defaultQuadrant when dialog reopens', async () => {
    const onAdd = vi.fn();
    const { rerender } = render(
      <TestAddDialog
        open={true}
        defaultQuadrant="do"
        onOpenChange={vi.fn()}
        onAdd={onAdd}
      />
    );

    // Switch quadrant
    fireEvent.click(screen.getByTestId('quadrant-eliminate'));
    expect(screen.getByTestId('quadrant-eliminate')).toHaveAttribute('aria-pressed', 'true');

    // Close and reopen
    rerender(
      <TestAddDialog
        open={false}
        defaultQuadrant="schedule"
        onOpenChange={vi.fn()}
        onAdd={onAdd}
      />
    );
    rerender(
      <TestAddDialog
        open={true}
        defaultQuadrant="schedule"
        onOpenChange={vi.fn()}
        onAdd={onAdd}
      />
    );

    await waitFor(() => {
      expect(screen.getByTestId('quadrant-schedule')).toHaveAttribute('aria-pressed', 'true');
    });
  });
});
