/* ==========================================================================
   dataLoader.js — fetches manifest/subject/chapter JSON on demand.
   Nothing here is hardcoded to "only Anatomy exists" — every other subject's
   topics.json and chXX chapter files can be dropped into data/<slug>/ later
   and this loader will pick them up automatically via manifest.json.
   ========================================================================== */

const DataLoader = {
  _manifest: null,
  _topicsCache: {},   // subject_slug -> topics.json content
  _chapterCache: {},  // chapter_file path -> chapter content

  async getManifest() {
    if (this._manifest) return this._manifest;
    const res = await fetch('data/manifest.json');
    if (!res.ok) throw new Error('Could not load manifest.json');
    this._manifest = await res.json();
    return this._manifest;
  },

  async getSubjectTopics(subjectSlug) {
    if (this._topicsCache[subjectSlug]) return this._topicsCache[subjectSlug];
    try {
      const res = await fetch(`data/${subjectSlug}/topics.json`);
      if (!res.ok) return null; // subject not built yet
      const data = await res.json();
      this._topicsCache[subjectSlug] = data;
      return data;
    } catch (e) {
      return null;
    }
  },

  async getChapter(chapterFilePath) {
    // chapterFilePath looks like "data/anatomy/ch01_pharyngeal_arch_arteries.json"
    if (this._chapterCache[chapterFilePath]) return this._chapterCache[chapterFilePath];
    try {
      const res = await fetch(chapterFilePath);
      if (!res.ok) return null; // chapter not generated yet
      const data = await res.json();
      this._chapterCache[chapterFilePath] = data;
      return data;
    } catch (e) {
      return null;
    }
  },

  /**
   * Lightweight summary for the Sprint setup screen: how many MCQs are
   * available, broken down by subject — without fetching every chapter
   * file (topics.json already carries mcq_count per generated chapter).
   */
  async getSprintPoolSummary() {
    const manifest = await this.getManifest();
    const perSubject = [];
    let total = 0;
    for (const s of manifest.subjects) {
      if (s.chapter_files_generated === 0) continue;
      const topicsDoc = await this.getSubjectTopics(s.subject_slug);
      if (!topicsDoc) continue;
      const count = topicsDoc.topics
        .filter(t => t.chapter_generated)
        .reduce((sum, t) => sum + (t.mcq_count || 0), 0);
      if (count > 0) {
        perSubject.push({ subject_slug: s.subject_slug, subject: s.subject, mcqCount: count });
        total += count;
      }
    }
    return { total, perSubject };
  },

  /**
   * Assembles the actual Sprint question pool: every MCQ from every
   * generated chapter, optionally restricted to one subject. Each pool
   * entry carries enough context (subject, topic, full chapter object) to
   * record attempts and roll up mastery correctly even though Sprint mixes
   * questions from different chapters/subjects in one run.
   *
   * This is the one function that makes Sprint "just grow" as more
   * chapters are added later — it never hardcodes a subject or chapter
   * list, it discovers them fresh from manifest.json every time it runs.
   */
  async getAllGeneratedChapters(subjectFilter = null) {
    const manifest = await this.getManifest();
    const pool = [];
    const subjectsToScan = manifest.subjects.filter(s =>
      s.chapter_files_generated > 0 && (!subjectFilter || s.subject_slug === subjectFilter)
    );
    for (const s of subjectsToScan) {
      const topicsDoc = await this.getSubjectTopics(s.subject_slug);
      if (!topicsDoc) continue;
      const generatedTopics = topicsDoc.topics.filter(t => t.chapter_generated);
      for (const t of generatedTopics) {
        const chapter = await this.getChapter(t.chapter_file);
        if (!chapter) continue;
        for (const mcq of chapter.mcqs) {
          pool.push({
            mcq,
            subject_slug: s.subject_slug,
            subject: s.subject,
            topic: t.topic,
            topic_id: t.topic_id,
            chapter
          });
        }
      }
    }
    return pool;
  }
};

window.DataLoader = DataLoader;

