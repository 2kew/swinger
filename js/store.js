// Session history in localStorage. Only metrics/scores are stored —
// video never leaves the device and is not persisted.

const KEY = 'swinger.sessions.v1';
const SETTINGS_KEY = 'swinger.settings.v1';
const MAX_SESSIONS = 200;

export function listSessions() {
  try {
    const raw = localStorage.getItem(KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function saveSession(analysis) {
  const session = {
    id: `s${Date.now()}${Math.random().toString(36).slice(2, 6)}`,
    date: new Date().toISOString(),
    view: analysis.view,
    handedness: analysis.handedness,
    overall: analysis.overall,
    scores: analysis.scores,
    categories: analysis.categories,
    metrics: {
      tempo: analysis.metrics.tempo,
      shoulderTurn: analysis.metrics.shoulderTurn,
      hipTurn: analysis.metrics.hipTurn,
      xFactor: analysis.metrics.xFactor,
      armExtension: analysis.metrics.armExtension,
      headMove: analysis.metrics.headMove,
      spineChange: analysis.metrics.spineChange,
      kneeFlex: analysis.metrics.kneeFlex,
      weightShift: analysis.metrics.weightShift,
      finishHipTurn: analysis.metrics.finishHipTurn,
    },
  };
  const sessions = listSessions();
  sessions.push(session);
  persist(sessions.slice(-MAX_SESSIONS));
  return session;
}

export function deleteSession(id) {
  persist(listSessions().filter((s) => s.id !== id));
}

function persist(sessions) {
  try {
    localStorage.setItem(KEY, JSON.stringify(sessions));
  } catch {
    // Storage full or unavailable — history simply won't persist.
  }
}

export function loadSettings() {
  try {
    return { handedness: 'right', view: 'face-on', ...JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}') };
  } catch {
    return { handedness: 'right', view: 'face-on' };
  }
}

export function saveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch { /* ignore */ }
}
