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
    allMastery: [],   // cache of every stored mastery record, refreshed after each answer
    dueCount: 0,      // how many previously-solved MCQs are due for review right now

    // ---- Sprint Mode state ----
    sprintPoolSummary: null,   // { total, perSubject } — lightweight, for the setup screen
    sprintScope: 'full',       // 'full' or a subject_slug
    sprintQueue: null,         // array of pool entries { mcq, subject_slug, subject, topic, topic_id, chapter }
    sprintIndex: 0,
    sprintAnswered: false,
    sprintSelected: null,
    sprintQuestionStart: null,
    sprintStats: { correct: 0, wrong: 0, rollbacks: 0, attempts: 0 },
    sprintSeen: null,          // Set of mcq ids seen at least once, for a "distinct covered" stat

    // ---- Review Due state (SM-2) ----
    reviewQueue: null,
    reviewIndex: 0,
    reviewAnswered: false,
    reviewSelected: null,
    reviewQuestionStart: null,
    reviewStats: { correct: 0, total: 0 }
  },

  async init() {
    this.state.manifest = await DataLoader.getManifest();
    this.state.streak = await Storage.getMeta('streak', { count: 0, lastActiveDate: null });
    this.state.allMastery = await Storage.getAllMastery();
    this.state.dueCount = await this._computeDueCount();
    this._maybeBumpStreak();
    this.render();
  },

  async _computeDueCount() {
    const schedules = await Storage.getAllSchedules();
    return schedules.filter(s => SchedulerSM2.isDue(s.due_at)).length;
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

  _subjectMasteryPercent(slug) {
    const records = this.state.allMastery.filter(m => m.concept_key.startsWith(`topic::${slug}::`));
    if (!records.length) return null;
    return Math.round(records.reduce((s, r) => s + r.mastery_score, 0) / records.length);
  },

  _topicMasteryPercent(slug, topicId) {
    const rec = this.state.allMastery.find(m => m.concept_key === `topic::${slug}::${topicId}`);
    return rec ? rec.mastery_score : null;
  },

  async goHomeFresh() {
    this.state.allMastery = await Storage.getAllMastery();
    this.state.dueCount = await this._computeDueCount();
    this.goHome();
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

    let resumeIndex = 0;
    if (mode === 'learn') {
      // Resume where you left off — but "left off" now means SM-2's due
      // status, not just "has any attempt ever." A question you solved
      // last week that's now due for review counts as unanswered again,
      // so it resurfaces here automatically instead of staying skipped
      // forever just because you got it right once.
      const schedules = await Storage.getAllSchedules();
      const scheduleMap = new Map(schedules.map(s => [s.mcq_id, s]));
      const isSkippable = (mcqId) => {
        const rec = scheduleMap.get(mcqId);
        return !!rec && !SchedulerSM2.isDue(rec.due_at);
      };
      const firstUnanswered = this.state.currentSession.queue.findIndex(m => !isSkippable(m.id));
      resumeIndex = firstUnanswered === -1 ? 0 : firstUnanswered;
    }

    this.state.currentIndex = resumeIndex;
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

    const prevSchedule = await Storage.getSchedule(mcq.id);
    const quality = SchedulerSM2.qualityFromAnswer(correct, timeMs);
    const nextSchedule = SchedulerSM2.review(prevSchedule, quality);
    await Storage.setSchedule(mcq.id, nextSchedule);

    await this._recomputeConceptMastery(mcq.concept, this.state.currentSubjectSlug, this.state.currentChapter);
    await this._recomputeTopicRollup(this.state.currentChapter, this.state.currentSubjectSlug);
    this.state.allMastery = await Storage.getAllMastery();
    this.render();
  },

  /** Generic — works for a single open chapter OR a Sprint pool entry,
   *  since both just need a concept + the subject it belongs to + the
   *  chapter object that concept's MCQs live in. */
  async _recomputeConceptMastery(concept, subjectSlug, chapter) {
    const attempts = await Storage.getAttemptsForConcept(concept);
    const totalTypes = new Set(chapter.mcqs.filter(m => m.concept === concept).map(m => m.question_type)).size || 1;
    const record = MasteryEngine.computeConceptMastery(attempts, totalTypes);
    await Storage.setMastery(`${subjectSlug}::${concept}`, record);
    return record;
  },

  /** Rolls every concept in ONE chapter up into a topic-level score. Called
   *  after any attempt, whether it came from a normal Learn/Practice session
   *  or from a Sprint question that happened to belong to this chapter. */
  /** Rolls every concept in ONE chapter up into a topic-level score. Called
   *  after any attempt, whether it came from a normal Learn/Practice session
   *  or from a Sprint question that happened to belong to this chapter.
   *
   *  Every concept in the chapter counts toward the average — including
   *  ones with zero attempts, which score 0. Skipping untouched concepts
   *  entirely (as an earlier version of this did) let solving a single
   *  question show an inflated topic-wide mastery percentage, since the
   *  other 11 untouched concepts in a 12-question chapter simply weren't
   *  counted instead of counting as "not yet mastered." */
  async _recomputeTopicRollup(chapter, subjectSlug) {
    const concepts = [...new Set(chapter.mcqs.map(m => m.concept))];
    const conceptRecords = [];
    for (const c of concepts) {
      const attempts = await Storage.getAttemptsForConcept(c);
      const totalTypes = new Set(chapter.mcqs.filter(m => m.concept === c).map(m => m.question_type)).size || 1;
      conceptRecords.push(MasteryEngine.computeConceptMastery(attempts, totalTypes));
    }
    const rollup = MasteryEngine.rollUpTopic(conceptRecords);
    await Storage.setMastery(`topic::${subjectSlug}::${chapter.meta.topic_id}`, {
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
    this.state.dueCount = await this._computeDueCount();
    this.state.screen = 'subject';
    this.render();
  },

  // -----------------------------------------------------------------------
  // Sprint Mode
  // -----------------------------------------------------------------------
  async openSprintSetup() {
    this.state.sprintPoolSummary = await DataLoader.getSprintPoolSummary();
    this.state.screen = 'sprint-setup';
    this.render();
  },

  setSprintScope(scope) {
    this.state.sprintScope = scope;
    this.render();
  },

  async startSprint() {
    const filter = this.state.sprintScope === 'full' ? null : this.state.sprintScope;
    const pool = await DataLoader.getAllGeneratedChapters(filter);
    if (!pool.length) { alert('No MCQs available for this scope yet.'); return; }

    const scopeLabel = this.state.sprintScope === 'full'
      ? 'Full Sprint'
      : (this.state.sprintPoolSummary.perSubject.find(s => s.subject_slug === filter) || {}).subject || 'Sprint';

    this.state.sprintQueueMeta = SessionEngine.buildSprintSession(pool, scopeLabel);
    this.state.sprintQueue = pool;
    this.state.sprintIndex = 0;
    this.state.sprintAnswered = false;
    this.state.sprintSelected = null;
    this.state.sprintStats = { correct: 0, wrong: 0, rollbacks: 0, attempts: 0 };
    this.state.sprintSeen = new Set();
    this.state.sprintQuestionStart = Date.now();
    this.state.screen = 'sprint';
    this.render();
  },

  async selectSprintOption(key) {
    if (this.state.sprintAnswered) return;
    this.state.sprintSelected = key;
    this.state.sprintAnswered = true;

    const entry = this.state.sprintQueue[this.state.sprintIndex];
    const mcq = entry.mcq;
    const correct = key === mcq.correct_answer;
    const timeMs = Date.now() - this.state.sprintQuestionStart;

    this.state.sprintStats.attempts += 1;
    this.state.sprintSeen.add(mcq.id);
    if (correct) this.state.sprintStats.correct += 1;
    else this.state.sprintStats.wrong += 1;

    await Storage.recordAttempt({
      mcq_id: mcq.id,
      subject_slug: entry.subject_slug,
      topic_id: entry.topic_id,
      concept: mcq.concept,
      question_type: mcq.question_type,
      difficulty: mcq.difficulty,
      correct,
      confidence: null,
      time_ms: timeMs,
      timestamp: new Date().toISOString(),
      sprint: true
    });

    const prevSchedule = await Storage.getSchedule(mcq.id);
    const quality = SchedulerSM2.qualityFromAnswer(correct, timeMs);
    const nextSchedule = SchedulerSM2.review(prevSchedule, quality);
    await Storage.setSchedule(mcq.id, nextSchedule);

    await this._recomputeConceptMastery(mcq.concept, entry.subject_slug, entry.chapter);
    await this._recomputeTopicRollup(entry.chapter, entry.subject_slug);
    this.state.allMastery = await Storage.getAllMastery();
    this.render();
  },

  showSprintExplanation() {
    this.state.screen = 'sprint-explain';
    this.render();
  },

  nextSprintQuestion() {
    const wasCorrect = this.state.sprintSelected === this.state.sprintQueue[this.state.sprintIndex].mcq.correct_answer;
    const poolLen = this.state.sprintQueue.length;

    if (wasCorrect) {
      const nextIdx = this.state.sprintIndex + 1;
      if (nextIdx >= poolLen) {
        this.state.screen = 'sprint-summary';
        this.render();
        return;
      }
      this.state.sprintIndex = nextIdx;
    } else {
      const rollbackN = SessionEngine.ROLLBACK_N;
      this.state.sprintStats.rollbacks += 1;
      this.state.sprintIndex = Math.max(0, this.state.sprintIndex - rollbackN);
    }

    this.state.sprintAnswered = false;
    this.state.sprintSelected = null;
    this.state.sprintQuestionStart = Date.now();
    this.state.screen = 'sprint';
    this.render();
  },

  backToSprintQuestion() {
    this.state.screen = 'sprint';
    this.render();
  },

  async exitSprint() {
    this.state.allMastery = await Storage.getAllMastery();
    this.state.screen = 'home';
    this.render();
  },

  // -----------------------------------------------------------------------
  // Review Due (SM-2)
  // -----------------------------------------------------------------------
  async openReviewDue() {
    const pool = await DataLoader.getAllGeneratedChapters(null);
    const schedules = await Storage.getAllSchedules();
    const scheduleMap = new Map(schedules.map(s => [s.mcq_id, s]));
    const due = pool.filter(e => {
      const rec = scheduleMap.get(e.mcq.id);
      return rec && SchedulerSM2.isDue(rec.due_at);
    });
    if (!due.length) {
      alert("Nothing is due for review right now. Solved questions come back here automatically once their SM-2 review interval passes.");
      return;
    }
    const session = SessionEngine.buildReviewSession(due);
    this.state.reviewQueue = session.queue;
    this.state.reviewIndex = 0;
    this.state.reviewAnswered = false;
    this.state.reviewSelected = null;
    this.state.reviewStats = { correct: 0, total: 0 };
    this.state.reviewQuestionStart = Date.now();
    this.state.screen = 'review';
    this.render();
  },

  async selectReviewOption(key) {
    if (this.state.reviewAnswered) return;
    this.state.reviewSelected = key;
    this.state.reviewAnswered = true;

    const entry = this.state.reviewQueue[this.state.reviewIndex];
    const mcq = entry.mcq;
    const correct = key === mcq.correct_answer;
    const timeMs = Date.now() - this.state.reviewQuestionStart;

    this.state.reviewStats.total += 1;
    if (correct) this.state.reviewStats.correct += 1;

    await Storage.recordAttempt({
      mcq_id: mcq.id,
      subject_slug: entry.subject_slug,
      topic_id: entry.topic_id,
      concept: mcq.concept,
      question_type: mcq.question_type,
      difficulty: mcq.difficulty,
      correct,
      confidence: null,
      time_ms: timeMs,
      timestamp: new Date().toISOString(),
      review: true
    });

    const prevSchedule = await Storage.getSchedule(mcq.id);
    const quality = SchedulerSM2.qualityFromAnswer(correct, timeMs);
    const nextSchedule = SchedulerSM2.review(prevSchedule, quality);
    await Storage.setSchedule(mcq.id, nextSchedule);

    await this._recomputeConceptMastery(mcq.concept, entry.subject_slug, entry.chapter);
    await this._recomputeTopicRollup(entry.chapter, entry.subject_slug);
    this.state.allMastery = await Storage.getAllMastery();
    this.render();
  },

  showReviewExplanation() {
    this.state.screen = 'review-explain';
    this.render();
  },

  nextReviewQuestion() {
    const nextIdx = this.state.reviewIndex + 1;
    if (nextIdx >= this.state.reviewQueue.length) {
      this.state.screen = 'review-summary';
      this.render();
      return;
    }
    this.state.reviewIndex = nextIdx;
    this.state.reviewAnswered = false;
    this.state.reviewSelected = null;
    this.state.reviewQuestionStart = Date.now();
    this.state.screen = 'review';
    this.render();
  },

  backToReviewQuestion() {
    this.state.screen = 'review';
    this.render();
  },

  async exitReview() {
    this.state.allMastery = await Storage.getAllMastery();
    this.state.dueCount = await this._computeDueCount();
    this.state.screen = 'home';
    this.render();
  },

  // ---------------------------------------------------------------------
  // Export / Import
  // ---------------------------------------------------------------------
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
        this.state.allMastery = await Storage.getAllMastery();
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
    // Review Due is launched from a card on Home, not the Sprint tab — so
    // review screens count as "home flow" for tab-highlighting purposes.
    const onSprintFlow = ['sprint-setup', 'sprint', 'sprint-explain', 'sprint-summary'].includes(this.state.screen);
    const onHomeFlow = !onSprintFlow;
    return `
      <div class="topbar">
        <div class="brand" data-action="home">NEET PG <span>Mastery</span></div>
        <div class="streak">🔥 ${streak} day streak</div>
      </div>
      <div class="nav-tabs">
        <button class="nav-tab ${onHomeFlow ? 'active' : ''}" data-action="home">Learn</button>
        <button class="nav-tab ${onSprintFlow ? 'active' : ''}" data-action="open-sprint-setup">Sprint</button>
        <button class="nav-tab ${this.state.screen === 'donate' ? 'active' : ''}" data-action="open-donate">Donate</button>
      </div>`;
  },

  _renderScreen() {
    switch (this.state.screen) {
      case 'home': return this._renderHome();
      case 'subject': return this._renderSubject();
      case 'mcq': return this._renderMCQ();
      case 'explanation': return this._renderExplanationScreen();
      case 'summary': return this._renderSummary();
      case 'sprint-setup': return this._renderSprintSetup();
      case 'sprint': return this._renderSprint();
      case 'sprint-explain': return this._renderSprintExplanation();
      case 'sprint-summary': return this._renderSprintSummary();
      case 'review': return this._renderReview();
      case 'review-explain': return this._renderReviewExplanation();
      case 'review-summary': return this._renderReviewSummary();
      case 'donate': return this._renderDonate();
      default: return '<p>Unknown screen.</p>';
    }
  },

  _renderDonate() {
    return `
      <div class="card" style="max-width:420px; margin:24px auto; padding:28px 24px; text-align:center;">
        <div style="font-family:var(--font-display); font-size:1.15rem; font-weight:600; margin-bottom:6px;">Support this app</div>
        <div class="muted" style="font-size:0.9rem; margin-bottom:20px; line-height:1.5;">
          This app is free and built independently. If it's helped your prep, a small contribution keeps it going.
        </div>
        <img src="data/assets/donate-qr.png" alt="UPI donation QR code" style="width:100%; max-width:280px; border-radius:var(--radius-lg); border:1px solid var(--line); margin-bottom:16px;">
        <div style="font-family:var(--font-mono); font-size:0.85rem; color:var(--ink-soft);">Scan to pay with any UPI app</div>
        <button class="btn btn-outline btn-sm" style="margin-top:16px;" data-action="copy-upi" data-upi="sailabzauhar@okicici">Copy UPI ID</button>
      </div>`;
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

      <div class="card" style="padding:16px; margin:20px 0; display:flex; justify-content:space-between; align-items:center; gap:12px;">
        <div>
          <div style="font-weight:600; margin-bottom:2px;">Sprint Mode</div>
          <div class="muted" style="font-size:0.88rem;">Walk every question live right now, across all subjects. Grows automatically as more chapters ship.</div>
        </div>
        <button class="btn" data-action="open-sprint-setup">Start</button>
      </div>

      <div class="card" style="padding:16px; margin:20px 0; display:flex; justify-content:space-between; align-items:center; gap:12px;">
        <div>
          <div style="font-weight:600; margin-bottom:2px;">Due for review</div>
          <div class="muted" style="font-size:0.88rem;">${this.state.dueCount > 0
            ? `${this.state.dueCount} question${this.state.dueCount === 1 ? '' : 's'} you've solved before ${this.state.dueCount === 1 ? 'is' : 'are'} due again, per SM-2 spacing.`
            : `Nothing due yet — solved questions resurface here on their own schedule.`}</div>
        </div>
        <button class="btn ${this.state.dueCount === 0 ? 'btn-outline' : ''}" data-action="open-review-due" ${this.state.dueCount === 0 ? 'disabled' : ''}>Review${this.state.dueCount > 0 ? ` (${this.state.dueCount})` : ''}</button>
      </div>

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

  // ---- Sprint screens ----
  _renderSprintSetup() {
    const summary = this.state.sprintPoolSummary;
    if (!summary || summary.total === 0) {
      return `<div class="empty-state"><h3>Sprint isn't ready yet</h3><p>No chapters are generated yet. Sprint pulls from whatever's live, so check back once at least one chapter exists.</p><button class="btn btn-outline" data-action="home">Back home</button></div>`;
    }

    const scope = this.state.sprintScope;
    const options = [
      `<button class="option ${scope === 'full' ? 'is-selected' : ''}" data-action="set-sprint-scope" data-scope="full">
         <span class="letter">${scope === 'full' ? '●' : '○'}</span>
         <span><strong>Full Sprint</strong> — all subjects · ${summary.total} question${summary.total === 1 ? '' : 's'}</span>
       </button>`,
      ...summary.perSubject.map(s => `
        <button class="option ${scope === s.subject_slug ? 'is-selected' : ''}" data-action="set-sprint-scope" data-scope="${s.subject_slug}">
          <span class="letter">${scope === s.subject_slug ? '●' : '○'}</span>
          <span><strong>${this._esc(s.subject)}</strong> only — ${s.mcqCount} question${s.mcqCount === 1 ? '' : 's'}</span>
        </button>`)
    ].join('');

    return `
      <h1>Sprint Mode</h1>
      <p class="muted">Walks straight through the question pool you choose below. Get one wrong, and you're rolled back ${SessionEngine.ROLLBACK_N} questions instead of starting over completely — so it rewards steady accuracy, not luck on any one question. This pool is assembled fresh every time from whatever chapters are live, so it grows on its own as more content ships.</p>
      <div class="eyebrow" style="margin-top:24px;">Choose scope</div>
      <div class="options">${options}</div>
      <button class="btn btn-block" data-action="start-sprint">Start Sprint (${(scope === 'full' ? summary.total : (summary.perSubject.find(s=>s.subject_slug===scope)||{mcqCount:0}).mcqCount)} questions)</button>
    `;
  },

  _renderSprint() {
    const entry = this.state.sprintQueue[this.state.sprintIndex];
    const mcq = entry.mcq;
    const total = this.state.sprintQueue.length;
    const pct = Math.round((this.state.sprintIndex / total) * 100);
    const answered = this.state.sprintAnswered;
    const selected = this.state.sprintSelected;

    const optionsHtml = mcq.options.map((opt, i) => {
      const letter = String.fromCharCode(65 + i);
      const isCorrectOpt = opt === mcq.correct_answer;
      const isSelected = opt === selected;
      let cls = 'option';
      if (answered) {
        if (isCorrectOpt) cls += ' is-correct';
        else if (isSelected) cls += ' is-wrong';
        else cls += ' is-muted';
      }
      return `
        <button class="${cls}" ${answered ? 'disabled' : ''} data-action="select-sprint-option" data-option="${this._escAttr(opt)}">
          <span class="letter">${letter}</span>
          <span>${this._esc(opt)}</span>
        </button>`;
    }).join('');

    const feedback = answered ? (
      selected === mcq.correct_answer
        ? `<div class="feedback-banner correct">✓ Correct — moving forward</div>`
        : `<div class="feedback-banner wrong">✗ Rolled back ${Math.min(SessionEngine.ROLLBACK_N, this.state.sprintIndex)} question(s)</div>`
    ) : '';

    const footer = answered
      ? `<button class="btn btn-block" data-action="show-sprint-explanation">See full explanation</button>`
      : '';

    const stats = this.state.sprintStats;

    return `
      <div class="progress-bar"><div class="fill" style="width:${pct}%"></div></div>
      <div class="question-meta">
        <span>${this._esc(entry.subject)} · ${this._esc(entry.topic)}</span>
        <span>Position ${this.state.sprintIndex + 1} / ${total} · ✓${stats.correct} ✗${stats.wrong} · rollbacks ${stats.rollbacks}</span>
      </div>
      <div class="question-stem">${this._esc(mcq.question)}</div>
      <div class="options">${optionsHtml}</div>
      ${feedback}
      ${footer}
      <button class="btn-outline btn btn-sm btn-block" style="margin-top:16px;" data-action="exit-sprint">Exit Sprint</button>
    `;
  },

  _renderSprintExplanation() {
    const entry = this.state.sprintQueue[this.state.sprintIndex];
    return `
      <button class="btn-outline btn btn-sm" data-action="back-to-sprint-question" style="margin-bottom:18px;">← Back to question</button>
      ${ExplanationRenderer.render(entry.mcq)}
      <button class="btn btn-block" style="margin-top:24px;" data-action="next-sprint-question">Continue Sprint</button>
    `;
  },

  _renderSprintSummary() {
    const stats = this.state.sprintStats;
    const accuracy = stats.attempts ? Math.round((stats.correct / stats.attempts) * 100) : 0;
    return `
      <div style="text-align:center; margin:24px 0 32px;">
        ${this._ring(accuracy, 'lg')}
      </div>
      <h2 style="text-align:center;">Sprint complete</h2>
      <div class="card" style="padding:8px 20px; margin:20px 0;">
        <div class="summary-stat"><span>Questions in pool</span><span class="val">${this.state.sprintQueue.length}</span></div>
        <div class="summary-stat"><span>Distinct questions seen</span><span class="val">${this.state.sprintSeen.size}</span></div>
        <div class="summary-stat"><span>Total attempts</span><span class="val">${stats.attempts}</span></div>
        <div class="summary-stat"><span>Correct</span><span class="val">${stats.correct}</span></div>
        <div class="summary-stat"><span>Rollbacks triggered</span><span class="val">${stats.rollbacks}</span></div>
        <div class="summary-stat"><span>Attempt accuracy</span><span class="val">${accuracy}%</span></div>
      </div>
      <div style="display:flex; gap:10px;">
        <button class="btn btn-outline btn-block" data-action="open-sprint-setup">Sprint again</button>
        <button class="btn btn-block" data-action="home">Back home</button>
      </div>
    `;
  },

  // ---- Review Due screens (SM-2) ----
  _renderReview() {
    const entry = this.state.reviewQueue[this.state.reviewIndex];
    const mcq = entry.mcq;
    const total = this.state.reviewQueue.length;
    const pct = Math.round((this.state.reviewIndex / total) * 100);
    const answered = this.state.reviewAnswered;
    const selected = this.state.reviewSelected;

    const optionsHtml = mcq.options.map((opt, i) => {
      const letter = String.fromCharCode(65 + i);
      const isCorrectOpt = opt === mcq.correct_answer;
      const isSelected = opt === selected;
      let cls = 'option';
      if (answered) {
        if (isCorrectOpt) cls += ' is-correct';
        else if (isSelected) cls += ' is-wrong';
        else cls += ' is-muted';
      }
      return `
        <button class="${cls}" ${answered ? 'disabled' : ''} data-action="select-review-option" data-option="${this._escAttr(opt)}">
          <span class="letter">${letter}</span>
          <span>${this._esc(opt)}</span>
        </button>`;
    }).join('');

    const feedback = answered ? (
      selected === mcq.correct_answer
        ? `<div class="feedback-banner correct">✓ Correct — next review pushed further out</div>`
        : `<div class="feedback-banner wrong">✗ Not quite — you'll see this again tomorrow</div>`
    ) : '';

    const footer = answered
      ? `<button class="btn btn-block" data-action="show-review-explanation">See full explanation</button>`
      : '';

    return `
      <div class="progress-bar"><div class="fill" style="width:${pct}%"></div></div>
      <div class="question-meta">
        <span>${this._esc(entry.subject)} · ${this._esc(entry.topic)}</span>
        <span>Review ${this.state.reviewIndex + 1} / ${total}</span>
      </div>
      <div class="question-stem">${this._esc(mcq.question)}</div>
      <div class="options">${optionsHtml}</div>
      ${feedback}
      ${footer}
      <button class="btn-outline btn btn-sm btn-block" style="margin-top:16px;" data-action="exit-review">Exit review</button>
    `;
  },

  _renderReviewExplanation() {
    const entry = this.state.reviewQueue[this.state.reviewIndex];
    const isLast = this.state.reviewIndex >= this.state.reviewQueue.length - 1;
    return `
      <button class="btn-outline btn btn-sm" data-action="back-to-review-question" style="margin-bottom:18px;">← Back to question</button>
      ${ExplanationRenderer.render(entry.mcq)}
      <button class="btn btn-block" style="margin-top:24px;" data-action="next-review-question">${isLast ? 'Finish review' : 'Next'}</button>
    `;
  },

  _renderReviewSummary() {
    const stats = this.state.reviewStats;
    const accuracy = stats.total ? Math.round((stats.correct / stats.total) * 100) : 0;
    return `
      <div style="text-align:center; margin:24px 0 32px;">
        ${this._ring(accuracy, 'lg')}
      </div>
      <h2 style="text-align:center;">Review queue cleared</h2>
      <div class="card" style="padding:8px 20px; margin:20px 0;">
        <div class="summary-stat"><span>Questions reviewed</span><span class="val">${stats.total}</span></div>
        <div class="summary-stat"><span>Correct</span><span class="val">${stats.correct}</span></div>
        <div class="summary-stat"><span>Accuracy</span><span class="val">${accuracy}%</span></div>
      </div>
      <p class="faint" style="font-size:0.85rem;">Each question you just reviewed has a new due date now, based on how well you remembered it — SM-2 pushes easy ones further out and brings hard ones back sooner.</p>
      <button class="btn btn-block" data-action="home">Back home</button>
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

          // Sprint
          case 'open-sprint-setup': this.openSprintSetup(); break;
          case 'open-donate': this.state.screen = 'donate'; this.render(); break;
          case 'copy-upi': {
            const upi = el.getAttribute('data-upi');
            if (navigator.clipboard && navigator.clipboard.writeText) {
              navigator.clipboard.writeText(upi).then(() => {
                el.textContent = 'Copied!';
                setTimeout(() => { el.textContent = 'Copy UPI ID'; }, 1500);
              });
            }
            break;
          }
          case 'set-sprint-scope': this.setSprintScope(el.getAttribute('data-scope')); break;
          case 'start-sprint': this.startSprint(); break;
          case 'select-sprint-option': this.selectSprintOption(el.getAttribute('data-option')); break;
          case 'show-sprint-explanation': this.showSprintExplanation(); break;
          case 'back-to-sprint-question': this.backToSprintQuestion(); break;
          case 'next-sprint-question': this.nextSprintQuestion(); break;
          case 'exit-sprint': this.exitSprint(); break;

          // Review Due
          case 'open-review-due': this.openReviewDue(); break;
          case 'select-review-option': this.selectReviewOption(el.getAttribute('data-option')); break;
          case 'show-review-explanation': this.showReviewExplanation(); break;
          case 'back-to-review-question': this.backToReviewQuestion(); break;
          case 'next-review-question': this.nextReviewQuestion(); break;
          case 'exit-review': this.exitReview(); break;
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
