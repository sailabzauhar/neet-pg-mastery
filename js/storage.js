/* ==========================================================================
   storage.js — IndexedDB wrapper. All user progress lives in-browser.
   No backend, no login. Same browser + same device = progress persists
   across closing the tab/browser/device restart, until site data is cleared.
   ========================================================================== */

const DB_NAME = 'neetpg_mastery_db';
const DB_VERSION = 1;
const STORE_ATTEMPTS = 'attempts';       // every individual answer a user gives
const STORE_MASTERY = 'mastery';         // rolled-up mastery per concept
const STORE_META = 'meta';               // streak, last-active-date, settings

let dbPromise = null;

function openDB() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = e.target.result;
      if (!db.objectStoreNames.contains(STORE_ATTEMPTS)) {
        const s = db.createObjectStore(STORE_ATTEMPTS, { keyPath: 'attempt_id', autoIncrement: true });
        s.createIndex('mcq_id', 'mcq_id', { unique: false });
        s.createIndex('concept', 'concept', { unique: false });
        s.createIndex('timestamp', 'timestamp', { unique: false });
      }
      if (!db.objectStoreNames.contains(STORE_MASTERY)) {
        db.createObjectStore(STORE_MASTERY, { keyPath: 'concept_key' });
      }
      if (!db.objectStoreNames.contains(STORE_META)) {
        db.createObjectStore(STORE_META, { keyPath: 'key' });
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

  // ---- Export / Import: manual backup, per Section 41 (workaround for "no server") ----
  async exportProgress() {
    const [attempts, mastery] = await Promise.all([this.getAllAttempts(), this.getAllMastery()]);
    const streak = await this.getMeta('streak', { count: 0, lastActiveDate: null });
    return JSON.stringify({
      export_version: '1.0',
      exported_at: new Date().toISOString(),
      attempts,
      mastery,
      streak
    }, null, 2);
  },

  async importProgress(jsonString) {
    const data = JSON.parse(jsonString);
    const db = await openDB();
    const tx = db.transaction([STORE_ATTEMPTS, STORE_MASTERY, STORE_META], 'readwrite');
    (data.attempts || []).forEach(a => {
      const { attempt_id, ...rest } = a;
      tx.objectStore(STORE_ATTEMPTS).add(rest);
    });
    (data.mastery || []).forEach(m => tx.objectStore(STORE_MASTERY).put(m));
    if (data.streak) tx.objectStore(STORE_META).put({ key: 'streak', value: data.streak });
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => reject(tx.error);
    });
  }
};

window.Storage = Storage;
