import * as M from './model.js';
import * as E from './engine.js';
import { store, save, exportJSON, importJSON, resetAll } from './store.js';
import { revolutRows, ruleKey } from './csv.js';
import { esc, ic, bigMoney, actions, bus, toast, openSheet, closeSheet, $, $$, frDate } from './ui.js';

const { fmt, fmt0, pocketById } = M;
const S = () => store.state;
const commit = () => { save(); bus.refresh(); };
const num = (v) => { const n = parseFloat(String(v ?? '').replace(/\s/g, '').replace(',', '.')); return isFinite(n) ? n : NaN; };
const dot = (c) => `<span class="dot" style="background:${c}"></span>`;
const pocketChips = (list, sel) => `<div class="chips" style="margin-bottom:18px">${list.map((p) => `<button type="button" class="chip ${p.id === sel ? 'on' : ''}" data-act="sh-pocket" data-id="${p.id}">${dot(p.color)}${esc(p.name)}</button>`).join('')}</div>`;

actions.close = closeSheet;

// ─────────────── Dépense ───────────────
function miniVerdict(v) {
  const cls = v.level === 'ok' ? 'pos' : v.level === 'careful' ? '' : 'neg';
  const mark = v.level === 'ok' ? '✓' : v.level === 'careful' ? '!' : '✕';
  return `<p class="small ${cls}" style="color:${v.level === 'careful' ? 'var(--warn)' : ''}"><b>${mark} ${esc(v.headline)}</b> ${esc(v.points[0] ?? '')}</p>`;
}
export function sheetExpense(pre = {}) {
  const s = S();
  const spendP = s.pockets.filter((p) => p.kind === 'spend');
  const st = { pocket: pre.pocket ?? 'plaisirs', manual: !!pre.pocket };
  openSheet(`<h2 class="h2">Dépense</h2><p class="lead">Je te dis tout de suite si ça passe.</p>
    <input class="input amount" id="x-amt" inputmode="decimal" placeholder="0 €" value="${pre.amount ?? ''}" aria-label="Montant">
    <div id="x-v" style="min-height:44px;text-align:center;margin-bottom:10px"></div>
    <label class="field"><span>C'est pour quoi ?</span><input class="input" id="x-label" placeholder="Restaurant, courses, billet…" value="${esc(pre.label ?? '')}"></label>
    <div id="x-chips">${pocketChips(spendP, st.pocket)}</div>
    <button class="btn primary block" id="x-save">Enregistrer</button>`, (sh) => {
    const run = () => {
      const a = num($('#x-amt', sh).value);
      const label = $('#x-label', sh).value;
      if (!st.manual && label.trim()) st.pocket = M.guessPocket(label);
      $('#x-chips', sh).innerHTML = pocketChips(spendP, st.pocket);
      $('#x-v', sh).innerHTML = a > 0 ? miniVerdict(E.verdict(S(), { amount: a, pocket: st.pocket, label })) : '';
    };
    sh.addEventListener('input', run);
    actions['sh-pocket'] = (el) => { st.pocket = el.dataset.id; st.manual = true; run(); };
    $('#x-save', sh).onclick = () => {
      const a = num($('#x-amt', sh).value);
      if (!(a > 0)) return toast('Entre un montant');
      M.spend(S(), { pocket: st.pocket, amount: a, label: $('#x-label', sh).value.trim() });
      closeSheet(); commit(); toast(`${fmt(a)} enregistrés dans ${pocketById(S(), st.pocket).name}`);
    };
    run();
    setTimeout(() => $('#x-amt', sh).focus(), 350);
  });
}
actions['open-expense'] = () => sheetExpense();
actions.fab = () => sheetExpense();
actions['confirm-expense'] = (el) => {
  const a = +el.dataset.amount;
  M.spend(S(), { pocket: el.dataset.pocket, amount: a, label: el.dataset.label ?? '' });
  commit(); toast(`${fmt(a)} enregistrés`);
};
actions['use-alt'] = (el) => sheetExpense({ amount: el.dataset.amount, pocket: el.dataset.pocket, label: el.dataset.label });

