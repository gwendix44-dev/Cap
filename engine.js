// Moteur du conseiller : règles explicables, 100 % local, aucun appel réseau.
import {
  REV_RATES as M_RATES, REV_VALUE, fmt, fmt0, round2, clamp, ym, daysBetween, pocketById, total, invested, savings,
  subsTotal, txInMonth, sum, netWorth, spendable,
} from './model.js';

const DAY = 30.44;

// ───────────────────────── Projets ─────────────────────────
export function goalStatuses(s, now = new Date()) {
  const avail = Object.fromEntries(s.pockets.map((p) => [p.id, Math.max(0, p.balance)]));
  const sorted = [...s.goals].sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((g) => {
    const saved = round2(Math.min(avail[g.pocket] ?? 0, g.target));
    avail[g.pocket] = round2((avail[g.pocket] ?? 0) - saved);
    const remaining = round2(g.target - saved);
    const monthsLeft = Math.max(0, daysBetween(now, g.date + 'T12:00:00') / DAY);
    const perMonth = remaining <= 0 ? 0 : round2(remaining / Math.max(monthsLeft, 0.5));
    const total = Math.max(1, daysBetween(g.created + 'T00:00:00', g.date + 'T12:00:00'));
    const elapsed = clamp(daysBetween(g.created + 'T00:00:00', now), 0, total);
    const expected = round2(g.target * (elapsed / total));
    let status = 'ontrack';
    if (remaining <= 0) status = 'done';
    else if (monthsLeft <= 0) status = 'late';
    else if (saved < expected * 0.9) status = 'behind';
    else if (saved > expected * 1.15 + 20) status = 'ahead';
    return { ...g, saved, remaining, monthsLeft, perMonth, expected, status, pct: clamp(saved / g.target, 0, 1) };
  });
}

export function monthlyIncome(s, now = new Date()) {
  const from = new Date(now); from.setDate(from.getDate() - 92);
  const inc = s.tx.filter((t) => t.type === 'income' && new Date(t.ts) >= from);
  if (!inc.length) return null;
  const first = new Date(Math.min(...inc.map((t) => +new Date(t.ts))));
  const months = clamp(daysBetween(first, now) / DAY, 1, 3);
  return round2(sum(inc, (t) => t.amount) / months);
}

// ───────────────────────── Portefeuille ─────────────────────────
export function portfolio(s) {
  const inv = s.pockets.filter((p) => p.kind === 'invest');
  const T = total(s, (p) => p.kind === 'invest');
  const shares = inv.map((p) => ({ id: p.id, name: p.name, color: p.color, value: p.balance, share: T ? p.balance / T : 0 }));
  const btc = shares.find((x) => x.id === 'btc');
  return { total: T, shares, btcShare: btc ? btc.share : 0 };
}

export function emergency(s) {
  const have = savings(s);
  const target = s.settings.emergencyTarget;
  return { have, target, ok: have >= target, missing: Math.max(0, round2(target - have)) };
}

