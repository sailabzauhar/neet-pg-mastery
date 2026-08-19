/* ==========================================================================
   errorIntelligence.js — classify wrong answers and suggest remediation.

   HONESTY NOTE: real error classification (distinguishing a conceptual
   mix-up from a misread question from a knowledge gap) needs signals this
   v1 doesn't collect yet — e.g. which specific distractor was picked and
   why, or eye-tracking-style timing patterns. What's implemented here is
   the lightest defensible version: classify by (a) which distractor was
   selected, using its distractor_rationale as a proxy for the likely
   confusion, and (b) whether the student was fast-wrong (likely misread)
   or slow-wrong (likely genuine gap). Treat the output as a helpful hint,
   not a confident diagnosis.
   ========================================================================== */

const ErrorIntelligence = {
  FAST_WRONG_THRESHOLD_MS: 8000,

  classify(mcq, selectedOptionKey, timeMs) {
    if (selectedOptionKey === mcq.correct_answer) return null; // not an error

    const rationale = mcq.distractor_rationale && mcq.distractor_rationale[selectedOptionKey];
    const isFast = timeMs != null && timeMs < this.FAST_WRONG_THRESHOLD_MS;

    let errorType = 'knowledge_gap';
    if (isFast) {
      errorType = 'possible_misread';
    } else if (rationale) {
      errorType = 'conceptual_mixup';
    }

    return {
      error_type: errorType,
      selected: selectedOptionKey,
      likely_confusion: rationale || null,
      remediation: this._remediationFor(errorType, mcq)
    };
  },

  _remediationFor(errorType, mcq) {
    switch (errorType) {
      case 'possible_misread':
        return 'You answered quickly and missed this — re-read the question stem slowly before re-attempting a variation of this concept.';
      case 'conceptual_mixup':
        return 'This looks like a mix-up between two related facts, not a blank gap — review the "Why Others Wrong" section closely, then retry a comparison-style question on this concept.';
      default:
        return 'This concept needs a fuller review — read the Core Concept and High-Yield Facts sections, then retry.';
    }
  }
};

window.ErrorIntelligence = ErrorIntelligence;
