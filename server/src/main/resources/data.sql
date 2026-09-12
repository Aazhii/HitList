-- ============================================================
-- Kaizen Todo — Seed Data
-- Mirrors the frontend createSeedState() in src/lib/storage.ts
-- so the UI shows a rich demo on first run.
--
-- Three lists: Daily Growth, Work Focus, Health & Wellness
-- Tasks cover all quadrants, statuses, and optional fields.
-- DONE tasks have completedAt = today so Today's History works.
-- ============================================================

-- ── Lists ────────────────────────────────────────────────────────────────────

INSERT INTO kaizen_lists (id, name, color, list_order, created_at, updated_at) VALUES
('a1000000-0000-0000-0000-000000000001', 'Daily Growth',      'emerald', 0, DATEADD('DAY', -5, CURRENT_TIMESTAMP), DATEADD('DAY', -5, CURRENT_TIMESTAMP)),
('a1000000-0000-0000-0000-000000000002', 'Work Focus',        'blue',    1, DATEADD('DAY', -3, CURRENT_TIMESTAMP), DATEADD('DAY', -3, CURRENT_TIMESTAMP)),
('a1000000-0000-0000-0000-000000000003', 'Health & Wellness', 'rose',    2, DATEADD('DAY', -2, CURRENT_TIMESTAMP), DATEADD('DAY', -2, CURRENT_TIMESTAMP));

-- ── Tasks — Work Focus (list 2) ──────────────────────────────────────────────

-- DO quadrant
INSERT INTO tasks (id, title, status, quadrant, priority, note, due_date, due_time, category, list_id, task_order, reminder_enabled, completed_at, created_at, updated_at) VALUES
(
  RANDOM_UUID(),
  'Prepare slides for the 3pm client presentation',
  'IN_PROGRESS', 'DO', 'HIGH',
  'Cover Q3 results, roadmap, and pricing. Deck is in Google Drive.',
  CURRENT_DATE, '15:00', 'work',
  'a1000000-0000-0000-0000-000000000002', 0, TRUE,
  NULL,
  DATEADD('MINUTE', -90, CURRENT_TIMESTAMP),
  DATEADD('MINUTE', -30, CURRENT_TIMESTAMP)
),
(
  RANDOM_UUID(),
  'Fix critical login bug reported by users',
  'TODO', 'DO', 'HIGH',
  'Auth token expiry issue on mobile. Ticket #4821.',
  CURRENT_DATE, '12:00', 'work',
  'a1000000-0000-0000-0000-000000000002', 1, FALSE,
  NULL,
  DATEADD('HOUR', -1, CURRENT_TIMESTAMP),
  DATEADD('HOUR', -1, CURRENT_TIMESTAMP)
),
(
  RANDOM_UUID(),
  'Reply to urgent email from project stakeholder',
  'DONE', 'DO', 'HIGH',
  'Confirm timeline and budget approval for Q4 roadmap.',
  CURRENT_DATE, NULL, 'work',
  'a1000000-0000-0000-0000-000000000002', 2, FALSE,
  DATEADD('HOUR', -2, CURRENT_TIMESTAMP),
  DATEADD('HOUR', -3, CURRENT_TIMESTAMP),
  DATEADD('HOUR', -2, CURRENT_TIMESTAMP)
),

-- SCHEDULE quadrant
(
  RANDOM_UUID(),
  'Plan next sprint with the engineering team',
  'TODO', 'SCHEDULE', 'MEDIUM',
  'Review backlog, estimate stories, assign owners.',
  DATEADD('DAY', 3, CURRENT_DATE), '10:00', 'work',
  'a1000000-0000-0000-0000-000000000002', 3, FALSE,
  NULL,
  DATEADD('HOUR', -5, CURRENT_TIMESTAMP),
  DATEADD('HOUR', -5, CURRENT_TIMESTAMP)
),
(
  RANDOM_UUID(),
  'Write unit tests for TaskService',
  'IN_PROGRESS', 'SCHEDULE', 'HIGH',
  'Cover createTask, updateStatus, markComplete, and edge cases for completedAt transitions.',
  DATEADD('DAY', 1, CURRENT_DATE), '18:00', 'work',
  'a1000000-0000-0000-0000-000000000002', 4, FALSE,
  NULL,
  DATEADD('HOUR', -3, CURRENT_TIMESTAMP),
  DATEADD('MINUTE', -30, CURRENT_TIMESTAMP)
),
(
  RANDOM_UUID(),
  'Review Q3 OKRs and align team goals',
  'DONE', 'SCHEDULE', 'MEDIUM',
  'Focus on engineering velocity and customer satisfaction metrics.',
  CURRENT_DATE, '10:00', 'work',
  'a1000000-0000-0000-0000-000000000002', 5, FALSE,
  DATEADD('MINUTE', -45, CURRENT_TIMESTAMP),
  DATEADD('DAY', -2, CURRENT_TIMESTAMP),
  DATEADD('MINUTE', -45, CURRENT_TIMESTAMP)
),

