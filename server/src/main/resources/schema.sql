-- ============================================================
-- Kaizen Todo — DDL Schema
-- Migration-friendly: uses CREATE TABLE IF NOT EXISTS so the
-- schema can be applied incrementally in future environments.
-- For H2 dev: spring.jpa.hibernate.ddl-auto=none lets this
-- file own the schema instead of Hibernate auto-DDL.
-- ============================================================

CREATE TABLE IF NOT EXISTS kaizen_lists (
    id          UUID         NOT NULL DEFAULT RANDOM_UUID() PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    color       VARCHAR(30)  NOT NULL DEFAULT 'emerald',
    list_order  INT          NOT NULL DEFAULT 0,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
    id                      UUID         NOT NULL DEFAULT RANDOM_UUID() PRIMARY KEY,
    title                   VARCHAR(500) NOT NULL,
    status                  VARCHAR(20)  NOT NULL DEFAULT 'TODO',
    quadrant                VARCHAR(20)  NOT NULL DEFAULT 'DO',
    priority                VARCHAR(10),
    note                    VARCHAR(2000),
    due_date                DATE,
    due_time                VARCHAR(5),
    category                VARCHAR(100),
    list_id                 UUID,
    task_order              INT          NOT NULL DEFAULT 0,
    reminder_enabled        BOOLEAN      NOT NULL DEFAULT FALSE,
    reminder_minutes_before INT,
    completed_at            TIMESTAMP WITH TIME ZONE,
    created_at              TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at              TIMESTAMP WITH TIME ZONE NOT NULL,

    CONSTRAINT fk_tasks_list FOREIGN KEY (list_id) REFERENCES kaizen_lists(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_tasks_list_id     ON tasks(list_id);
CREATE INDEX IF NOT EXISTS idx_tasks_status      ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_quadrant    ON tasks(quadrant);
CREATE INDEX IF NOT EXISTS idx_tasks_completed_at ON tasks(completed_at);
CREATE INDEX IF NOT EXISTS idx_tasks_due_date    ON tasks(due_date);

CREATE TABLE IF NOT EXISTS momentum_snapshots (
    id              UUID    NOT NULL DEFAULT RANDOM_UUID() PRIMARY KEY,
    snapshot_date   DATE    NOT NULL,
    list_id         UUID,
    streak          INT     NOT NULL DEFAULT 0,
    total_completed INT     NOT NULL DEFAULT 0,
    today_completed INT     NOT NULL DEFAULT 0,
    recorded_at     TIMESTAMP WITH TIME ZONE NOT NULL,

    CONSTRAINT uq_snap_date_list UNIQUE (snapshot_date, list_id)
);

CREATE INDEX IF NOT EXISTS idx_snap_date     ON momentum_snapshots(snapshot_date);
CREATE INDEX IF NOT EXISTS idx_snap_list     ON momentum_snapshots(list_id);

CREATE TABLE IF NOT EXISTS notes (
    id          UUID         NOT NULL DEFAULT RANDOM_UUID() PRIMARY KEY,
    title       VARCHAR(500) NOT NULL DEFAULT 'Untitled',
    blocks_json TEXT,
    emoji       VARCHAR(10),
    pinned      BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at  TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at  TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notes_updated_at ON notes(updated_at);
CREATE INDEX IF NOT EXISTS idx_notes_pinned     ON notes(pinned);

-- ============================================================
-- Automation Rules — persisted rule definitions
-- ============================================================

CREATE TABLE IF NOT EXISTS automation_rules (
    id                  UUID         NOT NULL DEFAULT RANDOM_UUID() PRIMARY KEY,
    name                VARCHAR(200) NOT NULL,
    description         VARCHAR(1000),
    task_id             UUID,
    task_title          VARCHAR(500),
    trigger_type        VARCHAR(30)  NOT NULL DEFAULT 'recurring',
    status              VARCHAR(20)  NOT NULL DEFAULT 'active',
    urgency             VARCHAR(20)  NOT NULL DEFAULT 'medium',
    notify_in_app       BOOLEAN      NOT NULL DEFAULT TRUE,
    notify_browser      BOOLEAN      NOT NULL DEFAULT FALSE,
    -- JSON blobs for flexible offset / recurrence config
    reminder_offset_json VARCHAR(200),
    recurrence_json      TEXT,
    last_triggered_at   TIMESTAMP WITH TIME ZONE,
    next_trigger_at     TIMESTAMP WITH TIME ZONE,
    created_at          TIMESTAMP WITH TIME ZONE NOT NULL,
    updated_at          TIMESTAMP WITH TIME ZONE NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_auto_rules_status ON automation_rules(status);
CREATE INDEX IF NOT EXISTS idx_auto_rules_next   ON automation_rules(next_trigger_at);

-- ============================================================
-- Automation Runs — execution log for each rule fire
-- ============================================================

CREATE TABLE IF NOT EXISTS automation_runs (
    id              UUID         NOT NULL DEFAULT RANDOM_UUID() PRIMARY KEY,
    rule_id         UUID         NOT NULL,
    rule_name       VARCHAR(200) NOT NULL,
    triggered_at    TIMESTAMP WITH TIME ZONE NOT NULL,
    status          VARCHAR(20)  NOT NULL DEFAULT 'success',
    message         VARCHAR(1000),
    trigger_source  VARCHAR(30)  NOT NULL DEFAULT 'scheduler',

    CONSTRAINT fk_runs_rule FOREIGN KEY (rule_id) REFERENCES automation_rules(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_auto_runs_rule_id      ON automation_runs(rule_id);
CREATE INDEX IF NOT EXISTS idx_auto_runs_triggered_at ON automation_runs(triggered_at DESC);
