/* ==========================================================================
   explanationRenderer.js — renders the full explanation structure
   (Correct Answer → Core Concept → Why Correct → Why Others Wrong →
   High-Yield → Clinical Correlation → Common Confusions → Exceptions →
   Related Concepts → Exam Traps → Image Clues → Memory Aid →
   Other Ways Tested → NEET PG Takeaway), per spec Section 12-14.
   ========================================================================== */

const ExplanationRenderer = {
  render(mcq) {
    const ex = mcq.explanation;
    const parts = [];

    const sourceLabel = {
      'SOURCE-DERIVED': 'Historical PYQ — source-derived',
      'CURRENT-KNOWLEDGE': 'Current knowledge — AI-generated, dated',
      'GUIDELINE-SENSITIVE': 'Guideline-sensitive — verify current guideline'
    }[mcq.source_topic] || mcq.source_topic;

    parts.push(`<div class="source-tag">${this._esc(sourceLabel)} · verified ${this._esc(mcq.last_verified)}</div>`);

    parts.push(this._section('Correct Answer', `<strong>${this._esc(mcq.correct_answer)}</strong>`));
    parts.push(this._section('Core Concept', `<p class="body">${this._esc(ex.core_concept)}</p>`));
    parts.push(this._section('Why This Is Correct', `<p class="body">${this._esc(ex.why_correct)}</p>`));

    if (ex.why_others_wrong && Object.keys(ex.why_others_wrong).length) {
      const items = Object.entries(ex.why_others_wrong).map(([opt, why]) =>
        `<div class="distractor-item"><div class="opt-text">${this._esc(opt)}</div><div class="why">${this._esc(why)}</div></div>`
      ).join('');
      parts.push(this._section('Why The Others Are Wrong', items));
    }

    if (ex.high_yield_facts && ex.high_yield_facts.length) {
      parts.push(this._section('High-Yield Facts', `<ul>${ex.high_yield_facts.map(f => `<li>${this._esc(f)}</li>`).join('')}</ul>`));
    }
    if (ex.clinical_correlation) {
      parts.push(this._section('Clinical Correlation', `<p class="body">${this._esc(ex.clinical_correlation)}</p>`));
    }
    if (ex.common_confusions && ex.common_confusions.length) {
      parts.push(this._section('Common Confusions', `<ul>${ex.common_confusions.map(f => `<li>${this._esc(f)}</li>`).join('')}</ul>`));
    }
    if (ex.exceptions && ex.exceptions.length) {
      parts.push(this._section('Exceptions', `<ul>${ex.exceptions.map(f => `<li>${this._esc(f)}</li>`).join('')}</ul>`));
    }
    if (ex.related_concepts && ex.related_concepts.length) {
      parts.push(this._section('Related Concepts', `<ul>${ex.related_concepts.map(f => `<li>${this._esc(f)}</li>`).join('')}</ul>`));
    }
    if (ex.exam_traps && ex.exam_traps.length) {
      parts.push(this._section('Exam Traps', `<ul>${ex.exam_traps.map(f => `<li>${this._esc(f)}</li>`).join('')}</ul>`));
    }
    if (mcq.is_image_based && ex.image_clues) {
      parts.push(this._section('Image Clues', `<p class="body">${this._esc(ex.image_clues)}</p>`));
    }
    if (ex.memory_aid) {
      parts.push(this._section('Memory Aid', `<p class="body">${this._esc(ex.memory_aid)}</p>`));
    }
    if (ex.other_ways_this_is_tested && ex.other_ways_this_is_tested.length) {
      parts.push(this._section('Other Ways This Is Tested', `<ul>${ex.other_ways_this_is_tested.map(f => `<li>${this._esc(f)}</li>`).join('')}</ul>`));
    }
    parts.push(this._section('NEET PG Takeaway', `<p class="body"><strong>${this._esc(ex.neet_pg_takeaway)}</strong></p>`));

    if (ex.source_reference) {
      parts.push(`<div class="citation">Source: ${this._esc(ex.source_reference)}</div>`);
    }

    return parts.join('');
  },

  _section(title, bodyHtml) {
    return `<div class="explain-section"><h4>${this._esc(title)}</h4>${bodyHtml}</div>`;
  },

  _esc(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  }
};

window.ExplanationRenderer = ExplanationRenderer;
