package com.hitlist.domain;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/**
 * Runs the automations once a minute while the app is up: the stored-queue engine on the desktop (SQLite), the older computed
 * sweep elsewhere. Off with hitlist.automations.sweep=false.
 */
@Component
@ConditionalOnProperty(name = "hitlist.automations.sweep", havingValue = "true", matchIfMissing = true)
public class AutomationScheduler {
    private final AutomationEngine engine;
    private final AutomationRunner runner;
    private final com.hitlist.storage.AutomationQueue queue;

    public AutomationScheduler(AutomationEngine engine, AutomationRunner runner, com.hitlist.storage.AutomationQueue queue) {
        this.engine = engine;
        this.runner = runner;
        this.queue = queue;
    }

    @Scheduled(initialDelay = 15_000, fixedDelay = 60_000)
    void sweep() {
        long now = System.currentTimeMillis();
        if (queue.enabled()) runner.tick(now);
        else engine.sweep(now);
    }
}
