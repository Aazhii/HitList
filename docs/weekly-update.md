# Weekly update

Every Monday a team update is due: what moved in the past week, **including work that did not finish**. HitList cannot know
that by itself (it has no history of edits), so it works in two steps and does not call any model.

1. **Log progress as you work.** Press `l` (or ⌘/Ctrl+L) anywhere, type one line, press Enter. Choose Moved, Discussed,
   Blocked or Done. Example: `Discussed ZCRM-1058212 with @naga, looping him in, still open`. The text is stored as typed; ids,
   @names and `[links](https://…)` are kept verbatim. Lines are saved in the progress log (`KaizenWorkLog`, one row each,
   personal to the computer, not synced to shared workspaces). If storage cannot be reached the line waits in local storage
   (`hitlist-progress-pending-v1`) and is sent later, never dropped; only a line the server calls invalid is discarded.
2. **Open Weekly update (sidebar).** It shows the week (last week on Monday and Tuesday), grouped into your sections:
   your progress lines, tasks finished in the week, then background (tasks saved, notes edited, records added or edited).
   Untick what should not go in, edit a line, or move it to another section. **Copy the prompt** puts one block of text on the
   clipboard: the rules and format, your past updates as examples, and the week's material with each item tagged
   PARTIAL, BLOCKED or DONE. Paste it into any LLM. "Show what is copied" displays the exact text first.

## Sections and examples
"Sections and examples" on the page sets the team name, the section names and order, a line prefix per section (e.g. `RE - `),
which section everything else goes to, and rules that route by a task's list, category or field value. Paste a few of your real
past updates into "Past updates" so the model copies their shape. These settings live in local storage
(`hitlist-weekly-settings-v1`) and are not committed anywhere; the built-in example is generic.

## What reaches the prompt
- Your **progress lines** and the tasks you **finished** (with their notes).
- **Open tasks you worked on this week that carry a note**: the task's own note is sent as the words behind it, tagged OPEN so the model reports what you wrote and that it is still open.
- **Notes edited this week**, as raw text (at most 2,500 characters each; a bullet, to-do or toggle keeps its marker and nesting). A note has no per-line dates, so the prompt tells the model to use only lines that clearly say work was done, something was discussed or a decision was made.
- Background (titles only): tasks saved without a note, records, notes with no text. If the prompt would pass 20,000 characters, the background goes first, then each note is cut shorter; your progress lines are never cut.
- No line prefix is forced. A section's prefix (for example a team tag) is only added if you set one in "Sections and examples".

## What the page knows (and does not)
Only what you log and what you complete is progress. Edits, notes and records are shown as background and are told to the model
as context only. A task saved this week (`updatedAt`, from the server) cannot say what changed.

## Monday reminder
Automations → New rule → "Monday reminder for the weekly update": every Monday 09:30, an in-app and desktop notice, with catch-up
for a Monday the app opened late. It uses the existing weekly trigger; no engine change.

## Code
`web/src/lib/weeklyUpdate.ts` (pure: week range, sections, collecting, prompt), `hooks/useProgressLog.ts`,
`components/worklog/LogProgressDialog.tsx`, `pages/WeeklyUpdatePage.tsx`; Java `WorkLogService`, `WorkLogController`
(`/api/worklog`). Backups include the log (`WorkspaceBackupService.TABLES`) and sign-in claiming moves it with the rest
(`WorkspaceClaimService`). A backup file containing `KaizenWorkLog` will not import into an older HitList (unknown table).