// ───────────────────────── Répartition d'un revenu ─────────────────────────
export function allocate(s, income, now = new Date(), opts = {}) {
  const infl = clamp((opts.influence ?? s.settings.influence) / 100, 0, 1);
  const notes = [];
  const lines = [];
  let R = round2(income);

  // 1) Besoins fixes d'abord (enveloppes remises à niveau)
  for (const p of s.pockets.filter((x) => x.role === 'need')) {
    const tgt = p.id === 'abos' ? subsTotal(s) : p.target;
    const gap = Math.max(0, round2(tgt - p.balance));
    const give = Math.min(gap, R);
    if (give > 0) {
      lines.push({
        id: p.id, amount: give, kind: 'need',
        reason: give < gap
          ? `Revenu insuffisant pour tout couvrir : il manquera encore ${fmt(gap - give)}.`
          : `Remise à niveau pour couvrir ${fmt(tgt)} ce mois-ci.`,
      });
      R = round2(R - give);
    }
  }
  if (R <= 0) {
    notes.push('Ce revenu part entièrement dans les besoins fixes. Rien à investir ni à mettre de côté ce coup-ci.');
    return { income: round2(income), lines, notes, free: 0 };
  }

  // 2) Répartition du reste : mes % + ajustements du conseiller (dosés par l'influence)
  const cands = s.pockets.filter((p) => p.pct > 0 && p.role !== 'need');
  const base = Object.fromEntries(cands.map((p) => [p.id, p.pct]));
  const w = { ...base };
  const why = {};
  const note = (id, t) => (why[id] = (why[id] ? why[id] + ' ' : '') + t);
  const shift = (id, delta) => { if (id in w) w[id] = Math.max(0, w[id] + delta); };

  const goals = goalStatuses(s, now);
  const mi = monthlyIncome(s, now) ?? income;
  for (const g of goals) {
    if (!(g.pocket in w)) continue;
    if (g.status === 'done') {
      w[g.pocket] = 0;
      note(g.pocket, `Objectif « ${g.name} » atteint : plus besoin d'alimenter cette poche.`);
      continue;
    }
    // part du revenu nécessaire pour tenir le rythme du projet
    const req = g.perMonth * (income / Math.max(mi, income * 0.25));
    const desired = clamp(req / R, 0, 0.65) * 100;
    if (desired > w[g.pocket]) {
      const nw = base[g.pocket] + infl * (desired - base[g.pocket]);
      w[g.pocket] = nw;
      note(g.pocket, `Pour « ${g.name} » il faut ~${fmt0(g.perMonth)}/mois : je relève ta part de ${Math.round(base[g.pocket])} % à ${Math.round(nw)} %.`);
    } else {
      note(g.pocket, `Pour « ${g.name} » : ~${fmt0(g.perMonth)}/mois à prévoir, ta part habituelle suffit.`);
    }
  }

  const em = emergency(s);
  if (!em.ok && 'epargne' in w) {
    shift('epargne', 10 * infl);
    shift('robo', -5 * infl); shift('btc', -5 * infl); shift('etf', -3 * infl);
    note('epargne', `Ton matelas (${fmt0(em.have)}) est sous l'objectif de ${fmt0(em.target)} : avec des revenus irréguliers, il passe avant la bourse.`);
  } else if (em.have >= em.target * 1.5 && 'epargne' in w) {
    shift('epargne', -8 * infl); shift('robo', 8 * infl);
    note('epargne', 'Matelas confortable : je réoriente un peu vers l\'investissement.');
  }

  const pf = portfolio(s);
  if ('btc' in w && pf.btcShare * 100 > s.settings.btcCap) {
    const cut = w.btc * Math.min(1, (infl * 100) / 50);
    const freed = cut;
    w.btc -= cut;
    const sink = 'etf' in w ? 'etf' : 'robo';
    if (sink in w) w[sink] += freed;
    note('btc', `Bitcoin pèse ${Math.round(pf.btcShare * 100)} % de ton portefeuille (plafond conseillé ${s.settings.btcCap} %) : je mets les nouveaux achats en pause.`);
    if (sink in w) note(sink, 'Reçoit la part retirée au Bitcoin pour diversifier.');
  }

  if (R < 80) {
    let freed = 0;
    for (const id of ['robo', 'btc', 'etf']) if (id in w) { freed += w[id]; w[id] = 0; }
    if ('epargne' in w) w.epargne += freed;
    if (freed) notes.push(`Sous 80 € à répartir, je ne conseille pas d'investir : ça va en priorité sur l'épargne et le projet.`);
  }

  for (const p of cands) {
    if (p.role === 'free' && p.target > 0 && p.balance >= p.target && w[p.id] > 0) {
      w[p.id] = 0;
      note(p.id, `Poche déjà pleine (${fmt0(p.balance)} pour un budget de ${fmt0(p.target)}).`);
    }
  }

  if ('btc' in base && !(w.btc > 0) && why.btc) notes.push(why.btc);
  const sumW = Object.values(w).reduce((a, x) => a + x, 0);
  if (sumW <= 0) {
    notes.push('Toutes tes poches libres sont pleines : tu peux garder le reste sur Épargne.');
    const e = 'epargne';
    lines.push({ id: e, amount: R, kind: 'free', reason: 'Tout le reste en sécurité.' });
    return { income: round2(income), lines, notes, free: R };
  }

  let free = cands.map((p) => ({ id: p.id, w: w[p.id] / sumW, raw: (R * w[p.id]) / sumW }))
    .filter((x) => x.w > 0);
  const step = R >= 30 ? 1 : 0.01;
  free.forEach((x) => (x.amount = Math.floor(x.raw / step) * step));
  let rest = round2(R - free.reduce((a, x) => a + x.amount, 0));
  free.sort((a, b) => b.raw - a.raw);
  free[0].amount = round2(free[0].amount + rest);
  for (const x of free) {
    const p = pocketById(s, x.id);
    const share = Math.round(x.w * 100);
    const myShare = Math.round(base[x.id]);
    const head = share === myShare ? `Ta part : ${myShare} %.` : `Ta part ${myShare} % → conseillée ${share} %.`;
    lines.push({ id: x.id, amount: round2(x.amount), kind: p.role, reason: `${head} ${why[x.id] ?? ''}`.trim() });
  }
  return { income: round2(income), lines, notes, free: R };
}

