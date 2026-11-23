import { fmt, round2 } from './model.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const P = {
  star: '<path d="m12 4 2.4 5 5.4.7-4 3.7 1 5.4L12 16.2 7.2 18.8l1-5.4-4-3.7 5.4-.7z"/>',
  home: '<path d="M4 11.5 12 5l8 6.5V19a1 1 0 0 1-1 1h-4v-5h-6v5H5a1 1 0 0 1-1-1z"/>',
  wallet: '<path d="M4 7.5A2.5 2.5 0 0 1 6.5 5H18v3"/><path d="M4 7.5V17a2 2 0 0 0 2 2h12a1 1 0 0 0 1-1V9a1 1 0 0 0-1-1H6.5A2.5 2.5 0 0 1 4 5.5"/><circle cx="15.5" cy="13.5" r="1.1"/>',
  chat: '<path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v6a2.5 2.5 0 0 1-2.5 2.5H11l-4 3.5V15a2.5 2.5 0 0 1-2-2.4z"/>',
  trend: '<path d="M4 16.5 9.5 11l3.5 3.5L20 7.5"/><path d="M15 7.5h5V12"/>',
  sliders: '<path d="M5 7h8M17 7h2M5 17h2M11 17h8"/><circle cx="15" cy="7" r="2"/><circle cx="9" cy="17" r="2"/>',
  lock: '<rect x="5" y="10.5" width="14" height="9" rx="2.5"/><path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5"/>',
  send: '<path d="M5 12h13M13 6l6 6-6 6"/>',
  back: '<path d="M15 6l-6 6 6 6"/>',
  chev: '<path d="M9 6l6 6-6 6"/>',
  refresh: '<path d="M19 12a7 7 0 1 1-2.2-5.1"/><path d="M19 5v4h-4"/>',
};
export const ic = (n) => `<svg class="ic" viewBox="0 0 24 24" aria-hidden="true">${P[n]}</svg>`;

export function bigMoney(n, { sign = false } = {}) {
  const v = round2(Math.abs(n));
  const [i, d] = v.toFixed(2).split('.');
  const int = Number(i).toLocaleString('fr-FR');
  const sg = n < 0 ? '−' : sign && n > 0 ? '+' : '';
  return `${sg}${int}<span class="cents">,${d}&nbsp;€</span>`;
}
export const signed = (n) => (n >= 0 ? '+' : '−') + fmt(Math.abs(n));

export const actions = {};
export const bus = { refresh() {}, go() {}, commit() {} };

let closing = null;
export function openSheet(html, mount) {
  const root = $('#sheet-root');
  clearTimeout(closing);
  root.innerHTML = `<div class="scrim" data-act="close"></div><div class="sheet" role="dialog" aria-modal="true"><div class="grab"></div>${html}</div>`;
  requestAnimationFrame(() => requestAnimationFrame(() => root.classList.add('open')));
  const sheet = $('.sheet', root);
  mount?.(sheet);
  return sheet;
}
export function closeSheet() {
  const root = $('#sheet-root');
  root.classList.remove('open');
  closing = setTimeout(() => (root.innerHTML = ''), 340);
}
export const sheetEl = () => $('#sheet-root .sheet');

let tt;
export function toast(msg) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(tt);
  tt = setTimeout(() => t.classList.remove('on'), 2400);
}

export const frDate = (iso, opts = { weekday: 'short', day: 'numeric', month: 'short' }) => new Date(iso).toLocaleDateString('fr-FR', opts).replace(/\./g, '');
export function dayLabel(ts, now = new Date()) {
  const d = new Date(ts);
  const a = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const b = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const diff = Math.round((a - b) / 86400000);
  if (diff === 0) return "Aujourd'hui";
  if (diff === 1) return 'Hier';
  return frDate(ts);
}
export const monthLabel = (key) => {
  const [y, m] = key.split('-').map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' });
};
