import { describe, expect, it, vi } from 'vitest';
import { loadZohoCalendarEvents } from '../../server/zohoCalendar/events.ts';

describe('Zoho Calendar event adapter', () => {
  it('uses bounded date ranges and normalizes calendar event instances', async () => {
    const fetcher = vi.fn(async (input: string | URL, _init?: RequestInit) => {
      const url = new URL(String(input));
      const payload = url.pathname.endsWith('/calendars')
        ? { data: { calendars: [{ caluid: 'primary', name: 'Personal' }] } }
        : { data: { events: [{ uid: 'event-1', title: 'Planning', dateandtime: { start: '20260918T143000+0530' } }] } };
      return new Response(JSON.stringify(payload), { status: 200 });
    });
    const events = await loadZohoCalendarEvents('https://calendar.zoho.in/api/v1', 'access', 'Asia/Kolkata', new Date(2026, 8, 17), fetcher);
    expect(events).toContainEqual({ id: 'event-1', calendarId: 'primary', calendarName: 'Personal', title: 'Planning', date: '2026-09-18', time: '14:30' });
    expect(fetcher.mock.calls.length).toBeGreaterThan(12);
    for (const [, init] of fetcher.mock.calls) expect(init?.headers).toEqual({ Authorization: 'Bearer access' });
  });
});