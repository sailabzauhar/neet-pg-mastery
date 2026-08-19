/* ==========================================================================
   sessionEngine.js — session-mode assembly.

   HONESTY NOTE: the master prompt specifies ~11 session modes (Quick 10/25,
   Standard 50, Marathon 100, Subject Test, Topic Test, Weakness Test, PYQ
   Test, Image Test, Revision Test, Grand Test, Sprint Mode) plus weighted
   Grand Test sampling across the whole question bank. With one chapter of
   12 MCQs live, most of those modes would be empty shells wrapping the same
   12 questions in different clothing — worse than not having them. This v1
   ships the two modes that are genuinely meaningful at this content depth:

     - "Start Learning"  — sequential walk through a topic's question family,
                            ordered by difficulty (L1 → L5), the way the
                            concept was designed to be taught.
     - "Practice Again"  — shuffled re-attempt of a topic already seen, for
                            spaced-repetition-style reinforcement.

   Sprint Mode, Grand Test, and per-subject/weakness tests all need either
   multiple topics or multiple subjects with real content to be meaningful —
   they're structured to be easy to add here (see stubs below) once that
   content exists, not redesigned from scratch.
   ========================================================================== */

const SessionEngine = {
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

  // ---- Deferred modes: stubs kept intentionally minimal, not fake-implemented ----
  buildSprintSession(_allSubjectTopics) {
    throw new Error('Sprint Mode needs multiple subjects with generated chapters to be meaningful — not available yet.');
  },
  buildGrandTest(_allSubjectTopics) {
    throw new Error('Grand Test needs a substantial cross-subject question bank to sample from — not available yet.');
  }
};

window.SessionEngine = SessionEngine;