// ───────────────────────── « Puis-je dépenser ? » ─────────────────────────
export function verdict(s, { amount, pocket, label = '' }, now = new Date()) {
  const p = pocketById(s, pocket);
  const pts = [];
  const alternatives = [];
  let level = 'ok';
  const after = round2(p.balance - amount);
  const month = ym(now);
  const spentMonth = sum(txInMonth(s, month).filter((t) => t.pocket === pocket), (t) => t.amount);
  const goals = goalStatuses(s, now);
  const goalOn = goals.find((g) => g.pocket === pocket && g.status !== 'done');

  const delayOf = (amt) => {
    const g = goals.find((x) => x.status !== 'done');
    if (!g || !g.perMonth) return 0;
    return Math.round(amt / (g.perMonth / DAY));
  };

  if (p.kind !== 'spend') {
    level = 'careful';
    pts.push(`${p.name} est une poche ${p.kind === 'save' ? "d'épargne" : "d'investissement"}, pas une poche de dépenses.`);
  }
  if (after < 0) {
    level = 'no';
    pts.push(`Il te manque ${fmt(-after)} : ${p.name} contient ${fmt(p.balance)}.`);
    for (const q of s.pockets.filter((x) => x.kind === 'spend' && x.id !== pocket && x.balance >= amount)) {
      const d = q.role === 'goal' ? delayOf(amount) : 0;
      alternatives.push({
        pocket: q.id, name: q.name,
        text: q.role === 'goal'
          ? `Prendre dans ${q.name} : retarde ton projet d'environ ${d} jour${d > 1 ? 's' : ''}.`
          : q.role === 'need'
            ? `Prendre dans ${q.name} : tu rogneras sur un besoin fixe.`
            : `Prendre dans ${q.name} : il t'y restera ${fmt(q.balance - amount)}.`,
        cost: q.role === 'goal' ? 3 : q.role === 'need' ? 2 : 1,
      });
    }
    alternatives.sort((a, b) => a.cost - b.cost);
  } else {
    const ratio = p.balance > 0 ? amount / p.balance : 1;
    if (ratio > 0.6) {
      level = 'careful';
      pts.push(`Ça consomme ${Math.round(ratio * 100)} % de ${p.name}. Il te restera ${fmt(after)}.`);
    }
    if (p.target > 0 && p.role === 'free' && spentMonth + amount > p.target) {
      level = 'careful';
      pts.push(`Ce mois-ci tu aurais dépensé ${fmt(spentMonth + amount)} en ${p.name} pour un budget de ${fmt0(p.target)}.`);
    }
    const abos = pocketById(s, 'abos');
    if (abos && p.role === 'free' && abos.balance < subsTotal(s)) {
      pts.push(`À savoir : tes abonnements ne sont pas encore couverts (il manque ${fmt(subsTotal(s) - abos.balance)}). Les besoins passent avant les envies.`);
    }
    if (goalOn && (goalOn.status === 'behind' || goalOn.status === 'late')) {
      level = 'careful';
      pts.push(`Ton projet « ${goalOn.name} » est en retard : chaque dépense ici le recule d'environ ${delayOf(amount)} jour(s).`);
    } else if (goalOn && p.role === 'goal') {
      pts.push(`Ça retarde « ${goalOn.name} » d'environ ${delayOf(amount)} jour(s) au rythme actuel.`);
    }
  }
  const headline = level === 'ok' ? 'Oui, c\'est raisonnable.' : level === 'careful' ? 'Possible, mais fais attention.' : 'Pas maintenant.';
  if (level === 'ok') pts.unshift(`Il te restera ${fmt(after)} dans ${p.name}.`);
  return { level, headline, points: pts, alternatives, after, pocket, amount, label };
}

