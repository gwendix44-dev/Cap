// Section RevPoints : suivi 60 000 → 100 000, leviers vérifiés, garde-fou « ça vaut le coup ? », astuces du moment.
import * as M from './model.js';
import * as E from './engine.js';
import { store, save } from './store.js';
import { geminiAsk } from './net.js';
import { esc, ic, actions, bus, toast, openSheet, closeSheet, $, frDate } from './ui.js';
import { spark } from './charts.js';

const { fmt, fmt0 } = M;
const S = () => store.state;
const R = () => store.state.rev;
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; };
const pts = (n) => Math.round(n).toLocaleString('fr-FR');
const today = () => M.isoDay(new Date());
const weekKey = (d = new Date()) => { const x = new Date(d); x.setHours(12, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return M.isoDay(x); };
const md = (t) => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/^\s*[*-] +/gm, '• ');
const srcHtml = (src = []) => src.length ? `<div class="srcs">${src.map((x) => `<a href="${esc(x.uri)}" target="_blank" rel="noopener noreferrer">${esc(x.title)}</a>`).join('')}</div>` : '';

// Leviers vérifiés (aide Revolut). `free` = ne coûte rien SI l'achat était déjà prévu. Les barèmes exacts se lisent dans l'app.
export const LEVERS = [
  { id: 'card', t: 'Tout ce que tu paies déjà, par la carte Revolut', d: 'Abonnements, courses, transport : chaque euro payé avec la carte ou Revolut Pay rapporte des points. Ne passe rien en espèces ou par une autre banque quand tu as le choix.', w: 'Faible en volume (Standard/Plus : 1 point pour 10 €), mais c’est gratuit et automatique.' },
  { id: 'offers', t: 'Activer une offre ou un booster avant de payer', d: 'Dans l’app, onglet RevPoints › Offres : certains marchands multiplient les points pendant une durée limitée. Active-la avant l’achat, sinon les points sont perdus.', w: 'Seulement pour un achat déjà prévu. Jamais l’inverse.' },
  { id: 'challenges', t: 'Défis et promotions limitées', d: 'Revolut lance des défis (ex. utiliser une fonction pour la première fois) avec un bonus de points. Regarde ceux qui te demandent une action gratuite ou un achat déjà prévu.', w: 'Ignore tout défi qui impose un montant à dépenser.' },
  { id: 'pocket', t: 'Points Pocket', d: 'Un solde minimum gardé sur un compartiment dédié rapporte des points chaque jour. Le seuil et le barème s’affichent dans l’app et peuvent changer : regarde si tu y as accès.', w: 'Utilise de l’argent déjà épargné, pas de l’argent que tu devrais dépenser. Immobilise-le seulement si tu n’en as pas besoin.' },
  { id: 'travel', t: 'Séjours et Expériences', d: 'Les réservations via l’app peuvent donner beaucoup plus de points (boosters annoncés jusqu’à plusieurs dizaines de points par euro selon l’offre). Compare le prix avec ton habitude : un booster ne justifie pas un tarif plus cher.', w: 'Pour ton voyage de mars uniquement, et seulement si le prix final est égal ou meilleur.' },
  { id: 'referral', t: 'Parrainage', d: 'Si un proche veut vraiment ouvrir un compte Revolut, le parrainage peut donner un bonus (variable, vérifie l’offre en cours).', w: 'Vrais proches uniquement. Les faux comptes ou échanges de parrainage peuvent annuler tes points.' },
];
const WEEKLY = [
  ['offers', 'J’ai regardé les offres et boosters avant mes achats de la semaine'],
  ['card', 'Tout ce que j’ai payé était réglé avec la carte ou Revolut Pay'],
  ['challenges', 'J’ai regardé les défis en cours (sans acheter pour eux)'],
  ['sync', 'J’ai mis à jour mon solde de points dans Cap'],
];
const NEVER = [
  'Passer à Premium (10,99 €/mois), Metal (18,99 €/mois) ou Ultra juste pour les points : les abonnements coûtent plus que ce qu’ils rapportent.',
  'Acheter des points ou dépenser « pour atteindre un palier » : à environ 0,7 centime le point, 40 000 points valent ~280 €.',
  'Faux parrainages, allers-retours de paiements : Revolut peut annuler les points concernés.',
];

function ensureWeek() {
  const k = weekKey();
  if (R().week.key !== k) { R().week = { key: k, checks: {} }; save(); }
}

