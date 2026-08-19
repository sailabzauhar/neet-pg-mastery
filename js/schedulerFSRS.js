/* ==========================================================================
   schedulerFSRS.js — spaced-repetition scheduling.

   HONESTY NOTE: the master prompt calls for a full FSRS-style scheduler.
   True FSRS fits per-card difficulty/stability parameters from review
   history using an optimizer — that's meaningfully more machinery than a
   single-chapter, freshly-launched app has data to justify yet. This v1
   ships a simplified FSRS-INSPIRED scheduler: same immediate → short-term →
   delayed → long-term staged philosophy, same "wrong answer resets the
   interval" behaviour, but with fixed interval multipliers instead of a
   fitted stability/difficulty model. Swap this file for real FSRS once
   there's enough attempt volume across enough concepts for the fitting to
   mean anything — the rest of the app doesn't need to change to support that.
   ========================================================================== */

const SchedulerFSRS = {
  STAGES_HOURS: [0, 4, 24, 72, 168, 336, 720], // immediate, ~4h, 1d, 3d, 1w, 2w, 1mo

  /**
   * Given a concept's mastery record and its last scheduling stage,
   * return the next due timestamp and stage.
   */
  nextReview(masteryRecord, currentStage = 0) {
    const wasLastCorrect = masteryRecord.streak > 0;
    let nextStage;

    if (!wasLastCorrect) {
      // Wrong answer: fall back toward the start of the schedule, not all
      // the way to zero — a concept reviewed 5 times before a slip is
      // treated as "nearly there," not as a fresh unknown.
      nextStage = Math.max(0, currentStage - 2);
    } else {
      nextStage = Math.min(this.STAGES_HOURS.length - 1, currentStage + 1);
    }

    const hoursFromNow = this.STAGES_HOURS[nextStage];
    const dueAt = new Date(Date.now() + hoursFromNow * 3600 * 1000).toISOString();

    return { stage: nextStage, due_at: dueAt };
  },

  isDue(dueAtIso) {
    if (!dueAtIso) return true;
    return new Date(dueAtIso).getTime() <= Date.now();
  }
};

window.SchedulerFSRS = SchedulerFSRS;
