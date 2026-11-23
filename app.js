import { load, save, store, hasPin, setPin, checkPin, requestPersist } from './store.js';
import * as E from './engine.js';
import { actions, bus, $, ic } from './ui.js';
import { render, ui } from './views.js';
import './sheets.js';

const lockEl = () => $('#lock');
let locked = false, hiddenAt = 0;

function askPin(title, sub, check) {
  return new Promise((resolve) => {
    const el = lockEl();
    el.hidden = false;
    let v = '';
    el.innerHTML = `<div class="brand"><span class="mark"><i style="background:#3987e5;width:20px"></i><i style="background:#199e70;width:27px"></i><i style="background:#f2ede0;width:34px"></i></span>Cap</div>
      <p id="lk-sub"><b style="color:var(--tx);font-weight:650">${title}</b><br>${sub}</p>
      <div class="dots" id="lk-dots"><i></i><i></i><i></i><i></i></div>
      <div class="pad">${[1, 2, 3, 4, 5, 6, 7, 8, 9].map((n) => `<button data-k="${n}" aria-label="${n}">${n}</button>`).join('')}<span></span><button data-k="0" aria-label="0">0</button><button class="ghost" data-k="del" aria-label="Effacer">${ic('back')}</button></div>`;
    const paint = () => $('#lk-dots').querySelectorAll('i').forEach((d, i) => d.classList.toggle('f', i < v.length));
    el.onclick = async (e) => {
      const b = e.target.closest('[data-k]'); if (!b) return;
      const k = b.dataset.k;
      if (k === 'del') v = v.slice(0, -1);
      else if (v.length < 4) v += k;
      paint();
      if (v.length === 4) {
        if (check && !(await check(v))) {
          navigator.vibrate?.(60);
          const dots = $('#lk-dots'); dots.classList.add('shake'); setTimeout(() => dots.classList.remove('shake'), 420);
          $('#lk-sub').innerHTML = '<b style="color:var(--bad);font-weight:650">Code incorrect</b><br>Réessaie';
          v = ''; setTimeout(paint, 200); return;
        }
        const out = v; v = '';
        resolve(out);
      }
    };
  });
}

async function createPin(intro = true) {
  for (;;) {
    const a = await askPin(intro ? 'Bienvenue' : 'Nouveau code', 'Crée un code PIN à 4 chiffres');
    const b = await askPin('Confirme ton code', 'Saisis-le une seconde fois');
    if (a === b) { await setPin(a); return; }
    intro = false;
  }
}
async function unlock() {
  locked = true;
  await askPin('Bon retour', 'Saisis ton code PIN', checkPin);
  lockEl().hidden = true; lockEl().innerHTML = ''; locked = false;
}
bus.lock = async () => { if (!hasPin() || locked) return; await unlock(); };
bus.changePin = async () => {
  await askPin('Code actuel', 'Pour le changer', checkPin);
  await createPin(false);
  lockEl().hidden = true; lockEl().innerHTML = '';
};

function notify() {
  const s = store.state;
  if (!s.settings.notif || !('Notification' in window) || Notification.permission !== 'granted') return;
  const today = new Date().toDateString();
  if (localStorage.getItem('cap.notified') === today) return;
  const w = E.insights(s).find((i) => i.tone === 'warn');
  if (!w) return;
  localStorage.setItem('cap.notified', today);
  navigator.serviceWorker?.ready.then((r) => r.showNotification('Cap', { body: `${w.title}. ${w.text}`, icon: 'icon-192.png', badge: 'icon-192.png', tag: 'cap-alert' }));
}

document.addEventListener('click', (e) => {
  const el = e.target.closest('[data-act]');
  if (!el) return;
  const fn = actions[el.dataset.act];
  if (fn) { e.preventDefault?.(); fn(el, e); }
});
document.addEventListener('visibilitychange', () => {
  if (document.hidden) hiddenAt = Date.now();
  else if (hasPin() && !locked && Date.now() - hiddenAt > 60000) bus.lock();
});

async function boot() {
  load(); requestPersist();
  if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost')) navigator.serviceWorker.register('sw.js').catch(() => {});
  if (!hasPin()) await createPin(); else await unlock();
  lockEl().hidden = true; lockEl().innerHTML = '';
  save();
  render();
  notify();
}
boot();