// ───────────────────────── vue ─────────────────────────
function feasibility(st) {
  const r = R();
  if (st.remaining === 0) return { tone: 'good', t: 'Objectif atteint', p: `Tu as ${pts(r.points)} points. Tu peux relever la cible dans « Modifier ».` };
  const cardOnly = `Avec la carte seule, ${pts(st.remaining)} points = ${fmt0(st.spendNeeded)} de dépenses : impossible sans dépenser inutilement. Les seuls leviers réalistes sont les offres, défis, Points Pocket et réservations déjà prévues.`;
  if (st.observed == null) return { tone: 'warn', t: 'Mesurons ton vrai rythme', p: `${cardOnly} Mets à jour ton solde dans Cap chaque semaine : après quelques jours je calcule ton rythme réel et la date d’arrivée.` };
  const eta = st.etaDays;
  const when = eta == null ? 'jamais à ce rythme' : eta > 3650 ? 'dans plus de 10 ans' : `vers ${frDate(new Date(Date.now() + eta * 864e5), { month: 'long', year: 'numeric' })}`;
  const tone = eta != null && eta <= 365 ? 'good' : 'warn';
  return { tone, t: `Rythme réel : ${pts(st.observed * 30)} points/mois`, p: `À ce rythme tu arrives ${when}. ${eta == null || eta > 365 ? 'Pour aller plus vite sans dépenser plus, il faut des boosters sur des achats prévus ou le Points Pocket, pas un volume de dépenses.' : 'Continue sur cette lancée.'}` };
}

