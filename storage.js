const memory = new Map();
let warned = false;
let userScope = '';
const scopedKey = key => userScope && (['hh-records', 'hh-favorites', 'hh-plays', 'hh-recent', 'hh-quarry'].includes(key) || key.startsWith('hh-save-')) ? `hh-user-${userScope}-${key}` : key;
const accountKeys = new Set([
  'hh-favorites', 'hh-plays', 'hh-recent', 'hh-quarry', 'hh-save-frontline-web-v1', 'hh-save-open-trails-v2',
  ...['horse', 'cross', 'blocks', 'dash', 'drive', 'miner', 'life', 'bowl', 'snake', 'snow', 'drag', 'whip', 'border'].map(key => `hh-save-${key}-v2`),
  ...['ultra', 'offroad', 'drift', 'sortie'].map(key => `hh-save-${key}-v3`)
]);
const saves = new Map();
let transport = null, generation = 0, uploadTimer, pollTimer, polling = false, leaving = false, syncError = '';
const journalKey = key => `hh-user-${userScope}-hh-sync-${key}`;

function cacheText(key, value) {
  memory.set(key, value);
  try {
    if (value === null) localStorage.removeItem(key); else localStorage.setItem(key, value);
    return true;
  } catch {
    if (!warned) { warned = true; window.dispatchEvent(new Event('hh-storage-unavailable')); }
    return false;
  }
}
function journal(key, state) { cacheText(journalKey(key), state.dirty ? JSON.stringify(state.dirty) : null); }
function changed(keys) { window.dispatchEvent(new CustomEvent('hh-account-save-changed', { detail: { keys } })); }
function statusChanged() { window.dispatchEvent(new Event('hh-save-sync')); }
export function accountSaveStatus() {
  if (!transport) return 'Progress stays on this device';
  if (syncError) return syncError;
  return [...saves.values()].some(state => state.dirty || state.flight) ? 'Saving progress to your account…' : 'Progress saved to your account';
}
function schedule(delay = 600) {
  if (!transport || uploadTimer) return;
  uploadTimer = setTimeout(() => { uploadTimer = undefined; void flushAccountSaves(leaving); }, delay);
}
function dirtySave(key, state, value) {
  state.stopped = false;
  state.dirty = { revision: state.revision, requestId: crypto.randomUUID(), value, previousRequestId: state.flight?.requestId || '' };
  journal(key, state); statusChanged(); schedule();
}
function adopt(key, state, row) {
  state.revision = row.revision; state.mutation = row.mutation;
  state.value = row.value; state.dirty = null; state.flight = null;
  cacheText(scopedKey(key), row.value); journal(key, state);
  if (row.value === null && readText('hh-legacy-owner') === userScope) cacheText(key, null);
}

// The session includes the server snapshot, so existing games can keep synchronous load().
// Local journals retain unsent changes; revisions protect a newer save on another device.
export function connectAccountStorage(snapshot, request) {
  if (!userScope) return;
  if (transport) return; // Profile changes must not reset in-flight saves.
  transport = request; syncError = '';
  for (const key of accountKeys) {
    const row = snapshot?.[key] || { revision: 0, value: null, mutation: '' };
    const local = readText(key, null), pending = read(journalKey(key), null);
    const state = { revision: row.revision, mutation: row.mutation, value: row.value, dirty: null, flight: null, busy: false, blocked: false };
    saves.set(key, state);
    if (pending && typeof pending.value === 'string' && typeof pending.requestId === 'string'
        && pending.requestId !== row.mutation
        && (pending.revision === row.revision || (pending.previousRequestId && pending.previousRequestId === row.mutation))) {
      state.value = pending.value;
      state.dirty = { ...pending, revision: row.revision, previousRequestId: '' };
      cacheText(scopedKey(key), pending.value); journal(key, state);
    } else if (!snapshot?.[key] && local !== null && !pending) {
      try { JSON.parse(local); } catch { continue; } // Leave a damaged legacy cache for the game's own recovery.
      state.value = local; dirtySave(key, state, local); // First sign-in imports this account's existing browser save.
    } else adopt(key, state, row);
  }
  pollTimer = setInterval(() => { if (!document.hidden) void refreshAccountSaves(); }, 15000);
  statusChanged(); schedule();
}