-- DELEGATE quadrant
(
  RANDOM_UUID(),
  'Schedule 1-on-1s with direct reports',
  'TODO', 'DELEGATE', 'MEDIUM',
  'Bi-weekly cadence. Ask EA to block 30-min slots on Tuesdays.',
  DATEADD('DAY', 2, CURRENT_DATE), NULL, 'work',
  'a1000000-0000-0000-0000-000000000002', 6, FALSE,
  NULL,
  DATEADD('DAY', -1, CURRENT_TIMESTAMP),
  DATEADD('DAY', -1, CURRENT_TIMESTAMP)
),

-- ELIMINATE quadrant
(
  RANDOM_UUID(),
  'Clear old Slack notification channels',
  'TODO', 'ELIMINATE', 'LOW',
  'Archive #random-2021 and #temp-migration. Low signal, high noise.',
  NULL, NULL, 'work',
  'a1000000-0000-0000-0000-000000000002', 7, FALSE,
  NULL,
  DATEADD('DAY', -5, CURRENT_TIMESTAMP),
  DATEADD('DAY', -5, CURRENT_TIMESTAMP)
);

-- ── Tasks — Daily Growth (list 1) ────────────────────────────────────────────

INSERT INTO tasks (id, title, status, quadrant, priority, note, due_date, due_time, category, list_id, task_order, reminder_enabled, completed_at, created_at, updated_at) VALUES
(
  RANDOM_UUID(),
  'Write quarterly personal growth reflection',
  'TODO', 'SCHEDULE', 'MEDIUM',
  'Review goals set in January. What worked, what didn''t, what to adjust.',
  DATEADD('DAY', 5, CURRENT_DATE), NULL, 'personal',
  'a1000000-0000-0000-0000-000000000001', 0, FALSE,
  NULL,
  DATEADD('DAY', -1, CURRENT_TIMESTAMP),
  DATEADD('DAY', -1, CURRENT_TIMESTAMP)
),
(
  RANDOM_UUID(),
  'Read 20 pages of current book',
  'DONE', 'DO', 'MEDIUM',
  'Currently reading: Atomic Habits. Chapter 12 onwards.',
  CURRENT_DATE, NULL, 'personal',
  'a1000000-0000-0000-0000-000000000001', 1, FALSE,
  DATEADD('HOUR', -1, CURRENT_TIMESTAMP),
  DATEADD('HOUR', -4, CURRENT_TIMESTAMP),
  DATEADD('HOUR', -1, CURRENT_TIMESTAMP)
),
(
  RANDOM_UUID(),
  'Research Eisenhower Matrix productivity techniques',
  'DONE', 'SCHEDULE', 'MEDIUM',
  'Read articles on time-boxing and quadrant-based prioritisation.',
  DATEADD('DAY', -1, CURRENT_DATE), NULL, 'personal',
  'a1000000-0000-0000-0000-000000000001', 2, FALSE,
  DATEADD('HOUR', -6, CURRENT_TIMESTAMP),
  DATEADD('DAY', -3, CURRENT_TIMESTAMP),
  DATEADD('HOUR', -6, CURRENT_TIMESTAMP)
),
(
  RANDOM_UUID(),
  'Set up CI/CD pipeline for server module',
  'TODO', 'DO', 'HIGH',
  'GitHub Actions workflow: build with Maven, run tests, push Docker image.',
  DATEADD('DAY', 5, CURRENT_DATE), NULL, 'work',
  'a1000000-0000-0000-0000-000000000001', 3, FALSE,
  NULL,
  CURRENT_TIMESTAMP,
  CURRENT_TIMESTAMP
),
(
  RANDOM_UUID(),
  'Update project README with API documentation',
  'TODO', 'SCHEDULE', 'LOW',
  'Document all REST endpoints, request/response shapes, and how to run locally.',
  DATEADD('DAY', 7, CURRENT_DATE), NULL, 'work',
  'a1000000-0000-0000-0000-000000000001', 4, FALSE,
  NULL,
  DATEADD('DAY', -2, CURRENT_TIMESTAMP),
  DATEADD('DAY', -2, CURRENT_TIMESTAMP)
);