export function revView() {
  ensureWeek();
  const s = S(), r = R();
  const st = E.revStatus(s);
  const f = feasibility(st);
  const hist = r.log.slice().sort((a, b) => a.d.localeCompare(b.d));
  const week = r.week.checks;
  const live = (() => { try { return JSON.parse(localStorage.getItem('cap.revlive')); } catch { return null; } })();
  const pct = Math.round(st.pct * 100);
  return `<h1 class="h1" style="margin-bottom:6px">RevPoints</h1><p class="dim" style="margin-bottom:22px">Monter sans dépenser pour rien.</p>
  <div class="group" style="padding:20px">
    <div class="muted small">Mes points</div>
    <div class="big" style="font-size:44px">${pts(r.points)}<span class="muted" style="font-size:18px;font-weight:600"> / ${pts(r.target)}</span></div>
    <div class="meter" style="height:8px;margin-top:14px"><i style="width:${pct}%;background:var(--ivory)"></i></div>
    <div class="foot" style="display:flex;justify-content:space-between;margin-top:10px"><span class="num muted small">${pct} %</span><span class="num muted small">il reste ${pts(st.remaining)}</span></div>
    <div style="display:flex;gap:10px;margin-top:16px"><button class="btn primary" data-act="rev-sync" style="flex:1.4;white-space:nowrap">Mettre à jour</button><button class="btn ghost" data-act="rev-edit" style="flex:1">Modifier</button></div>
  </div>
  <div class="advice ${f.tone === 'good' ? 'good' : 'warn'}" style="margin-top:14px"><h3>${esc(f.t)}</h3><p>${esc(f.p)}</p></div>
  <div class="group" style="margin-top:14px">
    <div class="row"><div class="grow"><div class="ttl">Valeur estimée</div><div class="sub">≈ 0,7 centime par point, indicatif et non garanti</div></div><div class="amt">${fmt0(st.valueNow)}<small>→ ${fmt0(st.valueGoal)}</small></div></div>
    <div class="row"><div class="grow"><div class="ttl">Rythme ${st.observed != null ? 'mesuré' : 'estimé par ta carte'}</div><div class="sub">${st.observed != null ? 'd’après tes mises à jour' : `${fmt0(st.spendMonthly)}/mois ÷ ${st.rate} € par point`}</div></div><div class="amt">${pts((st.observed != null ? st.observed * 30 : st.modeled * 30))}<small>pts/mois</small></div></div>
    ${hist.length > 1 ? `<div class="row"><div class="grow"><div class="ttl">Évolution</div><div class="sub">${hist.length} relevés</div></div><div>${spark(hist.map((x) => x.pts), { w: 90, h: 30 })}</div></div>` : ''}
    ${r.deadline ? `<div class="row"><div class="grow"><div class="ttl">Pour le ${esc(frDate(r.deadline + 'T12:00:00', { day: 'numeric', month: 'long', year: 'numeric' }))}</div><div class="sub">rythme nécessaire</div></div><div class="amt">${pts((st.needPerDay ?? 0) * 30)}<small>pts/mois</small></div></div>` : ''}
  </div>
  <section class="section"><div class="sec-h"><h2 class="h2">Cette semaine</h2></div>
    <div class="group">${WEEKLY.map(([k, l]) => `<button class="row" data-act="rev-check" data-k="${k}"><span class="chk ${week[k] ? 'on' : ''}" aria-hidden="true">${week[k] ? '✓' : ''}</span><div class="grow"><div class="ttl" style="font-weight:500">${esc(l)}</div></div></button>`).join('')}</div></section>
  <section class="section"><div class="sec-h"><h2 class="h2">Astuces du moment</h2></div>
    <div class="group" style="padding:18px"><p class="dim small" style="margin:0 0 12px">Promotions, boosters et défis en cours en France, cherchés sur le web. Vérifie toujours dans l’app avant d’agir : les offres changent vite.</p>
      <div id="revlive" style="white-space:pre-wrap;color:var(--tx2);font-size:15px">${live ? `${md(live.text)}${srcHtml(live.sources)}\n<span class="muted xs">Recherché le ${new Date(live.ts).toLocaleString('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })}</span>` : ''}</div>
      <button class="btn ghost sm" data-act="rev-live" style="margin-top:12px">${live ? 'Actualiser' : 'Chercher les astuces du moment'}</button></div></section>
  <section class="section"><div class="sec-h"><h2 class="h2">Les leviers</h2></div>
    ${LEVERS.map((l) => `<div class="advice"><h3>${esc(l.t)}</h3><p>${esc(l.d)}</p><p class="muted small" style="margin-top:8px"><b>Garde-fou :</b> ${esc(l.w)}</p></div>`).join('')}</section>
  <section class="section"><div class="sec-h"><h2 class="h2">Ça vaut le coup ?</h2></div>
    <button class="row group" data-act="rev-worth" style="width:100%"><div class="grow"><div class="ttl">Tester un bonus de points</div><div class="sub">Je te dis si tu y gagnes ou si tu perds de l’argent</div></div><span class="muted">${ic('chev')}</span></button></section>
  <section class="section"><div class="sec-h"><h2 class="h2">À éviter</h2></div>${NEVER.map((x) => `<div class="advice warn"><p>${esc(x)}</p></div>`).join('')}</section>
  <p class="muted xs" style="margin-top:26px">Cap n’est pas lié à Revolut : ton solde de points est saisi à la main. Barèmes et offres : à vérifier dans l’app. Les points expirent après 3 ans, ne sont pas remboursables et disparaissent si le compte est clôturé.</p>`;
}

// ───────────────────────── feuilles ─────────────────────────
actions['rev-check'] = (el) => { const c = R().week.checks; c[el.dataset.k] = !c[el.dataset.k]; save(); bus.refresh(); };

actions['rev-sync'] = () => {
  openSheet(`<h2 class="h2">Mes points aujourd’hui</h2><p class="lead">Recopie le total affiché dans l’app Revolut. Plus tu le fais régulièrement, plus mon rythme est juste.</p>
    <input class="input amount" id="rp-n" inputmode="numeric" placeholder="${pts(R().points)}" aria-label="Points RevPoints">
    <button class="btn primary block" id="rp-ok" style="margin-top:14px">Enregistrer</button>`, (sh) => {
    $('#rp-ok', sh).onclick = () => {
      const n = num($('#rp-n', sh).value);
      if (!(n >= 0)) return toast('Entre un nombre de points');
      const prev = R().points;
      R().points = Math.round(n);
      R().log = R().log.filter((x) => x.d !== today()).concat({ d: today(), pts: R().points });
      R().week.checks.sync = true;
      save(); closeSheet(); bus.refresh();
      toast(n > prev ? `+${pts(n - prev)} points` : 'Solde mis à jour');
    };
  });
};

actions['rev-edit'] = () => {
  const r = R();
  const plans = Object.entries(M.REV_PLANS);
  const st = { plan: r.plan };
  openSheet(`<h2 class="h2">Mon objectif</h2>
    <label class="field"><span>Cible (points)</span><input class="input" id="re-t" inputmode="numeric" value="${r.target}"></label>
    <label class="field"><span>Date visée (facultatif)</span><input class="input" id="re-d" type="date" value="${r.deadline ?? ''}"></label>
    <div class="muted small" style="margin:4px 0 8px">Mon abonnement Revolut</div>
    <div class="chips" id="re-plans" style="margin-bottom:16px">${plans.map(([k, l]) => `<button type="button" class="chip ${st.plan === k ? 'on' : ''}" data-act="re-plan" data-k="${k}">${l}</button>`).join('')}</div>
    <label class="field"><span>Dépenses carte par mois (vide = estimation de Cap)</span><input class="input" id="re-s" inputmode="decimal" value="${r.monthlySpend ?? ''}" placeholder="auto"></label>
    <label class="field"><span>Points Pocket : points gagnés par jour (0 si non utilisé)</span><input class="input" id="re-p" inputmode="decimal" value="${r.pocket.active ? r.pocket.perDay : ''}" placeholder="0"></label>
    <button class="btn primary block" id="re-ok">Enregistrer</button>`, (sh) => {
    actions['re-plan'] = (el) => { st.plan = el.dataset.k; sh.querySelectorAll('#re-plans .chip').forEach((c) => c.classList.toggle('on', c.dataset.k === st.plan)); };
    $('#re-ok', sh).onclick = () => {
      const t = num($('#re-t', sh).value);
      if (!(t > 0)) return toast('Cible invalide');
      r.target = Math.round(t); r.plan = st.plan; r.deadline = $('#re-d', sh).value || null;
      const sp = num($('#re-s', sh).value); r.monthlySpend = sp >= 0 ? sp : null;
      const pp = num($('#re-p', sh).value); r.pocket = pp > 0 ? { active: true, min: 0, perDay: pp } : { active: false, min: 0, perDay: 0 };
      save(); closeSheet(); bus.refresh();
    };
  });
};

actions['rev-worth'] = () => {
  const st = { planned: true };
  openSheet(`<h2 class="h2">Ça vaut le coup ?</h2><p class="lead">Une offre te promet des points pour un achat. Je compare à ce que ça te coûte vraiment.</p>
    <label class="field"><span>Prix de l’achat (€)</span><input class="input" id="rw-s" inputmode="decimal" placeholder="0"></label>
    <label class="field"><span>Points promis</span><input class="input" id="rw-p" inputmode="numeric" placeholder="0"></label>
    <div class="seg" id="rw-seg"><button type="button" class="on" data-act="rw-pl" data-v="1">Déjà prévu</button><button type="button" data-act="rw-pl" data-v="0">Pas prévu</button></div>
    <div id="rw-out" style="min-height:70px"></div>`, (sh) => {
    const run = () => {
      const spend = num($('#rw-s', sh).value), points = num($('#rw-p', sh).value);
      const out = $('#rw-out', sh);
      if (!(spend >= 0) || !(points > 0)) { out.innerHTML = ''; return; }
      const v = E.revWorth({ spend, points, planned: st.planned });
      out.innerHTML = `<div class="advice ${v.ok ? 'good' : 'bad'}"><h3>${v.ok ? 'Oui, profites-en' : 'Non, laisse tomber'}</h3><p>${esc(v.text)}</p></div>`;
    };
    sh.addEventListener('input', run);
    actions['rw-pl'] = (el) => { st.planned = el.dataset.v === '1'; sh.querySelectorAll('#rw-seg button').forEach((b) => b.classList.toggle('on', b === el)); run(); };
  });
};

// ───────────────────────── astuces en direct ─────────────────────────
export const REV_SYSTEM = 'Tu es un conseiller RevPoints honnête pour un jeune Français de 22 ans qui veut gagner des points SANS dépenses supplémentaires ni achats inutiles. Français, tutoiement, mots simples. Utilise la recherche web pour trouver les promotions, boosters, défis, offres partenaires et changements de règles RevPoints actuels en France, avec leurs dates de fin. Indique toujours la date de l\'information. Ne recommande jamais d\'acheter quelque chose pour obtenir des points, ni de changer d\'abonnement payant, ni de tactiques abusives (faux parrainages…). Si tu n\'es pas sûr d\'une offre, dis-le. N\'invente aucun chiffre.';
actions['rev-live'] = async () => {
  const llm = S().settings.llm;
  const el = $('#revlive');
  if (!llm.key) { el.textContent = 'Pour chercher les astuces du moment, ajoute une clé Gemini gratuite dans Gérer › IA Gemini.'; return; }
  el.textContent = 'Je cherche les offres du moment…';
  try {
    const st = E.revStatus(S());
    const res = await geminiAsk({
      key: llm.key, model: llm.model, system: REV_SYSTEM,
      prompt: `Nous sommes le ${today()}. Quelles sont les meilleures façons actuelles, en France, de gagner des RevPoints sans dépense supplémentaire ? Abonnement : ${M.REV_PLANS[R().plan]} (1 point pour ${st.rate} € dépensés). J'ai ${R().points} points et je vise ${R().target}. Je paie déjà ~130 €/mois d'abonnements, ~50 €/mois de nourriture et je prévois un voyage en mars. Donne 5 puces maximum : offre ou défi en cours (avec date de fin), points estimés, et si c'est gratuit pour quelqu'un qui aurait fait cet achat de toute façon. Termine par une phrase honnête sur le réalisme de l'objectif.`,
    });
    localStorage.setItem('cap.revlive', JSON.stringify({ text: res.text, sources: res.sources, ts: Date.now() }));
    bus.refresh();
  } catch (e) { el.textContent = `Impossible de chercher : ${e.message}`; }
};
