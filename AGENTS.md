# HitList Agent Rules

These rules apply to the entire repository, for every agent and contributor.

Before changes, read `docs/building/06-PRE-COMMIT-VALIDATION.md` and the current
handoff if present. Identify the owning behavior, affected platforms and a
focused regression check before editing. Preserve existing unrelated changes.

Before any commit:

- Run the focused regression and the mandatory local gate in the validation guide.
- Desktop startup, authentication, logout, restore, update, dependency and packaging
  changes require the platform matrix in that guide. A simulated platform branch
  is not a native Windows/Linux/macOS pass.
- Record commands, results, skipped checks, OS/architecture and artifact identity.
  Never describe an unavailable check as passed. Do not commit failed required
  checks. If a native/manual gate cannot run, disclose it and obtain explicit
  owner approval for a provisional commit; release remains blocked until tested.
- Stage only your changes. Inspect the staged diff, including mixed files.
  Never blanket-stage user changes, generated frontend files or app data.

Do not push, publish, deploy, tag releases or change cloud infrastructure without
explicit authorization. Use scratch profiles/data directories for tests, never
the installed HitList data directory. Do not delete user databases or backups,
weaken validation to make tests pass, or print credentials/session files.

Validation reduces regression risk; it cannot guarantee that no platform failure
will occur. Follow the evidence and report unresolved risks honestly.