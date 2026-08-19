/* ==========================================================================
   app.js — entry point, state machine, and screen rendering.
   Vanilla JS, no framework — per the build protocol's "no VS Code, no
   Claude Code, hand these files over as complete downloads" constraint.
   ========================================================================== */

const App = {
  state: {
    screen: 'home',
    manifest: null,
    currentSubjectSlug: null,
    currentSubjectTopics: null,
    currentChapter: null,
    currentSession: null,   // { mode, topic, chapter_file, queue }
    currentIndex: 0,
    selectedOption: null,
    answeredThisQuestion: false,
    questionStartTime: null,
    sessionStats: { correct: 0, total: 0 },
    streak: { count: 0, lastActiveDate: null },
    allMastery: []   // cache of every stored mastery record, refreshed after each answer
  },

  async init() {
    this.state.manifest = await DataLoader.getManifest();
    this.state.streak = await Storage.getMeta('streak', { count: 0, lastActiveDate: null });
    this.state.allMastery = await Storage.getAllMastery();
    this._maybeBumpStreak();
    this.render();
  },

  _subjectMasteryPercent(slug) {
    const records = this.state.allMastery.filter(m => m.concept_key.startsWith(`topic::${slug}::`));
    if (!records.length) return null;
    return Math.round(records.reduce((s, r) => s + r.mastery_score, 0) / records.length);
  },

  _topicMasteryPercent(slug, topicId) {
    const rec = this.state.allMastery.find(m => m.concept_key === `topic::${slug}::${topicId}`);
    return rec ? rec.mastery_score : null;
  },

  _maybeBumpStreak() {
    const today = new Date().toISOString().slice(0, 10);
    const last = this.state.streak.lastActiveDate;
    if (last === today) return; // already counted today
    const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
    if (last === yesterday) {
      this.state.streak.count += 1;
    } else {
      this.state.streak.count = 1;
    }
    this.state.streak.lastActiveDate = today;
    Storage.setMeta('streak', this.state.streak);
  },

  goHome() {
    this.state.screen = 'home';
    this.state.currentSubjectSlug = null;
    this.render();
  },

  async openSubject(slug) {
    this.state.currentSubjectSlug = slug;
    this.state.currentSubjectTopics = await DataLoader.getSubjectTopics(slug);
    this.state.screen = 'subject';
    this.render();
  },

  async startSession(chapterFilePath, mode) {
    const chapter = await DataLoader.getChapter(chapterFilePath);
    if (!chapter) { alert('This chapter is not generated yet.'); return; }
    this.state.currentChapter = chapter;
    this.state.currentSession = mode === 'practice'
      ? SessionEngine.buildPracticeSession(chapter)
      : SessionEngine.buildLearnSession(chapter);
    this.state.currentIndex = 0;
    this.state.sessionStats = { correct: 0, total: 0 };
    this.state.screen = 'mcq';
    this.state.answeredThisQuestion = false;
    this.state.selectedOption = null;
    this.state.questionStartTime = Date.now();
    this.render();
  },

  async selectOption(key) {
    if (this.state.answeredThisQuestion) return;
    this.state.selectedOption = key;
    this.state.answeredThisQuestion = true;

    const mcq = this.state.currentSession.queue[this.state.currentIndex];
    const correct = key === mcq.correct_answer;
    const timeMs = Date.now() - this.state.questionStartTime;

    this.state.sessionStats.total += 1;
    if (correct) this.state.sessionStats.correct += 1;

    await Storage.recordAttempt({
      mcq_id: mcq.id,
      subject_slug: this.state.currentSubjectSlug,
      topic_id: this.state.currentChapter.meta.topic_id,
      concept: mcq.concept,
      question_type: mcq.question_type,
      difficulty: mcq.difficulty,
      correct,
      confidence: null,
      time_ms: timeMs,
      timestamp: new Date().toISOString()
    });

    await this._recomputeConceptMastery(mcq.concept);
    await this._recomputeTopicRollup();
    this.state.allMastery = await Storage.getAllMastery();
    this.render();
  },

  async _recomputeConceptMastery(concept) {
    const attempts = await Storage.getAttemptsForConcept(concept);
    const chapter = this.state.currentChapter;
    const totalTypes = new Set(chapter.mcqs.filter(m => m.concept === concept).map(m => m.question_type)).size || 1;
    const record = MasteryEngine.computeConceptMastery(attempts, totalTypes);
    await Storage.setMastery(`${this.state.currentSubjectSlug}::${concept}`, record);
  },

  /** Roll every concept in the CURRENTLY LOADED chapter up into one topic-level
   *  score, keyed so subject/topic list screens can show it without re-fetching
   *  the chapter. Only covers chapters the user has actually opened. */
  async _recomputeTopicRollup() {
    const chapter = this.state.currentChapter;
    const concepts = [...new Set(chapter.mcqs.map(m => m.concept))];
    const conceptRecords = [];
    for (const c of concepts) {
      const attempts = await Storage.getAttemptsForConcept(c);
      if (!attempts.length) continue;
      const totalTypes = new Set(chapter.mcqs.filter(m => m.concept === c).map(m => m.question_type)).size || 1;
      conceptRecords.push(MasteryEngine.computeConceptMastery(attempts, totalTypes));
    }
    const rollup = MasteryEngine.rollUpTopic(conceptRecords);
    await Storage.setMastery(`topic::${this.state.currentSubjectSlug}::${chapter.meta.topic_id}`, {
      mastery_score: rollup.mastery_percent,
      mastered_count: rollup.mastered_count,
      total_concepts: rollup.total_concepts
    });
  },

  showExplanation() {
    this.state.screen = 'explanation';
    this.render();
  },

  nextQuestion() {
    const isLast = this.state.currentIndex >= this.state.currentSession.queue.length - 1;
    if (isLast) {
      this.state.screen = 'summary';
      this.render();
      return;
    }
    this.state.currentIndex += 1;
    this.state.answeredThisQuestion = false;
    this.state.selectedOption = null;
    this.state.questionStartTime = Date.now();
    this.state.screen = 'mcq';
    this.render();
  },

  async backToTopic() {
    this.state.allMastery = await Storage.getAllMastery();
    this.state.screen = 'subject';
    this.render();
  },

  async goHomeFresh() {
    this.state.allMastery = await Storage.getAllMastery();
    this.goHome();
  },

  async exportProgress() {
    const json = await Storage.exportProgress();
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `neetpg-mastery-progress-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  triggerImport() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'application/json';
    input.onchange = async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const text = await file.text();
      try {
        await Storage.importProgress(text);
        alert('Progress imported.');
        this.render();
      } catch (err) {
        alert('Could not import this file — it may not be a valid progress export.');
      }
    };
    input.click();
  },

  // ---------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------
  render() {
    const root = document.getElementById('app');
    root.innerHTML = this._topbar() + '<div class="screen">' + this._renderScreen() + '</div>';
    this._bindEvents();
  },

  _topbar() {
    const streak = this.state.streak.count || 0;
    return `
      <div class="topbar">
        <div class="brand" data-action="home">NEET PG <span>Mastery</span></div>
        <div class="streak">🔥 ${streak} day streak</div>
      </div>`;
  },

  _renderScreen() {
    switch (this.state.screen) {
      case 'home': return this._renderHome();
      case 'subject': return this._renderSubject();
      case 'mcq': return this._renderMCQ();
      case 'explanation': return this._renderExplanationScreen();
      case 'summary': return this._renderSummary();
      default: return '<p>Unknown screen.</p>';
    }
  },

  _ring(percent, size = 'md', label = null) {
    const r = 18, c = 2 * Math.PI * r;
    const offset = c - (Math.max(0, Math.min(100, percent)) / 100) * c;
    const cls = size === 'lg' ? 'ring ring-lg' : 'ring';
    return `
      <div class="${cls}">
        <svg viewBox="0 0 44 44" width="100%" height="100%">
          <circle class="ring-track" cx="22" cy="22" r="${r}"></circle>
          <circle class="ring-fill" cx="22" cy="22" r="${r}" stroke-dasharray="${c}" stroke-dashoffset="${offset}"></circle>
        </svg>
        <div class="ring-label">${label !== null ? label : percent + '%'}</div>
      </div>`;
  },

  _renderHome() {
    const m = this.state.manifest;
    const subjects = m.subjects;
    const totalMcqs = subjects.reduce((s, x) => s + (x.total_mcqs || 0), 0);
    const readySubjects = subjects.filter(s => s.chapter_files_generated > 0).length;

    const cards = subjects.map(s => {
      const locked = s.chapter_files_generated === 0;
      const masteryPct = locked ? null : this._subjectMasteryPercent(s.subject_slug);
      return `
        <div class="card subject-card ${locked ? 'locked' : ''}" data-action="${locked ? '' : 'open-subject'}" data-slug="${s.subject_slug}">
          <div style="display:flex; justify-content:space-between; align-items:flex-start;">
            ${locked ? `<div class="soon-badge">Coming soon</div>` : `<div class="soon-badge" style="color:var(--mustdo); border-color:var(--mustdo);">Live</div>`}
            ${locked ? '' : this._ring(masteryPct || 0)}
          </div>
          <div class="name">${this._esc(s.subject)}</div>
          <div class="stat-line">${s.total_topics} topics${locked ? '' : ` · ${s.chapter_files_generated} chapter live`}</div>
        </div>`;
    }).join('');

    return `
      <h1>Today's session</h1>
      <p class="muted">${totalMcqs} question${totalMcqs === 1 ? '' : 's'} live across ${readySubjects} of ${subjects.length} subjects. More chapters are added over time — nothing here needs re-downloading when they land.</p>

      <div class="eyebrow" style="margin-top:32px;">Subjects</div>
      <div class="subject-grid">${cards}</div>

      <div class="eyebrow" style="margin-top:32px;">Your data</div>
      <div class="card" style="padding:16px; display:flex; gap:10px; flex-wrap:wrap;">
        <button class="btn btn-outline btn-sm" data-action="export-progress">Export progress (.json)</button>
        <button class="btn btn-outline btn-sm" data-action="import-progress">Import progress</button>
      </div>
      <p class="faint" style="font-size:0.8rem; margin-top:10px;">Progress lives in this browser only, on this device. Export regularly as a backup — clearing site data or switching browsers won't carry it over otherwise.</p>
    `;
  },

  _renderSubject() {
    const topicsDoc = this.state.currentSubjectTopics;
    if (!topicsDoc) {
      return `<div class="empty-state"><h3>Not built yet</h3><p>This subject's topic list hasn't been generated.</p><button class="btn btn-outline" data-action="home">Back home</button></div>`;
    }
    const rows = topicsDoc.topics.map(t => {
      const locked = !t.chapter_generated;
      const masteryPct = locked ? null : this._topicMasteryPercent(this.state.currentSubjectSlug, t.topic_id);
      const tags = [
        t.is_must_do_topic ? `<span class="tag tag-mustdo">Must-do</span>` : '',
        t.is_repeated_topic ? `<span class="tag tag-repeat">Repeated ×${t.occurrence_count}</span>` : '',
        t.is_image_based ? `<span class="tag tag-image">Image</span>` : '',
        `<span class="tag tag-years">${t.years_mentioned.join(', ')}</span>`
      ].join('');
      return `
        <div class="topic-row ${locked ? 'locked' : ''}">
          <div class="rank">${t.rank}</div>
          ${locked ? '' : this._ring(masteryPct === null ? 0 : masteryPct)}
          <div class="info">
            <div class="name">${this._esc(t.topic)}</div>
            <div class="tags">${tags}</div>
          </div>
          ${locked
            ? `<span class="faint" style="font-family:var(--font-mono); font-size:0.72rem;">not yet</span>`
            : `<button class="btn btn-sm" data-action="start-session" data-chapter="${t.chapter_file}" data-mode="learn">${masteryPct === null ? 'Start' : 'Continue'}</button>`}
        </div>`;
    }).join('');

    return `
      <button class="btn-outline btn btn-sm" data-action="home" style="margin-bottom:18px;">← All subjects</button>
      <h1>${this._esc(topicsDoc.meta.subject)}</h1>
      <p class="muted">${topicsDoc.meta.total_topics} topics, ranked by exam priority (recurrence + must-do + image-based + recency). ${topicsDoc.meta.must_do_topics} are flagged must-do.</p>
      <div style="margin-top:22px;">${rows}</div>
    `;
  },

  _renderMCQ() {
    const sess = this.state.currentSession;
    const mcq = sess.queue[this.state.currentIndex];
    const total = sess.queue.length;
    const pct = Math.round(((this.state.currentIndex) / total) * 100);
    const answered = this.state.answeredThisQuestion;
    const selected = this.state.selectedOption;

    const optionsHtml = mcq.options.map((opt, i) => {
      const letter = String.fromCharCode(65 + i);
      // options are plain strings in schema for this dataset except the correct_answer
      // matches by full text; we key by letter for click handling and compare text
      const isCorrectOpt = opt === mcq.correct_answer;
      const isSelected = opt === selected;
      let cls = 'option';
      if (answered) {
        if (isCorrectOpt) cls += ' is-correct';
        else if (isSelected) cls += ' is-wrong';
        else cls += ' is-muted';
      }
      return `
        <button class="${cls}" ${answered ? 'disabled' : ''} data-action="select-option" data-option="${this._escAttr(opt)}">
          <span class="letter">${letter}</span>
          <span>${this._esc(opt)}</span>
        </button>`;
    }).join('');

    const feedback = answered ? (
      selected === mcq.correct_answer
        ? `<div class="feedback-banner correct">✓ Correct</div>`
        : `<div class="feedback-banner wrong">✗ Not quite — correct answer highlighted above</div>`
    ) : '';

    const footer = answered
      ? `<button class="btn btn-block" data-action="show-explanation">See full explanation</button>`
      : '';

    return `
      <div class="progress-bar"><div class="fill" style="width:${pct}%"></div></div>
      <div class="question-meta">
        <span>${this._esc(sess.topic)}</span>
        <span>${this.state.currentIndex + 1} / ${total} · L${mcq.difficulty} · ${mcq.question_type.replace(/_/g,' ')}</span>
      </div>
      <div class="question-stem">${this._esc(mcq.question)}</div>
      <div class="options">${optionsHtml}</div>
      ${feedback}
      ${footer}
    `;
  },

  _renderExplanationScreen() {
    const sess = this.state.currentSession;
    const mcq = sess.queue[this.state.currentIndex];
    const isLast = this.state.currentIndex >= sess.queue.length - 1;
    return `
      <button class="btn-outline btn btn-sm" data-action="back-to-mcq" style="margin-bottom:18px;">← Back to question</button>
      ${ExplanationRenderer.render(mcq)}
      <button class="btn btn-block" style="margin-top:24px;" data-action="next-question">${isLast ? 'Finish session' : 'Next question'}</button>
    `;
  },

  _renderSummary() {
    const stats = this.state.sessionStats;
    const accuracy = stats.total ? Math.round((stats.correct / stats.total) * 100) : 0;
    return `
      <div style="text-align:center; margin:24px 0 32px;">
        ${this._ring(accuracy, 'lg')}
      </div>
      <h2 style="text-align:center;">Session complete</h2>
      <div class="card" style="padding:8px 20px; margin:20px 0;">
        <div class="summary-stat"><span>Questions answered</span><span class="val">${stats.total}</span></div>
        <div class="summary-stat"><span>Correct</span><span class="val">${stats.correct}</span></div>
        <div class="summary-stat"><span>Accuracy</span><span class="val">${accuracy}%</span></div>
      </div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-outline btn-block" data-action="start-session-again">Practice again</button>
        <button class="btn btn-block" data-action="back-to-topic">Back to topics</button>
      </div>
    `;
  },

  _bindEvents() {
    document.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', (e) => {
        const action = el.getAttribute('data-action');
        switch (action) {
          case 'home': this.goHomeFresh(); break;
          case 'open-subject': this.openSubject(el.getAttribute('data-slug')); break;
          case 'start-session': this.startSession(el.getAttribute('data-chapter'), el.getAttribute('data-mode')); break;
          case 'select-option': this.selectOption(el.getAttribute('data-option')); break;
          case 'show-explanation': this.showExplanation(); break;
          case 'back-to-mcq': this.state.screen = 'mcq'; this.render(); break;
          case 'next-question': this.nextQuestion(); break;
          case 'back-to-topic': this.backToTopic(); break;
          case 'start-session-again': this.startSession(this.state.currentChapter.meta.chapter_file, 'practice'); break;
          case 'export-progress': this.exportProgress(); break;
          case 'import-progress': this.triggerImport(); break;
        }
      });
    });
  },

  _esc(str) {
    if (str == null) return '';
    const div = document.createElement('div');
    div.textContent = String(str);
    return div.innerHTML;
  },
  _escAttr(str) {
    return this._esc(str).replace(/"/g, '&quot;');
  }
};

window.addEventListener('DOMContentLoaded', () => App.init());
