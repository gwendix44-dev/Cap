// Conseiller conversationnel local : reconnaît les intentions, calcule avec le moteur.
import * as E from './engine.js';
import { fmt, fmt0, guessPocket, pocketById, netWorth, spendable, invested, savings, ym } from './model.js';

export const GLOSSARY = [
  { t: 'ETF', d: 'Un panier d\'actions ou d\'obligations qui se vend comme une seule action. Tu achètes une ligne et tu détiens des dizaines ou centaines d\'entreprises, avec très peu de frais.', a: "C'est comme un panier de courses déjà rempli : au lieu d'acheter chaque produit un par un, tu prends le panier entier, et si un produit est périmé, le reste compense." },
  { t: 'S&P 500', d: 'L\'indice des 500 plus grandes entreprises américaines. Un ETF S&P 500 copie cet indice : si l\'indice monte de 10 %, ton ETF monte d\'environ 10 %.', a: "C'est le « classement des 500 meilleurs élèves » de la bourse américaine : suivre l'indice, c'est miser sur toute la classe plutôt que sur un seul élève." },
  { t: 'PEA', d: 'Plan d\'Épargne en Actions : une enveloppe française pour investir en actions européennes. Après 5 ans, les gains ne paient plus d\'impôt sur le revenu (restent les prélèvements sociaux).', a: "C'est un coffre à bonne fiscalité : plus tu y laisses ton argent longtemps (5 ans), moins le fisc te prend sur tes gains." },
  { t: 'DCA', d: 'Investir un montant régulier (par exemple chaque mois) au lieu de tout d\'un coup. Tu achètes cher et moins cher tour à tour, ce qui lisse le prix d\'achat et évite de deviner le « bon moment ».', a: "C'est comme remplir ta cave à vin bouteille par bouteille chaque mois : tu ne dépends pas du jour où le prix est au plus haut." },
  { t: 'Volatilité', d: 'À quel point un prix bouge. Bitcoin est très volatil (±5 % en un jour est normal) ; un ETF monde l\'est beaucoup moins.', a: "C'est la houle de la mer : sur un ETF monde la mer est assez calme, sur le Bitcoin on est en pleine tempête, avec de grosses vagues dans les deux sens." },
  { t: 'Diversification', d: 'Ne pas mettre tous ses œufs dans le même panier : plusieurs entreprises, pays et types d\'actifs, pour qu\'une chute n\'emporte pas tout.', a: "On ne met pas tous ses œufs dans le même panier : si un panier tombe, les autres œufs sont intacts." },
  { t: 'Robo-advisor', d: 'Un service qui investit pour toi selon ton profil, en ETF diversifiés, et rééquilibre automatiquement. Pratique, mais avec des frais de gestion en plus.', a: "C'est un pilote automatique : tu donnes ta destination (ton profil), il conduit à ta place, mais il prend un péage (les frais)." },
  { t: 'Matelas de sécurité', d: 'Une épargne disponible tout de suite (compte épargne) pour les imprévus et les mois sans mission. On la constitue avant d\'investir davantage.', a: "C'est ton airbag : tu espères ne jamais l'utiliser, mais le jour d'un choc (mois sans mission), il t'évite de te blesser." },
  { t: 'Plafond', d: 'Le pourcentage maximum que tu acceptes d\'avoir sur une ligne. Ici : Bitcoin ne dépasse pas ~12 % de ton portefeuille investi.', a: "C'est la limite de vitesse que tu t'imposes sur une ligne risquée, pour qu'un accident ne ruine pas tout le trajet." },
  { t: 'Rendement', d: 'Ce qu\'un placement rapporte, en % par an. Les actions ont rapporté en moyenne ~7 à 8 %/an sur le très long terme, mais avec des années à -20 %. Rien n\'est garanti.', a: "C'est le « loyer » que ton argent te rapporte : plus il est élevé, plus le risque est en général grand aussi." },
  { t: 'Actions', d: 'Une part d\'une entreprise. Son prix monte ou baisse selon les résultats et l\'humeur du marché. Choisir des actions une par une est plus risqué qu\'un ETF.', a: "Acheter une action, c'est devenir tout petit propriétaire d'une boulangerie géante : si elle prospère, ta part vaut plus." },
  { t: 'Horizon', d: 'La durée pendant laquelle tu peux laisser l\'argent investi sans y toucher. Plus il est long, mieux tu encaisses les baisses.', a: "C'est la durée du voyage : pour un trajet de 5 ans on prend un vélo solide, pour 6 mois on garde l'argent à l'abri sous la main." },
];

