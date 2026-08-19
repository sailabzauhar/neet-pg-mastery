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
  }
};

window.DataLoader = DataLoader;