-- ── Tasks — Health & Wellness (list 3) ───────────────────────────────────────

INSERT INTO tasks (id, title, status, quadrant, priority, note, due_date, due_time, category, list_id, task_order, reminder_enabled, completed_at, created_at, updated_at) VALUES
(
  RANDOM_UUID(),
  'Morning run — 5km',
  'DONE', 'DO', 'HIGH',
  'Aim for sub-28 minutes. Stretch afterwards.',
  CURRENT_DATE, '07:00', 'health',
  'a1000000-0000-0000-0000-000000000003', 0, TRUE,
  DATEADD('HOUR', -3, CURRENT_TIMESTAMP),
  DATEADD('HOUR', -4, CURRENT_TIMESTAMP),
  DATEADD('HOUR', -3, CURRENT_TIMESTAMP)
),
(
  RANDOM_UUID(),
  'Meal prep for the week',
  'TODO', 'SCHEDULE', 'MEDIUM',
  'Batch cook: grilled chicken, roasted veg, brown rice.',
  DATEADD('DAY', 1, CURRENT_DATE), '11:00', 'health',
  'a1000000-0000-0000-0000-000000000003', 1, FALSE,
  NULL,
  DATEADD('DAY', -1, CURRENT_TIMESTAMP),
  DATEADD('DAY', -1, CURRENT_TIMESTAMP)
),
(
  RANDOM_UUID(),
  'Book annual health check-up',
  'TODO', 'DELEGATE', 'LOW',
  'Call GP to schedule. Bring last year''s blood work results.',
  DATEADD('DAY', 14, CURRENT_DATE), NULL, 'health',
  'a1000000-0000-0000-0000-000000000003', 2, FALSE,
  NULL,
  DATEADD('DAY', -2, CURRENT_TIMESTAMP),
  DATEADD('DAY', -2, CURRENT_TIMESTAMP)
),
(
  RANDOM_UUID(),
  'Meditate for 10 minutes',
  'DONE', 'DO', 'MEDIUM',
  'Use Headspace app. Focus on breath awareness.',
  CURRENT_DATE, '08:00', 'health',
  'a1000000-0000-0000-0000-000000000003', 3, FALSE,
  DATEADD('HOUR', -2, CURRENT_TIMESTAMP),
  DATEADD('HOUR', -5, CURRENT_TIMESTAMP),
  DATEADD('HOUR', -2, CURRENT_TIMESTAMP)
);

-- ── Momentum snapshots — last 7 days (global) ────────────────────────────────

INSERT INTO momentum_snapshots (id, snapshot_date, list_id, streak, total_completed, today_completed, recorded_at) VALUES
(RANDOM_UUID(), DATEADD('DAY', -6, CURRENT_DATE), NULL, 1, 2,  2, DATEADD('DAY', -6, CURRENT_TIMESTAMP)),
(RANDOM_UUID(), DATEADD('DAY', -5, CURRENT_DATE), NULL, 2, 5,  3, DATEADD('DAY', -5, CURRENT_TIMESTAMP)),
(RANDOM_UUID(), DATEADD('DAY', -4, CURRENT_DATE), NULL, 3, 7,  2, DATEADD('DAY', -4, CURRENT_TIMESTAMP)),
(RANDOM_UUID(), DATEADD('DAY', -3, CURRENT_DATE), NULL, 4, 10, 3, DATEADD('DAY', -3, CURRENT_TIMESTAMP)),
(RANDOM_UUID(), DATEADD('DAY', -2, CURRENT_DATE), NULL, 5, 13, 3, DATEADD('DAY', -2, CURRENT_TIMESTAMP)),
(RANDOM_UUID(), DATEADD('DAY', -1, CURRENT_DATE), NULL, 6, 15, 2, DATEADD('DAY', -1, CURRENT_TIMESTAMP));