// ─────────────── Revenu : le « billet » de répartition ───────────────
export function sheetIncome(pre = {}) {
  const st = { amount: pre.amount ?? '', label: pre.label ?? '', mode: 'mix' };
  openSheet('', (sh) => {
    const step1 = () => {
      sh.innerHTML = `<div class="grab"></div><h2 class="h2">Nouveau revenu</h2><p class="lead">Dis-moi ce que tu as reçu, je te propose la répartition.</p>
      <input class="input amount" id="i-amt" inputmode="decimal" placeholder="0 €" value="${st.amount}" aria-label="Montant reçu">
      <label class="field"><span>D'où vient-il ?</span><input class="input" id="i-label" placeholder="Mission, paie, cadeau…" value="${esc(st.label)}"></label>
      <div class="seg"><button data-act="i-mode" data-k="mix" class="${st.mode === 'mix' ? 'on' : ''}">Conseillé</button><button data-act="i-mode" data-k="mine" class="${st.mode === 'mine' ? 'on' : ''}">Mes % purs</button></div>
      <p class="help" style="margin:-8px 0 18px">${st.mode === 'mix' ? 'Tes % ajustés par le conseiller selon tes projets, ton matelas et ton portefeuille.' : 'Uniquement les pourcentages que tu as fixés, après les besoins fixes.'}</p>
      <button class="btn primary block" id="i-go">Voir la répartition</button>`;
      $('#i-go', sh).onclick = () => {
        const a = num($('#i-amt', sh).value);
        if (!(a > 0)) return toast('Entre le montant reçu');
        st.amount = a; st.label = $('#i-label', sh).value.trim(); step2();
      };
      setTimeout(() => $('#i-amt', sh)?.focus(), 350);
    };
    actions['i-mode'] = (el) => { st.amount = $('#i-amt', sh).value; st.label = $('#i-label', sh).value; st.mode = el.dataset.k; step1(); };
    const step2 = () => {
      const s = S();
      const plan = E.allocate(s, st.amount, new Date(), { influence: st.mode === 'mine' ? 0 : s.settings.influence });
      sh.innerHTML = `<div class="grab"></div><h2 class="h2">Répartition</h2><p class="lead">Tu peux ajuster chaque montant avant d'appliquer.</p>
      ${plan.notes.map((n) => `<div class="note">${esc(n)}</div>`).join('')}
      <div class="ticket"><div class="th"><div><div class="muted small">${esc(st.label || 'Revenu')}</div><div class="big">${bigMoney(st.amount)}</div></div><span class="pill">${st.mode === 'mine' ? 'Mes %' : 'Conseillé'}</span></div><div class="perf"></div>
      ${plan.lines.map((l) => { const p = pocketById(s, l.id); return `<div class="tline">${dot(p.color)}<div><div class="nm">${esc(p.name)}</div><div class="why">${esc(l.reason)}</div></div><input inputmode="decimal" data-id="${l.id}" value="${l.amount}" aria-label="Montant pour ${esc(p.name)}"></div>`; }).join('')}
      <div class="tfoot"><span>Reste à répartir</span><b class="num" id="i-left">0,00 €</b></div></div>
      <div class="actions"><button class="btn ghost" id="i-back">Retour</button><button class="btn primary" id="i-apply">Appliquer</button></div>`;
      const upd = () => {
        const sum = $$('.tline input', sh).reduce((a, i) => a + (num(i.value) || 0), 0);
        const left = M.round2(st.amount - sum);
        const el = $('#i-left', sh);
        el.textContent = fmt(left); el.style.color = Math.abs(left) < 0.005 ? 'var(--good)' : 'var(--warn)';
        $('#i-apply', sh).disabled = Math.abs(left) >= 0.005;
      };
      sh.addEventListener('input', upd); upd();
      $('#i-back', sh).onclick = step1;
      $('#i-apply', sh).onclick = () => {
        const alloc = {};
        $$('.tline input', sh).forEach((i) => { const v = num(i.value); if (v > 0) alloc[i.dataset.id] = M.round2(v); });
        M.applyIncome(S(), { amount: st.amount, label: st.label || 'Revenu', alloc });
        closeSheet(); commit(); toast('Revenu réparti');
      };
    };
    if (Number(pre.amount) > 0) { st.amount = Number(pre.amount); step2(); } else step1();
  });
}
actions['open-income'] = (el) => sheetIncome({ amount: el?.dataset?.amount });

