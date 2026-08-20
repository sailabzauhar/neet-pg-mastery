/* ==========================================================================
   storage.js — IndexedDB wrapper. All user progress lives in-browser.
   No backend, no login. Same browser + same device = progress persists
   across closing the tab/browser/device restart, until site data is cleared.
   ========================================================================== */

const DB_NAME = 'neetpg_mastery_db';
const DB_VERSION = 3; // v3 adds STORE_SCHEDULE — per-MCQ SM-2 spaced-repetition state
const STORE_ATTEMPTS = 'attempts';       // every individual answer a user gives
const STORE_MASTERY = 'mastery';         // rolled-up mastery per concept
const STORE_META = 'meta';               // streak, last-active-date, settings
const STORE_SCHEDULE = 'schedule';       // SM-2 state per mcq_id — when it's next due

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      const tx = e.target.transaction; // the versionchange transaction — the only
                                        // way to touch an EXISTING store's indexes
      let attemptsStore;
      if (!db.objectStoreNames.contains(STORE_ATTEMPTS)) {
        attemptsStore = db.createObjectStore(STORE_ATTEMPTS, { keyPath: 'attempt_id', autoIncrement: true });
        attemptsStore.createIndex('mcq_id', 'mcq_id', { unique: false });
        attemptsStore.createIndex('concept', 'concept', { unique: false });
        attemptsStore.createIndex('timestamp', 'timestamp', { unique: false });
      } else {
        attemptsStore = tx.objectStore(STORE_ATTEMPTS);
      }
      // Added in v2 — safe to run even on a fresh v1-less DB, since the
      // branch above already skips creating it twice.
      if (!attemptsStore.indexNames.contains('topic_id')) {
        attemptsStore.createIndex('topic_id', 'topic_id', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MASTERY)) {
        db.createObjectStore(STORE_MASTERY, { keyPath: 'concept_key' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
      }
      if (!db.objectStoreNames.contains(STORE_SCHEDULE)) {
        db.createObjectStore(STORE_SCHEDULE, { keyPath: 'mcq_id' });
      }
    };
    req.onsuccess = (e) => resolve(e.target.result);
    req.onerror = (e) => reject(e.target.error);
  });
  return dbPromise;
}

async function withStore(storeName, mode, fn) {
  const db = await openDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);
    const result = fn(store);
    tx.oncomplete = () => resolve(result && result.__pendingResult !== undefined ? result.__pendingResult : result);
    tx.onerror = () => reject(tx.error);
  });
}

const Storage = {
  async recordAttempt(attempt) {
    // attempt: { mcq_id, subject_slug, topic_id, concept, difficulty, correct, confidence, time_ms, timestamp }
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ATTEMPTS, 'readwrite');
      tx.objectStore(STORE_ATTEMPTS).add(attempt);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async getAttemptsForConcept(concept) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ATTEMPTS, 'readonly');
      const idx = tx.objectStore(STORE_ATTEMPTS).index('concept');
      const req = idx.getAll(concept);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async getAttemptsForTopic(topicId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ATTEMPTS, 'readonly');
      const idx = tx.objectStore(STORE_ATTEMPTS).index('topic_id');
      const req = idx.getAll(topicId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllAttempts() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_ATTEMPTS, 'readonly');
      const req = tx.objectStore(STORE_ATTEMPTS).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async setMastery(conceptKey, masteryRecord) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MASTERY, 'readwrite');
      tx.objectStore(STORE_MASTERY).put({ concept_key: conceptKey, ...masteryRecord });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async getMastery(conceptKey) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MASTERY, 'readonly');
      const req = tx.objectStore(STORE_MASTERY).get(conceptKey);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async getAllMastery() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_MASTERY, 'readonly');
      const req = tx.objectStore(STORE_MASTERY).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  async setMeta(key, value) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readwrite');
      tx.objectStore(STORE_META).put({ key, value });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async getMeta(key, fallback = null) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_META, 'readonly');
      const req = tx.objectStore(STORE_META).get(key);
      req.onsuccess = () => resolve(req.result ? req.result.value : fallback);
      req.onerror = () => reject(req.error);
    });
  },

  // ---- SM-2 schedule state, per MCQ ----
  async getSchedule(mcqId) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SCHEDULE, 'readonly');
      const req = tx.objectStore(STORE_SCHEDULE).get(mcqId);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => reject(req.error);
    });
  },

  async setSchedule(mcqId, record) {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SCHEDULE, 'readwrite');
      tx.objectStore(STORE_SCHEDULE).put({ mcq_id: mcqId, ...record });
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  },

  async getAllSchedules() {
    const db = await openDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_SCHEDULE, 'readonly');
      const req = tx.objectStore(STORE_SCHEDULE).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  },

  // ---- Export / Import: manual backup, per Section 41 (workaround for "no server") ----
  async exportProgress() {
    const [attempts, mastery, schedule] = await Promise.all([
      this.getAllAttempts(), this.getAllMastery(), this.getAllSchedules()
    ]);
    const streak = await this.getMeta('streak', { count: 0, lastActiveDate: null });
    return JSON.stringify({
      export_version: '2.0',
      exported_at: new Date().toISOString(),
      attempts,
      mastery,
      schedule,
      streak
    }, null, 2);
  },

  async importProgress(jsonString) {
    const data = JSON.parse(jsonString);
    const db = await openDB();
    const tx = db.transaction([STORE_ATTEMPTS, STORE_MASTERY, STORE_META, STORE_SCHEDULE], 'readwrite');
    (data.attempts || []).forEach(a => {
      const { attempt_id, ...rest } = a;
      tx.objectStore(STORE_ATTEMPTS).add(rest);
    });
    (data.mastery || []).forEach(m => tx.objectStore(STORE_MASTERY).put(m));
    (data.schedule || []).forEach(s => tx.objectStore(STORE_SCHEDULE).put(s));
    if (data.streak) tx.objectStore(STORE_META).put({ key: 'streak', value: data.streak });
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
};

window.Storage = Storage;
