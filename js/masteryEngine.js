/* ==========================================================================
   masteryEngine.js — mastery scoring across dimensions (spec Section 15-16).
   One correct answer never equals mastery: mastery_score blends accuracy,
   recency, streak, difficulty spread, and variation-type coverage.

   HONESTY NOTE: this is a deliberately simplified v1 implementation of the
   full mastery model described in the master prompt (which also calls for
   time_to_answer and confidence-weighted scoring). Those two dimensions are
   captured in the stored attempt record so they're available, but are not
   yet folded into the score formula below — see README for the v2 roadmap.
   ========================================================================== */

const MasteryEngine = {
  /**
   * Compute a mastery record for one concept from its raw attempts.
   * @param {Array} attempts - all attempts for this concept, chronological
   * @param {number} totalVariationTypesAvailable - how many distinct
   *        question_types exist for this concept across the question family
   */
  computeConceptMastery(attempts, totalVariationTypesAvailable = 1) {
    if (!attempts || attempts.length === 0) {
      return {
        attempt_count: 0, accuracy: 0, recent_accuracy: 0, streak: 0,
        variation_coverage: 0, mastery_score: 0, tier: 'unattempted'
      };
    }

    const attempt_count = attempts.length;
    const correctCount = attempts.filter(a => a.correct).length;
    const accuracy = correctCount / attempt_count;

    const recent = attempts.slice(-5);
    const recent_accuracy = recent.filter(a => a.correct).length / recent.length;

    // current streak: consecutive correct counting back from most recent
    let streak = 0;
    for (let i = attempts.length - 1; i >= 0; i--) {
      if (attempts[i].correct) streak++; else break;
    }

    // difficulty spread: has the student succeeded across difficulty levels, not just L1?
    const difficultiesAttempted = new Set(attempts.map(a => a.difficulty));
    const difficultiesCorrect = new Set(attempts.filter(a => a.correct).map(a => a.difficulty));
    const difficulty_success = difficultiesAttempted.size > 0
      ? difficultiesCorrect.size / difficultiesAttempted.size
      : 0;

    // variation coverage: distinct question_types attempted vs available in the family
    const typesAttempted = new Set(attempts.map(a => a.question_type)).size;
    const variation_coverage = totalVariationTypesAvailable > 0
      ? Math.min(1, typesAttempted / totalVariationTypesAvailable)
      : 0;

    // Blend into a single 0-100 mastery score.
    // Weighted: recent performance matters more than lifetime average,
    // but a single lucky streak on one variation type isn't enough —
    // variation_coverage and difficulty_success both gate the ceiling.
    const rawScore = (
      accuracy * 0.30 +
      recent_accuracy * 0.30 +
      difficulty_success * 0.20 +
      variation_coverage * 0.20
    ) * 100;

    // Attempt-count dampening: fewer than 3 attempts can't reach "mastered"
    // regardless of accuracy — one correct answer never equals mastery.
    const dampened = attempt_count < 3 ? rawScore * (attempt_count / 3) : rawScore;
    const mastery_score = Math.round(Math.min(100, dampened));

    let tier = 'unattempted';
    if (attempt_count > 0 && mastery_score < 40) tier = 'learning';
    else if (mastery_score >= 40 && mastery_score < 75) tier = 'developing';
    else if (mastery_score >= 75) tier = 'mastered';

    return {
      attempt_count, accuracy, recent_accuracy, streak,
      difficulty_success, variation_coverage, mastery_score, tier
    };
  },

  /** Roll up per-concept mastery scores into a topic-level average. */
  rollUpTopic(conceptMasteryList) {
    if (!conceptMasteryList.length) return { mastery_percent: 0, mastered_count: 0, total_concepts: 0 };
    const total = conceptMasteryList.reduce((sum, c) => sum + c.mastery_score, 0);
    const mastered_count = conceptMasteryList.filter(c => c.tier === 'mastered').length;
    return {
      mastery_percent: Math.round(total / conceptMasteryList.length),
      mastered_count,
      total_concepts: conceptMasteryList.length
    };
  }
};

window.MasteryEngine = MasteryEngine;
