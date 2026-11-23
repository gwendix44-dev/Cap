// Modèle de données + utilitaires purs (aucun accès DOM)

export const EUR = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' });
export const EUR0 = new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

export const fmt = (n) => EUR.format(round2(n));
export const fmt0 = (n) => EUR0.format(Math.round(n));
export const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
export const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
export const uid = () => Math.random().toString(36).slice(2, 10);

export const isoDay = (d) => {
  const x = new Date(d);
  const p = (n) => String(n).padStart(2, '0');
  return `${x.getFullYear()}-${p(x.getMonth() + 1)}-${p(x.getDate())}`;
};
export const ym = (d) => isoDay(d).slice(0, 7);
export const daysBetween = (a, b) => (new Date(b) - new Date(a)) / 86400000;

// Couleurs de données : palette catégorielle validée (mode sombre) – ordre fixe, jamais cyclé.
export const COLORS = {
  robo: '#3987e5',
  btc: '#d95926',
  voyages: '#199e70',
  plaisirs: '#c98500',
  nourriture: '#d55181',
  epargne: '#0ca30c',
  abos: '#9085e9',
  perso: '#8a93a8',
  etf: '#6bb7f0',
  extra: '#a7b0c6',
};

// RevPoints : € à dépenser pour 1 point, par abonnement (aide Revolut France, nov. 2026). Valeur indicative ~0,7 ct/point (non contractuelle).
export const REV_RATES = { standard: 10, plus: 10, premium: 4, metal: 2, ultra: 1 };
export const REV_PLANS = { standard: 'Standard', plus: 'Plus', premium: 'Premium', metal: 'Metal', ultra: 'Ultra' };
export const REV_VALUE = 0.007;
export const defaultRev = (now = new Date()) => ({
  points: 60000, target: 100000, plan: 'standard', monthlySpend: null, deadline: null,
  pocket: { active: false, min: 0, perDay: 0 },
  log: [{ d: isoDay(now), pts: 60000 }], done: {}, week: { key: '', checks: {} },
});

export const KIND_LABEL = { spend: 'Dépenses', save: 'Épargne', invest: 'Investissement' };

export function defaultState(now = new Date()) {
  const today = isoDay(now);
  return {
    v: 1,
    settings: {
      name: 'Ouinon',
      pinHash: null,
      pinSalt: null,
      influence: 60, // % de poids du conseiller face à mes % (0 = mes % purs)
      risk: 'equilibre-dynamique',
      horizon: 5,
      emergencyTarget: 1000,
      btcCap: 12, // % max de Bitcoin dans le portefeuille investi
      notif: false,
      llm: { enabled: false, key: '', model: 'gemini-flash-latest' },
      lastOpen: today,
    },
    pockets: [
      { id: 'abos', name: 'Abonnements', kind: 'spend', color: COLORS.abos, balance: 0, target: 130, pct: 0, role: 'need' },
      { id: 'nourriture', name: 'Nourriture', kind: 'spend', color: COLORS.nourriture, balance: 16, target: 50, pct: 0, role: 'need' },
      { id: 'voyages', name: 'Voyages', kind: 'spend', color: COLORS.voyages, balance: 168, target: 0, pct: 30, role: 'goal' },
      { id: 'plaisirs', name: 'Plaisirs', kind: 'spend', color: COLORS.plaisirs, balance: 42.82, target: 60, pct: 12, role: 'free' },
      { id: 'perso', name: 'Personnel', kind: 'spend', color: COLORS.perso, balance: 6.78, target: 40, pct: 5, role: 'free' },
      { id: 'epargne', name: 'Épargne', kind: 'save', color: COLORS.epargne, balance: 641.03, target: 0, pct: 18, role: 'save' },
      { id: 'robo', name: 'Robo-advisor', kind: 'invest', color: COLORS.robo, balance: 943, base: 943, target: 0, pct: 25, role: 'invest' },
      { id: 'btc', name: 'Bitcoin', kind: 'invest', color: COLORS.btc, balance: 801, base: 801, target: 0, pct: 10, role: 'btc' },
    ],
    goals: [
      { id: 'g-mars', name: 'Voyage de mars', target: 1500, date: '2027-03-01', pocket: 'voyages', created: today },
    ],
    subs: [], // [{id,name,amount}] – si vide, on utilise la cible de la poche Abonnements
    tx: [], // {id, ts, type: expense|income|move|adjust, pocket, amount, label, alloc?, imported?}
    snapshots: [{ d: today, total: 2618.63 }],
    chat: [],
    rules: {}, // description normalisée -> pocketId (import CSV)
    rev: defaultRev(now),
  };
}

