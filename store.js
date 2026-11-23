import { defaultState, defaultRev, snapshot } from './model.js';

const KEY = 'cap.budget.v1';
export const store = { state: null };

export function load() {
  try {
    const raw = localStorage.getItem(KEY);
    store.state = raw ? JSON.parse(raw) : defaultState();
  } catch {
    store.state = defaultState();
  }
  const d = defaultState();
  // migration douce : champs manquants
  store.state.settings = { ...d.settings, ...store.state.settings, llm: { ...d.settings.llm, ...(store.state.settings?.llm ?? {}) } };
  for (const k of ['pockets', 'goals', 'subs', 'tx', 'snapshots', 'chat']) store.state[k] ??= d[k];
  store.state.rules ??= {};
  store.state.rev = { ...defaultRev(), ...(store.state.rev ?? {}) };
  const rv = store.state.rev;
  if (!rv.hist) { // données réelles du résumé Revolut du 23/11/2026 (Premium, compte ouvert en mars 2025)
    rv.hist = { earned: 59005, since: '2025-03-01' };
    if (rv.plan === 'standard') rv.plan = 'premium';
    if (rv.points === 60000 && rv.log.length <= 1) { rv.points = 61127; rv.log = [{ d: '2026-11-23', pts: 61127 }]; }
  }
  store.state.rev.pocket = { ...defaultRev().pocket, ...(store.state.rev.pocket ?? {}) };
  return store.state;
}

export function save() {
  snapshot(store.state);
  try { localStorage.setItem(KEY, JSON.stringify(store.state)); } catch (e) { console.warn('save', e); }
}

export async function requestPersist() {
  try { await navigator.storage?.persist?.(); } catch { /* ignore */ }
}

export function exportJSON() {
  return JSON.stringify(store.state, null, 1);
}
export function importJSON(text) {
  const obj = JSON.parse(text);
  if (!obj || !Array.isArray(obj.pockets)) throw new Error('Fichier de sauvegarde invalide');
  store.state = obj;
  save();
  load();
}
export function resetAll() {
  localStorage.removeItem(KEY);
  load();
  save();
}

// ── Code PIN (verrou d'écran, pas un chiffrement des données)
const enc = new TextEncoder();
async function sha(str) {
  const buf = await crypto.subtle.digest('SHA-256', enc.encode(str));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
export async function setPin(pin) {
  const salt = crypto.getRandomValues(new Uint32Array(2)).join('-');
  store.state.settings.pinSalt = salt;
  store.state.settings.pinHash = await sha(salt + ':' + pin);
  save();
}
export async function checkPin(pin) {
  const { pinSalt, pinHash } = store.state.settings;
  if (!pinHash) return true;
  return (await sha(pinSalt + ':' + pin)) === pinHash;
}
export const hasPin = () => !!store.state.settings.pinHash;