// ─────────────── Poches ───────────────
actions.pocket = (el) => {
  const s = S();
  const id = el.dataset.id;
  const p = id ? pocketById(s, id) : null;
  const isNew = !p;
  openSheet(`<h2 class="h2">${isNew ? 'Nouvelle poche' : esc(p.name)}</h2><p class="lead">${isNew ? 'Ajoute une poche pour un nouveau placement ou une nouvelle enveloppe.' : 'Modifie ses réglages ou recale son solde.'}</p>
    <label class="field"><span>Nom</span><input class="input" id="p-name" value="${esc(p?.name ?? '')}" placeholder="ETF S&P 500"></label>
    ${isNew ? `<label class="field"><span>Type</span><select class="input" id="p-kind"><option value="invest">Investissement</option><option value="spend">Dépenses</option><option value="save">Épargne</option></select></label>` : ''}
    <label class="field"><span>Solde actuel (€)</span><input class="input" id="p-bal" inputmode="decimal" value="${p ? p.balance : '0'}"></label>
    ${p?.kind === 'spend' || isNew ? `<label class="field"><span>Budget mensuel prévu (€)</span><input class="input" id="p-tgt" inputmode="decimal" value="${p?.target || ''}" placeholder="0"></label>` : ''}
    ${p?.role !== 'need' ? `<label class="field"><span>Ta part de la répartition libre (%)</span><input class="input" id="p-pct" inputmode="decimal" value="${p?.pct ?? 0}"><span class="help" id="p-sum"></span></label>` : '<p class="help" style="margin-bottom:16px">Les besoins fixes sont couverts en premier, avant toute répartition.</p>'}
    <button class="btn primary block" id="p-save">Enregistrer</button>
    ${!isNew && !['abos'].includes(p.id) ? `<button class="btn danger block" id="p-del" style="margin-top:10px">Supprimer cette poche</button>` : ''}`, (sh) => {
    const sumInfo = () => {
      const el = $('#p-sum', sh); if (!el) return;
      const mine = num($('#p-pct', sh).value) || 0;
      const others = s.pockets.filter((q) => q.id !== p?.id && q.role !== 'need').reduce((a, q) => a + q.pct, 0);
      el.textContent = `Total de tes parts : ${Math.round(mine + others)} % (je les remets à l'échelle si ce n'est pas 100).`;
    };
    sh.addEventListener('input', sumInfo); sumInfo();
    $('#p-save', sh).onclick = () => {
      const name = $('#p-name', sh).value.trim();
      if (!name) return toast('Donne un nom à la poche');
      const bal = num($('#p-bal', sh).value) || 0;
      const tgt = $('#p-tgt', sh) ? num($('#p-tgt', sh).value) || 0 : p?.target ?? 0;
      const pct = $('#p-pct', sh) ? num($('#p-pct', sh).value) || 0 : p?.pct ?? 0;
      if (isNew) {
        const kind = $('#p-kind', sh).value;
        const isEtf = /etf|s&p|sp500|pea/i.test(name);
        const nid = isEtf ? 'etf' : name.toLowerCase().replace(/[^a-z0-9]+/g, '-') + '-' + M.uid().slice(0, 3);
        if (pocketById(s, nid)) return toast('Une poche ETF existe déjà');
        s.pockets.push({ id: nid, name, kind, color: isEtf ? M.COLORS.etf : M.COLORS.extra, balance: bal, base: kind === 'invest' ? bal : undefined, target: tgt, pct, role: kind === 'spend' ? 'free' : kind === 'save' ? 'save' : 'invest' });
      } else {
        p.name = name; p.target = tgt; p.pct = pct;
        if (Math.abs(bal - p.balance) > 0.004) M.setBalance(s, p.id, bal);
      }
      closeSheet(); commit(); toast('Poche enregistrée');
    };
    $('#p-del', sh)?.addEventListener('click', () => {
      if (!confirm(`Supprimer « ${p.name} » ? Son solde (${fmt(p.balance)}) sera retiré du patrimoine suivi.`)) return;
      s.pockets = s.pockets.filter((q) => q.id !== p.id);
      s.goals = s.goals.filter((g) => g.pocket !== p.id);
      closeSheet(); commit();
    });
  });
};