const num = (t) => {
  const s = t.replace(/(\d)\s(?=\d{3}\b)/g, '$1');
  const m = s.match(/(\d+(?:[.,]\d+)?)/);
  return m ? parseFloat(m[1].replace(',', '.')) : null;
};

const SUGGESTIONS = ['Explique-moi les ETF', 'Que se passe-t-il en bourse ?', 'Dois-je investir ?', 'Où en est mon voyage ?', 'Combien me reste-t-il ?', 'Bilan du mois'];
export const TRANSACTIONAL = new Set(['verdict', 'expense', 'alloc', 'balances', 'goals', 'month']);
export const suggestions = () => SUGGESTIONS;

export function reply(s, raw, now = new Date()) {
  const t = raw.trim();
  const low = t.toLowerCase();
  const n = num(t);

  if (/rev ?points?|revpoints/.test(low)) {
    const st = E.revStatus(s, now);
    const eta = st.etaDays == null ? 'pas de date possible pour l\'instant' : `arrivée estimée dans ~${Math.round(st.etaDays / 30)} mois`;
    return { text: `Tu as ${s.rev.points.toLocaleString('fr-FR')} RevPoints sur ${s.rev.target.toLocaleString('fr-FR')} visés (${Math.round(st.pct * 100)} %), ${eta}. Avec la carte seule, il faudrait dépenser ${fmt0(st.spendNeeded)} : ne dépense jamais pour des points. Les bons leviers : offres activées avant un achat déjà prévu, défis gratuits, Points Pocket avec de l'argent déjà épargné. Détails dans l'onglet Points.` };
  }
  // ── Investir un montant précis : réponse chiffrée sur CE qu'il demande ──
  const asset = /s&p|sp ?500|s and p/.test(low) ? 'sp' : /bitcoin|btc/.test(low) ? 'btc' : /\betf|monde|msci/.test(low) ? 'etf' : /robo/.test(low) ? 'robo' : /\bpea\b/.test(low) ? 'pea' : null;
  if (n && asset && /(invest|place|mettre|mets|envisage|acheter|investis)/.test(low)) return investAnswer(s, n, asset, now);
  // ── Budget pour un événement (Noël, cadeaux, vacances…) ──
  if (/(budget|combien (prévoir|dépenser|mettre|prendre)|prévoir)/.test(low) && /(no[eë]l|cadeau|anniv|f[eê]te|vacances|sorties?|week-?end|restos?|mariage)/.test(low)) return eventBudget(s, t, low, n, now);

  if (/puis[- ]?je|je peux|peut[- ]on|raisonnable|ai[- ]je (les moyens|le droit)|me permettre|m'offrir|je m'offre|j'ai envie|acheter/.test(low) && n) {
    const pocket = guessPocket(t);
    const v = E.verdict(s, { amount: n, pocket, label: t }, now);
    return { text: `${v.headline}`, card: { type: 'verdict', v } };
  }
  if (/(d[ée]pens|pay[ée]|achet[ée]|pris|claqu)/.test(low) && n && !/(combien|total)/.test(low)) {
    const pocket = guessPocket(t);
    return { text: `Je note ${fmt(n)} dans ${pocketById(s, pocket).name}. Tu confirmes ?`, card: { type: 'expense', amount: n, pocket, label: t.replace(/^(j'ai\s+)?(dépensé|payé|acheté)\s*/i, '') } };
  }
  if (/(re[cç]u|touch[ée]|paie|salaire|gagn[ée]|virement|mission|payé par)/.test(low) && n) {
    const plan = E.allocate(s, n, now);
    return { text: `Voilà comment je répartirais ${fmt(n)}.`, card: { type: 'alloc', income: n, plan } };
  }
  const gl = /(c'est quoi|qu'est[- ]ce (que|qu')|définition|explique|ça veut dire|signifie)/.test(low);
  if (gl) {
    const hit = GLOSSARY.find((g) => low.includes(g.t.toLowerCase()) || (g.t === 'S&P 500' && /s&p|sp500|s and p/.test(low)));
    if (hit) return { text: `${hit.t} : ${hit.d}\n\nEn image : ${hit.a ?? ''}`.trim() };
  }
  if (/(combien|solde|reste|poches?|dispo)/.test(low)) {
    return { text: `Tu as ${fmt(netWorth(s))} en tout : ${fmt(spendable(s))} à dépenser, ${fmt(savings(s))} d'épargne et ${fmt(invested(s))} investis.`, card: { type: 'balances' } };
  }
  if (/(voyage|projet|objectif|mars)/.test(low)) {
    const gs = E.goalStatuses(s, now);
    if (!gs.length) return { text: "Tu n'as pas encore de projet. Ajoute-en un dans Gérer › Projets." };
    return { text: gs.map((g) => `« ${g.name} » : ${fmt0(g.saved)} sur ${fmt0(g.target)} (${Math.round(g.pct * 100)} %). Il faut ~${fmt0(g.perMonth)} par mois.`).join('\n'), card: { type: 'goals' } };
  }
  if (/(bilan|résumé|resume|ce mois|mensuel)/.test(low)) {
    const m = E.monthSummary(s, ym(now));
    const bits = [`Ce mois-ci : ${fmt(m.income)} reçus, ${fmt(m.spent)} dépensés`];
    if (m.rate != null) bits.push(`${Math.round(m.rate * 100)} % mis de côté ou investi`);
    return { text: bits.join(', ') + '.', card: { type: 'month', m } };
  }
  if (/(invest|bitcoin|btc|etf|s&p|sp500|pea\b|actions?|bourse|robo|crypto)/.test(low)) {
    const ip = E.investPlan(s, now);
    const main = ip.advice.slice(0, 2).map((a) => `• ${a.title}. ${a.text}`).join('\n\n');
    return { text: main, card: { type: 'invest' } };
  }
  if (/(salut|bonjour|hello|coucou|hey)/.test(low)) return { text: `Salut ${s.settings.name} ! Dis-moi ce que tu as reçu, ce que tu veux dépenser, ou pose-moi une question sur ton budget.` };
  return { text: "Cette question demande de vraies phrases, et mes règles intégrées ne savent répondre qu'aux sujets prévus (répartir un revenu, juger une dépense, tes projets, ETF, S&P 500, Bitcoin, RevPoints). Active l'IA gratuite : elle répond à tout ce qui touche à l'argent, suit l'actualité et connaît tes chiffres.", card: { type: 'enable-ai' }, needsAI: true };
}

// Contexte compact envoyé à Gemini (si activé) : uniquement des chiffres agrégés.
export function llmContext(s, now = new Date()) {
  const ip = E.investPlan(s, now);
  const m = E.monthSummary(s, ym(now));
  return {
    date: now.toISOString().slice(0, 10),
    poches: s.pockets.map((p) => ({ nom: p.name, type: p.kind, solde: p.balance, objectifMensuel: p.target || undefined })),
    projets: E.goalStatuses(s, now).map((g) => ({ nom: g.name, cible: g.target, epargne: g.saved, echeance: g.date, parMois: g.perMonth, statut: g.status })),
    portefeuille: { total: ip.pf.total, partBitcoinPct: ip.btcPct, plafondBitcoinPct: ip.cap },
    matelas: ip.em,
    moisEnCours: { revenus: m.income, depenses: m.spent, mis_de_cote: m.put },
    revpoints: { points: s.rev.points, cible: s.rev.target, abonnement: s.rev.plan },
    profil: { risque: s.settings.risk, horizonAns: s.settings.horizon },
  };
}

export const SYSTEM_PROMPT = `Tu es « Cap », le conseiller financier personnel de {name}, 22 ans, à Nantes. Il utilise Revolut (poches Abonnements, Nourriture, Voyages, Plaisirs, Personnel, Épargne, robo-advisor, Bitcoin), a des revenus d'intérim irréguliers et débute en finance.

PÉRIMÈTRE STRICT : tu parles uniquement d'argent (y compris les RevPoints : il veut passer de 60 000 à 100 000 points SANS dépenses inutiles ; ne l'encourage jamais à acheter, changer d'abonnement payant ou utiliser des tactiques abusives pour des points) : budget, banque, épargne, investissement (actions, ETF, PEA, crypto, robo-advisor), fiscalité de l'épargne, économie, marchés, et l'actualité (économique, politique, géopolitique, générale) UNIQUEMENT dans la mesure où elle touche l'argent ou les marchés. Pour tout autre sujet (recettes, code, devoirs, santé, etc.), refuse en une phrase aimable et ramène vers la finance.

ACTUALITÉ : pour tout ce qui est récent (cours, indices, taux, banques centrales, résultats d'entreprises, événements), utilise la recherche web, donne la date des informations et dis clairement quand une donnée est incertaine. N'invente jamais un cours ou un chiffre.

STYLE PROFESSEUR : tutoie, sois direct et rassurant. Explique comme à un débutant : mots simples, chaque terme technique défini en une phrase, et une comparaison de la vie quotidienne (panier de courses, airbag, pilote automatique, etc.). Structure courte : 1) la réponse en une phrase, 2) l'explication avec une comparaison, 3) « Pour toi » avec les chiffres fournis dans les données JSON (jamais de chiffres personnels inventés). Termine parfois par une petite question ou un mini-exercice pour vérifier qu'il a compris. Maximum ~12 lignes, listes courtes si utile.

CONSEILS : prends position et justifie (rendement vs risque, horizon 5 ans, matelas de sécurité, plafond Bitcoin). Rappelle en une courte phrase, seulement quand c'est important, qu'il s'agit d'un éclairage pédagogique et non d'un conseil en investissement réglementé, et que rien n'est garanti. Réponds uniquement en français.`;

const fr = (n) => fmt0(n);
const NAMES = { sp: 'ETF S&P 500', btc: 'Bitcoin', etf: 'ETF', robo: 'robo-advisor', pea: 'PEA' };
function investAnswer(s, amount, asset, now) {
  const em = E.emergency(s);
  const pf = E.portfolio(s);
  const goals = E.goalStatuses(s, now).filter((g) => g.remaining > 0);
  const lines = [];
  let verdict;
  if (asset === 'btc') {
    const after = Math.round((((pf.shares.find((x) => x.id === 'btc')?.value ?? 0) + amount) / (pf.total + amount)) * 100);
    verdict = after > s.settings.btcCap ? `Non, pas pour l'instant : ${fr(amount)} de plus feraient monter le Bitcoin à ${after} % de ton portefeuille (ton plafond : ${s.settings.btcCap} %).` : `Oui, c'est dans ton plafond : le Bitcoin passerait à ${after} % (plafond ${s.settings.btcCap} %).`;
    lines.push('Le Bitcoin peut perdre la moitié de sa valeur en quelques mois : à ne mettre que ce que tu accepterais de voir fondre.');
  } else {
    const nameAfter = asset === 'sp' ? 'un ETF S&P 500 (500 grandes entreprises américaines en une seule ligne)' : 'ce placement';
    const remaining = em.have - amount;
    if (!em.ok) verdict = `Pas tout de suite : ton matelas de sécurité n'est pas complet (${fr(em.have)} sur ${fr(em.target)}). Complète-le d'abord, puis investis dans ${nameAfter}.`;
    else if (remaining < em.target) verdict = `Oui, mais pas avec l'épargne de sécurité : si ces ${fr(amount)} viennent de ton compte épargne, il passerait à ${fr(remaining)} (objectif ${fr(em.target)}). Prends plutôt l'argent de tes prochains revenus.`;
    else verdict = `Oui, c'est une bonne idée : ${nameAfter} convient à ton horizon de ${s.settings.horizon} ans, et ton matelas reste intact (${fr(remaining)} d'épargne après).`;
    if (asset === 'sp') {
      lines.push('Le S&P 500 monte en moyenne de 7 à 8 % par an sur le très long terme, mais il peut perdre 20 à 35 % en une mauvaise année et mettre des années à se refaire. Il ne se garde que si tu peux ne pas y toucher au moins 5 ans.');
      lines.push(`Astuce : au lieu de tout mettre d'un coup, fais ${amount >= 300 ? '3 versements de ' + fr(amount / 3) : '2 versements de ' + fr(amount / 2)} à quelques semaines d'écart. En image : tu entres dans la mer par paliers plutôt que d'un seul saut.`);
    }
  }
  const soon = goals.find((g) => (new Date(g.date) - now) / 864e5 < 730);
  if (soon && asset !== 'btc') lines.push(`Attention : l'argent de « ${soon.name} » (échéance ${new Date(soon.date).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' })}) ne doit jamais aller en bourse, il doit rester disponible.`);
  return { text: `${verdict}\n\n${lines.join('\n\n')}\n\nCe n'est pas un conseil réglementé, rien n'est garanti.`.trim(), card: { type: 'invest' } };
}
function eventBudget(s, t, low, n, now) {
  const inc = E.monthlyIncome(s, now);
  const fun = s.pockets.filter((p) => ['plaisirs', 'perso'].includes(p.id)).reduce((a, p) => a + p.balance, 0);
  const xmas = /no[eë]l|cadeau/.test(low);
  const end = new Date(now.getFullYear(), 11, 25);
  const weeks = Math.max(0, Math.round((end - now) / 6048e5));
  const base = inc ?? 0;
  const pct = xmas ? 0.1 : 0.07;
  const sugg = base ? Math.round((base * pct) / 10) * 10 : Math.min(Math.floor(fun / 10) * 10, 150);
  const parts = [];
  parts.push(base ? `Mon conseil : environ ${fr(sugg)} (≈ ${Math.round(pct * 100)} % d'un revenu mensuel moyen de ${fr(base)}).` : `Je n'ai pas encore assez de revenus enregistrés pour calculer un pourcentage. Pars sur ${fr(sugg)} maximum, tirés de tes poches Plaisirs et Personnel.`);
  parts.push(`Tu as ${fr(fun)} disponibles dans Plaisirs + Personnel. ${fun >= sugg - 0.5 ? 'Ça couvre ce budget sans toucher à ton épargne.' : `Il te manque ~${fr(sugg - fun)} : mets-les de côté sur tes prochains revenus.`}`);
  if (xmas) parts.push(`Noël est dans ${weeks} semaine${weeks > 1 ? 's' : ''}. Répartis la somme : liste tes personnes, fixe un montant par personne avant de regarder les prix, et garde ~10 % pour l'imprévu. Un cadeau choisi coûte souvent moins qu'un cadeau acheté sous la pression.`);
  parts.push('Veux-tu que je te dise si un achat précis passe ? Écris par exemple « puis-je dépenser 40 € pour un cadeau ? ».');
  return { text: parts.join('\n\n') };
}
