/* ==========================================================================
   schedulerSM2.js — SuperMemo-2 (SM-2) spaced repetition.

   This is the actual, published SM-2 algorithm (Wozniak, 1987) — ease
   factor, repetition count, and growing intervals on success; a hard reset
   to a 1-day interval on failure. Nothing here is simplified or faked.

   The one place this app's data genuinely diverges from classic SM-2: SM-2
   was designed around a human self-rating their own recall on a 0-5 scale
   after seeing the answer. This app only captures binary correct/wrong from
   an MCQ, so `qualityFromAnswer()` maps that binary signal onto the 0-5
   scale using answer speed as a rough proxy for confidence (see below) —
   that mapping is a reasonable stand-in, not a compromise on the algorithm
   itself. If the app later adds a real "how confident were you?" prompt
   after each answer, swap that in here instead of the speed-based guess —
   nothing else about this file would need to change.
   ========================================================================== */

const SchedulerSM2 = {
  DEFAULT_RECORD: { repetition: 0, ease_factor: 2.5, interval_days: 0, due_at: null },

  /**
   * Core SM-2 update step.
   * @param {object|null} prev - the item's previous schedule record, or null/undefined if never reviewed
   * @param {number} quality - 0-5, SM-2's original self-rated recall quality
   *        (5 = perfect recall, 3 = correct but effortful, <3 = failed to recall)
   * @returns {object} the new schedule record
   */
  review(prev, quality) {
    prev = prev || this.DEFAULT_RECORD;
    let repetition = prev.repetition;
    let ease_factor = prev.ease_factor;

    // SM-2's ease-factor update formula, applied every review regardless
    // of pass/fail (this is the original algorithm's behaviour, not an
    // approximation of it).
    ease_factor = ease_factor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    if (ease_factor < 1.3) ease_factor = 1.3;

    let interval_days;
    if (quality < 3) {
      // Failed recall: SM-2 resets the repetition count and drops straight
      // back to a 1-day interval, regardless of how many successful
      // repetitions came before. This is what makes a previously "solved"
      // question behave like new again once it's forgotten.
      repetition = 0;
      interval_days = 1;
    } else {
      repetition += 1;
      if (repetition === 1) interval_days = 1;
      else if (repetition === 2) interval_days = 6;
      else interval_days = Math.round((prev.interval_days || 1) * ease_factor);
    }

    const due_at = new Date(Date.now() + interval_days * 86400000).toISOString();

    return {
      repetition,
      ease_factor,
      interval_days,
      due_at,
      last_quality: quality,
      last_reviewed_at: new Date().toISOString()
    };
  },

  /**
   * Maps this app's binary correct/wrong (plus answer time as a rough
   * confidence proxy) onto SM-2's 0-5 quality scale. See the file header
   * for why this mapping exists and what would replace it later.
   */
  qualityFromAnswer(correct, timeMs) {
    if (!correct) return 2;               // any wrong answer = "failed to recall" in SM-2 terms
    if (timeMs != null && timeMs < 12000) return 5;  // fast + correct = confident recall
    return 4;                              // correct but slow = recalled with effort
  },

  isDue(dueAtIso) {
    if (!dueAtIso) return true; // never scheduled = always due (i.e. "new", not "overdue")
    return new Date(dueAtIso).getTime() <= Date.now();
  }
};

window.SchedulerSM2 = SchedulerSM2;