// ───────────────────────── Investissement ─────────────────────────
export function investPlan(s, now = new Date()) {
  const pf = portfolio(s);
  const em = emergency(s);
  const cap = s.settings.btcCap;
  const advice = [];
  const btcPct = Math.round(pf.btcShare * 100);
  if (pf.total > 0 && btcPct > cap) {
    advice.push({
      tone: 'warn', id: 'btc-cap',
      title: `Bitcoin = ${btcPct} % de ton portefeuille`,
      text: `Pour un profil équilibré-dynamique, le Bitcoin se garde plutôt sous ${cap} % : c'est une ligne très volatile (elle peut perdre la moitié de sa valeur en quelques mois). Je te conseille de ne plus en acheter pour l'instant et de verser les prochains euros sur une base diversifiée (ETF S&P 500 / monde ou robo-advisor). Inutile de vendre : le poids de Bitcoin va se diluer avec le temps.`,
    });
  }
  if (!em.ok) {
    advice.push({
      tone: 'info', id: 'matelas',
      title: 'Matelas de sécurité d\'abord',
      text: `Tu as ${fmt0(em.have)} d'épargne pour un objectif de ${fmt0(em.target)}. Avec un revenu d'intérim irrégulier, c'est ce matelas qui t'évite de vendre tes placements au mauvais moment. Il manque ${fmt0(em.missing)}.`,
    });
  }
  const hasEtf = s.pockets.some((p) => p.id === 'etf');
  if (!hasEtf) {
    advice.push({
      tone: 'good', id: 'etf',
      title: 'Ajoute une poche « ETF S&P 500 »',
      text: `Un ETF S&P 500 te fait détenir en une seule ligne ~500 grandes entreprises américaines, pour des frais très bas. Sur 5 ans c'est un bon cœur de portefeuille, avec la réserve qu'il peut baisser de 20 à 30 % sur une mauvaise année. Tu peux l'ajouter dans Gérer › Poches, puis acheter l'ETF directement dans l'appli Revolut.`,
    });
  }
  advice.push({
    tone: 'info', id: 'horizon',
    title: 'Horizon 5 ans : règle des 2 ans',
    text: `Tout argent dont tu auras besoin d'ici moins de 2 ans (ton voyage de mars, par exemple) reste hors bourse et hors Bitcoin. Les actions se gardent avec un horizon d'au moins 5 ans, donc seulement ce qui ne bouge pas avant ${new Date(now).getFullYear() + s.settings.horizon}.`,
  });
  advice.push({
    tone: 'info', id: 'pea',
    title: 'PEA : à ouvrir tôt',
    text: `Le PEA est une enveloppe française : après 5 ans de détention, les gains sont exonérés d'impôt sur le revenu (seuls les prélèvements sociaux restent). Plus tu l'ouvres tôt, plus la durée de 5 ans démarre tôt, même avec un petit versement. Vérifie si Revolut le propose ; sinon il se prend chez un courtier français, séparément.`,
  });
  // Où mettre le prochain euro investi
  const next = [];
  if (pf.total > 0) {
    if (em.ok || em.have >= em.target * 0.6) {
      next.push(hasEtf ? { id: 'etf', pct: 60 } : { id: 'robo', pct: 70 });
      if (hasEtf) next.push({ id: 'robo', pct: 30 });
      else next.push({ id: 'etf', pct: 0 });
      if (btcPct <= cap) next.push({ id: 'btc', pct: 10 });
    }
  }
  return { pf, em, advice, next, cap, btcPct };
}

