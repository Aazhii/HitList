import { render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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
    // The sidebar (rendered by App) now owns "What's on it" — CalendarPage
    // reports its content up via a callback instead of rendering its own
    // context column, so this checks what gets reported.
    const onSidebarContentChange = vi.fn();
    render(
      <CalendarPage
        lists={[]}
        onOpenTask={vi.fn()}
        onOpenDatabase={vi.fn()}
        onSidebarContentChange={onSidebarContentChange}
      />,
    );

    await waitFor(() => expect(loadCalendar).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onSidebarContentChange).toHaveBeenCalled());

    const reportedContext = onSidebarContentChange.mock.calls.at(-1)?.[0];
    const { getByText, queryByRole } = render(<>{reportedContext}</>);
    expect(getByText('Zoho Calendar import is unavailable in the PostgreSQL-only migration.')).toBeInTheDocument();
    expect(queryByRole('button', { name: /connect zoho calendar/i })).not.toBeInTheDocument();
  });
});
