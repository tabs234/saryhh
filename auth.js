import { setStorageUser, connectAccountStorage, flushAccountSaves, counters, write, scoreLimit, scoredGameIds } from './storage.js?v=20261013-account-saves-1';

export let account = null;
export let accountError = '';
let csrf = '';
let initialization;

export async function request(path, data, keepalive = false) {
  let response;
  try {
    response = await fetch('/api/' + path, {
      method: data === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', keepalive,
      headers: data === undefined ? {} : { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
      body: data === undefined ? undefined : JSON.stringify(data),
      signal: AbortSignal.timeout(12000)
    });
  } catch { throw new Error('Cannot reach HaywardHub. Keep this page open and try again shortly.'); }
  let result;
  try { result = await response.json(); }
  catch { throw new Error('HaywardHub is temporarily unavailable. Please try again shortly.'); }
  if (!response.ok) {
    const error = new Error(result?.error || 'That change could not be saved. Please try again.');
    error.status = response.status;
    error.result = result;
    throw error;
  }
  return result;
}

export function useSession(session) {
  account = session.user; csrf = session.csrf; accountError = '';
  setStorageUser(account?.id);
  if (account) { connectAccountStorage(session.saves, request); mergePersonalBests(session.personalBests); }
  return account;
}

export function mergePersonalBests(scores = {}) {
  const local = counters('hh-records');
  for (const [id, score] of Object.entries(scores)) if (scoredGameIds.has(id) && Number.isFinite(score) && Number.isInteger(score) && score >= 0 && score <= scoreLimit(id)) local[id] = Math.max(local[id] || 0, score);
  write('hh-records', local);
}

export function initializeAccount() {
  initialization ||= request('session').then(async session => { useSession(session); await flushAccountSaves(); if(account) { void import('./notifications.js?v=20261023-admin-1').then(module=>module.initializeMessages()); void import('./game-records.js?v=20261023-records-1').then(module=>module.recoverRecords(session.personalBests)); } return account; }).catch(error => {
    accountError = error.message;
    // A failed connection is retryable; do not cache it for the page's lifetime.
    initialization = undefined;
    return null;
  });
  return initialization;
}

export function accountLink(next = location.pathname + location.search) {
  return '/account.html?next=' + encodeURIComponent(next);
}

export function broadcastAccountChange() {
  try { localStorage.setItem('hh-account-change', String(Date.now()) + Math.random()); } catch {}
}

window.addEventListener('storage', event => { if (event.key === 'hh-account-change') location.reload(); });
window.addEventListener('pageshow', event => { if (event.persisted) location.reload(); });
