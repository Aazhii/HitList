package com.kaizen.todo.model;

/**
 * Eisenhower Matrix quadrant — mirrors the frontend Quadrant type.
 * DO   = Urgent + Important
 * SCHEDULE = Not Urgent + Important
 * DELEGATE = Urgent + Not Important
 * ELIMINATE = Not Urgent + Not Important
 */
public enum Quadrant {
    DO,
    SCHEDULE,
    DELEGATE,
    ELIMINATE
}
