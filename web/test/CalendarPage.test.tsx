import { render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import userEvent from '@testing-library/user-event';

const { loadCalendar } = vi.hoisted(() => ({
  loadCalendar: vi.fn(),
}));

vi.mock('@/lib/api', () => ({
  calendarApi: { load: loadCalendar },
  databaseApi: {
    list: vi.fn().mockResolvedValue([]),
    createRow: vi.fn(),
    setFieldValue: vi.fn(),
  },
  taskApi: {
    create: vi.fn(),
    update: vi.fn(),
  },
  ZOHO_CALENDAR_UNAVAILABLE_REASON: 'Zoho Calendar import is unavailable in the PostgreSQL-only migration.',
}));

import { CalendarPage } from '@/pages/CalendarPage';

describe('CalendarPage', () => {
  beforeEach(() => {
    loadCalendar.mockReset();
    loadCalendar.mockResolvedValue({ tasks: [], records: [] });
  });

  it('honestly marks Zoho Calendar import unavailable without a connect workflow', async () => {
    render(
      <CalendarPage
        lists={[]}
        onOpenTask={vi.fn()}
        onOpenDatabase={vi.fn()}
      />,
    );

    await waitFor(() => expect(loadCalendar).toHaveBeenCalledTimes(1));
    await userEvent.click(screen.getByRole('button', { name: 'Open sidebar' }));
    expect(screen.getByText('Zoho Calendar import is unavailable in the PostgreSQL-only migration.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /connect zoho calendar/i })).not.toBeInTheDocument();
  });
});