export const pocketById = (s, id) => s.pockets.find((p) => p.id === id);
export const total = (s, pred = () => true) => round2(s.pockets.filter(pred).reduce((a, p) => a + p.balance, 0));
export const netWorth = (s) => total(s);
export const spendable = (s) => total(s, (p) => p.kind === 'spend');
export const invested = (s) => total(s, (p) => p.kind === 'invest');
export const savings = (s) => total(s, (p) => p.kind === 'save');

export function subsTotal(s) {
  if (s.subs.length) return round2(s.subs.reduce((a, x) => a + x.amount, 0));
  return pocketById(s, 'abos')?.target ?? 0;
}

export function addTx(s, tx, now = new Date()) {
  const t = { id: uid(), ts: now.toISOString(), ...tx };
  s.tx.unshift(t);
  return t;
}

// Applique une dépense (retire de la poche) et enregistre.
export function spend(s, { pocket, amount, label = '' }, now = new Date()) {
  const p = pocketById(s, pocket);
  if (!p) throw new Error('Poche inconnue');
  p.balance = round2(p.balance - amount);
  return addTx(s, { type: 'expense', pocket, amount: round2(amount), label }, now);
}

// Déplacement entre poches (virement interne Revolut).
export function move(s, { from, to, amount, label = '' }, now = new Date()) {
  const a = pocketById(s, from);
  const b = pocketById(s, to);
  a.balance = round2(a.balance - amount);
  b.balance = round2(b.balance + amount);
  if (b.kind === 'invest') b.base = round2((b.base ?? 0) + amount);
  if (a.kind === 'invest') b.base = b.base; // retrait : on ne touche pas la base ici
  return addTx(s, { type: 'move', pocket: to, from, amount: round2(amount), label }, now);
}

// Applique une répartition de revenu.
export function applyIncome(s, { amount, label = 'Revenu', alloc }, now = new Date()) {
  for (const [id, v] of Object.entries(alloc)) {
    const p = pocketById(s, id);
    if (!p || !v) continue;
    p.balance = round2(p.balance + v);
    if (p.kind === 'invest') p.base = round2((p.base ?? 0) + v);
  }
  return addTx(s, { type: 'income', pocket: null, amount: round2(amount), label, alloc }, now);
}

// Recale le solde d'une poche (ex. valeur réelle du robo-advisor ou du Bitcoin).
export function setBalance(s, id, value, now = new Date()) {
  const p = pocketById(s, id);
  const diff = round2(value - p.balance);
  p.balance = round2(value);
  addTx(s, { type: 'adjust', pocket: id, amount: diff, label: 'Solde recalé' }, now);
}

export function snapshot(s, now = new Date()) {
  const d = isoDay(now);
  const t = netWorth(s);
  const last = s.snapshots[s.snapshots.length - 1];
  if (last && last.d === d) last.total = t;
  else s.snapshots.push({ d, total: t });
  if (s.snapshots.length > 800) s.snapshots.shift();
}

export function txInMonth(s, month, types = ['expense']) {
  return s.tx.filter((t) => types.includes(t.type) && t.ts.slice(0, 7) === month);
}
export const sum = (arr, f = (x) => x) => round2(arr.reduce((a, x) => a + f(x), 0));

// Devine la poche d'une dépense depuis son libellé.
const KEYWORDS = [
  ['nourriture', /courses|carrefour|leclerc|lidl|auchan|intermarch|monoprix|boulang|supermarch|picard|u express|biocoop|casino/i],
  ['voyages', /train|sncf|ouigo|interrail|vol |avion|billet|hôtel|hotel|airbnb|auberge|hostel|booking|bus|flixbus|blablacar|voyage/i],
  ['abos', /spotify|netflix|disney|prime|abonnement|forfait|icloud|youtube premium|canal|deezer|apple\.com|google one|chatgpt|claude/i],
  ['plaisirs', /resto|restaurant|café|cafe|bar |bière|cinéma|cinema|sortie|kebab|burger|mcdo|mcdonald|pizza|sushi|jeu|steam|concert|soirée|boîte|club/i],
];
export function guessPocket(label) {
  for (const [id, re] of KEYWORDS) if (re.test(label || '')) return id;
  return 'perso';
}