// ───────────────────────── Bilans & conseils du jour ─────────────────────────
export function monthSummary(s, month) {
  const exp = txInMonth(s, month, ['expense']);
  const inc = txInMonth(s, month, ['income']);
  const byPocket = {};
  for (const t of exp) byPocket[t.pocket] = round2((byPocket[t.pocket] ?? 0) + t.amount);
  const income = sum(inc, (t) => t.amount);
  const spent = sum(exp, (t) => t.amount);
  let put = 0;
  for (const t of inc) for (const [id, v] of Object.entries(t.alloc ?? {})) {
    const p = pocketById(s, id);
    if (p && (p.kind !== 'spend' || p.role === 'goal')) put += v;
  }
  put = round2(put);
  return { month, income, spent, byPocket, put, rate: income ? put / income : null, count: exp.length };
}

export function lastMonths(s, n = 6, now = new Date()) {
  const out = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = ym(d);
    out.push({ key, label: d.toLocaleDateString('fr-FR', { month: 'short' }).replace('.', ''), ...monthSummary(s, key) });
  }
  return out;
}

export function insights(s, now = new Date()) {
  const out = [];
  const goals = goalStatuses(s, now);
  for (const g of goals) {
    if (g.status === 'behind' || g.status === 'late') {
      out.push({ tone: 'warn', title: `« ${g.name} » prend du retard`, text: `Il te manque ${fmt0(g.remaining)} d'ici ${new Date(g.date).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' })}, soit ~${fmt0(g.perMonth)} par mois.` });
    } else if (g.status === 'done') {
      out.push({ tone: 'good', title: `« ${g.name} » : objectif atteint`, text: 'Tu peux réorienter les versements vers autre chose.' });
    } else {
      out.push({ tone: 'info', title: `« ${g.name} » : ${Math.round(g.pct * 100)} %`, text: `${fmt0(g.saved)} sur ${fmt0(g.target)}. Il faut ~${fmt0(g.perMonth)} par mois pour y arriver.` });
    }
  }
  const pf = portfolio(s);
  if (pf.total && pf.btcShare * 100 > s.settings.btcCap) {
    out.push({ tone: 'warn', title: 'Bitcoin surpondéré', text: `${Math.round(pf.btcShare * 100)} % de ton portefeuille pour un plafond de ${s.settings.btcCap} %. Pause sur les achats.` });
  }
  const em = emergency(s);
  if (!em.ok) out.push({ tone: 'info', title: 'Matelas à compléter', text: `${fmt0(em.have)} sur ${fmt0(em.target)} d'épargne de sécurité.` });
  for (const p of s.pockets.filter((x) => x.kind === 'spend' && x.target > 0)) {
    const tgt = p.id === 'abos' ? subsTotal(s) : p.target;
    if (p.role === 'need' && p.balance < tgt * 0.5) {
      out.push({ tone: 'warn', title: `${p.name} à recharger`, text: `${fmt(p.balance)} pour ${fmt0(tgt)} à prévoir ce mois.` });
    }
  }
  const mi = monthlyIncome(s, now);
  if (mi && subsTotal(s) / mi > 0.25) {
    out.push({ tone: 'warn', title: 'Abonnements lourds', text: `${Math.round((subsTotal(s) / mi) * 100)} % de tes revenus moyens partent en abonnements.` });
  }
  if (!s.tx.some((t) => t.type === 'income')) {
    out.push({ tone: 'info', title: 'Premier revenu', text: 'Dis-moi ce que tu as reçu et je te propose la répartition.' });
  }
  return out;
}

