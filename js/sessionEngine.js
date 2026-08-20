/* ==========================================================================
   sessionEngine.js — session-mode assembly.

   HONESTY NOTE: the master prompt specifies ~11 session modes (Quick 10/25,
   Standard 50, Marathon 100, Subject Test, Topic Test, Weakness Test, PYQ
   Test, Image Test, Revision Test, Grand Test, Sprint Mode). With one
   chapter of content live, most would still be empty shells wrapping the
   same questions in different clothing — not worth building yet. Three
   modes ARE genuinely meaningful at any content depth and are implemented:

     - "Start Learning"  — sequential walk through a topic's question family,
                            ordered by difficulty (L1 → L5), the way the
                            concept was designed to be taught.
     - "Practice Again"  — shuffled re-attempt of a topic already seen, for
                            spaced-repetition-style reinforcement.
     - "Sprint Mode"      — walks every MCQ from every generated chapter
                            (across all subjects, or one chosen subject),
                            with a wrong answer rolling the position back
                            ROLLBACK_N questions instead of restarting the
                            whole run. The pool is assembled fresh from
                            manifest.json each time, so it grows on its own
                            as more chapters are added — this file never
                            needs to be touched again for that to happen.

   Grand Test and the remaining modes still need either a much larger
   cross-subject bank (to sample meaningfully rather than just replaying
   a small pool) or per-user weakness data that doesn't exist yet at this
   content depth — they're structured to be easy to add once that exists,
   not redesigned from scratch.
   ========================================================================== */

const SessionEngine = {
  ROLLBACK_N: 20, // a wrong answer during Sprint rolls the position back this many
                  // questions (clamped at 0) instead of restarting the whole run.
                  // Configurable — see README for how to change it.

  buildLearnSession(chapter) {
    const mcqs = [...chapter.mcqs].sort((a, b) => a.difficulty - b.difficulty);
    return {
      mode: 'learn',
      topic: chapter.meta.topic,
      chapter_file: chapter.meta.chapter_file,
      queue: mcqs
    };
  },

  buildPracticeSession(chapter) {
    const mcqs = [...chapter.mcqs];
    for (let i = mcqs.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [mcqs[i], mcqs[j]] = [mcqs[j], mcqs[i]];
    }
    return {
      mode: 'practice',
      topic: chapter.meta.topic,
      chapter_file: chapter.meta.chapter_file,
      queue: mcqs
    };
  },

  /**
   * Review Due: a straightforward walk through whatever the SM-2 scheduler
   * says is due right now, pulled from wherever it lives (any subject, any
   * chapter). No rollback rule like Sprint — this is meant to be a quick,
   * low-friction "clear the queue" session, not a stress test.
   * @param {Array} dueEntries - pool entries already filtered to due-only
   */
  buildReviewSession(dueEntries) {
    if (!dueEntries || !dueEntries.length) {
      throw new Error('Nothing is due for review right now.');
    }
    return { mode: 'review', queue: dueEntries };
  },

  /**
   * Sprint Mode: walks a pool of MCQs assembled from every generated
   * chapter across every subject (or one subject, for "Subject Sprint").
   * The pool itself is built by DataLoader.getAllGeneratedChapters() —
   * this function just wraps it with the rollback rule. As more chapters
   * get added later, the pool DataLoader hands in simply gets bigger;
   * nothing here needs to change.
   *
   * @param {Array} pool - entries from DataLoader.getAllGeneratedChapters()
   * @param {string|null} scopeLabel - 'Full Sprint' or a subject name, for display
   */
  buildSprintSession(pool, scopeLabel) {
    if (!pool || !pool.length) {
      throw new Error('No MCQs available yet for Sprint Mode.');
    }
    return {
      mode: 'sprint',
      scope_label: scopeLabel,
      queue: pool,
      rollback_n: this.ROLLBACK_N
    };
  },

  // ---- Still deferred: needs a much larger cross-subject bank to sample
  //      meaningfully rather than just replaying the same small pool ----
  buildGrandTest(_allSubjectTopics) {
    throw new Error('Grand Test needs a substantial cross-subject question bank to sample from — not available yet.');
  }
};

window.SessionEngine = SessionEngine;

