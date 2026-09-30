package com.hitlist.domain;

import static org.assertj.core.api.Assertions.assertThat;

import java.time.LocalDate;
import org.junit.jupiter.api.Test;

class RecurrenceTest {
    private static final LocalDate LONG_AGO = LocalDate.of(2020, 1, 31);
    private static final LocalDate TODAY = LocalDate.of(2026, 10, 1);

    @Test
    void stepsOnceWhenTheDueDateIsStillAhead() {
        LocalDate due = LocalDate.of(2030, 1, 2);
        assertThat(TaskService.nextOccurrence("DAILY", due, TODAY)).isEqualTo("2030-01-03");
        assertThat(TaskService.nextOccurrence("WEEKLY", due, TODAY)).isEqualTo("2030-01-09");
        assertThat(TaskService.nextOccurrence("MONTHLY", due, TODAY)).isEqualTo("2030-02-02");
    }

    @Test
    void neverComesBackInThePast() {
        assertThat(TaskService.nextOccurrence("DAILY", LONG_AGO, TODAY)).isEqualTo(TODAY);
        assertThat(TaskService.nextOccurrence("WEEKLY", LONG_AGO, TODAY)).isAfterOrEqualTo(TODAY);
        assertThat(TaskService.nextOccurrence("WEEKLY", LONG_AGO, TODAY)).isBefore(TODAY.plusDays(7));
        assertThat(TaskService.nextOccurrence("WEEKLY", LONG_AGO, TODAY).getDayOfWeek()).isEqualTo(LONG_AGO.getDayOfWeek());
    }

    @Test
    void monthlyKeepsTheDayOfMonthAcrossShortMonths() {
        LocalDate jan31 = LocalDate.of(2030, 1, 31);
        assertThat(TaskService.nextOccurrence("MONTHLY", jan31, TODAY)).isEqualTo("2030-02-28");
        assertThat(TaskService.nextOccurrence("MONTHLY", LONG_AGO, LocalDate.of(2026, 3, 15))).isEqualTo("2026-03-31");
    }

    @Test
    void weekdaysSkipTheWeekend() {
        LocalDate friday = LocalDate.of(2030, 1, 4);
        assertThat(TaskService.nextOccurrence("WEEKDAYS", friday, TODAY)).isEqualTo("2030-01-07");
        assertThat(TaskService.nextOccurrence("WEEKDAYS", LocalDate.of(2030, 1, 7), TODAY)).isEqualTo("2030-01-08");
    }
}
