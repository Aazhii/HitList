/**
 * Quick capture (P6.1): one line in, a task out. The line may carry a due date ("tomorrow", "fri",
 * "in 3 days", "oct 5", "2026-10-05"), a time ("3pm", "15:30", "at 9"), a repeat ("every week", "every weekday", or "daily" / "weekly" / "monthly" as the last word) and a quadrant ("!do",
 * "!schedule", "!delegate", "!eliminate") and tasks it needs first (">Write notes >Run tests": each runs to the next ">", the next "!" or the end,
 * so a date goes before them). What is recognised is taken out of the title; everything
 * else stays as typed. Pure: `now` is passed in.
 */
import type { Quadrant } from '@/types/todo';
import type { Recurrence } from '@/lib/recurrence';

export interface CapturedTask {
  title: string;
  quadrant?: Quadrant;
  dueDate?: string;
  dueTime?: string;
  recurrence?: Recurrence;
  /** Titles typed after ">": tasks this one needs finished first (matched to open tasks, or made, by the caller). */
  needs?: string[];
}

const DAYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const QUADRANT_WORDS: Record<string, Quadrant> = { do: 'do', schedule: 'schedule', delegate: 'delegate', eliminate: 'eliminate' };

const pad = (n: number) => String(n).padStart(2, '0');
const iso = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const addDays = (d: Date, n: number) => { const r = new Date(d); r.setDate(r.getDate() + n); return r; };

/** Takes the first match of `re` out of `text`, returning the match and what is left. */
function take(text: string, re: RegExp): [RegExpMatchArray | null, string] {
  const m = text.match(re);
  return m ? [m, (text.slice(0, m.index) + ' ' + text.slice((m.index ?? 0) + m[0].length)).replace(/\s+/g, ' ').trim()] : [null, text];
}

function parseTime(text: string): [string | undefined, string] {
  let [m, rest] = take(text, /(?:^|\s)(?:at\s+)?(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/i);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3].toLowerCase() === 'pm') h += 12;
    const min = Number(m[2] ?? 0);
    if (Number(m[1]) >= 1 && Number(m[1]) <= 12 && min < 60) return [`${pad(h)}:${pad(min)}`, rest];
  }
  [m, rest] = take(text, /(?:^|\s)(?:at\s+)?([01]?\d|2[0-3]):([0-5]\d)\b/i);
  if (m) return [`${pad(Number(m[1]))}:${m[2]}`, rest];
  return [undefined, text];
}

function parseDate(text: string, now: Date): [string | undefined, string] {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  let m: RegExpMatchArray | null;
  let rest: string;

  [m, rest] = take(text, /(?:^|\s)(\d{4})-(\d{2})-(\d{2})(?=\s|$)/);
  if (m) return [`${m[1]}-${m[2]}-${m[3]}`, rest];

  [m, rest] = take(text, /(?:^|\s)in\s+(\d{1,3})\s+(day|days|week|weeks)\b/i);
  if (m) return [iso(addDays(today, Number(m[1]) * (m[2].toLowerCase().startsWith('week') ? 7 : 1))), rest];

  [m, rest] = take(text, /(?:^|\s)(today|tonight|tomorrow|tmrw)\b/i);
  if (m) return [iso(addDays(today, /^to(morrow|mrw)|^tmrw/i.test(m[1]) ? 1 : 0)), rest];

  [m, rest] = take(text, /(?:^|\s)(?:next\s+)?(sun(?:day)?|mon(?:day)?|tue(?:s|sday)?|wed(?:nesday)?|thu(?:r|rs|rsday)?|fri(?:day)?|sat(?:urday)?)\b/i);
  if (m) {
    const word = m[1].toLowerCase();
    const target = DAYS.findIndex((d) => word.startsWith(d));
    const ahead = (target - today.getDay() + 7) % 7 || 7;
    return [iso(addDays(today, ahead)), rest];
  }

  const monthRe = MONTHS.join('|');
  [m, rest] = take(text, new RegExp(`(?:^|\\s)(${monthRe})[a-z]*\\.?\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'i'));
  let month: number | undefined; let day: number | undefined;
  if (m) { month = MONTHS.indexOf(m[1].toLowerCase()); day = Number(m[2]); }
  else {
    [m, rest] = take(text, new RegExp(`(?:^|\\s)(\\d{1,2})(?:st|nd|rd|th)?\\s+(${monthRe})[a-z]*\\b`, 'i'));
    if (m) { day = Number(m[1]); month = MONTHS.indexOf(m[2].toLowerCase()); }
  }
  if (month !== undefined && day !== undefined && day >= 1 && day <= 31) {
    let year = today.getFullYear();
    if (new Date(year, month, day) < today) year += 1;
    const d = new Date(year, month, day);
    if (d.getMonth() === month) return [iso(d), rest];
  }
  return [undefined, text];
}

function parseRecurrence(text: string): [Recurrence | undefined, string] {
  const [m, rest] = take(text, /(?:^|\s)(every\s+(?:day|weekday|week|month)\b|(?:daily|weekly|monthly)$)/i);
  if (!m) return [undefined, text];
  const w = m[1].toLowerCase().replace(/^every\s+/, '');
  const kind: Recurrence = w.startsWith('weekday') ? 'weekdays' : w.startsWith('day') || w === 'daily' ? 'daily' : w.startsWith('week') ? 'weekly' : 'monthly';
  return [kind, rest];
}

export function parseQuickCapture(input: string, now: Date): CapturedTask {
  const original = input.replace(/\s+/g, ' ').trim();
  let text = original;

  // ">Write notes >Run tests": what this task needs first. A ">" with a space after it (a < b > c) is just text.
  const needs: string[] = [];
  for (let guard = 0; guard < 20; guard += 1) {
    const [n, rest] = take(text, /(?:^|\s)>(\S[^>!]*)/);
    if (!n) break;
    const title = n[1].trim();
    if (title && !needs.some((x) => x.toLowerCase() === title.toLowerCase())) needs.push(title);
    text = rest;
  }

  let quadrant: Quadrant | undefined;
  const [q, afterQ] = take(text, /(?:^|\s)!(do|schedule|delegate|eliminate)\b/i);
  if (q) { quadrant = QUADRANT_WORDS[q[1].toLowerCase()]; text = afterQ; }

  const [recurrence, afterRecurrence] = parseRecurrence(text);
  text = afterRecurrence;

  const [dueTime, afterTime] = parseTime(text);
  text = afterTime;
  const [parsedDate, afterDate] = parseDate(text, now);
  let dueDate = parsedDate;
  text = afterDate;
  // A time on its own means today.
  if (dueTime && !dueDate) dueDate = iso(now);
  // A repeat needs a date to repeat from: "water plants every week" starts today.
  if (recurrence && !dueDate) dueDate = iso(now);

  // Nothing left to call it: keep the line as typed rather than make an empty task.
  const title = text || original;
  return { title, ...(quadrant && { quadrant }), ...(dueDate && { dueDate }), ...(dueTime && { dueTime }), ...(recurrence && { recurrence }), ...(needs.length && { needs }) };
}
