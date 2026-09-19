/** Read-only Zoho Calendar API adapter. */
export interface ZohoCalendarEvent {
  id: string;
  calendarId: string;
  calendarName: string;
  title: string;
  date: string;
  time?: string;
}

type FetchLike = (input: string | URL, init?: RequestInit) => Promise<Response>;
type Raw = Record<string, unknown>;

function asArray(value: unknown): Raw[] {
  return Array.isArray(value) ? value.filter((item): item is Raw => Boolean(item) && typeof item === 'object') : [];
}

function dateParts(value: string, timeZone: string): { date: string; time?: string } | null {
  const compact = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})\d{2}(Z|[+-]\d{4})?)?$/);
  if (!compact) return null;
  const [, year, month, day, hour, minute, zone] = compact;
  if (!hour) return { date: `${year}-${month}-${day}` };
  if (!zone) return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
  const isoZone = zone === 'Z' ? 'Z' : `${zone.slice(0, 3)}:${zone.slice(3)}`;
  const instant = new Date(`${year}-${month}-${day}T${hour}:${minute}:00${isoZone}`);
  if (Number.isNaN(instant.valueOf())) return null;
  const values = new Intl.DateTimeFormat('en-CA', {
    timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  }).formatToParts(instant).reduce<Record<string, string>>((out, part) => ({ ...out, [part.type]: part.value }), {});
  return { date: `${values.year}-${values.month}-${values.day}`, time: `${values.hour}:${values.minute}` };
}

function eventStart(event: Raw): string {
  const dateTime = event['dateandtime'];
  if (typeof dateTime === 'string') return dateTime;
  if (dateTime && typeof dateTime === 'object') {
    const record = dateTime as Raw;
    return String(record['start'] ?? record['starttime'] ?? record['start_time'] ?? '');
  }
  return String(event['start'] ?? event['starttime'] ?? '');
}

function apiUrl(base: string, path: string): URL {
  return new URL(path.replace(/^\//, ''), `${base.replace(/\/$/, '')}/`);
}

async function getJson(url: URL, accessToken: string, fetcher: FetchLike): Promise<Raw> {
  const response = await fetcher(url, { headers: { Authorization: `Bearer ${accessToken}` } });
  const body = await response.json().catch(() => null);
  if (!response.ok || !body || typeof body !== 'object') throw new Error('Zoho Calendar events could not be loaded.');
  return body as Raw;
}

/** Fetches all visible calendars and their event instances in <=31-day ranges. */
export async function loadZohoCalendarEvents(
  apiBase: string, accessToken: string, timeZone: string, now = new Date(), fetcher: FetchLike = fetch,
): Promise<ZohoCalendarEvent[]> {
  const calendarBody = await getJson(apiUrl(apiBase, '/calendars'), accessToken, fetcher);
  const calendars = asArray((calendarBody['data'] as Raw | undefined)?.['calendars'] ?? calendarBody['calendars']);
  const from = new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
  const until = new Date(now.getFullYear() + 1, now.getMonth(), now.getDate());
  const output = new Map<string, ZohoCalendarEvent>();

  for (const calendar of calendars) {
    const calendarId = String(calendar['caluid'] ?? calendar['uid'] ?? '');
    if (!calendarId) continue;
    const calendarName = String(calendar['name'] ?? calendar['title'] ?? 'Zoho Calendar');
    for (let cursor = new Date(from); cursor < until; cursor.setDate(cursor.getDate() + 31)) {
      const end = new Date(Math.min(cursor.valueOf() + 31 * 86_400_000, until.valueOf()));
      const range = JSON.stringify({
        start: cursor.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''),
        end: end.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, ''),
      });
      const url = apiUrl(apiBase, `/calendars/${encodeURIComponent(calendarId)}/events`);
      url.searchParams.set('range', range);
      url.searchParams.set('byinstance', 'true');
      url.searchParams.set('timezone', timeZone);
      const body = await getJson(url, accessToken, fetcher);
      const events = asArray((body['data'] as Raw | undefined)?.['events'] ?? body['events']);
      for (const event of events) {
        const uid = String(event['uid'] ?? event['id'] ?? '');
        const when = dateParts(eventStart(event), timeZone);
        if (!uid || !when) continue;
        const item = { id: uid, calendarId, calendarName, title: String(event['title'] ?? 'Untitled event'), ...when };
        output.set(`${calendarId}:${uid}:${when.date}`, item);
      }
    }
  }
  return [...output.values()];
}