async function upload(key, state, keepalive) {
  if (state.busy || state.blocked || state.stopped || !state.dirty) return;
  const currentGeneration = generation, owner = userScope;
  const change = state.flight ||= { ...state.dirty };
  state.busy = true;
  try {
    const result = await transport('saves', { accountId: owner, key, value: change.value, revision: change.revision, requestId: change.requestId }, keepalive);
    if (generation !== currentGeneration || state.blocked || result.save.revision < state.revision) return;
    state.revision = result.save.revision; state.mutation = result.save.mutation; state.flight = null;
    if (state.dirty?.requestId === change.requestId) state.dirty = null;
    else if (state.dirty) state.dirty = { ...state.dirty, revision: state.revision, previousRequestId: '' };
    journal(key, state); syncError = '';
  } catch (error) {
    if (generation !== currentGeneration || state.blocked) return;
    if (error.status === 409 && error.result?.save && error.result.save.revision >= state.revision) {
      state.blocked = key.startsWith('hh-save-') || key === 'hh-quarry'; adopt(key, state, error.result.save);
      syncError = state.blocked ? 'Loading progress updated on another page or computer…' : '';
      changed([key]);
    } else if (error.status >= 400 && error.status < 500 && error.status !== 429) {
      state.stopped = true; state.flight = null;
      syncError = [401, 403, 409].includes(error.status) ? 'Sign in again to sync progress' : 'Progress could not sync · ' + error.message;
    } else {
      syncError = 'Progress waiting to sync · retrying shortly';
    }
  } finally {
    if (generation === currentGeneration) {
      state.busy = false; statusChanged();
      if (state.dirty && !state.blocked && !state.stopped) schedule(syncError ? 3000 : 600);
    }
  }
}
export async function flushAccountSaves(keepalive = false) {
  if (!transport) return;
  clearTimeout(uploadTimer); uploadTimer = undefined;
  await Promise.all([...saves].map(([key, state]) => upload(key, state, keepalive)));
}
export async function refreshAccountSaves() {
  if (!transport || polling) return;
  polling = true;
  const currentGeneration = generation;
  try {
    const result = await transport('saves');
    if (generation !== currentGeneration || result.accountId !== userScope) return;
    const updated = [];
    for (const [key, row] of Object.entries(result.saves)) {
      const state = saves.get(key);
      if (!state || state.blocked || row.revision <= state.revision || row.mutation === state.flight?.requestId) continue;
      state.blocked = key.startsWith('hh-save-') || key === 'hh-quarry';
      adopt(key, state, row); updated.push(key);
    }
    if (updated.length) changed(updated);
    if (!updated.length && syncError && ![...saves.values()].some(state => state.stopped)) { syncError = ''; schedule(); }
    statusChanged();
  } catch { /* Uploads retain their journal and show their own retry status. */ }
  finally { if (generation === currentGeneration) polling = false; }
}
export async function deleteAccountSaves(keys, owner) {
  if (!transport || owner !== userScope) throw new Error('Sign in to delete saved progress.');
  const currentGeneration = generation;
  const blocked = keys.map(key => saves.get(key)).filter(Boolean);
  for (const state of blocked) state.blocked = true;
  try {
    const result = await transport('saves/delete', { accountId: owner, keys, requestId: crypto.randomUUID() });
    if (generation !== currentGeneration) throw new Error('Your account changed. Reload this page.');
    for (const [key, row] of Object.entries(result.saves)) {
      const state = saves.get(key);
      if (state) { adopt(key, state, row); state.blocked = false; }
    }
    syncError = ''; statusChanged(); changed(keys);
  } catch (error) {
    if (generation === currentGeneration) { for (const state of blocked) state.blocked = false; schedule(); }
    throw error;
  }
}