// ───────────────────────── Simulateur de loyer ─────────────────────────
export function rentImpact(s, rent, now = new Date()) {
  const mi = monthlyIncome(s, now);
  if (mi == null) return { ok: false };
  const fixed = subsTotal(s) + (pocketById(s, 'nourriture')?.target ?? 0);
  const left = round2(mi - rent - fixed);
  const goals = goalStatuses(s, now).filter((g) => g.status !== 'done');
  const need = goals.reduce((a, g) => a + g.perMonth, 0);
  return { ok: true, income: mi, fixed, rent, left, need: round2(need), rentShare: rent / mi, tight: left < need };
}

// ───────────────────────── RevPoints ─────────────────────────
export function revStatus(s, now = new Date()) {
  const r = s.rev;
  const rate = M_RATES[r.plan] ?? 10;
  const remaining = Math.max(0, r.target - r.points);
  // dépense mensuelle carte : saisie, sinon moyenne réelle des 3 derniers mois, sinon somme des budgets
  const from = new Date(now); from.setDate(from.getDate() - 92);
  const real = s.tx.filter((t) => t.type === 'expense' && new Date(t.ts) >= from);
  const spendMonthly = r.monthlySpend ?? (real.length >= 5 ? round2((sum(real, (t) => t.amount) / Math.max(1, Math.min(3, daysBetween(Math.min(...real.map((t) => +new Date(t.ts))), now) / DAY)))) : round2(s.pockets.filter((p) => p.kind === 'spend').reduce((a, p) => a + (p.id === 'abos' ? subsTotal(s) : p.target), 0)));
  const cardMonth = spendMonthly / rate;
  const pocketMonth = r.pocket.active ? r.pocket.perDay * DAY : 0;
  const modeled = (cardMonth + pocketMonth) / DAY;
  // rythme observé : journal des soldes sur 45 jours
  const win = r.log.filter((x) => daysBetween(x.d, now) <= 45).sort((a, b) => a.d.localeCompare(b.d));
  let observed = null;
  if (win.length >= 2) {
    const d = daysBetween(win[0].d, win.at(-1).d);
    if (d >= 3) observed = Math.max(0, (win.at(-1).pts - win[0].pts) / d);
  }
  const hist = r.hist ? r.hist.earned / Math.max(30, daysBetween(r.hist.since + 'T12:00:00', now)) : null;
  const pace = observed ?? hist ?? modeled;
  const etaDays = remaining === 0 ? 0 : pace > 0 ? Math.ceil(remaining / pace) : null;
  const need = r.deadline ? (remaining / Math.max(1, daysBetween(now, r.deadline + 'T12:00:00'))) : null;
  return {
    hist, rate, remaining, pct: clamp(r.points / r.target, 0, 1), spendMonthly, cardMonth, pocketMonth, modeled, observed, pace, etaDays,
    spendNeeded: round2(remaining * rate), needPerDay: need, valueNow: round2(r.points * REV_VALUE), valueGoal: round2(r.target * REV_VALUE),
  };
}

// « Vaut-il le coup ? » : un bonus de points ne justifie jamais une dépense qu'on n'aurait pas faite.
export function revWorth({ spend, points, planned }) {
  const value = round2(points * REV_VALUE);
  if (planned) return { ok: true, value, extraCost: 0, text: `Tu l'aurais acheté de toute façon : c'est ${points.toLocaleString('fr-FR')} points gratuits (≈ ${fmt(value)} de valeur indicative).` };
  return { ok: false, value, extraCost: round2(spend), text: `Tu dépenserais ${fmt(spend)} qui n'étaient pas prévus pour ≈ ${fmt(value)} de valeur en points : tu perds ≈ ${fmt(spend - value)}. Les points ne valent pas cette dépense.` };
}

export { netWorth, spendable, invested };