actions.value = (el) => {
  const s = S(); const p = pocketById(s, el.dataset.id);
  openSheet(`<h2 class="h2">${esc(p.name)}</h2><p class="lead">Mets à jour la valeur affichée dans Revolut pour que le suivi reste juste.</p>
    <input class="input amount" id="v-amt" inputmode="decimal" value="${p.balance}" aria-label="Valeur actuelle">
    <p class="help" style="text-align:center;margin-bottom:20px">Tu as versé ${fmt(p.base ?? p.balance)} au total.</p>
    <button class="btn primary block" id="v-save">Mettre à jour</button>`, (sh) => {
    $('#v-save', sh).onclick = () => {
      const v = num($('#v-amt', sh).value);
      if (!isFinite(v) || v < 0) return toast('Valeur invalide');
      M.setBalance(s, p.id, v); closeSheet(); commit(); toast('Valeur mise à jour');
    };
  });
};

// ─────────────── Projets ───────────────
actions.goal = (el) => {
  const s = S();
  const g = el.dataset.id ? s.goals.find((x) => x.id === el.dataset.id) : null;
  const spendP = s.pockets.filter((p) => p.kind === 'spend' && p.role !== 'need');
  openSheet(`<h2 class="h2">${g ? 'Modifier le projet' : 'Nouveau projet'}</h2><p class="lead">Je l'intègre à chaque répartition et à chaque verdict.</p>
    <label class="field"><span>Nom</span><input class="input" id="g-name" value="${esc(g?.name ?? '')}" placeholder="Voyage de mars"></label>
    <label class="field"><span>Budget visé (€)</span><input class="input" id="g-tgt" inputmode="decimal" value="${g?.target ?? ''}" placeholder="1500"></label>
    <label class="field"><span>Date</span><input class="input" id="g-date" type="date" value="${g?.date ?? ''}"></label>
    <label class="field"><span>Poche qui l'alimente</span><select class="input" id="g-pocket">${spendP.map((p) => `<option value="${p.id}" ${g?.pocket === p.id ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></label>
    <button class="btn primary block" id="g-save">Enregistrer</button>${g ? '<button class="btn danger block" id="g-del" style="margin-top:10px">Supprimer</button>' : ''}`, (sh) => {
    $('#g-save', sh).onclick = () => {
      const name = $('#g-name', sh).value.trim(), target = num($('#g-tgt', sh).value), date = $('#g-date', sh).value;
      if (!name || !(target > 0) || !date) return toast('Nom, montant et date sont nécessaires');
      const pocket = $('#g-pocket', sh).value;
      if (g) Object.assign(g, { name, target, date, pocket });
      else s.goals.push({ id: M.uid(), name, target, date, pocket, created: M.isoDay(new Date()) });
      closeSheet(); commit(); toast('Projet enregistré');
    };
    $('#g-del', sh)?.addEventListener('click', () => { s.goals = s.goals.filter((x) => x.id !== g.id); closeSheet(); commit(); });
  });
};

// ─────────────── Abonnements ───────────────
actions.subs = () => {
  const s = S();
  const row = (x = {}) => `<div class="subrow" style="display:flex;gap:8px;margin-bottom:8px"><input class="input" style="flex:1" placeholder="Netflix" value="${esc(x.name ?? '')}"><input class="input" style="width:110px" inputmode="decimal" placeholder="€" value="${x.amount ?? ''}"></div>`;
  openSheet(`<h2 class="h2">Abonnements</h2><p class="lead">Détaille-les pour voir ce qui pèse, ou garde un simple total.</p>
    <div id="s-rows">${s.subs.map(row).join('')}</div><button class="btn ghost sm" id="s-add" style="margin-bottom:20px">Ajouter une ligne</button>
    <label class="field"><span>Total mensuel si tu ne détailles pas (€)</span><input class="input" id="s-total" inputmode="decimal" value="${pocketById(s, 'abos').target}"></label>
    <button class="btn primary block" id="s-save">Enregistrer</button>`, (sh) => {
    $('#s-add', sh).onclick = () => $('#s-rows', sh).insertAdjacentHTML('beforeend', row());
    $('#s-save', sh).onclick = () => {
      const items = $$('.subrow', sh).map((r) => { const [a, b] = $$('input', r); return { id: M.uid(), name: a.value.trim(), amount: num(b.value) }; }).filter((x) => x.name && x.amount > 0);
      s.subs = items;
      pocketById(s, 'abos').target = items.length ? M.round2(items.reduce((a, x) => a + x.amount, 0)) : num($('#s-total', sh).value) || 0;
      closeSheet(); commit(); toast('Abonnements enregistrés');
    };
  });
};

// ─────────────── Détail / suppression d'une opération ───────────────
actions.tx = (el) => {
  const s = S(); const t = s.tx.find((x) => x.id === el.dataset.id); if (!t) return;
  const p = t.pocket ? pocketById(s, t.pocket) : null;
  const alloc = t.alloc ? Object.entries(t.alloc).map(([id, v]) => `<div class="kv"><span>${esc(pocketById(s, id)?.name ?? id)}</span><b class="num">${fmt(v)}</b></div>`).join('') : '';
  openSheet(`<h2 class="h2">${esc(t.label || (t.type === 'income' ? 'Revenu' : p?.name ?? 'Opération'))}</h2><p class="lead">${esc(new Date(t.ts).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' }))}</p>
    <div class="kv"><span>Montant</span><b class="num">${fmt(t.amount)}</b></div>${p ? `<div class="kv"><span>Poche</span><b>${esc(p.name)}</b></div>` : ''}${alloc}
    <button class="btn danger block" id="t-del" style="margin-top:20px">Supprimer et annuler l'effet</button>`, (sh) => {
    $('#t-del', sh).onclick = () => {
      if (t.type === 'expense') pocketById(s, t.pocket).balance = M.round2(pocketById(s, t.pocket).balance + t.amount);
      else if (t.type === 'income') for (const [id, v] of Object.entries(t.alloc ?? {})) { const q = pocketById(s, id); if (q) { q.balance = M.round2(q.balance - v); if (q.kind === 'invest') q.base = M.round2((q.base ?? v) - v); } }
      else if (t.type === 'move') { pocketById(s, t.pocket).balance = M.round2(pocketById(s, t.pocket).balance - t.amount); pocketById(s, t.from).balance = M.round2(pocketById(s, t.from).balance + t.amount); }
      else if (t.type === 'adjust') pocketById(s, t.pocket).balance = M.round2(pocketById(s, t.pocket).balance - t.amount);
      s.tx = s.tx.filter((x) => x.id !== t.id);
      closeSheet(); commit(); toast('Opération annulée');
    };
  });
};

// ─────────────── Simulateur de loyer ───────────────
actions.rent = () => {
  const s = S();
  const mi = E.monthlyIncome(s);
  openSheet(`<h2 class="h2">Simulateur de loyer</h2><p class="lead">Avant de signer, vois ce que ton budget devient.</p>
    <label class="field"><span>Revenu mensuel moyen (€)</span><input class="input" id="r-inc" inputmode="decimal" value="${mi ?? ''}" placeholder="1200"><span class="help">${mi ? 'Calculé sur tes revenus saisis.' : 'Saisis des revenus pour que je le calcule, ou indique-le ici.'}</span></label>
    <label class="field"><span>Loyer et charges (€)</span><input class="input" id="r-rent" inputmode="decimal" placeholder="450"></label>
    <div id="r-out"></div>`, (sh) => {
    const run = () => {
      const inc = num($('#r-inc', sh).value), rent = num($('#r-rent', sh).value);
      if (!(inc > 0) || !(rent >= 0)) { $('#r-out', sh).innerHTML = ''; return; }
      const fixed = M.subsTotal(s) + (pocketById(s, 'nourriture')?.target ?? 0);
      const left = M.round2(inc - rent - fixed);
      const share = Math.round((rent / inc) * 100);
      const need = E.goalStatuses(s).filter((g) => g.status !== 'done').reduce((a, g) => a + g.perMonth, 0);
      const tone = left < 0 ? 'no' : left < need || share > 33 ? 'careful' : 'ok';
      const head = left < 0 ? 'Impossible sans nouveau revenu.' : left < need ? 'Faisable, mais tes projets ralentissent.' : share > 33 ? 'Ça passe, mais le loyer est lourd.' : 'Ça passe, projets compris.';
      $('#r-out', sh).innerHTML = `<div class="verdict ${tone}"><div class="vh"><div class="badge">${tone === 'ok' ? '✓' : tone === 'no' ? '✕' : '!'}</div><div class="h3">${head}</div></div>
        <ul><li>Le loyer pèse ${share} % de ton revenu${share > 33 ? ' (la règle courante est 33 % maximum)' : ''}.</li>
        <li>Après loyer, abonnements et nourriture (${fmt0(fixed)}), il te reste ${fmt(left)} par mois.</li>
        ${need > 0 ? `<li>Tes projets demandent ~${fmt0(need)} par mois, avant épargne, plaisirs et investissement.</li>` : ''}</ul></div>`;
    };
    sh.addEventListener('input', run); run();
  });
};

// ─────────────── Import relevé Revolut ───────────────
actions.import = () => {
  openSheet(`<h2 class="h2">Importer un relevé Revolut</h2><p class="lead">Dans Revolut : Compte › Relevés › Excel/CSV. Seules les dépenses sont lues ; les doublons sont ignorés.</p>
    <label class="btn primary block" style="cursor:pointer">Choisir le fichier CSV<input type="file" id="f-csv" accept=".csv,text/csv" hidden></label><div id="f-out"></div>`, (sh) => {
    $('#f-csv', sh).onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return;
      let rows;
      try { rows = revolutRows(await f.text(), S()); } catch (err) { $('#f-out', sh).innerHTML = `<p class="note" style="margin-top:14px">${esc(err.message)}</p>`; return; }
      if (!rows.length) { $('#f-out', sh).innerHTML = '<p class="empty">Aucune nouvelle dépense dans ce fichier.</p>'; return; }
      const spendP = S().pockets.filter((p) => p.kind === 'spend');
      const shown = rows.slice(0, 150);
      $('#f-out', sh).innerHTML = `<p class="help" style="margin:16px 0 8px">${rows.length} dépenses trouvées${rows.length > 150 ? ' (les 150 plus récentes affichées)' : ''}. Vérifie la poche de chacune.</p>
        <div class="group" style="margin-bottom:14px">${shown.map((r, i) => `<div class="row" style="gap:10px"><input type="checkbox" data-i="${i}" ${r.include ? 'checked' : ''} aria-label="Importer"><div class="grow"><div class="ttl" style="font-size:14.5px">${esc(r.desc)}</div><div class="sub">${esc(r.date)} · ${fmt(r.amount)}</div></div><select class="input" data-p="${i}" style="width:128px;height:40px;font-size:14px">${spendP.map((p) => `<option value="${p.id}" ${p.id === r.pocket ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select></div>`).join('')}</div>
        <div class="toggle"><div><div class="h3">Ajuster les soldes des poches</div><div class="help" style="margin:0">Désactivé : l'import ne sert qu'à l'historique.</div></div><button class="switch" id="f-adj" role="switch" aria-checked="false"></button></div>
        <button class="btn primary block" id="f-go">Importer</button>`;
      let adj = false;
      $('#f-adj', sh).onclick = (ev) => { adj = !adj; ev.currentTarget.classList.toggle('on', adj); ev.currentTarget.setAttribute('aria-checked', adj); };
      $('#f-go', sh).onclick = () => {
        const s = S(); let n = 0;
        shown.forEach((r, i) => {
          if (!$(`input[data-i="${i}"]`, sh).checked) return;
          const pid = $(`select[data-p="${i}"]`, sh).value;
          s.rules[ruleKey(r.desc)] = pid;
          const t = { id: M.uid(), ts: new Date(r.date + 'T12:00:00').toISOString(), type: 'expense', pocket: pid, amount: r.amount, label: r.desc, key: r.key, imported: true };
          s.tx.push(t); if (adj) pocketById(s, pid).balance = M.round2(pocketById(s, pid).balance - r.amount); n++;
        });
        s.tx.sort((a, b) => b.ts.localeCompare(a.ts));
        closeSheet(); commit(); toast(`${n} dépenses importées`);
      };
    };
  });
};

// ─────────────── Réglages ───────────────
actions.settings = () => {
  const s = S(); const c = s.settings;
  openSheet(`<h2 class="h2">Le conseiller</h2><p class="lead">Règle son poids et ses seuils.</p>
    <label class="field"><span>Prénom</span><input class="input" id="c-name" value="${esc(c.name)}"></label>
    <label class="field"><span>Poids du conseiller : <b id="c-infl-v">${c.influence} %</b></span><input type="range" id="c-infl" min="0" max="100" step="5" value="${c.influence}"><span class="help">0 % = tes pourcentages purs. 100 % = le conseiller ajuste au maximum selon tes projets, ton matelas et ton portefeuille.</span></label>
    <label class="field"><span>Profil</span><select class="input" id="c-risk">${[['prudent', 'Prudent'], ['equilibre', 'Équilibré'], ['equilibre-dynamique', 'Équilibré à dynamique'], ['dynamique', 'Dynamique']].map(([k, l]) => `<option value="${k}" ${c.risk === k ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
    <label class="field"><span>Horizon d'investissement (années)</span><input class="input" id="c-hor" inputmode="numeric" value="${c.horizon}"></label>
    <label class="field"><span>Objectif de matelas de sécurité (€)</span><input class="input" id="c-em" inputmode="decimal" value="${c.emergencyTarget}"></label>
    <label class="field"><span>Plafond Bitcoin dans le portefeuille (%)</span><input class="input" id="c-cap" inputmode="decimal" value="${c.btcCap}"></label>
    <button class="btn primary block" id="c-save">Enregistrer</button>`, (sh) => {
    $('#c-infl', sh).oninput = (e) => ($('#c-infl-v', sh).textContent = e.target.value + ' %');
    $('#c-save', sh).onclick = () => {
      Object.assign(c, { name: $('#c-name', sh).value.trim() || c.name, influence: +$('#c-infl', sh).value, risk: $('#c-risk', sh).value, horizon: num($('#c-hor', sh).value) || 5, emergencyTarget: num($('#c-em', sh).value) || 1000, btcCap: num($('#c-cap', sh).value) || 12 });
      closeSheet(); commit(); toast('Réglages enregistrés');
    };
  });
};

actions.llm = () => {
  const l = S().settings.llm;
  openSheet(`<h2 class="h2">IA Gemini</h2><p class="lead">Gratuit. Sans elle, le conseiller répond avec tes chiffres et ses cours intégrés. Avec elle, il suit l'actualité (bourse, taux, Bitcoin, monde) via la recherche web, répond à toutes tes questions de finance et rédige le point marché.</p>
    <div class="toggle"><div><div class="h3">Activer l'IA</div></div><button class="switch ${l.enabled ? 'on' : ''}" id="l-on" role="switch" aria-checked="${l.enabled}"></button></div>
    <label class="field"><span>Clé API Gemini</span><input class="input" id="l-key" type="password" autocomplete="off" value="${esc(l.key)}" placeholder="AIza…"><span class="help">Gratuite sur aistudio.google.com/apikey. Elle reste sur ce téléphone.</span></label>
    <label class="field"><span>Modèle</span><input class="input" id="l-model" value="${esc(l.model)}"></label>
    <div class="note">Confidentialité : quand l'IA est utilisée, ta question et un résumé chiffré (soldes, projets, part de Bitcoin) sont envoyés à Google. Aucun libellé de dépense n'est envoyé. Les calculs de répartition et de « puis-je ? » restent toujours locaux. Désactivée, rien ne quitte le téléphone.</div>
    <button class="btn primary block" id="l-save">Enregistrer</button>`, (sh) => {
    let on = l.enabled;
    $('#l-on', sh).onclick = (e) => { on = !on; e.currentTarget.classList.toggle('on', on); };
    $('#l-save', sh).onclick = () => { const key = $('#l-key', sh).value.trim();
      if (key && !l.key) on = true; // première clé saisie : on active
      Object.assign(l, { enabled: on && !!key, key, model: $('#l-model', sh).value.trim() || 'gemini-flash-latest' }); closeSheet(); commit(); toast(on ? 'IA activée' : 'IA désactivée'); };
  });
};

actions.pin = () => openSheet(`<h2 class="h2">Code PIN</h2><p class="lead">Le PIN verrouille l'écran de l'appli. Il ne chiffre pas les données : garde aussi ton téléphone verrouillé.</p>
  <button class="btn primary block" data-act="lock-now">Verrouiller maintenant</button><button class="btn ghost block" style="margin-top:10px" data-act="change-pin">Changer le PIN</button>`);
actions['lock-now'] = () => { closeSheet(); setTimeout(() => bus.lock(), 200); };
actions['change-pin'] = () => { closeSheet(); setTimeout(() => bus.changePin(), 200); };
actions.lock = () => bus.lock();

actions.notif = () => {
  const c = S().settings;
  openSheet(`<h2 class="h2">Notifications</h2><p class="lead">Alertes quand un projet prend du retard, qu'une enveloppe est à sec ou que Bitcoin dépasse son plafond.</p>
    <div class="toggle"><div class="h3">Activer les alertes</div><button class="switch ${c.notif ? 'on' : ''}" id="n-on" role="switch" aria-checked="${c.notif}"></button></div>
    <div class="note">Honnêteté technique : sans serveur, un téléphone ne peut pas recevoir de notification à heure fixe. Cap te prévient à l'ouverture de l'appli, et rien ne sort de ton téléphone.</div>`, (sh) => {
    $('#n-on', sh).onclick = async (e) => {
      if (!c.notif) {
        const perm = await Notification.requestPermission().catch(() => 'denied');
        if (perm !== 'granted') return toast('Autorise les notifications dans Chrome');
        c.notif = true;
      } else c.notif = false;
      e.currentTarget.classList.toggle('on', c.notif); save(); bus.refresh();
    };
  });
};

actions.backup = () => openSheet(`<h2 class="h2">Sauvegarde</h2><p class="lead">Tes données ne vivent que sur ce téléphone : exporte-les de temps en temps, surtout avant de changer de téléphone.</p>
  <button class="btn primary block" id="b-exp">Exporter mes données</button>
  <label class="btn ghost block" style="margin-top:10px;cursor:pointer">Restaurer une sauvegarde<input type="file" id="b-imp" accept=".json,application/json" hidden></label>
  <button class="btn danger block" id="b-reset" style="margin-top:26px">Tout réinitialiser</button>`, (sh) => {
  $('#b-exp', sh).onclick = () => {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([exportJSON()], { type: 'application/json' }));
    a.download = `cap-sauvegarde-${M.isoDay(new Date())}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000); toast('Sauvegarde exportée');
  };
  $('#b-imp', sh).onchange = async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try { importJSON(await f.text()); closeSheet(); bus.refresh(); toast('Sauvegarde restaurée'); } catch (err) { toast(err.message); }
  };
  $('#b-reset', sh).onclick = () => {
    if (!confirm('Effacer toutes tes données et repartir de zéro ?')) return;
    const keep = S().settings; resetAll(); Object.assign(S().settings, { pinHash: keep.pinHash, pinSalt: keep.pinSalt }); save(); closeSheet(); bus.refresh();
  };
});
