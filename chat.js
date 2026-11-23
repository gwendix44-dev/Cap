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
  return { text: 'Je ne traite que ton budget, la banque, l\'investissement et l\'économie. Je peux répartir un revenu, juger une dépense, suivre ton voyage ou t\'expliquer un placement. Essaie : « puis-je dépenser 30 € au resto ? » ou « explique-moi les ETF ».', fallback: true };
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