export function setStorageUser(id) {
  if ((id || '') !== userScope) {
    generation++; transport = null; saves.clear(); polling = false; syncError = ''; leaving = false;
    clearTimeout(uploadTimer); uploadTimer = undefined; clearInterval(pollTimer);
  }
  userScope = id || '';
  const legacyOwner = readText('hh-legacy-owner');
  if (!id || (legacyOwner && legacyOwner !== id)) return;
  if (!legacyOwner) writeText('hh-legacy-owner', id);
  for (const key of ['hh-favorites', 'hh-plays', 'hh-quarry', 'hh-save-blocks-v2', 'hh-save-miner-v2', 'hh-save-life-v2', 'hh-save-bowl-v2']) {
    try {
      const legacy = localStorage.getItem(key);
      if (legacy !== null && localStorage.getItem(scopedKey(key)) === null) writeText(key, legacy);
    } catch { break; }
  }
}

export function readText(key, fallback = '') {
  key = scopedKey(key);
  if (memory.has(key)) return memory.get(key) ?? fallback;
  try { return localStorage.getItem(key) ?? fallback; }
  catch { return memory.get(key) ?? fallback; }
}

window.addEventListener('storage', event => {
  if (event.key === null) memory.clear();
  else memory.delete(event.key);
});

export function writeText(key, value) {
  value = String(value);
  const state = transport && saves.get(key);
  if (state?.blocked) return false;
  const cached = cacheText(scopedKey(key), value);
  if (state && value !== state.value) { state.value = value; dirtySave(key, state, value); }
  return state ? true : cached;
}

export function read(key, fallback) {
  try { return JSON.parse(readText(key)) ?? fallback; }
  catch { return fallback; }
}

export function write(key, value) { return writeText(key, JSON.stringify(value)); }
export function remove(key, { legacy = false } = {}) {
  const keys = [scopedKey(key)];
  if (legacy && readText('hh-legacy-owner') === userScope && !keys.includes(key)) keys.push(key);
  return keys.map(storageKey => cacheText(storageKey, null)).every(Boolean);
}

window.addEventListener('online', () => { void flushAccountSaves(); void refreshAccountSaves(); });
window.addEventListener('pagehide', () => { leaving = true; queueMicrotask(() => { void flushAccountSaves(true); }); });
window.addEventListener('pageshow', () => { leaving = false; });
window.addEventListener('focus', () => { void refreshAccountSaves(); });
window.addEventListener('visibilitychange', () => {
  if (document.hidden) queueMicrotask(() => { void flushAccountSaves(true); });
  else void refreshAccountSaves();
});
export function number(value, fallback = 0, max = 1e12) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.min(value, max) : fallback;
}

export const scoredGameIds = new Set(['fence-hopper', 'crosswalk-sprint', 'pulse-runner', 'neon-pursuit', 'snow-rider', 'no-limit-drag-racing-2', 'ultrakill', 'offroad-outlaws', 'drift-hunters', 'flight-sortie', 'project-frontline', 'whip-clicker', 'border-desk', 'open-trails', '2048', 'slope-3', 'idle-mining-empire', 'subway-surfers', 'tiny-fishing', 'slice-master', 'google-snake', 'block-blast', 'bitlife', 'retro-bowl', 'doom', 'pool', 'eaglecraft']);

export function scoreLimit(id) { return ['idle-mining-empire', 'whip-clicker'].includes(id) ? 1e60 : 1e12; }

export function counters(key) {
  const data = read(key, {});
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return Object.fromEntries(Object.entries(data).filter(([id]) => key !== 'hh-records' || scoredGameIds.has(id)).map(([id, count]) => [id, number(count, 0, key === 'hh-records' ? scoreLimit(id) : 1e12)]));
}

export function recordScore(id, score) {
  if (!scoredGameIds.has(id)) return 0;
  const scores = counters('hh-records');
  const best = Math.max(scores[id] || 0, Math.floor(number(score, 0, scoreLimit(id))));
  if (best !== scores[id]) write('hh-records', { ...scores, [id]: best });
  return best;
}

export function trackLaunch(id) {
  const plays = counters('hh-plays');
  write('hh-plays', { ...plays, [id]: (plays[id] || 0) + 1 });
}
