# Needs first

A task can wait on other tasks. Example: *Ship release* needs *Write notes* and *Run tests* first.

## Linking
- **Task detail panel → Needs first**: search your open tasks and pick them (a task cannot need itself, and two tasks cannot wait on each other).
  "Create “…” as a new task" makes a task on the spot. The same panel shows **Waiting on this:** for tasks that need this one.
- **Add task dialog → Needs first (optional)**: the same picker; new tasks typed there are made together with the task.
- **Quick add** (`c`): `Ship release fri >Write notes >Run tests`. Each `>` part runs to the next `>`, the next `!` or the end of the line, so write dates
  before them. A part matches an open task with the same words (or the only one that starts with them); otherwise it becomes a new task. The preview
  under the box says "Needs first: Write notes (existing) · Run tests (new)". A `>` followed by a space (a < b > c) is just text.
- A task that still waits shows **Waiting on N** on its card and row. Done tasks never show it.

## Completing
Whenever a task is completed (tick, status menu, table cell, bulk bar) and some of the tasks it needs are still open, a pop-up lists them:
**Cancel** (the default) · **Complete anyway** · **Finish them too** (completes what is needed, deepest first, then the task).
Reopening a task never asks. A bulk change asks once for all selected tasks.

- **Cliq bot "complete"** refuses: "Task still needs … first. Finish those, or complete it in HitList."
- **Automations ("mark done")** complete anyway: a rule you wrote on purpose just does its job.
- A recurring task's **next copy starts without links**.
- Deleting a task needs no clean-up: ids that no longer exist are ignored everywhere.

## Technical
Stored on the task row as `NeedsFirstIds` (a JSON array of ids as text, at most 20; additive, old rows have none). API field `needsFirst: string[]`.
Server checks in `TaskService.applyNeedsFirst` (exists in this workspace, not itself, no loop, ≤ 20). Shared workspaces: the key is in
`SyncJournal.SHARED_FIELDS` and in `FIELDS.tasks` of `functions/backup/workspaces.js`. **Deploy the function before installing a desktop build that has this**
(`sh scripts/deploy-backup-function.sh`), otherwise a shared edit that carries a link is rejected by the cloud (the local copy keeps it).
Web: `lib/taskNeeds.ts` (rules), `hooks/useNeedsFirstGate.ts` (the question), `components/tasks/NeedsFirstDialog.tsx`, `NeedsFirstPicker.tsx`, `WaitingBadge.tsx`.
