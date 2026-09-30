package com.hitlist.domain;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

/** Runs the automation sweep twice a minute while the app is up. Off with hitlist.automations.sweep=false. */
@Component
@ConditionalOnProperty(name = "hitlist.automations.sweep", havingValue = "true", matchIfMissing = true)
public class AutomationScheduler {
    private final AutomationEngine engine;

    public AutomationScheduler(AutomationEngine engine) {
        this.engine = engine;
    }

    @Scheduled(initialDelay = 15_000, fixedDelay = 30_000)
    void sweep() {
        engine.sweep(System.currentTimeMillis());
    }
}
