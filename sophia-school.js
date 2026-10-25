// ---- progress.js ----
// progress.js — Calcul de la progression à partir du journal d'événements.
//
// Fonctions pures : elles ne lisent ni le DOM ni le stockage, pour être testées seules.
// Le journal ne contient que des fins d'activité :
//   { type: 'lecon_lue',     activite, t }
//   { type: 'tp_termine',    activite, t, prediction, observation }
//   { type: 'defi_termine',  activite, t, score, resultats: [{ premier: bool, essais: n }] }
//   { type: 'correction',    activite, t, corrige: id, score, resultats }  (un parent corrige une
//     dictée sur l'ardoise : la dernière correction remplace le score de l'événement corrigé)
// Tout le reste (maîtrise, étoiles, badges, points, série) en est déduit. Les notes de l'école
// réelle (note_ecole, note_retiree, bulletin_ecole, coef_matiere) sont dans le même journal mais
// ignorées ici.
(function (root) {
  'use strict';

  var LEVELS = ['À découvrir', 'Découverte', 'En cours', 'Maîtrisé', 'Expert'];
  var POINTS = { lecon: 10, tp: 60, question: 10, badge: 30, entrainement: 20 };
  var POINTS_PAR_NIVEAU = 120;
  var CARNET = { note_ecole: 1, note_retiree: 1, bulletin_ecole: 1, coef_matiere: 1 };
  var NOTE = { defi: 1, evaluation: 1, dictee: 1, flash: 1, motsmeles: 1, clique: 1, complete: 1, ardoise: 1, histoire: 1 };
  var CONSULTATION = { table: 1 };

  // Première fin de chaque activité, et meilleur score de chaque défi.
  function summary(events) {
    var done = {}, best = {};
    (events || []).forEach(function (e) {
      if (!e || !e.activite) return;
      if (!done[e.activite]) done[e.activite] = e;
      if (e.type === 'defi_termine') best[e.activite] = Math.max(best[e.activite] || 0, e.score || 0);
    });
    return { done: done, best: best };
  }

  // Maîtrise d'une notion (0 à 4) d'après les activités qui la travaillent.
  //   1 Découverte : au moins une activité faite
  //   2 En cours   : un TP ou un défi fait
  //   3 Maîtrisé   : un défi réussi à 80 %, ou un TP fait et un défi réussi à 60 %
  //   4 Expert     : toutes les activités de la notion faites, et tous ses défis à 90 %
  // Les activités bonus (« bonus: true », TP experts) ne comptent pas : facultatives. Les outils
  // à consulter (table d'addition, de Pythagore) non plus : ils n'ont pas de fin enregistrée.
  // Exercices notés (score dans defi_termine) : défis, évaluations, « clique sur le mot », « je complète » et exercices d'orthophonie ;
  // chacun peut avoir son seuil de réussite (« seuil » dans le contenu).
  function notionLevel(notion, activities, sum) {
    var acts = activities.filter(function (a) { return !a.bonus && !CONSULTATION[a.type] && (a.notions || []).indexOf(notion) !== -1; });
    if (!acts.length) return 0;
    var done = acts.filter(function (a) { return sum.done[a.id]; });
    if (!done.length) return 0;
    var defis = acts.filter(function (a) { return NOTE[a.type]; });
    var passed = function (a, base) { return (sum.best[a.id] || 0) >= (a.seuil || base); };
    var practice = done.some(function (a) { return a.type === 'tp' || a.type === 'entrainement' || NOTE[a.type]; });
    var tpDone = done.some(function (a) { return a.type === 'tp'; });
    var level = practice ? 2 : 1;
    if (defis.some(function (a) { return passed(a, 0.8); }) || (tpDone && defis.some(function (a) { return passed(a, 0.6); }))) level = 3;
    // Expert : tout fait, et chaque défi réussi à 90 % (chaque évaluation sans faute).
    if (level === 3 && done.length === acts.length && defis.length &&
        defis.every(function (a) { return (sum.best[a.id] || 0) >= (a.type === 'evaluation' ? 1 : 0.9); })) level = 4;
    return level;
  }

  // Étoiles d'un thème (0 à 3) : part des notions maîtrisées.
  function themeStars(levels) {
    if (!levels.length) return 0;
    var ratio = levels.filter(function (l) { return l >= 3; }).length / levels.length;
    return ratio >= 1 ? 3 : ratio >= 2 / 3 ? 2 : ratio >= 1 / 3 ? 1 : 0;
  }

  // Étoiles d'un thème à niveaux de difficulté (orthophonie) : 1 pour un exercice facile réussi,
  // 2 pour un moyen, 3 pour un difficile ; le niveau le plus haut réussi compte. Réussi = sans
  // faute et sans indice (score 1), plus exigeant que le badge : ces exercices sont faciles.
  var DIFFICULTES = { facile: 1, moyen: 2, difficile: 3 };
  function difficultyStars(activities, sum) {
    return activities.reduce(function (n, a) {
      var d = DIFFICULTES[a.difficulte] || 0;
      return !a.bonus && NOTE[a.type] && (sum.best[a.id] || 0) >= 1 ? Math.max(n, d) : n;
    }, 0);
  }

  // Jours (AAAA-MM-JJ, heure locale) où l'élève a fini au moins une activité.
  function dayOf(t) {
    var d = new Date(t);
    if (isNaN(d)) return null;
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function shiftDay(day, n) {
    var p = day.split('-'), d = new Date(+p[0], +p[1] - 1, +p[2] + n);
    return dayOf(d);
  }
  // Série en cours : jours d'affilée jusqu'à aujourd'hui (ou hier, si rien encore aujourd'hui).
  function streak(events, today) {
    var days = {};
    (events || []).forEach(function (e) { var d = e && dayOf(e.t); if (d) days[d] = true; });
    var day = dayOf(today || new Date());
    if (!days[day]) day = shiftDay(day, -1);
    var n = 0;
    while (days[day]) { n++; day = shiftDay(day, -1); }
    return n;
  }
  // Plus longue série jamais faite (pour le badge de série, qui reste acquis).
  function bestStreak(events) {
    var days = Object.keys((events || []).reduce(function (m, e) { var d = e && dayOf(e.t); if (d) m[d] = true; return m; }, {})).sort();
    var best = 0, run = 0, prev = null;
    days.forEach(function (d) { run = prev && shiftDay(prev, 1) === d ? run + 1 : 1; best = Math.max(best, run); prev = d; });
    return best;
  }

  function badgeEarned(badge, sum, events) {
    var q = badge.quand || {};
    if (q.activite) return !!sum.done[q.activite];
    if (q.defi) return (sum.best[q.defi] || 0) >= (q.score || 0);
    if (q.serie) return bestStreak(events) >= q.serie;
    return false;
  }

  function points(activities, sum, badgeCount) {
    var byId = {};
    activities.forEach(function (a) { byId[a.id] = a; });
    var xp = 0;
    Object.keys(sum.done).forEach(function (id) {
      var a = byId[id], e = sum.done[id];
      if (!a) return;
      if (a.type === 'lecon') xp += POINTS.lecon;
      else if (a.type === 'tp') xp += POINTS.tp;
      else if (a.type === 'defi' || a.type === 'evaluation') xp += POINTS.question * (e.resultats || []).filter(function (r) { return r.premier; }).length;
      else if (a.type === 'entrainement') xp += POINTS.entrainement;
      else xp += POINTS.lecon;
    });
    return xp + POINTS.badge * badgeCount;
  }

  // Corrections des parents : appliquées aux événements corrigés, puis retirées (elles ne comptent
  // ni comme activité ni dans la série de jours de l'enfant).
  function applyCorrections(events) {
    var fix = {};
    events.forEach(function (e) { if (e && e.type === 'correction' && e.corrige) fix[e.corrige] = e; });
    return events.filter(function (e) { return !(e && e.type === 'correction'); }).map(function (e) {
      var c = e && e.id && fix[e.id];
      return c ? Object.assign({}, e, { score: c.score, resultats: c.resultats, corrige_par: c }) : e;
    });
  }

  // Vue d'ensemble pour un ensemble d'activités et de badges.
  //   activities : [{ id, type, notions[] }]
  //   badges     : [{ id, nom, quand }]
  function compute(activities, badges, events, today) {
    // Le carnet de notes de l'école réelle (carnet.js) ne compte ni dans la progression ni dans la série.
    events = applyCorrections((events || []).filter(function (e) { return !(e && CARNET[e.type]); }));
    var sum = summary(events);
    var earned = (badges || []).filter(function (b) { return badgeEarned(b, sum, events); }).map(function (b) { return b.id; });
    var xp = points(activities, sum, earned.length);
    return {
      done: sum.done, best: sum.best, badges: earned, xp: xp,
      level: Math.floor(xp / POINTS_PAR_NIVEAU) + 1, levelPoints: xp % POINTS_PAR_NIVEAU, levelSize: POINTS_PAR_NIVEAU,
      streak: streak(events, today),
      notion: function (id) { return notionLevel(id, activities, sum); },
      difficultyStars: function (acts) { return difficultyStars(acts, sum); },
    };
  }

  // Correction d'une réponse de défi : jamais la réponse au premier essai raté.
  //   1er essai faux → indice ; 2e essai faux → explication, la question est perdue.
  function checkAnswer(question, choice, attempt) {
    var ok = choice === question.bonne;
    if (ok) return { ok: true, show: 'explication', fini: true };
    if (attempt <= 1) return { ok: false, show: 'indice', fini: false };
    return { ok: false, show: 'explication', fini: true };
  }

  // ---------- Faits numériques (tables) ----------
  // « 7x8 » (7 × 8) ou « 3+5 » ; la table de 7 = 7×1 … 7×10, la table de +3 = 1+3 … 10+3.
  function facts(operation, tables) {
    var out = [];
    (tables || []).forEach(function (t) {
      for (var k = 1; k <= 10; k++) out.push(operation === 'multiplication' ? t + 'x' + k : k + '+' + t);
    });
    return out;
  }
  // Un fait : « 7x8 », « 9+6 » (tables), et pour le calcul mental « 73-29 », « 4500:100 » (affiché 4500 ÷ 100, comme le mémo).
  var OPS = { x: [' × ', function (a, b) { return a * b; }], '+': [' + ', function (a, b) { return a + b; }],
    '-': [' − ', function (a, b) { return a - b; }], ':': [' ÷ ', function (a, b) { return b ? a / b : null; }] };
  function factParts(f) { var m = /^(\d+)([x+:-])(\d+)$/.exec(f); return m ? { a: +m[1], op: m[2], b: +m[3] } : null; }
  function answer(f) { var p = factParts(f); return p ? OPS[p.op][1](p.a, p.b) : null; }
  // Milliers séparés par une espace insécable, comme le mémo (1 000, 15 000).
  function number(n) { return String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '\u00a0'); }
  function factLabel(f) { var p = factParts(f); return p ? number(p.a) + OPS[p.op][0] + number(p.b) : f; }

  // Répétition espacée (boîtes de Leitner) reconstruite à partir du journal : juste → boîte
  // suivante (5 au plus), faux → retour en boîte 0. Les faits des petites boîtes reviennent plus souvent.
  function factBoxes(events) {
    var box = {};
    (events || []).forEach(function (e) {
      if (!e || (e.type !== 'entrainement_termine' && e.type !== 'defi_termine')) return;
      (e.resultats || []).forEach(function (r) {
        if (!r || !r.fait) return;
        box[r.fait] = r.ok ? Math.min(5, (box[r.fait] || 0) + 1) : 0;
      });
    });
    return box;
  }
  // Tirage de n faits : poids 6, 5, 4… selon la boîte, sans répétition tant que possible.
  function pickFacts(candidates, boxes, n, rand) {
    rand = rand || Math.random;
    var pool = candidates.slice(), out = [];
    while (out.length < n && candidates.length) {
      if (!pool.length) pool = candidates.slice();
      var weights = pool.map(function (f) { return 6 - Math.min(5, boxes[f] || 0); });
      var total = weights.reduce(function (a, b) { return a + b; }, 0), x = rand() * total, i = 0;
      while (i < pool.length - 1 && x >= weights[i]) { x -= weights[i]; i++; }
      out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }
  function shuffle(list, rand) {
    rand = rand || Math.random; var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }
  // Questions d'une évaluation : tous les faits des tables, mélangés, complétés au besoin.
  function evaluationFacts(operation, tables, n, rand) {
    var all = shuffle(facts(operation, tables), rand), out = [];
    while (out.length < n) out = out.concat(shuffle(all, rand));
    return out.slice(0, n);
  }

  var api = { LEVELS: LEVELS, facts: facts, answer: answer, number: number, factLabel: factLabel, factParts: factParts, factBoxes: factBoxes,
    pickFacts: pickFacts, evaluationFacts: evaluationFacts, shuffle: shuffle, compute: compute, notionLevel: notionLevel, themeStars: themeStars, difficultyStars: difficultyStars, streak: streak,
    bestStreak: bestStreak, checkAnswer: checkAnswer, summary: summary, applyCorrections: applyCorrections };
  root.School = root.School || {};
  root.School.progress = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ---- carnet.js ----
// carnet.js — Carnet de notes de l'école réelle (version SophIA) : fonctions pures, testées seules.
//
// L'élève recopie ses évaluations, matière par matière :
//   primaire (« competences ») : date, compétence NA, PA, A ou A+ ; ni note, ni moyenne, ni comparaison ;
//   collège (« notes »)        : date, note sur un barème, coefficient (1 par défaut), moyenne de la
//                                classe si elle est connue.
// Journal :
//   { type: 'note_ecole',   activite: <matière>, note_id, niveau, date, intitule, remarque,
//                           competence | note, bareme, coef, moyenne_classe }
//   { type: 'note_retiree', activite: <matière>, note_id }
//   { type: 'bulletin_ecole', activite: <matière>, niveau, annee, periode, moyenne, moyenne_classe }
//   { type: 'coef_matiere',   activite: <matière>, niveau, annee, coef }   (moyenne générale ; 1 par défaut)
//   { type: 'scolarite',      activite: 'scolarite', niveau, annee }      (la plus récente : classe active ;
//                                                                         les autres : archives)
// Une correction renvoie la note avec le même note_id : la dernière version compte. Une note
// peut porter « absent » (sans résultat, ne compte pas) et une période (T1, T2, T3, S1, S2 ;
// déduite de la date sinon). Le bulletin d'une période donne les moyennes officielles, sur 20.
(function (root) {
  'use strict';

  var COMPETENCES = ['NA', 'PA', 'A', 'A+'];
  var COMPETENCE_NOMS = { NA: 'Non acquis', PA: 'Partiellement acquis', A: 'Acquis', 'A+': 'Acquis +' };

  function isNote(e) { return !!e && (e.type === 'note_ecole' || e.type === 'note_retiree' || e.type === 'bulletin_ecole' || e.type === 'coef_matiere' || e.type === 'scolarite'); }
  function counted(n) { return !n.absent; }

  // Année scolaire (« 2025-2026 », bascule au 1er août) et trimestre d'une date AAAA-MM-JJ.
  function schoolYear(date) { var y = +date.slice(0, 4), m = +date.slice(5, 7); return m >= 8 ? y + '-' + (y + 1) : (y - 1) + '-' + y; }
  function guessPeriod(date) { var m = +date.slice(5, 7); return m >= 8 ? 'T1' : m <= 3 ? 'T2' : 'T3'; }
  function periodOf(n) { return n.periode || guessPeriod(n.date); }
  var PERIOD_ORDER = ['T1', 'S1', 'T2', 'S2', 'T3'];
  function byTime(a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; }
  function byDate(a, b) { return a.date < b.date ? -1 : a.date > b.date ? 1 : byTime(a, b); }

  // Notes en vigueur : dernière version de chaque note_id, sans les notes retirées ; par date.
  function fold(events) {
    var cur = {}, gone = {};
    (events || []).filter(isNote).slice().sort(byTime).forEach(function (e) {
      if (e.type === 'bulletin_ecole' || e.type === 'coef_matiere' || e.type === 'scolarite') return;
      if (e.type === 'note_retiree') { gone[e.note_id] = true; delete cur[e.note_id]; return; }
      if (gone[e.note_id]) return;
      cur[e.note_id] = Object.assign({ matiere: e.activite }, e);
    });
    return Object.keys(cur).map(function (k) { return cur[k]; }).sort(byDate);
  }
  function ofSubject(notes, matiere, niveau) {
    return notes.filter(function (n) { return n.matiere === matiere && (!niveau || n.niveau === niveau); });
  }
  function mode(n) { return n.competence ? 'competences' : 'notes'; }

  // Bulletins en vigueur : le dernier par matière, niveau, année et période ; vides = retirés.
  function bulletins(events) {
    var cur = {};
    (events || []).filter(function (e) { return e && e.type === 'bulletin_ecole'; }).slice().sort(byTime).forEach(function (e) {
      var k = [e.niveau, e.activite, e.annee, e.periode].join('/');
      if (e.moyenne == null && e.moyenne_classe == null) delete cur[k];
      else cur[k] = { niveau: e.niveau, matiere: e.activite, annee: e.annee, periode: e.periode, moyenne: e.moyenne, moyenne_classe: e.moyenne_classe };
    });
    return cur;
  }
  // Scolarité : la classe de chaque année scolaire (la dernière saisie compte), par année.
  function scolarite(events) {
    var y = {};
    (events || []).filter(function (e) { return e && e.type === 'scolarite'; }).slice().sort(byTime).forEach(function (e) { y[e.annee] = e.niveau; });
    return Object.keys(y).sort().map(function (a) { return { annee: a, niveau: y[a] }; });
  }
  function currentClass(events) { var s = scolarite(events); return s.length ? s[s.length - 1] : null; }
  function nextYear(annee) { var a = +annee.slice(0, 4) + 1; return a + '-' + (a + 1); }
  function currentSchoolYear(today) { return schoolYear(today || new Date().toISOString().slice(0, 10)); }
  // Années à ranger dans la malle : les scolarités passées, et les années qui ont des notes sans
  // scolarité (avant que la classe soit indiquée). [{ annee, niveau }], les plus récentes d'abord.
  function archives(events) {
    var cur = currentClass(events), seen = {}, out = [];
    scolarite(events).forEach(function (s) { if (!cur || s.annee !== cur.annee) { seen[s.annee + '/' + s.niveau] = true; out.push(s); } });
    fold(events).forEach(function (n) {
      var a = schoolYear(n.date), k = a + '/' + n.niveau;
      if (cur && a === cur.annee && n.niveau === cur.niveau) return;
      if (!seen[k]) { seen[k] = true; out.push({ annee: a, niveau: n.niveau }); }
    });
    return out.sort(function (a, b) { return a.annee < b.annee ? 1 : a.annee > b.annee ? -1 : 0; });
  }

  function bulletin(bul, niveau, matiere, annee, periode) { return bul[[niveau, matiere, annee, periode].join('/')] || null; }

  // Une ligne par période d'une matière : moyenne de l'élève et de la classe, celles du bulletin
  // quand elles sont saisies, sinon calculées à partir des évaluations.
  function periods(notes, bul, niveau, matiere) {
    var keys = {};
    notes.forEach(function (n) { keys[schoolYear(n.date) + '/' + periodOf(n)] = true; });
    Object.keys(bul).forEach(function (k) { var b = bul[k]; if (b.niveau === niveau && b.matiere === matiere) keys[b.annee + '/' + b.periode] = true; });
    return Object.keys(keys).sort(function (a, b) {
      var A = a.split('/'), B = b.split('/');
      return A[0] !== B[0] ? (A[0] < B[0] ? -1 : 1) : PERIOD_ORDER.indexOf(A[1]) - PERIOD_ORDER.indexOf(B[1]);
    }).map(function (k) {
      var p = k.split('/'), list = notes.filter(function (n) { return schoolYear(n.date) === p[0] && periodOf(n) === p[1]; });
      var b = bulletin(bul, niveau, matiere, p[0], p[1]), cmp = classCompare(list), avg = average(list);
      return { annee: p[0], periode: p[1], notes: list,
        eleve: b && b.moyenne != null ? b.moyenne : avg, eleveBulletin: !!(b && b.moyenne != null),
        classe: b && b.moyenne_classe != null ? b.moyenne_classe : cmp ? cmp.classe : null, classeBulletin: !!(b && b.moyenne_classe != null) };
    });
  }
  // Moyenne annuelle d'une matière : moyenne des périodes qui en ont une.
  function yearAverage(rows, annee, key) {
    var v = rows.filter(function (r) { return r.annee === annee && r[key || 'eleve'] != null; }).map(function (r) { return r[key || 'eleve']; });
    return v.length ? v.reduce(function (s, x) { return s + x; }, 0) / v.length : null;
  }
  // Coefficients des matières : le dernier par niveau, matière et année scolaire.
  function subjectCoefs(events) {
    var cur = {};
    (events || []).filter(function (e) { return e && e.type === 'coef_matiere'; }).slice().sort(byTime)
      .forEach(function (e) { cur[[e.niveau, e.activite, e.annee].join('/')] = e.coef; });
    return cur;
  }
  // Moyenne générale d'une période (ou de l'année, periode = null) : moyenne des matières,
  // pondérée par leur coefficient de l'année (1 par défaut : toutes égales).
  function generalAverage(subjects, annee, periode, key) {
    var s = 0, c = 0, n = 0;
    subjects.forEach(function (sub) {
      var x = periode ? (sub.rows.filter(function (r) { return r.annee === annee && r.periode === periode; })[0] || {})[key || 'eleve'] : yearAverage(sub.rows, annee, key);
      if (x == null) return;
      var k = sub.coefs && sub.coefs[annee] || 1;
      s += x * k; c += k; n++;
    });
    return n ? { moyenne: s / c, matieres: n } : null;
  }
  // Toutes les matières notées d'un niveau (et d'une année scolaire, si donnée) : [{ matiere, notes, rows }]
  function subjectsOf(events, niveau, annee) {
    var notes = fold(events).filter(function (n) { return n.niveau === niveau && (!annee || schoolYear(n.date) === annee); }), bul = bulletins(events), co = subjectCoefs(events), ids = {};
    if (annee) { var b2 = {}; Object.keys(bul).forEach(function (k) { if (bul[k].annee === annee) b2[k] = bul[k]; }); bul = b2; }
    notes.forEach(function (n) { ids[n.matiere] = true; });
    Object.keys(bul).forEach(function (k) { if (bul[k].niveau === niveau) ids[bul[k].matiere] = true; });
    return Object.keys(ids).sort().map(function (m) {
      var l = ofSubject(notes, m, niveau), coefs = {};
      Object.keys(co).forEach(function (k) { var p = k.split('/'); if (p[0] === niveau && p[1] === m) coefs[p[2]] = co[k]; });
      return { matiere: m, notes: l, rows: periods(l, bul, niveau, m), coefs: coefs };
    });
  }

  // ----- Collège -----
  function on20(n) { return n.note / n.bareme * 20; }
  function weighted(list, value) {
    var s = 0, c = 0;
    list.forEach(function (n) { var coef = n.coef == null ? 1 : n.coef; s += value(n) * coef; c += coef; });
    return c ? s / c : null;
  }
  // Moyenne de l'élève sur 20, pondérée par les coefficients.
  function average(notes) { return weighted(notes.filter(function (n) { return counted(n) && mode(n) === 'notes'; }), on20); }
  // Moyenne de la classe, et celle de l'élève sur les mêmes évaluations (sinon la comparaison ne veut rien dire).
  function classCompare(notes) {
    var same = notes.filter(function (n) { return counted(n) && mode(n) === 'notes' && n.moyenne_classe != null; });
    if (!same.length) return null;
    return { eleve: weighted(same, on20), classe: weighted(same, function (n) { return n.moyenne_classe / n.bareme * 20; }), evaluations: same.length };
  }
  // Moyenne après chaque évaluation, pour la courbe.
  function runningAverage(notes) {
    var list = notes.filter(function (n) { return counted(n) && mode(n) === 'notes'; });
    return list.map(function (n, i) { return { date: n.date, moyenne: weighted(list.slice(0, i + 1), on20) }; });
  }

  // ----- Primaire -----
  function competenceRank(n) { return COMPETENCES.indexOf(n.competence); }
  function counts(notes) {
    var c = { NA: 0, PA: 0, A: 0, 'A+': 0 };
    notes.forEach(function (n) { if (counted(n) && n.competence) c[n.competence]++; });
    return c;
  }

  // Valeur comparable de 0 à 1 (primaire : rang de la compétence ; collège : note / barème).
  function score(n) { return mode(n) === 'competences' ? competenceRank(n) / 3 : n.note / n.bareme; }

  // Tendance : moyenne des 3 dernières évaluations contre les 3 d'avant (6 au moins).
  function trend(notes) {
    notes = notes.filter(counted);
    if (notes.length < 6) return null;
    var mean = function (l) { return l.reduce(function (s, n) { return s + score(n); }, 0) / l.length; };
    var d = mean(notes.slice(-3)) - mean(notes.slice(-6, -3));
    return d > 0.05 ? 'hausse' : d < -0.05 ? 'baisse' : 'stable';
  }

  // À travailler : non ou partiellement acquis ; au collège, sous la moyenne de la classe quand
  // elle est connue (une note basse au-dessus de la classe veut dire que c'était difficile pour
  // tous), sinon sous la moitié du barème. Les plus récentes d'abord.
  function toWork(notes) {
    return notes.filter(function (n) {
      if (!counted(n)) return false;
      if (mode(n) === 'competences') return n.competence === 'NA' || n.competence === 'PA';
      return n.moyenne_classe != null ? n.note < n.moyenne_classe : n.note < n.bareme / 2;
    }).slice().reverse();
  }

  // Meilleur résultat (le plus récent en cas d'égalité).
  function best(notes) {
    var l = notes.filter(counted); if (!l.length) return null;
    return l.reduce(function (b, n) { return score(n) >= score(b) ? n : b; });
  }
  // Évaluations au-dessus (ou égales) de la moyenne de la classe.
  function aboveClass(notes) {
    var l = notes.filter(function (n) { return counted(n) && n.moyenne_classe != null; });
    return { sur: l.length, au_dessus: l.filter(function (n) { return n.note >= n.moyenne_classe; }).length };
  }

  // ----- Travail avec Sophia -----
  function dayOf(t) { var d = new Date(t); return isNaN(d) ? null : d.toISOString().slice(0, 10); }
  // Activités de l'école Sophia dans une matière, par jour : { 'AAAA-MM-JJ': nombre }.
  function activityByDay(events, activites, matiere) {
    var out = {};
    (events || []).forEach(function (e) {
      if (isNote(e)) return;
      var a = activites[e.activite];
      if (!a || a.matiere !== matiere) return;
      var d = dayOf(e.t); if (d) out[d] = (out[d] || 0) + 1;
    });
    return out;
  }
  // Avant / depuis la première activité avec Sophia dans la matière : seulement s'il y a au moins
  // 2 évaluations de chaque côté (sinon, rien à dire).
  function sophiaEffect(notes, byDay) {
    notes = notes.filter(counted);
    var days = Object.keys(byDay).sort();
    if (!days.length) return null;
    var first = days[0];
    var before = notes.filter(function (n) { return n.date < first; }), after = notes.filter(function (n) { return n.date >= first; });
    if (before.length < 2 || after.length < 2) return { depuis: first, avant: null, apres: null };
    var mean = function (l) { return l.reduce(function (s, n) { return s + score(n); }, 0) / l.length; };
    return { depuis: first, avant: mean(before), apres: mean(after), nAvant: before.length, nApres: after.length };
  }

  // ----- Saisie -----
  function num(v) {
    if (typeof v === 'number') return v;
    var s = String(v == null ? '' : v).trim().replace(',', '.');
    return s === '' || !/^-?\d+(\.\d+)?$/.test(s) ? NaN : +s;
  }
  // Vérifie une saisie du formulaire ; renvoie { note } (champs du journal) ou { erreur }.
  function check(form, notation, today) {
    var out = { note_id: form.note_id, niveau: form.niveau, date: form.date, intitule: String(form.intitule || '').trim().slice(0, 120),
      remarque: String(form.remarque || '').trim().slice(0, 300) };
    if (!/^\d{4}-\d{2}-\d{2}$/.test(out.date || '')) return { erreur: 'Choisis la date de l\'évaluation.' };
    if (today && out.date > today) return { erreur: 'La date ne peut pas être dans le futur.' };
    if (form.annee && schoolYear(out.date) !== form.annee) return { erreur: 'Cette date n\'est pas dans l\'année scolaire ' + form.annee + '.' };
    if (form.periode) { if (PERIOD_ORDER.indexOf(form.periode) === -1) return { erreur: 'Période inconnue.' }; out.periode = form.periode; }
    if (form.absent) {
      out.absent = true;
      if (notation !== 'competences') { var b0 = num(form.bareme); if (b0 > 0 && b0 <= 1000) out.bareme = b0; }
      return { note: out };
    }
    if (notation === 'competences') {
      if (COMPETENCES.indexOf(form.competence) === -1) return { erreur: 'Choisis le résultat : NA, PA, A ou A+.' };
      out.competence = form.competence;
      return { note: out };
    }
    var bareme = num(form.bareme), note = num(form.note), coef = form.coef === '' || form.coef == null ? 1 : num(form.coef);
    if (!(bareme > 0 && bareme <= 1000)) return { erreur: 'Le barème doit être un nombre positif (sur 20, sur 10…).' };
    if (!(note >= 0 && note <= bareme)) return { erreur: 'La note doit être entre 0 et ' + bareme + '.' };
    if (!(coef > 0 && coef <= 100)) return { erreur: 'Le coefficient doit être un nombre positif (1 si tu ne sais pas).' };
    out.note = note; out.bareme = bareme; out.coef = coef;
    if (form.moyenne_classe !== '' && form.moyenne_classe != null) {
      var m = num(form.moyenne_classe);
      if (!(m >= 0 && m <= bareme)) return { erreur: 'La moyenne de la classe doit être entre 0 et ' + bareme + '.' };
      out.moyenne_classe = m;
    }
    return { note: out };
  }

  function fr(x, digits) { return (Math.round(x * Math.pow(10, digits == null ? 1 : digits)) / Math.pow(10, digits == null ? 1 : digits)).toString().replace('.', ','); }

  // Moyennes du bulletin saisies (sur 20, facultatives) : { bulletin } ou { erreur }.
  function checkBulletin(form) {
    var out = { niveau: form.niveau, annee: form.annee, periode: form.periode };
    if (!/^\d{4}-\d{4}$/.test(out.annee || '') || PERIOD_ORDER.indexOf(out.periode) === -1) return { erreur: 'Période inconnue.' };
    var ok = true;
    ['moyenne', 'moyenne_classe'].forEach(function (k) {
      if (form[k] === '' || form[k] == null) { out[k] = null; return; }
      var v = num(form[k]); if (!(v >= 0 && v <= 20)) ok = false; else out[k] = v;
    });
    return ok ? { bulletin: out } : { erreur: 'Les moyennes du bulletin sont sur 20 : un nombre entre 0 et 20.' };
  }

  // ----- Import depuis un tableur -----
  // Collage d'un tableur (cellules séparées par des tabulations), une matière par groupe de 4
  // colonnes : date, note, barème, coefficient. Repères reconnus : ligne des matières, « 1er
  // trimestre », « 2ème trimestre »… ; « Classe » sous une matière = moyenne de la classe de la
  // période ; « absent(e) » à la place de la note. Les dates mal tapées sont corrigées et signalées.
  var NOMS = [[/^math/, 'maths'], [/^fran/, 'francais'], [/^angl/, 'anglais'], [/^espa/, 'espagnol'], [/^allem/, 'allemand'],
    [/^hist.*geo|^hg$|^histoire.?geographie/, 'histoire-geo'], [/^histoire$/, 'histoire'], [/^svt|vie et de la terre/, 'svt'],
    [/^phys/, 'physique-chimie'], [/^techn/, 'technologie'], [/^sciences?$/, 'sciences'], [/^sport|^eps/, 'eps'],
    [/^musique|^education musicale/, 'musique'], [/^arts?.?plast/, 'arts-plastiques'], [/^latin/, 'latin']];
  function plainName(s) { return String(s).normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z]+/g, ' ').trim(); }
  function subjectId(name) { var p = plainName(name); if (!p) return null; for (var i = 0; i < NOMS.length; i++) if (NOMS[i][0].test(p)) return NOMS[i][1]; return null; }
  // Identifiant stable (même évaluation importée deux fois = même note, pas de doublon), au format UUID.
  function stableId(text) {
    var h = [0x811c9dc5, 0x01000193, 0x2545f491, 0x9e3779b9];
    for (var i = 0; i < text.length; i++) for (var j = 0; j < 4; j++) { h[j] ^= text.charCodeAt(i) + j; h[j] = Math.imul(h[j], 16777619 + j * 2); }
    var hex = h.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
    return hex.slice(0, 8) + '-' + hex.slice(8, 12) + '-5' + hex.slice(13, 16) + '-' + '89ab'[parseInt(hex[16], 16) % 4] + hex.slice(17, 20) + '-' + hex.slice(20, 32);
  }
  function parseDate(cell) {
    var m = /^\s*(\d{1,2})\/(\d{1,2})\/(\d{4,5})\s*$/.exec(cell || '');
    if (!m) return null;
    var y = m[3].length === 5 ? m[3].slice(0, 4) : m[3];
    return { date: y + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2), corrige: m[3].length === 5 };
  }
  // annee (facultatif) : l'année scolaire attendue ; un tableau d'une autre année est refusé.
  function importSheet(text, niveau, anneeAttendue) {
    var lines = String(text || '').split(/\r?\n/).map(function (l) { return l.split('\t'); });
    var cols = null, periode = null, out = { notes: [], bulletins: [], alertes: [], ignorees: [] };
    var raw = [];
    lines.forEach(function (cells, li) {
      var first = String(cells[0] || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
      if (!cols) {
        var found = [];
        cells.forEach(function (c, i) { var id = subjectId(c); if (id) found.push({ i: i, matiere: id, nom: c.trim() }); });
        if (found.length >= 2) { cols = found; cells.forEach(function (c) { if (c.trim() && !subjectId(c)) out.ignorees.push(c.trim()); }); }
        return;
      }
      var tri = /^(\d)\s*(er|eme|e|nd)?\s*trimestre/.exec(first), sem = /^(\d)\s*(er|eme|e|nd)?\s*semestre/.exec(first);
      if (tri) { periode = 'T' + tri[1]; return; }
      if (sem) { periode = 'S' + sem[1]; return; }
      if (/^annee/.test(first)) { periode = null; return; }
      if (!periode) return;
      cols.forEach(function (c) {
        var a = (cells[c.i] || '').trim(), b = (cells[c.i + 1] || '').trim(), bar = num(String(cells[c.i + 2] || '').replace(/,$/, '')), coef = num(String(cells[c.i + 3] || '').replace(/,$/, ''));
        if (/^classe$/i.test(a)) { var v = num(b.replace(/,$/, '')); if (v >= 0 && v <= 20 && (bar === 20 || isNaN(bar))) raw.push({ type: 'classe', matiere: c.matiere, periode: periode, moyenne_classe: v }); return; }
        var d = parseDate(a);
        if (!d && /^abs/i.test(a)) d = null;
        if (!d) {
          if (/^abs/i.test(a) || /^abs/i.test(b)) out.alertes.push(c.nom + ' (' + periode + ') : une absence sans date, ignorée.');
          else if (a && b && !/^moyenne/i.test(a)) out.alertes.push(c.nom + ' : ligne ' + (li + 1) + ' illisible (« ' + [a, b].join(' | ') + ' »), ignorée.');
          return;
        }
        var n = { matiere: c.matiere, nom: c.nom, periode: periode, date: d.date, ligne: li + 1 };
        if (d.corrige) out.alertes.push(c.nom + ' : date « ' + a + ' » lue comme ' + d.date.split('-').reverse().join('/') + '.');
        if (/^abs/i.test(b)) { n.absent = true; if (bar > 0) n.bareme = bar; }
        else {
          var note = num(b.replace(/,$/, ''));
          if (isNaN(note) || !(bar > 0) || note > bar) { if (b || a) out.alertes.push(c.nom + ' : ligne ' + (li + 1) + ' illisible (« ' + [a, b, cells[c.i + 2], cells[c.i + 3]].join(' | ') + ' »), ignorée.'); return; }
          n.note = note; n.bareme = bar; n.coef = coef > 0 ? coef : 1;
        }
        raw.push(n);
      });
    });
    if (!cols) { out.erreur = 'Je ne trouve pas la ligne des matières (Maths, Français…). Copie le tableau depuis cette ligne, avec les cellules.'; return out; }
    // Année scolaire : la plus fréquente parmi les dates ; une date d'une autre année est corrigée
    // si son mois tombe dans la bonne période (ex. 16/01/2025 au 2e trimestre de 2025-2026).
    var years = {};
    raw.forEach(function (r) { if (r.date) years[schoolYear(r.date)] = (years[schoolYear(r.date)] || 0) + 1; });
    var annee = Object.keys(years).sort(function (a, b) { return years[b] - years[a]; })[0];
    out.annee = annee || null;
    if (anneeAttendue && annee && annee !== anneeAttendue) { out.erreur = 'Ce tableau est de l\'année ' + annee + ', pas de ' + anneeAttendue + '.'; return out; }
    raw.forEach(function (r) {
      if (r.type === 'classe') { if (annee) out.bulletins.push({ niveau: niveau, matiere: r.matiere, annee: annee, periode: r.periode, moyenne_classe: r.moyenne_classe }); return; }
      if (annee && schoolYear(r.date) !== annee) {
        var m = +r.date.slice(5, 7), y = m >= 8 ? annee.slice(0, 4) : annee.slice(5);
        var fixed = y + r.date.slice(4);
        out.alertes.push(r.nom + ' : date ' + r.date.split('-').reverse().join('/') + ' hors de l\'année ' + annee + ', lue comme ' + fixed.split('-').reverse().join('/') + '.');
        r.date = fixed;
      }
      var note = { note_id: stableId([niveau, r.matiere, r.periode, r.date, r.note, r.bareme, r.coef, r.absent ? 'abs' : '', r.ligne].join('|')), niveau: niveau, matiere: r.matiere,
        date: r.date, periode: r.periode, intitule: '', remarque: '' };
      if (r.absent) { note.absent = true; if (r.bareme) note.bareme = r.bareme; } else { note.note = r.note; note.bareme = r.bareme; note.coef = r.coef; }
      out.notes.push(note);
    });
    out.matieres = cols.map(function (c) { return c.matiere; });
    return out;
  }

  var api = { importSheet: importSheet, subjectId: subjectId, stableId: stableId, COMPETENCES: COMPETENCES, PERIOD_ORDER: PERIOD_ORDER, schoolYear: schoolYear, guessPeriod: guessPeriod, periodOf: periodOf,
    bulletins: bulletins, bulletin: bulletin, subjectCoefs: subjectCoefs, scolarite: scolarite, currentClass: currentClass,
    nextYear: nextYear, currentSchoolYear: currentSchoolYear, archives: archives, schoolYearOf: schoolYear, periods: periods, yearAverage: yearAverage, generalAverage: generalAverage, subjectsOf: subjectsOf,
    best: best, aboveClass: aboveClass, checkBulletin: checkBulletin, counted: counted, COMPETENCE_NOMS: COMPETENCE_NOMS, isNote: isNote, fold: fold, ofSubject: ofSubject, mode: mode,
    on20: on20, average: average, classCompare: classCompare, runningAverage: runningAverage, counts: counts, score: score, trend: trend,
    toWork: toWork, activityByDay: activityByDay, sophiaEffect: sophiaEffect, check: check, num: num, fr: fr };
  root.School = root.School || {};
  root.School.carnet = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ---- lexique.js ----
// lexique.js — Outils de mots pour l'orthophonie (fonctions pures, testées seules).
//
// - variants(mot) : fausses orthographes plausibles, avec les confusions fréquentes chez les
//   enfants dyslexiques : lettres miroir (b/d, p/q), proches (m/n, u/n), sons voisins (f/v, t/d,
//   ch/j), graphies d'un même son ou presque (ou/on, an/en, au/o…), inversions de deux
//   lettres, lettre oubliée ou doublée. Déterministe : le même mot donne les mêmes variantes.
// - grid(mots, …) : grille de mots mêlés, mots écrits de gauche à droite, lettres à la suite.
(function (root) {
  'use strict';

  // Générateur pseudo-aléatoire reproductible (mulberry32), graine tirée d'un texte.
  function seeded(text) {
    var h = 2166136261;
    for (var i = 0; i < String(text).length; i++) { h ^= String(text).charCodeAt(i); h = Math.imul(h, 16777619); }
    var a = h >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(list, rand) {
    var a = list.slice();
    for (var i = a.length - 1; i > 0; i--) { var j = Math.floor(rand() * (i + 1)), t = a[i]; a[i] = a[j]; a[j] = t; }
    return a;
  }

  // Remplacements, par famille. Chaque règle : [de, vers].
  var RULES = {
    miroir: [['b', 'd'], ['d', 'b'], ['p', 'q'], ['q', 'p'], ['b', 'p'], ['p', 'b']],
    proches: [['m', 'n'], ['n', 'm'], ['u', 'n'], ['n', 'u'], ['l', 'i'], ['h', 'n']],
    sons: [['f', 'v'], ['v', 'f'], ['t', 'd'], ['d', 't'], ['ch', 'j'], ['j', 'ch'], ['g', 'c'], ['c', 'g'], ['s', 'z'], ['z', 's']],
    graphies: [['am', 'an'], ['an', 'am'], ['em', 'en'], ['en', 'em'], ['om', 'on'], ['on', 'om'], ['ou', 'on'], ['on', 'ou'], ['an', 'en'], ['en', 'an'], ['on', 'an'], ['ain', 'in'], ['in', 'ain'], ['eau', 'o'], ['au', 'o'],
      ['o', 'au'], ['qu', 'k'], ['ss', 's'], ['ll', 'l'], ['mm', 'm'], ['tt', 't'], ['é', 'er'], ['er', 'é'], ['gn', 'ni'], ['oi', 'io'], ['ui', 'iu']],
  };
  function replaceAt(w, from, to, i) { return w.slice(0, i) + to + w.slice(i + from.length); }
  function positions(w, s) { var out = [], i = w.indexOf(s); while (i !== -1) { out.push(i); i = w.indexOf(s, i + 1); } return out; }

  // Toutes les variantes à une modification, rangées par famille.
  //   inversion  : deux lettres voisines échangées (br → rb, on → no)
  //   inversion2 : deux lettres séparées par une autre échangées (bal → lab)
  //   miroir, proches, graphies : en complément seulement, si les inversions ne suffisent pas
  // Pas de lettre oubliée ni doublée : ce ne sont pas les erreurs visées ici.
  function candidates(w) {
    var out = { inversion: [], inversion2: [], miroir: [], proches: [], graphies: [] };
    for (var i = 0; i < w.length - 1; i++) if (w[i] !== w[i + 1]) out.inversion.push(w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2));
    for (var k = 0; k < w.length - 2; k++) if (w[k] !== w[k + 2]) out.inversion2.push(w.slice(0, k) + w[k + 2] + w[k + 1] + w[k] + w.slice(k + 3));
    ['miroir', 'proches'].forEach(function (fam) {
      RULES[fam].forEach(function (r) { positions(w, r[0]).forEach(function (p) { out[fam].push(replaceAt(w, r[0], r[1], p)); }); });
    });
    RULES.graphies.filter(function (r) { return r[0].length === r[1].length && r[0] !== r[1]; })
      .forEach(function (r) { positions(w, r[0]).forEach(function (p) { out.graphies.push(replaceAt(w, r[0], r[1], p)); }); });
    return out;
  }

  // n fausses orthographes : d'abord des inversions (3 au plus), puis le complément ; jamais le mot.
  function variants(word, n, exclude) {
    n = n || 5;
    var w = String(word).toLowerCase(), rand = seeded(w), seen = {}, out = [];
    seen[w] = true; (exclude || []).forEach(function (x) { seen[String(x).toLowerCase()] = true; });
    var c = candidates(w);
    Object.keys(c).forEach(function (f) { c[f] = shuffle(c[f], rand); });
    function take(list, max) {
      var got = 0;
      while (list.length && out.length < n && got < max) { var v = list.shift(); if (!seen[v]) { seen[v] = true; out.push(v); got++; } }
    }
    var inv = shuffle(c.inversion.concat(c.inversion2), rand);
    take(inv, 3);
    take(c.miroir, 1);
    // am/an, em/en, om/on : une variante si le mot en contient (champignon → chanpignon)
    take(c.graphies.filter(function (v) { return /am|an|em|en|om|on/.test(v); }), 1);
    take(inv, n);
    ['miroir', 'proches', 'graphies'].forEach(function (f) { take(c[f], n); });
    // Mot très court : on combine deux inversions.
    for (var g = 0; out.length < n && g < 50; g++) {
      var base = out[g % Math.max(1, out.length)] || w, more = candidates(base);
      take(shuffle(more.inversion.concat(more.inversion2), rand), 1);
    }
    return out;
  }

  // Lettres sans accents, en capitales, pour la grille.
  function plain(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/[^A-Z]/g, ''); }

  // Grille de mots mêlés : chaque mot sur une ligne, de gauche à droite ; deux mots peuvent
  // partager une ligne s'ils ne se touchent pas. Remplissage : lettres au hasard, ou lettres
  // « pièges » proches de celles des mots (b/d/p/q, m/n…) pour le niveau difficile.
  function grid(words, rows, cols, rand, fill) {
    rand = rand || Math.random;
    var cells = [], placed = [], i, r, c;
    for (r = 0; r < rows; r++) { cells.push([]); for (c = 0; c < cols; c++) cells[r].push(null); }
    var list = words.map(plain).filter(Boolean).sort(function (a, b) { return b.length - a.length; });
    for (i = 0; i < list.length; i++) {
      var w = list[i], ok = false;
      if (w.length > cols) throw new Error('Mot trop long pour la grille : ' + w);
      for (var tries = 0; tries < 200 && !ok; tries++) {
        r = Math.floor(rand() * rows); c = Math.floor(rand() * (cols - w.length + 1));
        var free = true;
        for (var k = -1; k <= w.length; k++) { var x = c + k; if (x >= 0 && x < cols && cells[r][x] !== null) { free = false; break; } }
        if (free) { for (k = 0; k < w.length; k++) cells[r][c + k] = w[k]; placed.push({ mot: w, ligne: r, col: c }); ok = true; }
      }
      if (!ok) throw new Error('Grille trop petite pour ' + list.join(', '));
    }
    var TRAPS = { B: 'DPQ', D: 'BPQ', P: 'QBD', Q: 'PDB', M: 'NW', N: 'MU', U: 'NV', E: 'F', F: 'E', O: 'QC', C: 'OG', I: 'L', L: 'I' };
    var letters = list.join(''), ABC = 'ABCDEFGHIJKLMNOPRSTUVZ', empty = [];
    for (r = 0; r < rows; r++) for (c = 0; c < cols; c++) if (cells[r][c] === null) empty.push([r, c]);
    // Remplissage, recommencé tant qu'un mot apparaît une 2e fois par hasard (une seule bonne réponse).
    for (var round = 0; round < 50; round++) {
      empty.forEach(function (rc) {
        var v;
        if (fill === 'confusion' && rand() < 0.6) { var src = letters[Math.floor(rand() * letters.length)], t = TRAPS[src]; v = t ? t[Math.floor(rand() * t.length)] : src; }
        else v = ABC[Math.floor(rand() * ABC.length)];
        cells[rc[0]][rc[1]] = v;
      });
      var lines = cells.map(function (row) { return row.join(''); });
      var dup = list.some(function (w) { return lines.reduce(function (n, line) { return n + positions(line, w).length; }, 0) > 1; });
      if (!dup) break;
    }
    return { cells: cells, placed: placed };
  }
  // Le mot lu de (ligne, col1) à (ligne, col2), de gauche à droite.
  function readRun(g, ligne, c1, c2) {
    if (c2 < c1) { var t = c1; c1 = c2; c2 = t; }
    return g.cells[ligne].slice(c1, c2 + 1).join('');
  }
  function findPlaced(g, ligne, c1, c2) {
    var a = Math.min(c1, c2), b = Math.max(c1, c2);
    return g.placed.filter(function (p) { return p.ligne === ligne && p.col === a && p.col + p.mot.length - 1 === b; })[0] || null;
  }

  // Lecture flash « je retrouve » : l'élément montré et 3 leurres qui lui ressemblent.
  function flashChoices(item, n, rand) {
    var v = variants(item, (n || 4) - 1);
    return shuffle([item].concat(v), rand || Math.random);
  }

  var api = { seeded: seeded, shuffle: shuffle, variants: variants, candidates: candidates, plain: plain, grid: grid, readRun: readRun,
    findPlaced: findPlaced, flashChoices: flashChoices };
  root.School = root.School || {};
  root.School.lexique = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ---- store.js ----
// store.js — Où la progression est enregistrée.
//
// Version publique (« local ») : dans le navigateur (localStorage), rien n'est envoyé nulle part.
// Si le stockage est bloqué (navigation privée, réglages), on garde tout en mémoire le temps
// de la visite, et l'interface le signale.
//
// Version SophIA (« sophia ») : la progression est celle du compte. L'identité, le prénom et
// l'avatar viennent du profil SophIA (/api/store/profile) ; les fins d'activité partent vers
// /api/store/school/events. Chaque fin d'activité est d'abord gardée sur l'appareil, dans une
// file propre au compte, puis envoyée : une coupure du VPN ou une session expirée ne perd rien.
// Session expirée (oauth2-proxy répond 401 sur /oauth2/auth) : la page est rechargée, ce qui
// relance la connexion (silencieuse si la session Keycloak est encore ouverte), puis la file part.
(function (root) {
  'use strict';

  var KEY = 'sophia-school:v1';
  var EMPTY = function () { return { version: 1, profil: { pseudo: '', avatar: { type: 'dessin', id: 'renard' } }, events: [] }; };

  function valid(d) {
    return d && typeof d === 'object' && d.profil && typeof d.profil === 'object' && Array.isArray(d.events);
  }
  function safeStorage(env) {
    var storage = null;
    try { storage = (env || root).localStorage; } catch (e) { storage = null; }
    return storage || { getItem: function () { throw new Error('indisponible'); }, setItem: function () { throw new Error('indisponible'); }, removeItem: function () {} };
  }
  function newId(env) {
    var c = (env || root).crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var h = '0123456789abcdef', s = '';
    for (var i = 0; i < 36; i++) s += i === 8 || i === 13 || i === 18 || i === 23 ? '-' : i === 14 ? '4' : h[(Math.random() * 16) | 0];
    return s;
  }

  // ---------- Version publique ----------
  function localStore(storage) {
    var persistent = true, data = EMPTY();
    try {
      var raw = storage.getItem(KEY);
      if (raw) { var parsed = JSON.parse(raw); if (valid(parsed)) data = parsed; }
      storage.setItem(KEY + ':test', '1'); storage.removeItem(KEY + ':test');
    } catch (e) { persistent = false; }

    function save() {
      if (!persistent) return;
      try { storage.setItem(KEY, JSON.stringify(data)); } catch (e) { persistent = false; }
    }
    return {
      kind: 'local',
      get persistent() { return persistent; },
      ready: function () { return Promise.resolve(); },
      get: function () { return data; },
      addEvent: function (e) { data.events.push(Object.assign({ t: new Date().toISOString() }, e)); save(); },
      setProfil: function (p) { data.profil = Object.assign({}, data.profil, p); save(); return Promise.resolve(); },
      exportJSON: function () { return JSON.stringify(data, null, 2); },
      importJSON: function (text) {
        var d = JSON.parse(text);
        if (!valid(d)) throw new Error('Ce fichier ne contient pas de progression Sophia School.');
        data = d; save();
      },
      reset: function () { data = EMPTY(); save(); },
    };
  }

  // ---------- Version SophIA ----------
  // Avatar : « dessin:renard » ou photo (data URL) dans le profil ; { type, id | src } dans l'app.
  function avatarFromProfile(v) {
    if (typeof v === 'string' && v.indexOf('dessin:') === 0) return { type: 'dessin', id: v.slice(7) };
    if (typeof v === 'string' && v.indexOf('data:image/') === 0) return { type: 'photo', src: v };
    return { type: 'dessin', id: 'renard' };
  }
  function avatarToProfile(a) { return a && a.type === 'photo' ? a.src : 'dessin:' + ((a && a.id) || 'renard'); }

  function sophiaStore(env) {
    env = env || root;
    var storage = safeStorage(env), fetchFn = env.fetch.bind(env);
    var data = EMPTY(), owner = null, pending = [], timer = null, listeners = [], lastError = null;
    var RETRY_MS = 30000;
    var qkey = function () { return KEY + ':file:' + owner; };
    var opts = function (extra) { return Object.assign({ credentials: 'same-origin', redirect: 'manual', cache: 'no-store' }, extra || {}); };

    function readQueue() { try { var q = JSON.parse(storage.getItem(qkey()) || '[]'); return Array.isArray(q) ? q : []; } catch (e) { return []; } }
    function writeQueue() { try { if (pending.length) storage.setItem(qkey(), JSON.stringify(pending)); else storage.removeItem(qkey()); } catch (e) {} }
    function notify() { listeners.forEach(function (fn) { try { fn(); } catch (e) {} }); }

    // true seulement si oauth2-proxy dit 401/403 ; une erreur réseau (VPN coupé) ne conclut rien.
    function sessionExpired() {
      return fetchFn('/oauth2/auth', opts()).then(function (r) { return r.status === 401 || r.status === 403; }, function () { return false; });
    }
    function authProblem(r) { return r.type === 'opaqueredirect' || r.status === 401 || r.status === 0; }
    function api(path, init) {
      return fetchFn(path, opts(init)).then(function (r) {
        if (authProblem(r)) { var e = new Error('session'); e.session = true; throw e; }
        if (!r.ok) { var err = new Error('HTTP ' + r.status); err.status = r.status; throw err; }
        return r.json();
      });
    }
    // Rechargement pour se reconnecter, au plus 2 fois en 5 minutes : pas de boucle si le
    // serveur refuse l'identité pour une autre raison.
    function relogin() {
      var ss = null, now = Date.now(), list = [];
      try { ss = env.sessionStorage; list = JSON.parse(ss.getItem(KEY + ':reloads') || '[]').filter(function (t) { return now - t < 300000; }); } catch (e) { ss = null; }
      if (list.length >= 2) return false;
      try { if (ss) ss.setItem(KEY + ':reloads', JSON.stringify(list.concat(now))); } catch (e) {}
      writeQueue(); env.location.reload();
      return true;
    }
    function handleFailure(err) {
      lastError = err;
      return sessionExpired().then(function (expired) {
        if (!(expired && relogin())) schedule();
      }).then(function () { notify(); });
    }
    function schedule() { if (!timer) timer = env.setTimeout(function () { timer = null; flush(); }, RETRY_MS); }

    function flush() {
      if (!pending.length) return Promise.resolve();
      var batch = pending.slice(0, 200);
      return api('/api/store/school/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: batch }) })
        .then(function () {
          var sent = {}; batch.forEach(function (e) { sent[e.id] = true; });
          pending = pending.filter(function (e) { return !sent[e.id]; });
          writeQueue(); lastError = null; notify();
          return pending.length ? flush() : null;
        }, function (err) {
          // 400 : événement refusé par le serveur ; on ne le renverra pas en boucle.
          if (err && err.status === 400) { pending = pending.filter(function (e) { return batch.indexOf(e) === -1; }); writeQueue(); return; }
          return handleFailure(err);
        });
    }

    var store = {
      kind: 'sophia',
      persistent: true,
      get owner() { return owner; },
      get pendingCount() { return pending.length; },
      get lastError() { return lastError; },
      onChange: function (fn) { listeners.push(fn); },
      ready: function () {
        return api('/api/store/profile').then(function (p) {
          owner = p.owner;
          data.profil = { pseudo: p.first_name || p.owner, avatar: avatarFromProfile(p.avatar), role: p.role };
          pending = readQueue();
          return api('/api/store/school/events');
        }).then(function (events) {
          var known = {}; events.forEach(function (e) { known[e.id] = true; });
          pending = pending.filter(function (e) { return !known[e.id]; });
          data.events = events.concat(pending);
          if (env.addEventListener) env.addEventListener('online', function () { flush(); });
          return flush();
        }).catch(function (err) {
          return sessionExpired().then(function (expired) {
            if (expired && relogin()) return new Promise(function () {});
            throw new Error('Le serveur de l’école ne répond pas. Vérifie que le VPN est actif, puis recharge la page.');
          });
        });
      },
      get: function () { return data; },
      addEvent: function (e) {
        var ev = Object.assign({ id: newId(env), t: new Date().toISOString() }, e);
        data.events.push(ev); pending.push(ev); writeQueue(); flush();
      },
      setProfil: function (p) {
        if (!p.avatar) return Promise.resolve();
        var before = data.profil.avatar;
        data.profil = Object.assign({}, data.profil, { avatar: p.avatar });
        return api('/api/store/profile', { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ avatar: avatarToProfile(p.avatar) }) })
          .catch(function (err) { data.profil.avatar = before; throw new Error('Avatar non enregistré : ' + (err.status === 400 ? 'image refusée.' : 'serveur injoignable.')); });
      },
      livrets: function () { return api('/api/store/school/livrets'); },
      livret: function (o) { return api('/api/store/school/livrets/' + encodeURIComponent(o)); },
      // Carnet de notes : réactions de Sophia déjà reçues, et réaction à une note. La note doit
      // d'abord être arrivée au serveur (il construit lui-même le message à partir du journal).
      reactions: function () { return api('/api/store/school/reactions'); },
      classes: function () { return api('/api/store/school/classes'); },
      // Fiche de lecture : photos (recto, verso) gardées ; le modèle local recopie les rubriques.
      // Réponse { photos: [id…], champs: { titre, auteur… } }.
      lecture: function (images) { return api('/api/store/school/lecture', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ images: images }) }); },
      // « Demander à Sophia » : un indice pour l'endroit où l'enfant bloque (voir aide.js).
      aide: function (body) { return api('/api/store/school/aide', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); },
      photoUrl: function (id) { return '/api/store/school/ardoise/' + encodeURIComponent(id); },
      // Parent : correction d'une dictée sur l'ardoise, ajoutée au journal de l'enfant.
      corriger: function (owner, e) {
        var ev = Object.assign({ id: newId(env), t: new Date().toISOString() }, e);
        return api('/api/store/school/livrets/' + encodeURIComponent(owner) + '/events', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ events: [ev] }) }).then(function () { return ev; });
      },
      // Dictée sur l'ardoise : le modèle local recopie les n mots écrits sur la photo, dans l'ordre
      // (il ne connaît pas les mots attendus) ; le serveur garde la photo. Réponse { lus: [...], photo: id }.
      ardoise: function (image, n) { return api('/api/store/school/ardoise', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ image: image, mots: n }) }); },
      reaction: function (noteId) {
        return flush().then(function () {
          if (pending.some(function (e) { return e.note_id === noteId; })) throw new Error('note pas encore envoyée');
          return api('/api/v1/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Sophia-School-Reaction': noteId }, body: '{}' });
        });
      },
      _flush: flush,
    };
    return store;
  }

  function create(env, variante) {
    if ((variante || (root.SCHOOL_DATA && root.SCHOOL_DATA.variante)) === 'sophia') return sophiaStore(env);
    return localStore(safeStorage(env));
  }

  var api = { create: create, KEY: KEY, avatarFromProfile: avatarFromProfile, avatarToProfile: avatarToProfile };
  root.School = root.School || {};
  root.School.store = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);

// ---- ui.js ----
// ui.js — Outils d'affichage communs : fenêtre, message, lecture à voix haute, petits dessins.
(function (root) {
  'use strict';
  var INK = '#2a2240';
  var School = root.School = root.School || {};
  var $ = function (id) { return document.getElementById(id); };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };

  // --- Fenêtre ---
  var lastFocus = null, onClose = null;
  function openWin(title, html, opts) {
    lastFocus = document.activeElement;
    onClose = opts && opts.onClose || null;
    $('win-title').textContent = title;
    $('win-body').innerHTML = html;
    $('veil').hidden = false;
    $('win-body').scrollTop = 0;
    $('win-close').focus();
  }
  function closeWin() {
    if ($('veil').hidden) return;
    $('veil').hidden = true;
    stopSpeaking();
    var cb = onClose; onClose = null;
    if (cb) cb();
    if (lastFocus && lastFocus.focus && document.contains(lastFocus)) lastFocus.focus();
  }
  function bindWin() {
    $('win-close').addEventListener('click', closeWin);
    $('veil').addEventListener('click', function (e) { if (e.target === $('veil')) closeWin(); });
  }

  // --- Message bref ---
  var toastTimer;
  function toast(msg) {
    var t = $('toast'); t.textContent = msg; t.hidden = false;
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { t.hidden = true; }, 2800);
  }

  // --- Voix ---
  // Version SophIA : la voix de Sophia (/api/v1/audio/speech, même site, modèle sophia-tts).
  // Sinon, ou si elle ne répond pas : une voix française de l'appareil.
  function frenchVoice() {
    if (!('speechSynthesis' in root)) return null;
    var voices = root.speechSynthesis.getVoices().filter(function (v) { return /^fr/i.test(v.lang); });
    return voices.filter(function (v) { return v.localService; })[0] || null;
  }
  function canSpeak() { return !!frenchVoice(); }
  // Jamais d'exception : une voix qui refuse de parler rend « false », l'exercice continue.
  function speak(text) {
    try {
      var v = frenchVoice(); if (!v) return false;
      root.speechSynthesis.cancel();
      var u = new SpeechSynthesisUtterance(text); u.lang = v.lang; u.rate = 0.95;
      try { u.voice = v; } catch (e) { /* voix non affectable : la langue suffit */ }
      root.speechSynthesis.speak(u);
      return true;
    } catch (e) { return false; }
  }
  function sophiaVoice() { return !!(root.SCHOOL_DATA && root.SCHOOL_DATA.variante === 'sophia'); }
  function canSay() { return sophiaVoice() || canSpeak(); }
  var audioCache = {}, playing = null, turn = 0;
  function fetchAudio(text) {
    if (audioCache[text]) return audioCache[text];
    audioCache[text] = fetch('/api/v1/audio/speech', {
      method: 'POST', credentials: 'same-origin', redirect: 'manual', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'sophia-tts', input: text, voice: 'default', response_format: 'wav' }),
    }).then(function (r) { if (!r.ok) throw new Error('voix ' + r.status); return r.blob(); })
      .then(function (b) { return URL.createObjectURL(b); })
      .catch(function (e) { delete audioCache[text]; throw e; });
    return audioCache[text];
  }
  // Joue un texte ; la promesse se résout à la fin de la lecture (ou à l'arrêt).
  function playSophia(text, t) {
    return fetchAudio(text).then(function (u) {
      if (t !== turn) return;
      return new Promise(function (ok, ko) {
        var a = playing = new Audio(u);
        a.onended = a.onpause = function () { ok(); };
        a.onerror = function () { ko(new Error('lecture impossible')); };
        a.play().catch(ko);
      });
    });
  }
  function say(text) {
    stopSpeaking();
    var t = turn;
    if (sophiaVoice()) return playSophia(text, t).catch(function () { if (!speak(text)) throw new Error('voix indisponible'); });
    return speak(text) ? Promise.resolve() : Promise.reject(new Error('voix indisponible'));
  }
  // Texte long (leçon) : lu morceau par morceau, le suivant préparé pendant la lecture.
  function chunks(text) {
    var out = [];
    String(text).split(/\n+/).map(function (p) { return p.trim(); }).filter(Boolean).forEach(function (p) {
      while (p.length > 280) {
        var cut = Math.max(p.lastIndexOf('. ', 280), p.lastIndexOf(' ; ', 280), p.lastIndexOf(', ', 280));
        if (cut < 80) cut = p.lastIndexOf(' ', 280);
        if (cut < 1) cut = 280;
        out.push(p.slice(0, cut + 1).trim()); p = p.slice(cut + 1).trim();
      }
      if (p) out.push(p);
    });
    return out;
  }
  function sayAll(text) {
    if (!sophiaVoice()) return speak(text) ? Promise.resolve() : Promise.reject(new Error('voix indisponible'));
    stopSpeaking();
    var t = turn, parts = chunks(text), i = 0;
    function next() {
      if (t !== turn || i >= parts.length) return Promise.resolve();
      var part = parts[i++];
      if (parts[i]) fetchAudio(parts[i]).catch(function () {});
      return playSophia(part, t).then(next);
    }
    return next().catch(function (e) {
      if (t !== turn) return;
      // Voix de Sophia indisponible : la voix de l'appareil lit la suite.
      if (!speak(parts.slice(i - 1).join(' '))) throw e;
    });
  }
  // Enregistrements (leçon lue par la voix de Sophia, fichiers du paquet) : joués à la suite,
  // le suivant chargé pendant la lecture ; même arrêt que la voix (stopSpeaking).
  function playList(files) {
    stopSpeaking();
    var t = turn, i = 0;
    function next() {
      if (t !== turn || i >= files.length) return Promise.resolve();
      var a = playing = new Audio(files[i++]);
      if (files[i]) { var pre = new Audio(); pre.preload = 'auto'; pre.src = files[i]; }
      return new Promise(function (ok, ko) {
        a.onended = function () { ok(); };
        a.onpause = function () { if (t !== turn) ok(); };
        a.onerror = function () { ko(new Error('lecture impossible')); };
        a.play().catch(ko);
      }).then(next);
    }
    return next();
  }
  // Prépare un texte à l'avance (mot suivant de la dictée) ; sans effet hors version SophIA.
  function prepare(text) { if (sophiaVoice()) fetchAudio(text).catch(function () {}); }
  function speaking() { return !!(playing && !playing.paused) || !!(root.speechSynthesis && root.speechSynthesis.speaking); }
  function stopSpeaking() {
    turn++;
    try { if (playing) { playing.pause(); playing = null; } } catch (e) {}
    try { if ('speechSynthesis' in root) root.speechSynthesis.cancel(); } catch (e) {}
  }

  // --- Dessins ---
  function star(x, y, on, r) {
    r = r || 16; var p = '';
    for (var i = 0; i < 10; i++) { var a = -Math.PI / 2 + i * Math.PI / 5, rr = i % 2 ? r * 0.45 : r; p += (i ? 'L' : 'M') + (x + rr * Math.cos(a)).toFixed(1) + ' ' + (y + rr * Math.sin(a)).toFixed(1); }
    return '<path d="' + p + 'Z" fill="' + (on ? '#ffc04d' : '#ffffff') + '" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round"/>';
  }
  function lock(x, y, s) {
    return '<g class="lock" transform="translate(' + x + ' ' + y + ') scale(' + (s || 1) + ')" stroke="' + INK + '" stroke-width="5">' +
      '<path d="M-18 0 V-14 A18 18 0 0 1 18 -14 V0" fill="none"/><rect x="-28" y="-2" width="56" height="44" rx="8" fill="#ffc04d"/>' +
      '<circle cx="0" cy="16" r="5" fill="' + INK + '"/><path d="M0 18 V30"/></g>';
  }
  function medal(color) {
    return '<svg viewBox="0 0 80 80" aria-hidden="true"><path d="M26 4 L36 30 L44 30 L54 4 Z" fill="#ff8fbf" stroke="' + INK + '" stroke-width="3" stroke-linejoin="round"/>' +
      '<circle cx="40" cy="48" r="26" fill="' + (color || '#ffc04d') + '" stroke="' + INK + '" stroke-width="3.5"/>' +
      '<circle cx="40" cy="48" r="19" fill="none" stroke="' + INK + '" stroke-width="2" stroke-dasharray="3 4"/>' +
      '<path d="M40 34 L44 44 L55 44 L46 51 L49 62 L40 55 L31 62 L34 51 L25 44 L36 44 Z" fill="#fff" stroke="' + INK + '" stroke-width="2" stroke-linejoin="round"/></svg>';
  }
  // Avatars dessinés : app/avatars/*.svg, intégrés par la construction (aussi servis en fichiers pour le chat).
  var AVATARS = {}, AVATAR_NAMES = {};
  ((root.SCHOOL_DATA && root.SCHOOL_DATA.avatars) || []).forEach(function (a) { AVATARS[a.id] = a.svg; AVATAR_NAMES[a.id] = a.nom; });
  function avatarHTML(av) {
    if (av && av.type === 'photo' && /^data:image\/(jpeg|png|webp);base64,/.test(av.src || '')) return '<img src="' + av.src + '" alt="">';
    return AVATARS[(av && av.id) || 'renard'] || AVATARS.renard || '';
  }
  // Photo choisie par l'élève : recadrée en carré, réduite à 160 px, jamais envoyée.
  function photoToAvatar(file, cb) {
    var r = new FileReader();
    r.onload = function () {
      var img = new Image();
      img.onload = function () {
        var c = document.createElement('canvas'), n = 160, s = Math.min(img.width, img.height);
        c.width = c.height = n;
        c.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, n, n);
        cb(null, { type: 'photo', src: c.toDataURL('image/jpeg', 0.85) });
      };
      img.onerror = function () { cb(new Error('Cette image ne peut pas être lue.')); };
      img.src = r.result;
    };
    r.onerror = function () { cb(new Error('Cette image ne peut pas être lue.')); };
    r.readAsDataURL(file);
  }
  function fill(tpl, vars) { return String(tpl || '').replace(/\{(\w+)\}/g, function (m, k) { return vars[k] != null ? vars[k] : m; }); }

  School.ui = { $: $, esc: esc, openWin: openWin, closeWin: closeWin, bindWin: bindWin, toast: toast, canSpeak: canSpeak, speak: speak, canSay: canSay, say: say, sayAll: sayAll, playList: playList, prepare: prepare, speaking: speaking, chunks: chunks,
    stopSpeaking: stopSpeaking, star: star, lock: lock, medal: medal, AVATARS: AVATARS, AVATAR_NAMES: AVATAR_NAMES, avatarHTML: avatarHTML,
    photoToAvatar: photoToAvatar, fill: fill, INK: INK };
})(window);

// ---- aide.js ----
// aide.js — « Demander à Sophia » (version SophIA) : un bouton sous la question ; l'API
// (/api/store/school/aide) répond par un indice, jamais par la réponse (contrôle côté serveur :
// si le modèle la donne, l'indice vient du contenu de l'école). On envoie seulement des
// identifiants : l'activité, l'endroit où l'enfant bloque (« question:2 », « calcul:7x8 »,
// « mot:3 », « tp:defi ») et ses essais.
(function (root) {
  'use strict';
  var School = root.School, ui = School.ui, $ = ui.$, esc = ui.esc;

  function available() { return !!(School.app && School.app.store && typeof School.app.store.aide === 'function'); }
  function html() {
    return available() ? '<div class="row"><button class="btn alt" id="aide-btn">Demander à Sophia</button></div><div id="aide-fb" aria-live="polite"></div>' : '';
  }
  // element, essais : fonctions appelées au clic (l'état a pu changer depuis l'affichage).
  function bind(a, element, essais) {
    var b = $('aide-btn');
    if (!b) return;
    b.addEventListener('click', function () {
      var body = { activite: a.id }, el = element && element(), tries = essais && essais();
      if (el) body.element = el;
      if (tries && tries.length) body.essais = tries.slice(-5).map(function (t) { return String(t).slice(0, 60); });
      b.disabled = true;
      $('aide-fb').innerHTML = '<div class="callout">Sophia réfléchit…</div>';
      School.app.store.aide(body).then(function (r) {
        $('aide-fb').innerHTML = '<div class="callout sophia"><b>Sophia :</b> ' + esc(r && r.indice || 'Relis la leçon, tu vas trouver.') + '</div>';
      }, function (e) {
        $('aide-fb').innerHTML = '<div class="callout">' + (e && e.status === 429 ? 'Tu as déjà demandé beaucoup d\'aide : essaie d\'abord sans aide, puis redemande plus tard.' : 'Sophia ne peut pas t\'aider pour l\'instant. Relis la leçon, puis réessaie.') + '</div>';
      }).then(function () { b.disabled = false; });
    });
  }

  School.aide = { html: html, bind: bind, available: available };
})(window);

// ---- activities.js ----
// activities.js — Classeurs et activités : leçon, TP (énigme → badge), défi.
(function (root) {
  'use strict';
  var School = root.School, ui = School.ui, $ = ui.$, esc = ui.esc;
  var D = root.SCHOOL_DATA;
  var ICON = {
    lecon: '<svg viewBox="0 0 40 40" width="30" aria-hidden="true"><path d="M6 8 Q14 5 20 9 Q26 5 34 8 V32 Q26 29 20 33 Q14 29 6 32Z" fill="#fff" stroke="#2a2240" stroke-width="2.5" stroke-linejoin="round"/><path d="M20 9 V33" stroke="#2a2240" stroke-width="2.5"/></svg>',
    tp: '<svg viewBox="-40 -48 80 90" width="30" aria-hidden="true"><g stroke="#2a2240" stroke-width="5" stroke-linejoin="round"><path d="M-12 -40 H12 M-8 -40 V-14 L-30 28 Q-32 36 -22 36 H22 Q32 36 30 28 L8 -14 V-40" fill="#fff"/><path d="M-22 14 H22 L30 28 Q32 36 22 36 H-22 Q-32 36 -30 28Z" fill="#ff8fbf"/></g></svg>',
    defi: '<svg viewBox="0 0 40 40" width="30" aria-hidden="true">' + ui.star(20, 21, true, 16) + '</svg>',
    video: '<svg viewBox="0 0 40 40" width="30" aria-hidden="true"><rect x="4" y="9" width="32" height="22" rx="6" fill="#fff" stroke="#2a2240" stroke-width="2.5"/><path d="M17 15 L26 20 L17 25Z" fill="#2a2240"/></svg>',
  };
  var BG = { lecon: '#e3f0ff', tp: '#fff0cc', simulation: '#e5f8f1', defi: '#ffe0ef', video: '#d5f5ea', lien: '#d5f5ea',
    table: '#e3f0ff', entrainement: '#fff0cc', evaluation: '#ffe0ef', motsmeles: '#e5f8f1', dictee: '#ffe0ef', flash: '#fff0cc', fiche: '#fff0cc', clique: '#fff0cc', complete: '#e5f8f1', ardoise: '#e3f0ff', lecture: '#e3f0ff', histoire: '#fff0cc', galerie: '#e5f8f1' };
  var LETTERS = function (t, bg) { return '<svg viewBox="0 0 40 40" width="30" aria-hidden="true"><rect x="5" y="7" width="30" height="26" rx="6" fill="' + bg + '" stroke="#2a2240" stroke-width="2.5"/><text x="20" y="26" text-anchor="middle" font-size="13" font-weight="800" fill="#2a2240" font-family="sans-serif">' + t + '</text></svg>'; };
  ICON.lien = '<svg viewBox="0 0 40 40" width="30" aria-hidden="true"><circle cx="20" cy="20" r="14" fill="#fff" stroke="#2a2240" stroke-width="2.5"/><path d="M6 20 H34 M20 6 Q11 20 20 34 Q29 20 20 6" stroke="#2a2240" stroke-width="2" fill="none"/></svg>';
  ICON.fiche = ICON.evaluation; ICON.lecture = ICON.lecon; ICON.histoire = LETTERS('7×9', '#fff08a'); ICON.galerie = LETTERS('0-9', '#fff');
  ICON.motsmeles = LETTERS('ABC', '#fff'); ICON.clique = LETTERS('Le', '#fff08a'); ICON.complete = LETTERS('a_', '#fff'); ICON.ardoise = LETTERS('abc', '#2f5d50').replace('fill="#2a2240" font-family', 'fill="#fff" font-family'); ICON.dictee = LETTERS('Aa', '#fff'); ICON.flash = LETTERS('ba', '#fff08a');
  ICON.table = '<svg viewBox="0 0 40 40" width="30" aria-hidden="true"><g stroke="#2a2240" stroke-width="2">' +
    [0, 1, 2].map(function (r) { return [0, 1, 2].map(function (c) { return '<rect x="' + (6 + c * 10) + '" y="' + (6 + r * 10) + '" width="9" height="9" fill="' + ['#ff8fbf', '#ffc04d', '#8fd2ff', '#c6f0d9', '#d9ccff'][(r + c) % 5] + '"/>'; }).join(''); }).join('') + '</g></svg>';
  ICON.entrainement = '<svg viewBox="0 0 40 40" width="30" aria-hidden="true"><circle cx="20" cy="22" r="13" fill="#fff" stroke="#2a2240" stroke-width="2.5"/><path d="M20 22 V13 M20 22 L27 26 M16 5 H24" stroke="#2a2240" stroke-width="2.5" stroke-linecap="round"/></svg>';
  ICON.evaluation = '<svg viewBox="0 0 40 40" width="30" aria-hidden="true"><rect x="8" y="5" width="24" height="30" rx="3" fill="#fff" stroke="#2a2240" stroke-width="2.5"/><path d="M13 14 L16 17 L21 11 M13 25 H27" stroke="#2a2240" stroke-width="2.5" fill="none" stroke-linecap="round"/></svg>';

  var TYPE_NAMES = { video: 'Vidéo', lien: 'Site', fiche: 'Fiche d\'exercices', motsmeles: 'Mots mêlés', dictee: 'Orthographe à l\'oreille', flash: 'Lecture flash', clique: 'Clique sur le mot', complete: 'Je complète', ardoise: 'Dictée sur l\'ardoise', lecture: 'Fiche de lecture', histoire: 'Histoire des Multimalins', galerie: 'Les personnages', evaluation: 'Évaluation', entrainement: 'Entraînement' };
  var LOCK = ui.lock(20, 20, 0.5).replace('<g', '<svg viewBox="0 0 40 40" width="30"><g').replace(/<\/g>$/, '</g></svg>');
  function openBinder(route, classeur) {
    var cl = School.app.classeursOf(route.matiere)[classeur], P = School.app.progress();
    var acts = School.app.model.classeurActivities(route.matiere, route.niveau, route.theme, cl);
    var th = School.app.model.theme(route.matiere, route.niveau, route.theme);
    var M = School.app.model, bonusOpen = M.bonusOpen(route.matiere, route.niveau, route.theme);
    ui.openWin('Classeur ' + cl.nom, '<p><span class="tag">' + esc(th.nom) + '</span></p><div class="list">' + acts.map(function (a) {
      var done = !!P.done[a.id], bonus = M.isBonus(a), locked = bonus && !bonusOpen, wait = M.activityLock(a);
      var tag = a.expert ? 'TP expert : ' : 'Bonus : ';
      if (wait) return '<div class="item off" aria-disabled="true"><span class="ic">' + LOCK + '</span><span><strong>' + esc(a.titre) + '</strong><small>' + esc(wait) + '</small></span><span class="st todo">Fermé</span></div>';
      if (locked) return '<div class="item off" aria-disabled="true"><span class="ic">' + LOCK + '</span><span><strong>' + tag + esc(a.titre) + '</strong><small>Facultatif. S\'ouvre quand tu as fait tout le reste du thème.' + (a.expert ? ' Matériel spécifique : ' + esc(a.expert) : '') + '</small></span><span class="st todo">' + (a.expert ? 'Expert' : 'Bonus') + '</span></div>';
      var plus = M.plusOf(a);
      return '<button class="item' + (plus ? ' plus' : '') + '" data-act="' + esc(a.id) + '"><span class="ic" style="background:' + (BG[a.type] || '#efe8fb') + '">' + (ICON[a.type] || ICON.lecon) + '</span>' +
        '<span><strong>' + (plus ? '<span class="tag plus">' + esc(plus) + '</span> ' : '') + (bonus ? (a.expert ? '★ TP expert : ' : '★ Bonus : ') : '') + esc(a.titre) + '</strong><small>' + (plus ? 'Notion de ' + esc(plus) + ', plus difficile · facultatif · ' : '') + (a.expert ? 'Matériel spécifique : ' + esc(a.expert) + ' · ' : '') + esc([TYPE_NAMES[a.type], a.duree, a.securite && a.securite.adulte ? 'avec un adulte' : ''].filter(Boolean).join(' · ')) + '</small>' +
        '<small class="src">' + esc(a.source + ' · ' + a.licence) + '</small></span><span class="st ' + (done ? 'done' : 'todo') + '">' + (done ? 'Fait' : 'À faire') + '</span></button>';
    }).join('') + '</div>');
    $('win-body').querySelectorAll('[data-act]').forEach(function (b) { b.addEventListener('click', function () { open(b.getAttribute('data-act')); }); });
  }

  function open(id) {
    var a = D.activites[id];
    if (!a) return;
    var wait = School.app.model.activityLock(a);
    if (wait) return ui.toast(wait);
    if (a.type === 'lecon') return lecon(a);
    if (a.type === 'video' || a.type === 'lien') return lien(a);
    if (a.type === 'tp') return tp(a);
    if (a.type === 'defi') return defi(a);
    if (a.type === 'fiche') return fiche(a);
    // Moteurs des autres matières (maths.js, mots.js…) : School.engines[type](activité, outils)
    if (School.engines && School.engines[a.type]) return School.engines[a.type](a, { badgesHTML: badgesHTML, close: closeAndRefresh });
    ui.toast('Cette activité arrive bientôt.');
  }
  function closeAndRefresh() { ui.closeWin(); School.app.render(); }
  function badgesHTML(list) {
    return list.map(function (b) {
      return '<div class="badge-win"><div class="medal">' + ui.medal(b.couleur) + '</div><b class="badge-name">Badge « ' + esc(b.nom) + ' »</b></div>';
    }).join('');
  }

  // ---------- Leçon ----------
  function lecon(a) {
    var recorded = !!(a.voix && a.voix.length);
    var listen = recorded || ui.canSay() ? '<button class="btn alt" id="listen">Écouter la leçon</button>' : '';
    ui.openWin(a.titre, '<div class="row"><span class="tag">Leçon</span>' + listen + '</div><div class="lesson">' + a.html + '</div>' +
      '<p class="src">' + esc(a.source + ' · ' + a.licence) + (a.programme ? ' · ' + esc(a.programme) : '') + '</p>' +
      '<div class="row"><button class="btn" id="lu">J\'ai lu la leçon</button></div><div id="after"></div>');
    var l = $('listen');
    // Même bouton pour lancer et arrêter ; la voix est celle de Sophia dans la version SophIA.
    if (l) l.addEventListener('click', function () {
      if (l.dataset.on) { ui.stopSpeaking(); return; }
      l.dataset.on = '1'; l.textContent = 'Arrêter la lecture';
      var done = function () { delete l.dataset.on; l.textContent = 'Écouter la leçon'; };
      // Leçon enregistrée avec la voix de Sophia : les fichiers ; sinon la voix de Sophia en direct
      // (version SophIA) ou celle de l'appareil.
      (recorded ? ui.playList(a.voix) : ui.sayAll($('win-body').querySelector('.lesson').innerText))
        .then(done, function () { done(); ui.toast('La voix ne répond pas. Réessaie dans un instant.'); });
    });
    $('lu').addEventListener('click', function () {
      var first = !School.app.progress().done[a.id];
      var won = first ? School.app.record({ type: 'lecon_lue', activite: a.id }) : [];
      ui.stopSpeaking();
      $('lu').disabled = true;
      $('after').innerHTML = '<div class="callout safe">' + (first ? 'Leçon notée dans ton carnet, +10 points.' : 'Déjà notée dans ton carnet.') + '</div>' + badgesHTML(won) +
        '<div class="row"><button class="btn alt" id="close">Retour à la paillasse</button></div>';
      $('close').addEventListener('click', closeAndRefresh);
    });
  }

  // ---------- TP ----------
  var STEPS = ['Énigme', 'Prédiction', 'Expérience', 'Observation', 'Défi', 'Conclusion'];
  function tp(a) {
    var st = { step: 0, prediction: null, observation: null, essais: 0 };
    function choices(name, list, picked) {
      return '<div class="opts">' + list.map(function (c, i) {
        return '<label><input type="radio" name="' + name + '" id="' + name + '-' + i + '" value="' + i + '"' + (picked === i ? ' checked' : '') + '> ' + esc(c) + '</label>';
      }).join('') + '</div>';
    }
    function picked(name) { var v = document.querySelector('input[name="' + name + '"]:checked'); return v ? +v.value : null; }
    function draw() {
      var s = st.step, h = '<div class="steps">' + STEPS.map(function (n, i) { return '<span class="' + (i === s ? 'on' : i < s ? 'ok' : '') + '">' + (i + 1) + '. ' + n + '</span>'; }).join('') + '</div>';
      if (s === 0) h += '<div class="callout"><b>L\'énigme</b><br>' + a.enigme + '</div><div class="row"><button class="btn" id="next">J\'enquête !</button></div>';
      if (s === 1) h += '<p>' + esc(a.prediction.question) + ' Elle sera notée dans ton carnet de labo.</p>' + choices('pred', a.prediction.choix, st.prediction) +
        '<div class="row"><button class="btn" id="next">Je valide ma prédiction</button></div>';
      if (s === 2) {
        var sec = a.securite || {};
        h += '<div class="callout ' + (sec.adulte ? '' : 'safe') + '"><b>' + (sec.adulte ? 'Avec un adulte' : 'Sans danger') + '</b> · ' + esc(sec.note || '') + '</div>' +
          '<p><b>Matériel</b> : ' + esc(a.experience.materiel.join(', ')) + '.</p><ol class="how">' + a.experience.etapes.map(function (e) { return '<li>' + esc(e) + '</li>'; }).join('') + '</ol>' +
          '<div class="row"><button class="btn" id="next">J\'ai fait l\'expérience</button><button class="btn alt" id="later">Je la fais plus tard</button></div>';
      }
      if (s === 3) h += '<p>' + esc(a.observation.question) + '</p>' + choices('obs', a.observation.choix, st.observation) +
        '<div class="row"><button class="btn" id="next">Je note mon observation</button></div><div id="fb"></div>';
      if (s === 4) h += '<div class="callout"><b>Défi</b><br>' + esc(a.defi.question) + '</div>' + choices('ans', a.defi.choix, null) +
        '<div class="row"><button class="btn" id="next">Je réponds</button></div><div id="fb"></div>';
      if (s === 5) h += '<div class="lesson">' + a.conclusion + '</div><div id="after"></div>';
      var where = { 1: 'tp:prediction', 3: 'tp:observation', 4: 'tp:defi' }[s];
      ui.openWin('TP · ' + a.titre, h + (where ? School.aide.html() : ''));
      if (where) School.aide.bind(a, function () { return where; });
      bind();
    }
    function bind() {
      var n = $('next'), later = $('later');
      if (later) later.addEventListener('click', function () { ui.closeWin(); ui.toast('Reviens quand tu auras fait l’expérience !'); });
      if (!n) return finish();
      n.addEventListener('click', function () {
        if (st.step === 1) { st.prediction = picked('pred'); if (st.prediction == null) return ui.toast('Choisis une prédiction.'); }
        if (st.step === 3) {
          var o = picked('obs'); if (o == null) return ui.toast('Choisis ce que tu as observé.');
          if (a.observation.attendu != null && o !== a.observation.attendu && st.observation !== o) {
            st.observation = o;
            $('fb').innerHTML = '<div class="callout">' + a.observation.si_different + '</div><div class="row"><button class="btn alt" id="anyway">Je continue quand même</button></div>';
            $('anyway').addEventListener('click', function () { st.step++; draw(); });
            return;
          }
          st.observation = o;
        }
        if (st.step === 4) {
          var c = picked('ans'); if (c == null) return ui.toast('Choisis une réponse.');
          st.essais++;
          var res = School.progress.checkAnswer(a.defi, c, st.essais);
          if (!res.fini) { $('fb').innerHTML = '<div class="callout">Pas encore ! ' + a.defi.indice + '</div>'; return; }
          $('fb').innerHTML = '<div class="callout ' + (res.ok ? 'safe' : '') + '">' + (res.ok ? '<b>Bravo !</b> ' : '<b>La réponse :</b> ') + a.defi.explication + '</div><div class="row"><button class="btn" id="go">Voir la conclusion</button></div>';
          n.disabled = true;
          $('go').addEventListener('click', function () { st.step++; draw(); });
          return;
        }
        st.step++; draw();
      });
    }
    function finish() {
      var first = !School.app.progress().done[a.id];
      var won = School.app.record({ type: 'tp_termine', activite: a.id, prediction: st.prediction, observation: st.observation });
      $('after').innerHTML = '<div class="callout safe">' + (first ? 'TP noté dans ton carnet, +60 points.' : 'TP refait : bravo pour l\'entraînement !') + '</div>' + badgesHTML(won) +
        '<div class="row"><button class="btn" id="close">Retour à la paillasse</button></div>';
      $('close').addEventListener('click', closeAndRefresh);
    }
    draw();
  }

  // ---------- Fiche d'exercices (énoncé PDF, corrigé, auto-évaluation) ----------
  // Fiche « externe » (version de partage) : énoncé et corrigé restent sur leur site d'origine.
  function fiche(a) {
    var site = a.externe ? ' sur ' + esc(String(a.enonce).replace(/^https:\/\/(www\.)?([^\/]+).*$/, '$2')) : '';
    ui.openWin(a.titre, '<div class="row"><span class="tag">Fiche d\'exercices</span></div>' +
      '<ol class="how"><li>Ouvre l\'énoncé et fais les exercices sur ton cahier.</li><li>Puis regarde la correction, et note-toi honnêtement.</li></ol>' +
      '<div class="row"><a class="btn" href="' + esc(a.enonce) + '" target="_blank" rel="noopener' + (a.externe ? ' noreferrer' : '') + '">Ouvrir l\'énoncé' + site + '</a>' +
      (a.externe ? '<a class="btn alt" id="corr" href="' + esc(a.corrige) + '" target="_blank" rel="noopener noreferrer">J\'ai fini : voir la correction' + site + '</a>'
        : '<button class="btn alt" id="corr">J\'ai fini : voir la correction</button>') + '</div><div id="after"></div>' +
      '<p class="src">' + esc(a.source + ' · ' + a.licence) + (a.externe ? ' · s\'ouvre dans un nouvel onglet' : '') + '</p>');
    $('corr').addEventListener('click', function () {
      if (!a.externe) $('corr').disabled = true;
      $('after').innerHTML = (a.externe ? '<p>La correction s\'est ouverte dans un nouvel onglet. Compare avec ton cahier.</p>' : '<h3 class="h3">La correction</h3><div class="lesson corrige">' + a.html + '</div>') +
        '<p><b>Comment ça s\'est passé ?</b></p><div class="row"><button class="btn" data-note="1">Tout juste ou presque</button>' +
        '<button class="btn alt" data-note="0.5">À moitié</button><button class="btn alt" data-note="0">À revoir</button></div><div id="won"></div>';
      $('after').querySelectorAll('[data-note]').forEach(function (b) {
        b.addEventListener('click', function () {
          var score = +b.getAttribute('data-note');
          var won = School.app.record({ type: 'defi_termine', activite: a.id, score: score, resultats: [{ ok: score === 1, premier: score === 1, essais: 1 }] });
          $('after').querySelectorAll('[data-note]').forEach(function (x) { x.disabled = true; });
          $('won').innerHTML = '<div class="callout safe">' + (score === 1 ? 'Bravo !' : score ? 'Bien, relis ce qui coince.' : 'Relis la leçon, et retente la fiche plus tard.') + '</div>' + badgesHTML(won) +
            '<div class="row"><button class="btn alt" id="close">Retour</button></div>';
          $('close').addEventListener('click', closeAndRefresh);
        });
      });
    });
  }

  // ---------- Vidéo, site ----------
  // Rien n'est intégré à l'école : la vidéo (lecteur YouTube sans cookie) ou le site s'ouvrent
  // dans un nouvel onglet ; l'enfant revient dire qu'il a regardé.
  function lien(a) {
    var video = a.type === 'video';
    ui.openWin(a.titre, '<div class="row"><span class="tag">' + (video ? 'Vidéo' : 'Site') + '</span>' + (a.duree ? '<span class="src">' + esc(a.duree) + '</span>' : '') + '</div>' +
      (a.resume ? '<p>' + esc(a.resume) + '</p>' : '') +
      '<div class="row"><a class="btn" id="go-out" href="' + esc(a.url) + '" target="_blank" rel="noopener noreferrer">' + (video ? 'Regarder la vidéo' : 'Ouvrir le site') + '</a>' +
      '<button class="btn alt" id="seen">' + (video ? 'J\'ai regardé' : 'J\'ai fini') + '</button></div><div id="after"></div>' +
      '<p class="src">' + esc(a.source + ' · ' + a.licence) + ' · s\'ouvre dans un nouvel onglet</p>');
    $('seen').addEventListener('click', function () {
      var first = !School.app.progress().done[a.id];
      var won = first ? School.app.record({ type: 'lecon_lue', activite: a.id }) : [];
      $('seen').disabled = true;
      $('after').innerHTML = '<div class="callout safe">' + (first ? 'Noté dans ton carnet, +10 points.' : 'Déjà noté dans ton carnet.') + '</div>' + badgesHTML(won) +
        '<div class="row"><button class="btn alt" id="close">Retour</button></div>';
      $('close').addEventListener('click', closeAndRefresh);
    });
  }

  // ---------- Défi ----------
  function defi(a) {
    var i = 0, essais = 0, resultats = [], tries = [];
    function draw() {
      var q = a.questions[i];
      ui.openWin(a.titre, '<div class="row"><span class="tag">Défi</span><span class="src">Question ' + (i + 1) + ' sur ' + a.questions.length + '</span></div>' +
        '<div class="callout"><b>' + esc(q.question) + '</b></div><div class="opts">' + q.choix.map(function (c, k) {
          return '<label><input type="radio" name="q" id="q-' + k + '" value="' + k + '"> ' + esc(c) + '</label>';
        }).join('') + '</div><div class="row"><button class="btn" id="answer">Je réponds</button></div><div id="fb"></div>' + School.aide.html());
      tries = [];
      School.aide.bind(a, function () { return 'question:' + i; }, function () { return tries; });
      $('answer').addEventListener('click', function () {
        var v = document.querySelector('input[name="q"]:checked');
        if (!v) return ui.toast('Choisis une réponse.');
        essais++; tries.push(q.choix[+v.value]);
        var res = School.progress.checkAnswer(q, +v.value, essais);
        if (!res.fini) { $('fb').innerHTML = '<div class="callout">Pas encore ! ' + q.indice + '</div>'; return; }
        resultats.push({ premier: res.ok && essais === 1, essais: essais, ok: res.ok });
        $('answer').disabled = true;
        $('win-body').querySelectorAll('input[name="q"]').forEach(function (x) { x.disabled = true; });
        var last = i === a.questions.length - 1;
        $('fb').innerHTML = '<div class="callout ' + (res.ok ? 'safe' : '') + '">' + (res.ok ? '<b>Bravo !</b> ' : '<b>La réponse :</b> ') + q.explication + '</div>' +
          '<div class="row"><button class="btn" id="next">' + (last ? 'Voir mon score' : 'Question suivante') + '</button></div>';
        $('next').addEventListener('click', function () { if (last) return end(); i++; essais = 0; draw(); });
        $('next').focus();
      });
    }
    function end() {
      var ok = resultats.filter(function (r) { return r.ok; }).length, score = ok / a.questions.length;
      var won = School.app.record({ type: 'defi_termine', activite: a.id, score: score, resultats: resultats });
      var msg = score >= 0.8 ? 'Excellent !' : score >= 0.6 ? 'Bien joué, tu y es presque.' : 'Relis la leçon et retente ta chance : tu vas y arriver.';
      ui.openWin(a.titre, '<div class="score"><b>' + ok + ' / ' + a.questions.length + '</b><span>' + msg + '</span></div>' + badgesHTML(won) +
        '<div class="row"><button class="btn alt" id="again">Recommencer</button><button class="btn" id="close">Retour à la paillasse</button></div>');
      $('again').addEventListener('click', function () { defi(a); });
      $('close').addEventListener('click', closeAndRefresh);
    }
    draw();
  }

  School.activities = { openBinder: openBinder, open: open };
})(window);

// ---- maths.js ----
// maths.js — Tables d'addition et de multiplication : table colorée, entraînement, évaluation.
// Calcul mental : un entraînement peut porter sur une liste de calculs écrite dans le contenu
// (« faits »), à la place des tables : même répétition espacée, même chrono. Un calcul peut
// porter sa question en toutes lettres : { calcul: "34:2", question: "La moitié de 34" }.
//
// - table : table de Pythagore (ou d'addition) colorée ; toucher une case montre le calcul, en
//   points pour la multiplication ; on peut cacher les résultats pour se tester.
// - entrainement : séries courtes, réponse immédiate, répétition espacée (les faits ratés
//   reviennent plus souvent) ; mode calme ou chrono « bats ton record ».
// - evaluation : sans aide pendant l'épreuve, correction complète à la fin, badge si le
//   seuil est atteint ; les calculs ratés peuvent être retravaillés tout de suite.
(function (root) {
  'use strict';
  var School = root.School, ui = School.ui, $ = ui.$, esc = ui.esc, P = School.progress;
  var D = root.SCHOOL_DATA;
  var HUES = [350, 20, 42, 90, 150, 185, 205, 240, 275, 310, 330, 0];

  function events() { return School.app.store.get().events; }
  function sym(op) { return op === 'multiplication' ? '×' : '+'; }
  function factOf(op, a, b) { return op === 'multiplication' ? a + 'x' + b : a + '+' + b; }

  // ---------- Clavier numérique (doigt, souris ou clavier) ----------
  var keyHandler = null;
  function keypad(onSubmit) {
    var html = '<div class="answer" id="answer" aria-live="polite">&nbsp;</div><div class="keypad" role="group" aria-label="Clavier">' +
      [1, 2, 3, 4, 5, 6, 7, 8, 9].map(function (n) { return '<button class="key" data-k="' + n + '">' + n + '</button>'; }).join('') +
      '<button class="key alt" data-k="del" aria-label="Effacer">⌫</button><button class="key" data-k="0">0</button><button class="key ok" data-k="ok">OK</button></div>';
    var value = '';
    function show() { $('answer').innerHTML = value ? esc(value) : '&nbsp;'; }
    function press(k) {
      if (k === 'del') value = value.slice(0, -1);
      else if (k === 'ok') { if (value !== '') onSubmit(+value); return; }
      else if (value.length < 6) value += k;
      show();
    }
    function bind() {
      $('win-body').querySelectorAll('[data-k]').forEach(function (b) { b.addEventListener('click', function () { press(b.getAttribute('data-k')); }); });
      if (keyHandler) document.removeEventListener('keydown', keyHandler);
      keyHandler = function (e) {
        if ($('veil').hidden) { document.removeEventListener('keydown', keyHandler); keyHandler = null; return; }
        if (/^\d$/.test(e.key)) { press(e.key); e.preventDefault(); }
        else if (e.key === 'Backspace') { press('del'); e.preventDefault(); }
        else if (e.key === 'Enter') { press('ok'); e.preventDefault(); }
      };
      document.addEventListener('keydown', keyHandler);
    }
    return { html: html, bind: bind, reset: function () { value = ''; show(); } };
  }

  // ---------- Table colorée ----------
  function table(a, tools) {
    var max = a.max || 10, op = a.operation, s = sym(op), sel = null, hidden = false, shown = {};
    function cell(r, c) {
      var v = op === 'multiplication' ? r * c : r + c, key = r + ',' + c;
      var on = sel && (sel[0] === r || sel[1] === c), me = sel && sel[0] === r && sel[1] === c, mirror = sel && sel[0] === c && sel[1] === r && !me;
      var bg = 'hsl(' + HUES[(r - 1) % HUES.length] + ' 85% ' + (on ? 78 : 90) + '%)';
      var cls = 'pcell' + (r === c ? ' diag' : '') + (me ? ' me' : '') + (mirror ? ' mirror' : '');
      var txt = hidden && !shown[key] && !me ? '?' : v;
      return '<td><button class="' + cls + '" style="background:' + bg + '" data-r="' + r + '" data-c="' + c + '" aria-label="' + r + ' ' + s + ' ' + c + '">' + txt + '</button></td>';
    }
    function dots(r, c) {
      if (op !== 'multiplication') {
        var sq = function (n, col, x0) { var o = ''; for (var i = 0; i < n; i++) o += '<rect x="' + (x0 + i * 16) + '" y="4" width="13" height="13" rx="3" fill="' + col + '" stroke="#2a2240" stroke-width="1.5"/>'; return o; };
        return '<svg viewBox="0 0 ' + ((r + c) * 16 + 8) + ' 22" class="dots" aria-hidden="true">' + sq(r, '#8fd2ff', 4) + sq(c, '#ffc04d', 4 + r * 16) + '</svg>';
      }
      var o = '';
      for (var i = 0; i < r; i++) for (var j = 0; j < c; j++) o += '<circle cx="' + (10 + j * 18) + '" cy="' + (10 + i * 18) + '" r="6.5" fill="hsl(' + HUES[(r - 1) % HUES.length] + ' 75% 60%)" stroke="#2a2240" stroke-width="1.5"/>';
      return '<svg viewBox="0 0 ' + (c * 18 + 2) + ' ' + (r * 18 + 2) + '" class="dots" aria-hidden="true">' + o + '</svg>';
    }
    function draw() {
      var head = '<tr><th class="corner">' + s + '</th>' + Array.from({ length: max }, function (_, i) { return '<th>' + (i + 1) + '</th>'; }).join('') + '</tr>';
      var rows = Array.from({ length: max }, function (_, i) {
        var r = i + 1; return '<tr><th>' + r + '</th>' + Array.from({ length: max }, function (_, j) { return cell(r, j + 1); }).join('') + '</tr>';
      }).join('');
      var info = sel
        ? '<div class="pinfo"><b class="big">' + sel[0] + ' ' + s + ' ' + sel[1] + ' = ' + (op === 'multiplication' ? sel[0] * sel[1] : sel[0] + sel[1]) + '</b>' + dots(sel[0], sel[1]) +
          (sel[0] !== sel[1] ? '<span class="src">C\'est aussi ' + sel[1] + ' ' + s + ' ' + sel[0] + ' : la case en pointillés.</span>' : '<span class="src">Sur la diagonale, le nombre est multiplié ou ajouté à lui-même.</span>') + '</div>'
        : '<div class="pinfo"><span>Touche une case pour voir le calcul.</span></div>';
      ui.openWin(a.titre, '<div class="row spread"><span class="tag">' + (op === 'multiplication' ? 'Table de Pythagore' : 'Table d\'addition') + '</span>' +
        '<label class="switch"><input type="checkbox" id="hide"' + (hidden ? ' checked' : '') + '> Cacher les résultats</label></div>' +
        '<div class="ptable"><table>' + head + rows + '</table></div>' + info +
        '<p class="src">' + (op === 'multiplication' ? 'Astuce : chaque ligne est une table. La table est symétrique : 3 × 7 = 7 × 3, il y a donc deux fois moins à retenir !' : 'Astuce : 8 + 5, c\'est 8 + 2 + 3 : on passe par 10.') + '</p>' +
        '<div class="row"><button class="btn" id="lu">J\'ai exploré la table</button></div><div id="after"></div>');
      $('win-body').querySelectorAll('.pcell').forEach(function (b) {
        b.addEventListener('click', function () { var r = +b.getAttribute('data-r'), c = +b.getAttribute('data-c'); sel = [r, c]; shown[r + ',' + c] = true; draw(); });
      });
      $('hide').addEventListener('change', function () { hidden = $('hide').checked; shown = {}; sel = null; draw(); });
      $('lu').addEventListener('click', function () {
        var first = !School.app.progress().done[a.id];
        var won = first ? School.app.record({ type: 'lecon_lue', activite: a.id }) : [];
        $('lu').disabled = true;
        $('after').innerHTML = '<div class="callout safe">' + (first ? 'Bravo, +10 points !' : 'Déjà noté dans ton carnet.') + '</div>' + tools.badgesHTML(won) +
          '<div class="row"><button class="btn alt" id="close">Retour au bureau</button></div>';
        $('close').addEventListener('click', tools.close);
      });
    }
    draw();
  }

  // ---------- Entraînement ----------
  function bestTime(id) {
    return events().filter(function (e) { return e.activite === id && e.type === 'entrainement_termine' && e.duree_ms && (e.resultats || []).every(function (r) { return r.ok; }); })
      .reduce(function (m, e) { return m == null ? e.duree_ms : Math.min(m, e.duree_ms); }, null);
  }
  function secs(ms) { return (ms / 1000).toFixed(1).replace('.', ',') + ' s'; }

  function entrainement(a, tools, preset) {
    var op = a.operation, faits = Array.isArray(a.faits) ? a.faits.map(function (f) { return f.calcul || f; }) : null, chrono = false;
    var asked = {};
    (a.faits || []).forEach(function (f) { if (f.question) asked[f.calcul] = f.question; });
    function question(f) { return asked[f] || P.factLabel(f); }
    var chosen = faits ? [] : preset && preset.tables ? preset.tables.slice() : a.tables.slice();
    function intro() {
      var label = op === 'multiplication' ? 'Tables' : 'Ajouter';
      ui.openWin(a.titre, '<p>' + (preset && preset.facts ? 'On retravaille les calculs ratés : <b>' + preset.facts.map(question).join(', ') + '</b>.' :
        faits ? 'Calcule de tête. Les calculs que tu rates reviendront plus souvent, jusqu\'à ce que tu les saches.' :
        'Choisis tes tables. Les calculs que tu rates reviendront plus souvent, jusqu\'à ce que tu les saches.') + '</p>' +
        (preset && preset.facts || faits ? '' : '<div class="chips" role="group" aria-label="' + label + '">' +
          '<button class="tchip all" data-t="toutes" aria-pressed="' + (chosen.length === a.tables.length) + '">Toutes</button>' + a.tables.map(function (t) {
          return '<button class="tchip" data-t="' + t + '" aria-pressed="' + (chosen.length < a.tables.length && chosen.indexOf(t) !== -1) + '">' + (op === 'multiplication' ? '× ' : '+ ') + t + '</button>';
        }).join('') + '</div><p class="src" id="chosen"></p>') +
        '<div class="row"><label class="switch"><input type="checkbox" id="chrono"' + (chrono ? ' checked' : '') + '> Chrono : bats ton record</label></div>' +
        (bestTime(a.id) ? '<p class="src">Ton record (série sans faute) : ' + secs(bestTime(a.id)) + '</p>' : '') +
        '<div class="row"><button class="btn" id="go">C\'est parti !</button></div>');
      // Toutes les tables au départ ; toucher une table la choisit seule, puis chaque toucher
      // ajoute ou retire une table ; « Toutes » revient à l'ensemble.
      function showChosen() {
        var all = chosen.length === a.tables.length;
        $('win-body').querySelectorAll('.tchip').forEach(function (x) {
          var t = x.getAttribute('data-t');
          x.setAttribute('aria-pressed', t === 'toutes' ? all : !all && chosen.indexOf(+t) !== -1);
        });
        if ($('chosen')) $('chosen').textContent = all ? 'Toutes les tables.' : (chosen.length > 1 ? 'Tables choisies : ' : 'Table choisie : ') +
          chosen.slice().sort(function (x, y) { return x - y; }).map(function (t) { return (op === 'multiplication' ? '× ' : '+ ') + t; }).join(', ') + '.';
      }
      $('win-body').querySelectorAll('.tchip').forEach(function (b) {
        b.addEventListener('click', function () {
          var v = b.getAttribute('data-t');
          if (v === 'toutes') chosen = a.tables.slice();
          else {
            var t = +v, i = chosen.indexOf(t);
            if (chosen.length === a.tables.length) chosen = [t];
            else if (i === -1) chosen.push(t);
            else if (chosen.length > 1) chosen.splice(i, 1);
          }
          showChosen();
        });
      });
      if (!faits) showChosen();
      $('chrono').addEventListener('change', function () { chrono = $('chrono').checked; });
      $('go').addEventListener('click', start);
    }
    function start() {
      var queue = preset && preset.facts ? P.shuffle(preset.facts.concat(preset.facts)).slice(0, Math.max(6, preset.facts.length * 2))
        : P.pickFacts(faits || P.facts(op, chosen), P.factBoxes(events()), a.questions || 15);
      var results = {}, order = [], again = {}, t0 = Date.now(), qStart = 0, pad = null, n = queue.length, busy = false;
      function ask() {
        busy = false;
        if (!queue.length) return end();
        var f = queue[0];
        ui.openWin(a.titre, '<div class="row spread"><span class="tag">' + (order.length + 1) + ' / ' + n + '</span>' + (chrono ? '<span class="src" id="clock">0,0 s</span>' : '') + '</div>' +
          '<div class="bigq">' + esc(question(f)) + (asked[f] ? ' ?' : ' = ?') + '</div>' + (pad = keypad(answer)).html + '<div id="fb" aria-live="polite"></div>' + School.aide.html());
        // L'aide ne reçoit le calcul que pour les tables (l'API n'accepte que « calcul:7x8 », « calcul:3+5 »).
        School.aide.bind(a, function () { return /^([1-9]|1[0-2])[x+]([1-9]|1[0-2])$/.test(f) ? 'calcul:' + f : null; });
        pad.bind(); qStart = Date.now();
        if (chrono) tick();
      }
      function tick() { var c = $('clock'); if (!c || $('veil').hidden) return; c.textContent = secs(Date.now() - t0); setTimeout(tick, 200); }
      function answer(v) {
        if (busy) return;           // réponse déjà donnée, correction affichée
        busy = true;
        var f = queue[0], ok = v === P.answer(f), first = !(f in results);
        if (first) { results[f] = { fait: f, ok: ok, ms: Math.min(600000, Date.now() - qStart) }; order.push(f); }
        queue.shift();
        if (ok) { $('fb').innerHTML = '<div class="callout safe"><b>Bravo !</b></div>'; setTimeout(ask, 500); }
        else {
          if (!again[f]) { again[f] = true; queue.splice(Math.min(queue.length, 3), 0, f); }   // revient un peu plus tard
          $('fb').innerHTML = '<div class="callout">Presque ! <b>' + esc(question(f)) + (asked[f] ? ' : ' : ' = ') + P.number(P.answer(f)) + '</b>. Il reviendra tout à l\'heure.</div>';
          $('win-body').querySelectorAll('[data-k]').forEach(function (b) { b.disabled = true; });
          setTimeout(ask, 1800);
        }
      }
      function end() {
        var res = order.map(function (f) { return results[f]; }), good = res.filter(function (r) { return r.ok; }).length, ms = Date.now() - t0;
        var before = bestTime(a.id), allOk = good === res.length;
        var won = School.app.record(Object.assign({ type: 'entrainement_termine', activite: a.id, resultats: res }, chrono ? { duree_ms: Math.min(3600000, ms) } : {}));
        var missed = res.filter(function (r) { return !r.ok; }).map(function (r) { return r.fait; });
        var rec = chrono && allOk && (before == null || ms < before) ? '<div class="callout safe"><b>Nouveau record : ' + secs(ms) + ' !</b></div>' : chrono ? '<p class="src">Temps : ' + secs(ms) + (before ? ' · record : ' + secs(before) : '') + '</p>' : '';
        ui.openWin(a.titre, '<div class="score"><b>' + good + ' / ' + res.length + '</b><span>du premier coup' + (good === res.length ? ', bravo !' : '') + '</span></div>' + rec +
          (missed.length ? '<p>À revoir : <b>' + missed.map(question).join(', ') + '</b>. Ils reviendront plus souvent dans tes prochaines séries.</p>' : '') + tools.badgesHTML(won) +
          '<div class="row"><button class="btn" id="again">Une autre série</button><button class="btn alt" id="close">Retour au bureau</button></div>');
        $('again').addEventListener('click', function () { entrainement(a, tools, preset && preset.facts ? null : { tables: chosen }); });
        $('close').addEventListener('click', tools.close);
      }
      ask();
    }
    intro();
  }

  // ---------- Évaluation ----------
  function evaluation(a, tools) {
    var n = a.questions, need = Math.ceil(a.seuil * n - 1e-9);
    var badge = School.app.model.badges().filter(function (b) { return b.quand && b.quand.defi === a.id; })[0];
    function intro() {
      ui.openWin(a.titre, '<p>' + n + ' calculs. Pendant l\'évaluation, pas de correction : elle arrive à la fin, complète.</p>' +
        '<div class="callout">Pour ' + (badge ? 'gagner le badge <b>« ' + esc(badge.nom) + ' »</b>' : 'valider') + ', il faut au moins <b>' + need + ' bonnes réponses sur ' + n + '</b>.</div>' +
        '<div class="row"><button class="btn" id="go">Je commence</button></div>');
      $('go').addEventListener('click', start);
    }
    function start() {
      var list = P.evaluationFacts(a.operation, a.tables, n), answers = [], i = 0, pad;
      function ask() {
        ui.openWin(a.titre, '<div class="row spread"><span class="tag">Question ' + (i + 1) + ' / ' + n + '</span></div>' +
          '<div class="bigq">' + esc(P.factLabel(list[i])) + ' = ?</div>' + (pad = keypad(answer)).html);
        pad.bind();
      }
      function answer(v) { if (answers.length > i) return; answers.push(v); i++; if (i < n) ask(); else end(); }
      function end() {
        var res = list.map(function (f, k) { var ok = answers[k] === P.answer(f); return { fait: f, ok: ok, premier: ok, essais: 1 }; });
        var good = res.filter(function (r) { return r.ok; }).length, score = good / n;
        var won = School.app.record({ type: 'defi_termine', activite: a.id, score: score, resultats: res });
        var passed = good >= need, missed = res.filter(function (r) { return !r.ok; }).map(function (r) { return r.fait; });
        var corr = '<ol class="corr">' + list.map(function (f, k) {
          var ok = res[k].ok;
          return '<li class="' + (ok ? 'ok' : 'ko') + '"><span>' + esc(P.factLabel(f)) + ' = <b>' + esc(answers[k]) + '</b></span><span>' + (ok ? '✓' : '✗ ' + P.answer(f)) + '</span></li>';
        }).join('') + '</ol>';
        var practice = Object.keys(D.activites).map(function (id) { return D.activites[id]; })
          .filter(function (x) { return x.type === 'entrainement' && x.theme === a.theme && x.operation === a.operation; })[0];
        ui.openWin(a.titre, '<div class="score"><b>' + good + ' / ' + n + '</b><span>' + (passed ? 'Réussi !' : 'Il fallait ' + need + ' bonnes réponses : pas encore, mais tu y es presque.') + '</span></div>' +
          tools.badgesHTML(won) + '<h3 class="h3">La correction</h3>' + corr +
          '<div class="row">' + (missed.length && practice ? '<button class="btn" id="train">M\'entraîner sur les calculs ratés</button>' : '') +
          '<button class="btn alt" id="again">Recommencer</button><button class="btn alt" id="close">Retour au bureau</button></div>');
        if ($('train')) $('train').addEventListener('click', function () { entrainement(practice, tools, { facts: missed }); });
        $('again').addEventListener('click', function () { evaluation(a, tools); });
        $('close').addEventListener('click', tools.close);
      }
      ask();
    }
    intro();
  }

  School.engines = Object.assign(School.engines || {}, { table: table, entrainement: function (a, t) { entrainement(a, t); }, evaluation: evaluation });
})(window);

// ---- mots.js ----
// mots.js — Orthophonie : mots mêlés, orthographe à l'oreille, lecture flash.
//
// Exercices d'entraînement, en complément des séances d'orthophonie (ils ne les remplacent pas).
// Grands caractères espacés ; jamais de comparaison entre élèves.
// Voix : celle de Sophia dans la version SophIA, sinon une voix française de l'appareil (ui.js) ;
// sans voix, la dictée l'explique au lieu de démarrer.
(function (root) {
  'use strict';
  var School = root.School, ui = School.ui, $ = ui.$, esc = ui.esc, L = School.lexique;
  var COLORS = ['#ffc04d', '#8fd2ff', '#ff8fbf', '#c6f0d9', '#d9ccff', '#ffd9a8', '#bfe9ff', '#fff08a'];

  function secs(ms) { return (ms / 1000).toFixed(1).replace('.', ',') + ' s'; }
  function finish(a, tools, score, resultats, extra) {
    return School.app.record(Object.assign({ type: 'defi_termine', activite: a.id, score: Math.max(0, Math.min(1, score)), resultats: resultats }, extra || {}));
  }

  // ---------- Voix (ui.js : celle de Sophia, sinon celle de l'appareil) ----------
  var say = ui.say, canSay = ui.canSay;
  var SPEAKER = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9 H8 L13 5 V19 L8 15 H4 Z" fill="currentColor"/><path d="M16 8 Q19 12 16 16 M18.5 5.5 Q23 12 18.5 18.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';

  // ---------- Mots mêlés ----------
  function motsmeles(a, tools) {
    var g = L.grid(a.mots, a.lignes, a.colonnes, Math.random, a.remplissage), found = {}, start = null, hints = 0, t0 = Date.now();
    var order = g.placed.map(function (p) { return p.mot; }).sort();
    // La grille est sans accents (usage des mots mêlés) ; la liste montre le mot bien écrit.
    var spelled = {};
    a.mots.forEach(function (w) { spelled[L.plain(w)] = String(w).toLocaleUpperCase('fr-FR'); });
    function draw(flash) {
      var cells = '';
      g.cells.forEach(function (row, r) {
        row.forEach(function (ch, c) {
          var hit = g.placed.filter(function (p) { return found[p.mot] && p.ligne === r && c >= p.col && c < p.col + p.mot.length; })[0];
          var style = hit ? ' style="background:' + COLORS[order.indexOf(hit.mot) % COLORS.length] + '"' : '';
          var cls = 'mm' + (start && start[0] === r && start[1] === c ? ' start' : '') + (flash && flash[0] === r && flash[1] === c ? ' hint' : '') + (hit ? ' found' : '');
          cells += '<button class="' + cls + '"' + style + ' data-r="' + r + '" data-c="' + c + '" aria-label="Ligne ' + (r + 1) + ', colonne ' + (c + 1) + ' : ' + ch + '">' + ch + '</button>';
        });
      });
      var left = order.filter(function (w) { return !found[w]; }).length;
      ui.openWin(a.titre, '<p class="src">Touche la première lettre d\'un mot, puis la dernière. Les mots se lisent de gauche à droite.</p>' +
        '<div class="mmgrid" style="grid-template-columns:repeat(' + a.colonnes + ', minmax(0, 1fr))">' + cells + '</div>' +
        '<ul class="mmlist">' + order.map(function (w) { return '<li class="' + (found[w] ? 'done' : '') + '">' + esc(spelled[w] || w) + '</li>'; }).join('') + '</ul>' +
        '<div class="row"><button class="btn alt" id="hint"' + (left ? '' : ' disabled') + '>Un indice</button><span class="src">' + (order.length - left) + ' / ' + order.length + ' mots</span></div><div id="fb" aria-live="polite"></div>');
      $('win-body').querySelectorAll('.mm').forEach(function (b) { b.addEventListener('click', function () { pick(+b.getAttribute('data-r'), +b.getAttribute('data-c')); }); });
      $('hint').addEventListener('click', function () {
        var rest = g.placed.filter(function (p) { return !found[p.mot]; }), p = rest[Math.floor(Math.random() * rest.length)];
        hints++; start = null; draw([p.ligne, p.col]);
      });
    }
    function pick(r, c) {
      if (!start || start[0] !== r) { start = [r, c]; return draw(); }
      var p = L.findPlaced(g, r, start[1], c);
      start = null;
      if (p && !found[p.mot]) { found[p.mot] = true; }
      draw();
      if (!p) $('fb').innerHTML = '<div class="callout">Ce n\'est pas un des mots. Essaie encore !</div>';
      if (Object.keys(found).length === order.length) end();
    }
    function end() {
      var ms = Date.now() - t0, score = 1 - 0.1 * hints;
      var won = finish(a, tools, score, order.map(function () { return { ok: true, premier: true, essais: 1 }; }), { duree_ms: Math.min(3600000, ms) });
      ui.openWin(a.titre, '<div class="score"><b>Bravo !</b><span>Tous les mots trouvés en ' + secs(ms) + (hints ? ', avec ' + hints + ' indice' + (hints > 1 ? 's' : '') : ', sans indice') + '.</span></div>' +
        tools.badgesHTML(won) + '<div class="row"><button class="btn" id="again">Une nouvelle grille</button><button class="btn alt" id="close">Retour</button></div>');
      $('again').addEventListener('click', function () { motsmeles(a, tools); });
      $('close').addEventListener('click', tools.close);
    }
    draw();
  }

  // ---------- Orthographe à l'oreille ----------
  function dictee(a, tools) {
    function intro() {
      var ok = canSay();
      ui.openWin(a.titre, '<p>Sophia dit un mot, sans l\'épeler. Touche la bonne orthographe parmi les 6. Tu peux réécouter autant que tu veux.</p>' +
        (ok ? '' : '<div class="callout">Cet appareil n\'a pas de voix française : ouvre l\'école depuis SophIA, ou installe une voix française dans les réglages de l\'appareil.</div>') +
        '<div class="callout">Pour le badge : au moins <b>' + Math.ceil(a.seuil * a.questions - 1e-9) + ' bonnes réponses sur ' + a.questions + '</b>.</div>' +
        '<div class="row"><button class="btn" id="go"' + (ok ? '' : ' disabled') + '>Je commence</button></div>');
      $('go').addEventListener('click', start);
    }
    function start() {
      var list = L.shuffle(a.mots, Math.random).slice(0, a.questions), i = 0, res = [], missed = [];
      function ask() {
        var q = list[i], opts = L.shuffle([q.mot].concat(q.variantes), Math.random), answered = false;
        if (list[i + 1]) ui.prepare(list[i + 1].dire || list[i + 1].mot);   // le mot suivant se prépare
        ui.openWin(a.titre, '<div class="row spread"><span class="tag">Mot ' + (i + 1) + ' / ' + list.length + '</span></div>' +
          '<div class="row center"><button class="btn sophia listen" id="listen">' + SPEAKER + ' Écouter</button></div>' +
          '<div class="spell">' + opts.map(function (o, k) { return '<button class="sp" data-k="' + k + '">' + esc(o) + '</button>'; }).join('') + '</div>' +
          '<div id="fb" aria-live="polite"></div>' + School.aide.html());
        School.aide.bind(a, function () { return 'mot:' + a.mots.indexOf(q); });
        // « dire » : prononciation à faire lire quand la voix se trompe sur le mot écrit (tapis → tapi).
        var play = function () { say(q.dire || q.mot).catch(function () { $('fb').innerHTML = '<div class="callout">La voix ne répond pas. Réessaie dans un instant.</div>'; }); };
        $('listen').addEventListener('click', play);
        play();
        $('win-body').querySelectorAll('.sp').forEach(function (b) {
          b.addEventListener('click', function () {
            if (answered) return; answered = true;
            var ok = opts[+b.getAttribute('data-k')] === q.mot;
            res.push({ ok: ok, premier: ok, essais: 1 }); if (!ok) missed.push(q.mot);
            $('win-body').querySelectorAll('.sp').forEach(function (x) {
              var good = opts[+x.getAttribute('data-k')] === q.mot;
              x.disabled = true; if (good) x.classList.add('good'); else if (x === b) x.classList.add('bad');
            });
            $('fb').innerHTML = '<div class="callout ' + (ok ? 'safe' : '') + '">' + (ok ? '<b>Bravo !</b>' : 'Ça s\'écrit <b>' + esc(q.mot) + '</b>.') + '</div>' +
              '<div class="row"><button class="btn" id="next">' + (i + 1 < list.length ? 'Mot suivant' : 'Voir mon score') + '</button></div>';
            $('next').addEventListener('click', function () { i++; if (i < list.length) ask(); else end(); });
            $('next').focus();
          });
        });
      }
      function end() {
        var good = res.filter(function (r) { return r.ok; }).length, won = finish(a, tools, good / list.length, res);
        ui.openWin(a.titre, '<div class="score"><b>' + good + ' / ' + list.length + '</b><span>' + (good / list.length >= a.seuil ? 'Super oreille !' : 'Continue, ça vient !') + '</span></div>' + tools.badgesHTML(won) +
          (missed.length ? '<p>À revoir : ' + missed.map(function (m) { return '<b>' + esc(m) + '</b>'; }).join(', ') + '</p>' : '') +
          '<div class="row"><button class="btn" id="again">Recommencer</button><button class="btn alt" id="close">Retour</button></div>');
        $('again').addEventListener('click', function () { dictee(a, tools); });
        $('close').addEventListener('click', tools.close);
      }
      ask();
    }
    intro();
  }

  // ---------- Lecture flash ----------
  var SETTINGS_KEY = 'sophia-school:reglages:';
  function loadSettings(a) {
    var d = { duree: a.duree_ms, syllabes: 1, mode: 'retrouver', auto: true };
    try { return Object.assign(d, JSON.parse(localStorage.getItem(SETTINGS_KEY + a.id) || '{}')); } catch (e) { return d; }
  }
  function saveSettings(a, s) { try { localStorage.setItem(SETTINGS_KEY + a.id, JSON.stringify(s)); } catch (e) {} }

  function flash(a, tools) {
    var set = loadSettings(a);
    function intro() {
      ui.openWin(a.titre, '<p>Un ' + (a.syllabes ? 'groupe de syllabes' : 'mot') + ' apparaît très vite, puis disparaît. Lis-le !</p>' +
        '<div class="settings">' +
        '<label class="field" for="dur">Temps d\'affichage : <span id="durv">' + secs(set.duree) + '</span><input type="range" id="dur" min="100" max="2000" step="50" value="' + set.duree + '"></label>' +
        (a.syllabes ? '<label class="field" for="nb">Syllabes à la suite : <span id="nbv">' + set.syllabes + '</span><input type="range" id="nb" min="1" max="3" step="1" value="' + set.syllabes + '"></label>' : '') +
        '<div class="opts"><label><input type="radio" name="mode" id="m-r" value="retrouver"' + (set.mode === 'retrouver' ? ' checked' : '') + '> Je retrouve ce que j\'ai lu parmi 4</label>' +
        '<label><input type="radio" name="mode" id="m-v" value="voix"' + (set.mode === 'voix' ? ' checked' : '') + '> Je lis à voix haute, puis je vérifie</label></div>' +
        '<label class="switch"><input type="checkbox" id="auto"' + (set.auto ? ' checked' : '') + '> Vitesse automatique (plus vite quand je réussis)</label></div>' +
        '<div class="row"><button class="btn" id="go">Je suis prêt·e !</button></div>');
      $('dur').addEventListener('input', function () { set.duree = +$('dur').value; $('durv').textContent = secs(set.duree); });
      if ($('nb')) $('nb').addEventListener('input', function () { set.syllabes = +$('nb').value; $('nbv').textContent = set.syllabes; });
      $('go').addEventListener('click', function () {
        set.mode = $('m-v').checked ? 'voix' : 'retrouver'; set.auto = $('auto').checked; saveSettings(a, set); start();
      });
    }
    function makeItem() {
      if (!a.syllabes || set.syllabes === 1) return a.items[Math.floor(Math.random() * a.items.length)];
      var s = ''; for (var k = 0; k < set.syllabes; k++) s += a.items[Math.floor(Math.random() * a.items.length)];
      return s;
    }
    function start() {
      var i = 0, res = [], dur = set.duree, fastest = dur;
      function ask() {
        var item = makeItem();
        ui.openWin(a.titre, '<div class="row spread"><span class="tag">' + (i + 1) + ' / ' + a.questions + '</span><span class="src">Affichage : ' + secs(dur) + '</span></div>' +
          '<div class="flashbox" id="box" aria-live="off">Prêt ?</div><div id="after"></div>');
        setTimeout(function () {
          if ($('veil').hidden) return;
          $('box').textContent = item;
          setTimeout(function () { if (!$('veil').hidden) { $('box').textContent = '▒▒▒▒'; after(item); } }, dur);
        }, 900);
      }
      function next(ok) {
        res.push({ ok: ok, premier: ok, essais: 1 });
        if (set.auto) dur = ok ? Math.max(150, Math.round(dur * 0.9 / 10) * 10) : Math.min(2000, Math.round(dur * 1.15 / 10) * 10);
        fastest = Math.min(fastest, dur);
        i++; if (i < a.questions) setTimeout(ask, 700); else end();
      }
      function after(item) {
        if (set.mode === 'voix') {
          $('after').innerHTML = '<div class="row center"><button class="btn" id="reveal">Je l\'ai lu : vérifier</button></div>';
          $('reveal').addEventListener('click', function () {
            $('box').textContent = item;
            $('after').innerHTML = '<div class="row center"><button class="btn" id="yes">J\'ai bien lu</button><button class="btn alt" id="no">Pas encore</button></div>';
            $('yes').addEventListener('click', function () { next(true); });
            $('no').addEventListener('click', function () { next(false); });
          });
          return;
        }
        var choices = L.flashChoices(item, 4, Math.random), done = false;
        $('after').innerHTML = '<div class="spell four">' + choices.map(function (c, k) { return '<button class="sp" data-k="' + k + '">' + esc(c) + '</button>'; }).join('') + '</div>';
        $('after').querySelectorAll('.sp').forEach(function (b) {
          b.addEventListener('click', function () {
            if (done) return; done = true;
            var ok = choices[+b.getAttribute('data-k')] === item;
            $('after').querySelectorAll('.sp').forEach(function (x) { x.disabled = true; if (choices[+x.getAttribute('data-k')] === item) x.classList.add('good'); else if (x === b) x.classList.add('bad'); });
            $('box').textContent = item;
            next(ok);
          });
        });
      }
      function end() {
        var good = res.filter(function (r) { return r.ok; }).length, won = finish(a, tools, good / res.length, res, { duree_ms: fastest });
        if (set.auto) { set.duree = dur; saveSettings(a, set); }
        ui.openWin(a.titre, '<div class="score"><b>' + good + ' / ' + res.length + '</b><span>Affichage le plus rapide : ' + secs(fastest) + '</span></div>' + tools.badgesHTML(won) +
          '<div class="row"><button class="btn" id="again">Encore !</button><button class="btn alt" id="close">Retour</button></div>');
        $('again').addEventListener('click', function () { flash(a, tools); });
        $('close').addEventListener('click', tools.close);
      }
      ask();
    }
    intro();
  }

  School.engines = Object.assign(School.engines || {}, { motsmeles: motsmeles, dictee: dictee, flash: flash });
})(window);

// ---- clique.js ----
// clique.js — « Clique sur le mot » : une phrase, une consigne (« Touche le verbe conjugué »),
// l'élève touche le ou les mots demandés puis valide.
//
// Même règle que les défis : premier essai faux → indice ; second essai faux → la réponse et
// l'explication, la phrase est perdue. Les phrases sont déjà découpées à la construction
// (tools/build.mjs, parseClique) : [{ t, c (réponse), k (cliquable), s (espace avant) }].
(function (root) {
  'use strict';
  var School = root.School, ui = School.ui, $ = ui.$, esc = ui.esc;
  var SPEAKER = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9 H8 L13 5 V19 L8 15 H4 Z" fill="currentColor"/><path d="M16 8 Q19 12 16 16 M18.5 5.5 Q23 12 18.5 18.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';

  function plain(unites) { return unites.map(function (u) { return (u.s ? ' ' : '') + u.t; }).join(''); }

  // Juste si l'élève a touché exactement les réponses, ni plus ni moins.
  function correct(unites, picked) {
    return unites.every(function (u, k) { return !u.k || !!u.c === !!picked[k]; });
  }

  function clique(a, tools) {
    var i = 0, essais = 0, resultats = [];
    function draw() {
      var q = a.phrases[i], picked = {}, over = false;
      ui.openWin(a.titre, '<div class="row spread"><span class="tag">Clique sur le mot</span><span class="src">Phrase ' + (i + 1) + ' sur ' + a.phrases.length + '</span></div>' +
        '<div class="callout"><b>' + esc(q.consigne) + '</b></div>' +
        '<p class="clique" id="phrase">' + q.unites.map(function (u, k) {
          var sp = u.s ? ' ' : '';
          return sp + (u.k ? '<button class="mot" data-k="' + k + '" aria-pressed="false">' + esc(u.t) + '</button>' : '<span class="ponct">' + esc(u.t) + '</span>');
        }).join('') + '</p>' +
        '<div class="row">' + (ui.canSay() ? '<button class="btn alt listen" id="listen">' + SPEAKER + ' Écouter la phrase</button>' : '') +
        '<button class="btn" id="check">Je valide</button></div><div id="fb" aria-live="polite"></div>' + School.aide.html());
      School.aide.bind(a);
      var l = $('listen');
      if (l) l.addEventListener('click', function () { ui.say(plain(q.unites)).catch(function () { ui.toast('La voix ne répond pas. Réessaie dans un instant.'); }); });
      $('phrase').querySelectorAll('.mot').forEach(function (b) {
        b.addEventListener('click', function () {
          if (over) return;
          var k = +b.getAttribute('data-k');
          picked[k] = !picked[k];
          b.classList.toggle('on', picked[k]); b.setAttribute('aria-pressed', String(!!picked[k]));
        });
      });
      $('check').addEventListener('click', function () {
        if (!Object.keys(picked).some(function (k) { return picked[k]; })) return ui.toast('Touche au moins un mot.');
        essais++;
        var ok = correct(q.unites, picked);
        if (!ok && essais === 1) { $('fb').innerHTML = '<div class="callout">Pas encore ! ' + q.indice + '</div>'; return; }
        over = true;
        resultats.push({ ok: ok, premier: ok && essais === 1, essais: essais });
        $('check').disabled = true;
        $('phrase').querySelectorAll('.mot').forEach(function (b) {
          var u = q.unites[+b.getAttribute('data-k')], on = picked[+b.getAttribute('data-k')];
          b.disabled = true; b.classList.remove('on');
          if (u.c) b.classList.add('good'); else if (on) b.classList.add('bad');
        });
        var last = i === a.phrases.length - 1;
        $('fb').innerHTML = '<div class="callout ' + (ok ? 'safe' : '') + '">' + (ok ? '<b>Bravo !</b> ' : '<b>La réponse :</b> ') + q.explication + '</div>' +
          '<div class="row"><button class="btn" id="next">' + (last ? 'Voir mon score' : 'Phrase suivante') + '</button></div>';
        $('next').addEventListener('click', function () { if (last) return end(); i++; essais = 0; draw(); });
        $('next').focus();
      });
    }
    function end() {
      var ok = resultats.filter(function (r) { return r.ok; }).length, score = ok / a.phrases.length;
      var won = School.app.record({ type: 'defi_termine', activite: a.id, score: score, resultats: resultats });
      var msg = score === 1 ? 'Sans faute, bravo !' : score >= 0.8 ? 'Excellent !' : score >= 0.6 ? 'Bien joué, tu y es presque.' : 'Relis la leçon et retente ta chance : tu vas y arriver.';
      ui.openWin(a.titre, '<div class="score"><b>' + ok + ' / ' + a.phrases.length + '</b><span>' + msg + '</span></div>' + tools.badgesHTML(won) +
        '<div class="row"><button class="btn alt" id="again">Recommencer</button><button class="btn" id="close">Retour</button></div>');
      $('again').addEventListener('click', function () { clique(a, tools); });
      $('close').addEventListener('click', tools.close);
    }
    draw();
  }

  School.engines = Object.assign(School.engines || {}, { clique: clique });
})(window);

// ---- complete.js ----
// complete.js — « Je complète » : une phrase avec une case à remplir (une terminaison, un verbe
// conjugué, un accord). L'élève écrit, puis valide.
//
// Même règle que les défis : premier essai faux → indice ; second essai faux → la réponse et
// l'explication, la phrase est perdue. Comparaison exacte, accents compris (c'est l'orthographe
// qu'on travaille) ; seuls comptent pour rien les majuscules, les espaces en trop et la forme de
// l'apostrophe. Phrases découpées à la construction (tools/build.mjs, parseComplete).
(function (root) {
  'use strict';
  var School = root.School, ui = School.ui, $ = ui.$, esc = ui.esc;
  var SPEAKER = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9 H8 L13 5 V19 L8 15 H4 Z" fill="currentColor"/><path d="M16 8 Q19 12 16 16 M18.5 5.5 Q23 12 18.5 18.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';

  function norm(s) { return String(s || '').normalize('NFC').replace(/[’ʼ]/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr-FR'); }
  function correct(q, typed) { return q.reponses.some(function (r) { return norm(r) === norm(typed); }); }
  // Ce que dit la voix : la phrase entière, avec la réponse (comme une dictée) ; sans les indications
  // entre parenthèses (« (venir) »).
  function spoken(q) { return (q.avant + q.reponses[0] + q.apres).replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim(); }

  function complete(a, tools) {
    var i = 0, essais = 0, resultats = [];
    function draw() {
      var q = a.phrases[i], over = false, size = Math.max(3, Math.max.apply(null, q.reponses.map(function (r) { return r.length; })) + 2);
      ui.openWin(a.titre, '<div class="row spread"><span class="tag">Je complète</span><span class="src">Phrase ' + (i + 1) + ' sur ' + a.phrases.length + '</span></div>' +
        '<div class="callout"><b>' + esc(q.consigne) + '</b></div>' +
        '<p class="clique">' + esc(q.avant) + '<input class="trou" id="trou" size="' + size + '" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" aria-label="Ta réponse">' + esc(q.apres) + '</p>' +
        '<div class="row">' + (ui.canSay() ? '<button class="btn alt listen" id="listen">' + SPEAKER + ' Écouter la phrase</button>' : '') +
        '<button class="btn" id="check">Je valide</button></div><div id="fb" aria-live="polite"></div>' + School.aide.html());
      School.aide.bind(a);
      var input = $('trou'), l = $('listen');
      input.focus();
      if (l) l.addEventListener('click', function () { ui.say(spoken(q)).catch(function () { ui.toast('La voix ne répond pas. Réessaie dans un instant.'); }); });
      input.addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); if (!over) check(); else if ($('next')) $('next').click(); } });
      $('check').addEventListener('click', check);
      function check() {
        if (!input.value.trim()) return ui.toast('Écris ta réponse dans la case.');
        essais++;
        var ok = correct(q, input.value);
        if (!ok && essais === 1) { $('fb').innerHTML = '<div class="callout">Pas encore ! ' + q.indice + '</div>'; input.select(); return; }
        over = true;
        resultats.push({ ok: ok, premier: ok && essais === 1, essais: essais });
        $('check').disabled = true; input.readOnly = true;
        input.classList.add(ok ? 'good' : 'bad');
        var last = i === a.phrases.length - 1;
        $('fb').innerHTML = '<div class="callout ' + (ok ? 'safe' : '') + '">' + (ok ? '<b>Bravo !</b> ' : '<b>La réponse :</b> <span class="attendu">' + esc(q.reponses[0]) + '</span>. ') + q.explication + '</div>' +
          '<div class="row"><button class="btn" id="next">' + (last ? 'Voir mon score' : 'Phrase suivante') + '</button></div>';
        $('next').addEventListener('click', function () { if (last) return end(); i++; essais = 0; draw(); });
        $('next').focus();
      }
    }
    function end() {
      var ok = resultats.filter(function (r) { return r.ok; }).length, score = ok / a.phrases.length;
      var won = School.app.record({ type: 'defi_termine', activite: a.id, score: score, resultats: resultats });
      var msg = score === 1 ? 'Sans faute, bravo !' : score >= 0.8 ? 'Excellent !' : score >= 0.6 ? 'Bien joué, tu y es presque.' : 'Relis la leçon et retente ta chance : tu vas y arriver.';
      ui.openWin(a.titre, '<div class="score"><b>' + ok + ' / ' + a.phrases.length + '</b><span>' + msg + '</span></div>' + tools.badgesHTML(won) +
        '<div class="row"><button class="btn alt" id="again">Recommencer</button><button class="btn" id="close">Retour</button></div>');
      $('again').addEventListener('click', function () { complete(a, tools); });
      $('close').addEventListener('click', tools.close);
    }
    draw();
  }

  School.engines = Object.assign(School.engines || {}, { complete: complete });
})(window);

// ---- ardoise.js ----
// ardoise.js — « Dictée sur l'ardoise » : Sophia dicte des mots, l'élève les écrit sur son ardoise,
// puis la prend en photo. Dans la version SophIA, le modèle local lit l'ardoise (route
// /api/store/school/ardoise : il recopie seulement ce qui est écrit, sans connaître les mots attendus) ;
// la comparaison avec la liste se fait ici, par règle (même règle que « Je complète »). Les mots
// reconnus justes sont pré-cochés, et l'on peut changer chaque case si l'écriture a été mal lue.
// Sans lecture (version publique, serveur indisponible) : on coche soi-même.
// Le serveur garde la photo jusqu'à la correction du parent, 7 jours au plus : le résultat de la dictée note, ardoise par ardoise, la photo, les mots
// dictés et ce que Sophia a lu, pour que les parents vérifient et corrigent dans le livret.
(function (root) {
  'use strict';
  var School = root.School, ui = School.ui, $ = ui.$, esc = ui.esc;
  var SPEAKER = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9 H8 L13 5 V19 L8 15 H4 Z" fill="currentColor"/><path d="M16 8 Q19 12 16 16 M18.5 5.5 Q23 12 18.5 18.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';

  function norm(s) { return String(s || '').normalize('NFC').replace(/[’ʼ]/g, "'").replace(/\s+/g, ' ').trim().toLocaleLowerCase('fr-FR'); }

  // Photo réduite (1600 px au plus, JPEG) avant l'envoi : assez pour lire, pas trop lourde.
  function shrink(file) {
    return new Promise(function (ok, ko) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 1600 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); ko(new Error('photo illisible')); };
      img.src = url;
    });
  }

  function ardoise(a, tools, only) {
    var store = School.app.store, reads = typeof store.ardoise === 'function';
    var mots = only || a.mots, size = a.par_ardoise || 8, groups = [];
    for (var g = 0; g < mots.length; g += size) groups.push(mots.slice(g, g + size));
    var gi = 0, res = [], planches = [];

    function intro() {
      var ok = ui.canSay();
      ui.openWin(a.titre, '<p>Prépare ton <b>ardoise</b> et ton feutre. Sophia dit un mot : écris-le, puis passe au suivant. Tu peux réécouter autant que tu veux.</p>' +
        '<p>' + (groups.length > 1 ? 'Toutes les ' + size + ' mots, prends ton ardoise en photo, puis efface-la.' : 'À la fin, prends ton ardoise en photo.') + '</p>' +
        (ok ? '' : '<div class="callout">Cet appareil n\'a pas de voix française : ouvre l\'école depuis SophIA.</div>') +
        '<div class="row"><button class="btn" id="go"' + (ok ? '' : ' disabled') + '>Je commence (' + mots.length + ' mots)</button></div>');
      $('go').addEventListener('click', function () { dictate(0); });
    }
    function dictate(i) {
      var list = groups[gi], m = list[i], last = i === list.length - 1;
      if (list[i + 1]) ui.prepare(list[i + 1].dire || list[i + 1].mot);
      ui.openWin(a.titre, '<div class="row spread"><span class="tag">Mot ' + (gi * size + i + 1) + ' / ' + mots.length + '</span>' +
        (groups.length > 1 ? '<span class="src">Ardoise ' + (gi + 1) + ' sur ' + groups.length + '</span>' : '') + '</div>' +
        '<div class="row center"><button class="btn sophia listen" id="listen">' + SPEAKER + ' Réécouter</button></div>' +
        '<p class="center">Écris le mot sur ton ardoise.</p>' +
        '<div class="row center"><button class="btn" id="next">' + (last ? 'J\'ai fini cette ardoise' : 'Mot suivant') + '</button></div><div id="fb" aria-live="polite"></div>' + School.aide.html());
      School.aide.bind(a, function () { return 'mot:' + a.mots.indexOf(m); });
      var play = function () { ui.say(m.dire || m.mot).catch(function () { $('fb').innerHTML = '<div class="callout">La voix ne répond pas. Réessaie dans un instant.</div>'; }); };
      $('listen').addEventListener('click', play);
      play();
      $('next').addEventListener('click', function () { ui.stopSpeaking(); if (last) photo(); else dictate(i + 1); });
    }
    function photo() {
      if (!reads) return check(null, '', null);
      ui.openWin(a.titre, '<p>Prends ton ardoise en photo, bien à plat, toute l\'ardoise dans l\'image.</p>' +
        '<div class="row"><label class="btn upload" for="snap">Prendre la photo<input type="file" id="snap" accept="image/*" capture="environment"></label>' +
        '<button class="btn alt" id="manual">Corriger sans photo</button></div><div id="fb" aria-live="polite"></div>');
      $('manual').addEventListener('click', function () { check(null, '', null); });
      $('snap').addEventListener('change', function () {
        var f = $('snap').files[0]; if (!f) return;
        $('fb').innerHTML = '<div class="callout">Sophia lit ton ardoise…</div>';
        shrink(f).then(function (img) { return store.ardoise(img, groups[gi].length); })
          .then(function (r) { check(Array.isArray(r && r.lus) ? r.lus : null, '', r && typeof r.photo === 'string' ? r.photo : null); },
            function () { check(null, 'Sophia n\'a pas pu lire la photo : coche toi-même les mots justes.', null); });
      });
    }
    // lus : ce que le modèle a lu, dans l'ordre de l'ardoise (ou null : on coche soi-même) ;
    // photo : identifiant de la photo gardée par le serveur (ou null).
    function check(lus, note, photo) {
      var list = groups[gi];
      ui.openWin(a.titre, (note ? '<div class="callout">' + esc(note) + '</div>' : '') +
        '<p>' + (lus ? 'Sophia a coché les mots qu\'elle trouve justes. <b>Vérifie</b> : si elle a mal lu ton écriture, change la case.' : 'Compare ton ardoise avec les mots : coche ceux que tu as bien écrits.') + '</p>' +
        '<div class="list">' + list.map(function (m, k) {
          var lu = lus ? String(lus[k] || '') : null, ok = lus ? norm(lu) === norm(m.mot) : false;
          return '<label class="item"><input type="checkbox" data-k="' + k + '"' + (ok ? ' checked' : '') + '><span><strong>' + esc(m.mot) + '</strong>' +
            (lus ? '<small>Sophia a lu : ' + (lu ? esc(lu) : '<i>rien</i>') + '</small>' : '') + '</span></label>';
        }).join('') + '</div><div class="row"><button class="btn" id="ok">C\'est vérifié</button></div>');
      $('ok').addEventListener('click', function () {
        $('win-body').querySelectorAll('input[data-k]').forEach(function (c) {
          var ok = c.checked; res.push({ ok: ok, premier: ok, essais: 1, mot: list[+c.getAttribute('data-k')].mot });
        });
        planches.push({ photo: photo, mots: list.map(function (m) { return m.mot; }), lus: lus ? list.map(function (m, k) { return String(lus[k] || ''); }) : null });
        gi++;
        if (gi < groups.length) { ui.openWin(a.titre, '<p>Efface ton ardoise : on continue !</p><div class="row"><button class="btn" id="go">Ardoise suivante</button></div>'); $('go').addEventListener('click', function () { dictate(0); }); }
        else end();
      });
    }
    function end() {
      var good = res.filter(function (r) { return r.ok; }).length, missed = res.filter(function (r) { return !r.ok; }).map(function (r) { return r.mot; });
      // Les mots ratés refaits ne comptent pas : c'est de l'entraînement.
      var won = only ? [] : School.app.record({ type: 'defi_termine', activite: a.id, score: good / res.length, resultats: res.map(function (r) { return { ok: r.ok, premier: r.premier, essais: 1 }; }), ardoises: planches });
      ui.openWin(a.titre, '<div class="score"><b>' + good + ' / ' + res.length + '</b><span>' + (good === res.length ? 'Sans faute, bravo !' : good / res.length >= 0.8 ? 'Très bien !' : 'Continue, ça vient !') + '</span></div>' + tools.badgesHTML(won) +
        (missed.length ? '<p>À revoir : ' + missed.map(function (m) { return '<b>' + esc(m) + '</b>'; }).join(', ') + '</p>' : '') +
        '<div class="row">' + (missed.length ? '<button class="btn" id="redo">Refaire les mots ratés</button>' : '') +
        '<button class="btn alt" id="again">Recommencer la dictée</button><button class="btn alt" id="close">Retour</button></div>');
      if ($('redo')) $('redo').addEventListener('click', function () { ardoise(a, tools, a.mots.filter(function (m) { return missed.indexOf(m.mot) !== -1; })); });
      $('again').addEventListener('click', function () { ardoise(a, tools); });
      $('close').addEventListener('click', tools.close);
    }
    intro();
  }

  School.engines = Object.assign(School.engines || {}, { ardoise: ardoise });
})(window);

// ---- lecture.js ----
// lecture.js — « Mes fiches de lecture » : l'élève remplit sa fiche sur papier (modèle de la
// classe), puis la prend en photo, recto et verso. Version SophIA : le modèle local recopie les
// rubriques (route /api/store/school/lecture ; le serveur garde les photos) ; l'élève vérifie au
// moins le titre et l'auteur, puis enregistre. Les parents voient photos et rubriques dans le
// livret ; Sophia pourra en parler dans le chat. Pas de note : une fiche faite compte comme faite.
(function (root) {
  'use strict';
  var School = root.School, ui = School.ui, $ = ui.$, esc = ui.esc;
  // Rubriques du modèle de fiche de la classe (recto, verso).
  var CHAMPS = [['titre', 'Titre'], ['auteur', 'Auteur'], ['illustrateur', 'Illustrateur'], ['editeur', 'Éditeur'], ['genre', 'Genre'],
    ['lieu', 'Où se déroule l\'histoire ?'], ['epoque', 'Quand se déroule l\'histoire ?'], ['personnage', 'Le personnage principal'],
    ['amis', 'Ses amis'], ['ennemis', 'Ses ennemis'], ['autres', 'Les autres personnages'], ['resume', 'L\'histoire en quelques lignes'],
    ['connexion', 'Connexion'], ['difficulte', 'J\'ai trouvé ce livre…'], ['aime', 'Ce que j\'ai aimé'], ['moins_aime', 'Ce que j\'ai moins aimé']];
  var LONG = { resume: 1, connexion: 1, aime: 1, moins_aime: 1 };

  function fiches(events, id) {
    return (events || []).filter(function (e) { return e && e.type === 'fiche_lecture' && (!id || e.activite === id); }).sort(function (a, b) { return a.t < b.t ? 1 : -1; });
  }
  function shrink(file) {
    return new Promise(function (ok, ko) {
      var img = new Image(), url = URL.createObjectURL(file);
      img.onload = function () {
        var k = Math.min(1, 2000 / Math.max(img.width, img.height)), c = document.createElement('canvas');
        c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url); ok(c.toDataURL('image/jpeg', 0.85));
      };
      img.onerror = function () { URL.revokeObjectURL(url); ko(new Error('photo illisible')); };
      img.src = url;
    });
  }
  // Photos gardées 7 jours au plus par le serveur (une ardoise : jusqu'à la correction du parent) ;
  // ensuite l'image n'existe plus : on le dit.
  function bindPhotos(box) {
    (box || document).querySelectorAll('img.ardoise-photo').forEach(function (img) {
      img.addEventListener('error', function () { img.outerHTML = '<p class="src">Photo effacée (correction validée, ou plus de 7 jours).</p>'; });
    });
  }
  // Une fiche en lecture seule (élève ou parent) : photos et rubriques.
  function ficheHTML(e, store) {
    var c = e.champs || {};
    return (e.photos || []).map(function (p, i) { return '<img class="ardoise-photo" alt="Fiche, ' + (i ? 'verso' : 'recto') + '" src="' + esc(store.photoUrl(p)) + '">'; }).join('') +
      '<dl class="fiche">' + CHAMPS.filter(function (f) { return c[f[0]]; }).map(function (f) { return '<dt>' + esc(f[1]) + '</dt><dd>' + esc(c[f[0]]) + '</dd>'; }).join('') + '</dl>';
  }

  function lecture(a, tools) {
    var store = School.app.store, reads = typeof store.lecture === 'function';
    function home() {
      var list = fiches(store.get().events, a.id);
      ui.openWin(a.titre, '<p>Remplis ta fiche de lecture sur papier, puis prends-la en photo, recto et verso.</p>' +
        '<div class="row"><button class="btn" id="new">Nouvelle fiche</button></div>' +
        (list.length ? '<h3 class="h3">Mes fiches</h3><div class="list">' + list.map(function (e) {
          var c = e.champs || {};
          return '<button class="item" data-fiche="' + esc(e.id) + '"><span><strong>' + esc(c.titre || 'Sans titre') + '</strong><small>' + esc([c.auteur, new Date(e.t).toLocaleDateString('fr-FR')].filter(Boolean).join(' · ')) + '</small></span></button>';
        }).join('') + '</div>' : ''));
      $('new').addEventListener('click', snap);
      $('win-body').querySelectorAll('[data-fiche]').forEach(function (b) {
        b.addEventListener('click', function () {
          var e = list.filter(function (x) { return x.id === b.getAttribute('data-fiche'); })[0];
          ui.openWin((e.champs && e.champs.titre) || 'Ma fiche', ficheHTML(e, store) + '<div class="row"><button class="btn alt" id="back">Mes fiches</button></div>');
          $('back').addEventListener('click', home);
          bindPhotos($('win-body'));
        });
      });
    }
    function snap() {
      var imgs = [null, null];
      ui.openWin(a.titre, '<p>Pose ta fiche bien à plat, toute la page dans l\'image.</p>' +
        '<div class="row"><label class="btn upload" for="recto">Photo du recto<input type="file" id="recto" accept="image/*" capture="environment"></label>' +
        '<label class="btn upload" for="verso">Photo du verso<input type="file" id="verso" accept="image/*" capture="environment"></label></div>' +
        '<p id="state" class="src">Aucune photo pour l\'instant.</p><div class="row"><button class="btn" id="send" disabled>' + (reads ? 'Envoyer à Sophia' : 'Continuer') + '</button><button class="btn alt" id="back">Retour</button></div><div id="fb" aria-live="polite"></div>');
      $('back').addEventListener('click', home);
      [['recto', 0], ['verso', 1]].forEach(function (x) {
        $(x[0]).addEventListener('change', function () {
          var f = $(x[0]).files[0]; if (!f) return;
          shrink(f).then(function (img) {
            imgs[x[1]] = img;
            $('state').textContent = (imgs[0] ? 'Recto ✓' : 'Recto à prendre') + ' · ' + (imgs[1] ? 'Verso ✓' : 'Verso à prendre');
            $('send').disabled = !imgs[0];
          }, function () { ui.toast('Cette photo ne s\'ouvre pas. Reprends-la.'); });
        });
      });
      $('send').addEventListener('click', function () {
        var sent = imgs.filter(Boolean);
        if (!reads) return check({}, [], '');
        $('send').disabled = true; $('fb').innerHTML = '<div class="callout">Sophia lit ta fiche…</div>';
        store.lecture(sent).then(function (r) { check((r && r.champs) || {}, (r && r.photos) || [], ''); },
          function () { $('send').disabled = false; $('fb').innerHTML = '<div class="callout">Sophia n\'a pas pu lire la fiche. Réessaie dans un instant.</div>'; });
      });
    }
    // Vérification : titre et auteur en premier ; les autres rubriques se relisent et se corrigent.
    function check(champs, photos, note) {
      ui.openWin(a.titre, (note ? '<div class="callout">' + esc(note) + '</div>' : '') +
        '<p>' + (photos.length ? 'Voici ce que Sophia a lu. <b>Vérifie au moins le titre et l\'auteur</b>, et corrige si besoin.' : 'Écris au moins le titre et l\'auteur de ton livre.') + '</p>' +
        CHAMPS.map(function (f) {
          var v = esc(champs[f[0]] || ''), id = 'f-' + f[0];
          return '<label class="field" for="' + id + '">' + esc(f[1]) + (LONG[f[0]] ? '<textarea id="' + id + '" rows="3" maxlength="1500">' + v + '</textarea>' : '<input id="' + id + '" maxlength="120" value="' + v + '">') + '</label>';
        }).join('') + '<div class="row"><button class="btn" id="save">Enregistrer ma fiche</button></div>');
      $('save').addEventListener('click', function () {
        var out = {};
        CHAMPS.forEach(function (f) { var v = $('f-' + f[0]).value.trim(); if (v) out[f[0]] = v; });
        if (!out.titre) return ui.toast('Écris le titre du livre.');
        var won = School.app.record({ type: 'fiche_lecture', activite: a.id, photos: photos, champs: out });
        ui.openWin(a.titre, '<div class="callout safe">Fiche de lecture enregistrée : « ' + esc(out.titre) + ' ». Bravo !</div>' + tools.badgesHTML(won) +
          '<div class="row"><button class="btn" id="back">Mes fiches</button><button class="btn alt" id="close">Retour</button></div>');
        $('back').addEventListener('click', home);
        $('close').addEventListener('click', tools.close);
      });
    }
    home();
  }

  School.engines = Object.assign(School.engines || {}, { lecture: lecture });
  School.lecture = { fiches: fiches, ficheHTML: ficheHTML, bindPhotos: bindPhotos };
})(window);

// ---- multimalins.js ----
// multimalins.js — Les nombres-personnages (d'après la méthode des Multimalins) : chaque chiffre a
// deux personnages, un en 1re position (premier nombre du calcul, chiffre des dizaines du
// résultat) et un en 2e position (second nombre, chiffre des unités). Le plus petit nombre vient
// toujours en premier.
//   « galerie »  : tous les personnages, dessinés, par position ;
//   « histoire » : la carte d'un calcul (personnages dessinés + histoire écoutable), puis trois
//                  questions : qui est le premier nombre, qui arrive pour le résultat, le résultat.
// Les dessins sont ici (le moteur) ; les histoires sont des contenus (champ « texte »).
(function (root) {
  'use strict';
  var School = root.School, ui = School.ui, $ = ui.$, esc = ui.esc;
  var INK = '#2a2240';
  var SPEAKER = '<svg viewBox="0 0 24 24" width="22" height="22" aria-hidden="true"><path d="M4 9 H8 L13 5 V19 L8 15 H4 Z" fill="currentColor"/><path d="M16 8 Q19 12 16 16 M18.5 5.5 Q23 12 18.5 18.5" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round"/></svg>';

  // [nom, dessin (viewBox 0 0 100 100)] ; null : le personnage n'existe pas à cette position.
  var EGG = '<ellipse cx="50" cy="34" rx="24" ry="28" fill="#fffaf0" stroke="' + INK + '" stroke-width="3"/><path d="M70 50 Q74 80 50 94" stroke="' + INK + '" stroke-width="10" fill="none" stroke-linecap="round"/><circle cx="42" cy="30" r="4" fill="' + INK + '"/><circle cx="58" cy="30" r="4" fill="' + INK + '"/><path d="M42 44 Q50 50 58 44" stroke="' + INK + '" stroke-width="2.5" fill="none"/>';
  var P = {
    1: [
      null,
      ['la chenille', '<path d="M30 90 V30 L50 14" stroke="#8bd35a" stroke-width="16" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="50" cy="16" r="10" fill="#8bd35a" stroke="' + INK + '" stroke-width="3"/><circle cx="53" cy="14" r="3" fill="' + INK + '"/><path d="M22 40 h16 M22 55 h16 M22 70 h16" stroke="' + INK + '" stroke-width="2"/>'],
      ['le poussin', '<path d="M22 34 Q50 4 74 34 Q78 50 28 86 H80" stroke="#ffd54d" stroke-width="16" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="44" cy="24" r="4" fill="' + INK + '"/><path d="M30 26 L18 30 L30 34 Z" fill="#ff9f6e" stroke="' + INK + '" stroke-width="2"/>'],
      ['la bouche de chien', '<path d="M24 20 Q74 14 70 44 Q60 52 44 52 Q78 54 72 80 Q60 94 22 84" stroke="#c49a6c" stroke-width="16" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M40 52 l4 6 l4 -6 M52 52 l4 6 l4 -6" fill="#fff" stroke="' + INK + '" stroke-width="2"/><circle cx="56" cy="30" r="4" fill="' + INK + '"/><ellipse cx="72" cy="22" rx="6" ry="4" fill="' + INK + '"/>'],
      ['la planche à voile', '<path d="M64 10 L22 64 H64 Z" fill="#ff8fbf" stroke="' + INK + '" stroke-width="3"/><path d="M64 10 V92" stroke="' + INK + '" stroke-width="6"/><path d="M10 92 H90" stroke="#8fd2ff" stroke-width="8" stroke-linecap="round"/>'],
      ['le serpent', '<path d="M76 14 H34 L30 48 Q70 36 74 64 Q72 90 30 84" stroke="#8bd35a" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="72" cy="12" r="9" fill="#8bd35a" stroke="' + INK + '" stroke-width="3"/><circle cx="74" cy="10" r="3" fill="' + INK + '"/><path d="M80 14 l10 2 l-4 3 m4 -3 l-4 -3" stroke="#ff4d6d" stroke-width="2" fill="none"/>'],
      ['le rhinocéros', '<path d="M64 12 Q30 20 30 60 A22 22 0 1 0 52 40 Q40 42 32 52" stroke="#a0b4c8" stroke-width="15" fill="none" stroke-linecap="round"/><path d="M62 8 L76 2 L70 14 Z" fill="#fff" stroke="' + INK + '" stroke-width="2.5"/><circle cx="56" cy="22" r="4" fill="' + INK + '"/>'],
      ['le plongeoir', '<path d="M16 16 H80 L44 92" stroke="#ffc04d" stroke-width="14" fill="none" stroke-linejoin="round" stroke-linecap="round"/><path d="M10 96 H92" stroke="#8fd2ff" stroke-width="8" stroke-linecap="round"/><path d="M20 10 V22 M34 10 V22 M48 10 V22" stroke="' + INK + '" stroke-width="2"/>'],
      ['le bonhomme à lunettes', '<circle cx="50" cy="28" r="20" fill="#ffd9a8" stroke="' + INK + '" stroke-width="3"/><circle cx="50" cy="72" r="24" fill="#8fd2ff" stroke="' + INK + '" stroke-width="3"/><circle cx="42" cy="26" r="7" fill="#fff" stroke="' + INK + '" stroke-width="3"/><circle cx="58" cy="26" r="7" fill="#fff" stroke="' + INK + '" stroke-width="3"/><circle cx="42" cy="26" r="2.5" fill="' + INK + '"/><circle cx="58" cy="26" r="2.5" fill="' + INK + '"/><path d="M42 38 Q50 44 58 38" stroke="' + INK + '" stroke-width="2.5" fill="none"/>'],
      ['le bonhomme tête d\'œuf', EGG],
    ],
    2: [
      ['le cerceau', '<ellipse cx="50" cy="50" rx="30" ry="38" fill="none" stroke="#ff8fbf" stroke-width="12"/><path d="M28 30 l8 6 M68 70 l6 6" stroke="#fff" stroke-width="4" stroke-linecap="round"/>'],
      ['le totem', '<rect x="38" y="10" width="24" height="84" rx="4" fill="#c49a6c" stroke="' + INK + '" stroke-width="3"/><path d="M38 38 H62 M38 66 H62" stroke="' + INK + '" stroke-width="3"/><circle cx="45" cy="22" r="3" fill="' + INK + '"/><circle cx="55" cy="22" r="3" fill="' + INK + '"/><path d="M26 18 L38 24 M74 18 L62 24" stroke="#ff8fbf" stroke-width="6" stroke-linecap="round"/>'],
      ['le cygne', '<path d="M26 30 Q50 2 72 30 Q74 48 34 80 H84" stroke="#fff" stroke-width="16" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M26 30 Q50 2 72 30 Q74 48 34 80 H84" stroke="' + INK + '" stroke-width="2" fill="none"/><circle cx="40" cy="24" r="3.5" fill="' + INK + '"/><path d="M28 26 L16 30 L28 34 Z" fill="#ff9f6e" stroke="' + INK + '" stroke-width="2"/><path d="M10 92 Q30 86 50 92 Q70 98 92 90" stroke="#8fd2ff" stroke-width="5" fill="none"/>'],
      ['l\'os', '<path d="M30 16 Q74 12 68 42 Q60 50 46 50 Q76 54 70 80 Q60 92 30 86" stroke="#fff" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M30 16 Q74 12 68 42 Q60 50 46 50 Q76 54 70 80 Q60 92 30 86" stroke="' + INK + '" stroke-width="2" fill="none"/><circle cx="28" cy="12" r="7" fill="#fff" stroke="' + INK + '" stroke-width="2"/><circle cx="28" cy="22" r="7" fill="#fff" stroke="' + INK + '" stroke-width="2"/><circle cx="28" cy="82" r="7" fill="#fff" stroke="' + INK + '" stroke-width="2"/><circle cx="28" cy="92" r="7" fill="#fff" stroke="' + INK + '" stroke-width="2"/>'],
      ['l\'aile d\'oiseau', '<path d="M66 8 L18 64 H86 M66 8 V94" stroke="#d9ccff" stroke-width="14" fill="none" stroke-linejoin="round" stroke-linecap="round"/><path d="M30 64 l6 -10 M44 64 l6 -12 M58 64 l4 -12" stroke="' + INK + '" stroke-width="2"/>'],
      ['la toupie', '<path d="M74 12 H36 L32 46 Q70 36 72 64 Q70 88 32 84" stroke="#ff9f6e" stroke-width="14" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M14 94 Q50 86 86 94" stroke="' + INK + '" stroke-width="2" stroke-dasharray="4 4" fill="none"/>'],
      ['la luge', '<path d="M66 10 Q32 18 32 60 A20 20 0 1 0 52 40 Q40 42 34 52" stroke="#ff4d6d" stroke-width="12" fill="none" stroke-linecap="round"/><path d="M14 92 H88" stroke="' + INK + '" stroke-width="4" stroke-linecap="round"/>'],
      ['la canne de cow-boy', '<path d="M20 22 Q20 8 36 10 H80 L46 94" stroke="#8a5a3c" stroke-width="12" fill="none" stroke-linejoin="round" stroke-linecap="round"/>'],
      ['le lasso', '<path d="M50 50 C20 40 20 8 50 8 C80 8 80 40 50 50 C16 60 16 94 50 94 C84 94 84 60 50 50" stroke="#c49a6c" stroke-width="8" fill="none"/><path d="M76 80 Q90 86 96 98" stroke="#c49a6c" stroke-width="6" fill="none" stroke-linecap="round"/>'],
      ['le bonhomme tête d\'œuf', EGG],
    ],
  };
  var MYSTERE = '<circle cx="50" cy="50" r="38" fill="#fff" stroke="' + INK + '" stroke-width="3" stroke-dasharray="8 6"/><text x="50" y="66" text-anchor="middle" font-size="46" font-weight="800" fill="' + INK + '">?</text>';

  function perso(pos, d) { return (P[pos] || [])[d] || null; }
  function nom(pos, d) { var p = perso(pos, d); return p ? p[0] : ''; }
  // Un personnage dessiné, avec son chiffre et son nom.
  function figure(pos, d, size) {
    var p = d == null ? ['un personnage', MYSTERE] : perso(pos, d);
    return '<figure class="mm"><svg viewBox="0 0 100 100" width="' + (size || 88) + '" height="' + (size || 88) + '" role="img" aria-label="' + esc(p[0]) + '">' + p[1] + '</svg>' +
      '<figcaption>' + (d == null ? '' : '<b class="mm-d">' + d + '</b> ') + esc(p[0]) + '</figcaption></figure>';
  }
  function parse(calcul) {
    var m = /^(\d)([x+])(\d)$/.exec(calcul);
    var a = +m[1], b = +m[3], op = m[2], r = op === 'x' ? a * b : a + b;
    return { a: a, b: b, op: op, r: r, signe: op === 'x' ? '×' : '+', dz: r >= 10 ? Math.floor(r / 10) : null, u: r % 10 };
  }
  // Les personnages de la carte : × 0 et × 1 sont des règles, pas un calcul (un personnage quelconque).
  function cast(c, calcul) {
    if (calcul === '0x0') return { gauche: [figure(1, null)], droite: [figure(2, 0)], resultat: [figure(2, 0)], ecrit: 'n × 0 = 0' };
    if (calcul === '1x1') return { gauche: [figure(1, null)], droite: [figure(2, 1)], resultat: [figure(1, null)], ecrit: 'n × 1 = n' };
    return { gauche: [figure(1, c.a)], droite: [figure(2, c.b)], resultat: (c.dz != null ? [figure(1, c.dz)] : []).concat([figure(2, c.u)]), ecrit: c.a + ' ' + c.signe + ' ' + c.b + ' = ' + c.r };
  }
  function carte(a) {
    var c = parse(a.calcul), k = cast(c, a.calcul);
    return '<div class="mm-carte"><div class="mm-strip">' + k.gauche.join('') + '<span class="mm-op">' + c.signe + '</span>' + k.droite.join('') +
      '<span class="mm-op">=</span>' + k.resultat.join('') + '</div><p class="mm-calc">' + esc(k.ecrit) + '</p><p class="mm-texte">' + a.texte + '</p></div>';
  }
  function plain(html) { var d = document.createElement('div'); d.innerHTML = html; return d.textContent; }
  function shuffle(l) { return School.lexique.shuffle(l, Math.random); }
  function others(pos, good, n) {
    var all = []; for (var d = 0; d <= 9; d++) { var p = perso(pos, d); if (p && p[0] !== good) all.push(p[0]); }
    return shuffle(all).slice(0, n);
  }

  // ---------- Galerie ----------
  function galerie(a, tools) {
    var row = function (pos) { var h = ''; for (var d = 0; d <= 9; d++) h += perso(pos, d) ? figure(pos, d, 70) : '<figure class="mm off"><span>—</span><figcaption><b class="mm-d">' + d + '</b> n\'existe pas</figcaption></figure>'; return h; };
    ui.openWin(a.titre, '<p>Chaque chiffre a deux personnages. <b>1re position</b> : le premier nombre du calcul (le plus petit) et le chiffre des dizaines du résultat. <b>2e position</b> : le second nombre et le chiffre des unités.</p>' +
      '<h3 class="h3">1re position</h3><div class="mm-galerie">' + row(1) + '</div><h3 class="h3">2e position</h3><div class="mm-galerie">' + row(2) + '</div>' +
      '<div class="row"><button class="btn" id="seen">Je connais mes personnages</button></div><div id="after"></div>');
    $('seen').addEventListener('click', function () {
      var first = !School.app.progress().done[a.id], won = first ? School.app.record({ type: 'lecon_lue', activite: a.id }) : [];
      $('seen').disabled = true;
      $('after').innerHTML = '<div class="callout safe">' + (first ? 'Bravo, +10 points.' : 'Déjà noté.') + '</div>' + tools.badgesHTML(won) + '<div class="row"><button class="btn alt" id="close">Retour</button></div>';
      $('close').addEventListener('click', tools.close);
    });
  }

  // ---------- Histoire ----------
  // Trois questions : le personnage du premier nombre ; ceux du résultat ; le résultat écrit.
  function questions(a) {
    var c = parse(a.calcul), qs = [];
    if (a.calcul === '0x0') {
      var b0 = 2 + Math.floor(Math.random() * 8);
      qs.push({ q: 'Qui est le 0 ?', choix: shuffle([nom(2, 0)].concat(others(2, nom(2, 0), 2))), bonne: nom(2, 0) });
      qs.push({ q: 'Dans quoi tombe-t-on quand on multiplie par 0 ?', choix: shuffle(['dans le trou du cerceau', 'dans le miroir du totem', 'sur le dos du cygne']), bonne: 'dans le trou du cerceau' });
      qs.push({ q: b0 + ' × 0 = ?', ecrire: '0' });
    } else if (a.calcul === '1x1') {
      var b1 = 2 + Math.floor(Math.random() * 8);
      qs.push({ q: 'Qui est le 1 en 2e position ?', choix: shuffle([nom(2, 1)].concat(others(2, nom(2, 1), 2))), bonne: nom(2, 1) });
      qs.push({ q: 'Que voit-on dans le miroir du totem ?', choix: shuffle(['soi-même, et rien d\'autre', 'deux fois plus de personnages', 'le trou du cerceau']), bonne: 'soi-même, et rien d\'autre' });
      qs.push({ q: b1 + ' × 1 = ?', ecrire: String(b1) });
    } else {
      var res = (c.dz != null ? nom(1, c.dz) + ' et ' : '') + nom(2, c.u), fake = [];
      for (var t = 0; fake.length < 2 && t < 50; t++) {
        var r = c.r + (Math.floor(Math.random() * 7) - 3) * (c.op === 'x' ? c.a : 1); if (r <= 0 || r === c.r) continue;
        var f = (r >= 10 ? nom(1, Math.floor(r / 10)) + ' et ' : '') + nom(2, r % 10); if (f !== res && fake.indexOf(f) === -1) fake.push(f);
      }
      qs.push({ q: 'Dans l\'histoire, qui est le ' + c.a + ' (1re position) ?', choix: shuffle([nom(1, c.a)].concat(others(1, nom(1, c.a), 2))), bonne: nom(1, c.a) });
      qs.push({ q: 'Qui arrive à la fin, pour le résultat ?', choix: shuffle([res].concat(fake)), bonne: res });
      qs.push({ q: c.a + ' ' + c.signe + ' ' + c.b + ' = ?', ecrire: String(c.r) });
    }
    return qs;
  }
  function histoire(a, tools) {
    var canSay = ui.canSay();
    function lire() {
      ui.openWin(a.titre, carte(a) + '<div class="row">' + (canSay ? '<button class="btn alt listen" id="listen">' + SPEAKER + ' Écouter l\'histoire</button>' : '') +
        '<button class="btn" id="go">Je joue</button></div>');
      if ($('listen')) $('listen').addEventListener('click', function () { ui.say(plain(a.texte)).catch(function () { ui.toast('La voix ne répond pas. Réessaie dans un instant.'); }); });
      $('go').addEventListener('click', function () { ui.stopSpeaking(); jouer(questions(a), 0, []); });
    }
    function jouer(qs, i, res) {
      var q = qs[i], essais = 0;
      ui.openWin(a.titre, '<div class="row spread"><span class="tag">Question ' + (i + 1) + ' sur ' + qs.length + '</span><button class="btn alt" id="revoir">Revoir l\'histoire</button></div>' +
        '<div class="callout"><b>' + esc(q.q) + '</b></div>' +
        (q.ecrire ? '<p class="clique"><input class="trou" id="trou" size="4" inputmode="numeric" autocomplete="off" aria-label="Ta réponse"></p><div class="row"><button class="btn" id="check">Je valide</button></div>'
          : '<div class="opts">' + q.choix.map(function (c, k) { return '<label><input type="radio" name="q" value="' + k + '"> ' + esc(c) + '</label>'; }).join('') + '</div><div class="row"><button class="btn" id="check">Je réponds</button></div>') +
        '<div id="fb" aria-live="polite"></div>');
      $('revoir').addEventListener('click', function () { ui.openWin(a.titre, carte(a) + '<div class="row"><button class="btn" id="back">Je reprends la question</button></div>'); $('back').addEventListener('click', function () { jouer(qs, i, res); }); });
      if ($('trou')) { $('trou').focus(); $('trou').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('check').click(); } }); }
      $('check').addEventListener('click', function () {
        var v = q.ecrire ? $('trou').value.trim() : (document.querySelector('input[name="q"]:checked') || {}).value;
        if (v == null || v === '') return ui.toast(q.ecrire ? 'Écris ta réponse.' : 'Choisis une réponse.');
        essais++;
        var ok = q.ecrire ? v === q.ecrire : q.choix[+v] === q.bonne;
        if (!ok && essais === 1) { $('fb').innerHTML = '<div class="callout">Pas encore ! Repense à l\'histoire : ' + esc(plain(a.texte).replace(/\s*\S+ (fois|plus) [^.]*\.\s*$/, '').replace(/\s*\(\d\)/g, '')) + '</div>'; return; }
        res.push({ ok: ok, premier: ok && essais === 1, essais: essais });
        $('check').disabled = true;
        var last = i === qs.length - 1;
        $('fb').innerHTML = '<div class="callout ' + (ok ? 'safe' : '') + '">' + (ok ? '<b>Bravo !</b>' : '<b>La réponse :</b> ' + esc(q.ecrire || q.bonne) + '.') + '</div>' +
          '<div class="row"><button class="btn" id="next">' + (last ? 'Voir mon score' : 'Question suivante') + '</button></div>';
        $('next').addEventListener('click', function () { if (last) return fin(res); jouer(qs, i + 1, res); });
        $('next').focus();
      });
    }
    function fin(res) {
      var ok = res.filter(function (r) { return r.ok; }).length, won = School.app.record({ type: 'defi_termine', activite: a.id, score: ok / res.length, resultats: res });
      ui.openWin(a.titre, '<div class="score"><b>' + ok + ' / ' + res.length + '</b><span>' + (ok === res.length ? 'Sans faute, bravo !' : 'Relis l\'histoire et rejoue : tu vas y arriver.') + '</span></div>' + tools.badgesHTML(won) +
        '<div class="row"><button class="btn alt" id="again">Rejouer</button><button class="btn" id="close">Retour</button></div>');
      $('again').addEventListener('click', function () { histoire(a, tools); });
      $('close').addEventListener('click', tools.close);
    }
    lire();
  }

  School.engines = Object.assign(School.engines || {}, { histoire: histoire, galerie: galerie });
  School.multimalins = { nom: nom, parse: parse };
})(window);

// ---- carnet-ui.js ----
// carnet-ui.js — Carnet de notes et bulletin de l'école réelle (version SophIA).
//
// Par matière : l'élève recopie ses évaluations (ou les importe d'un tableur), les corrige ou
// les retire ; une courbe par trimestre montre sa progression, la moyenne de la classe et les
// jours de travail avec Sophia. « Mon bulletin » : toutes les matières d'un niveau, période par
// période, et la moyenne générale. Le parent voit les mêmes vues dans le livret, en lecture
// seule. Primaire : compétences NA à A+, sans moyenne ni comparaison. Calculs : carnet.js.
(function (root) {
  'use strict';
  var School = root.School, ui = School.ui, $ = ui.$, esc = ui.esc, C = School.carnet;
  var D = root.SCHOOL_DATA;
  var COMP_COLORS = { NA: '#ff8f8f', PA: '#ffc04d', A: '#8fdcc4', 'A+': '#2fbf98' };
  var PERIOD_NAMES = { T1: '1er trimestre', T2: '2e trimestre', T3: '3e trimestre', S1: '1er semestre', S2: '2e semestre' };

  // Le carnet est celui des élèves (version SophIA) : les adultes ne sont plus à l'école.
  function enabled() {
    if (D.variante !== 'sophia' || !School.app || !School.app.store) return false;
    var p = School.app.store.get().profil || {};
    return p.role === 'proteges';
  }
  // La malle : les élèves (leurs archives) et les parents (celles de leurs enfants).
  function isParent() {
    if (D.variante !== 'sophia' || !School.app || !School.app.store) return false;
    var p = School.app.store.get().profil || {};
    return p.role === 'admin' || p.role === 'responsables';
  }
  function malleVisible() { return enabled() || isParent(); }
  function myClass() { return enabled() ? C.currentClass(School.app.store.get().events) : null; }
  function isMyClass(n) { var c = myClass(); return !!c && c.niveau === n; }
  function nextLevel(n) { var ids = D.niveaux.map(function (x) { return x.id; }), i = ids.indexOf(n); return i !== -1 && i + 1 < ids.length ? ids[i + 1] : null; }
  function niveauDef(n) { return D.niveaux.filter(function (x) { return x.id === n; })[0] || null; }
  function notation(niveau) { var n = niveauDef(niveau); return n && n.notation || 'notes'; }
  function subjectName(m) { return (D.matieres[m] && D.matieres[m].nom) || (D.nomsMatieres || {})[m] || m; }
  function subjectColor(m) { var c = (D.catalogue || []).filter(function (x) { return x.id === m; })[0]; return c && c.couleur || '#b7aed0'; }
  function levelName(n) { var x = niveauDef(n); return x ? x.nom : n; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function dateFr(d) { var p = String(d).split('-'); return p.length === 3 ? new Date(+p[0], +p[1] - 1, +p[2]).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short', year: 'numeric' }) : d; }
  function newId() {
    var c = root.crypto;
    if (c && typeof c.randomUUID === 'function') return c.randomUUID();
    var h = '0123456789abcdef', s = '';
    for (var i = 0; i < 36; i++) s += i === 8 || i === 13 || i === 18 || i === 23 ? '-' : i === 14 ? '4' : h[(Math.random() * 16) | 0];
    return s;
  }
  // Couleur d'un résultat : vert à partir de 15/20, bleu de 10 à 15, orange en dessous.
  function band(v20) { return v20 >= 15 ? '#2fbf98' : v20 >= 10 ? '#7ab8ff' : '#ffa25c'; }
  function bandWord(v20) { return v20 >= 15 ? 'Très bien' : v20 >= 10 ? 'Bien' : 'À renforcer'; }
  // Moyennes (collège) : toujours deux chiffres après la virgule, comme sur le bulletin (14,00 ; 11,67).
  function avg2(v) { return (Math.round(v * 100) / 100).toFixed(2).replace('.', ','); }
  function f20(v) { return v == null ? '–' : avg2(v); }
  function result(n) {
    if (n.absent) return '<b class="abs">Absente</b>';
    if (n.competence) return '<b class="comp" style="background:' + COMP_COLORS[n.competence] + '">' + esc(n.competence) + '</b>';
    return '<b>' + C.fr(n.note, 2) + ' / ' + C.fr(n.bareme, 2) + '</b>' + (n.coef !== 1 ? ' <span class="src">coef ' + C.fr(n.coef, 2) + '</span>' : '') +
      (n.moyenne_classe != null ? ' <span class="src">· classe ' + C.fr(n.moyenne_classe, 2) + '</span>' : '');
  }
  function events(opts) { return opts.events || School.app.store.get().events; }
  // Réactions de Sophia aux notes (version SophIA, carnet de l'élève connectée) : { note_id: texte }.
  var reactions = null;
  function loadReactions(done) {
    var s = School.app.store;
    if (reactions || !s.reactions) return done();
    s.reactions().then(function (list) { reactions = {}; list.forEach(function (r) { reactions[r.note_id] = r.texte; }); done(); }, function () { reactions = {}; done(); });
  }
  function bubble(texte, loading) {
    return '<div class="sophia-says' + (loading ? ' loading' : '') + '"><img src="/images/SophIA.svg" alt="" class="sophia-ico"><p>' + esc(texte) + '</p></div>';
  }
  function record(e) { return School.app.record(e); }

  // ---------- Courbe d'une matière ----------
  // Bandes : une par période. Points : les évaluations (sur 20 ; primaire : NA à A+), colorés ;
  // étoile : le meilleur résultat ; trait épais : la moyenne au fil du temps ; tirets roses : la
  // moyenne de la classe de la période. En bas : les jours de travail avec Sophia.
  function chart(notes, rows, byDay, mode) {
    var days = Object.keys(byDay).sort(), all = notes.map(function (n) { return n.date; }).concat(days).sort();
    if (!notes.length) return '';
    var t0 = Date.parse(all[0]), t1 = Date.parse(all[all.length - 1]);
    if (t1 - t0 < 21 * 864e5) { t0 -= 10 * 864e5; t1 += 10 * 864e5; }
    t0 -= 4 * 864e5; t1 += 4 * 864e5;
    var W = 640, H = 260, L = 40, R = 14, T = 26, B = 206;
    var x = function (d) { return L + (Date.parse(d) - t0) / (t1 - t0) * (W - L - R); };
    var yv = function (v) { return B - v / 20 * (B - T); };
    var yc = function (n) { return B - 10 - C.score(n) * (B - T - 20); };
    var g = '';
    // Bandes des périodes
    rows.forEach(function (r, i) {
      var ds = r.notes.map(function (n) { return n.date; }).sort();
      if (!ds.length) return;
      var a = Math.max(L, x(ds[0]) - 10), b = Math.min(W - R, x(ds[ds.length - 1]) + 10);
      g += '<rect x="' + a + '" y="' + T + '" width="' + Math.max(8, b - a) + '" height="' + (B - T) + '" rx="8" class="band b' + (i % 2) + '"/>' +
        '<text x="' + ((a + b) / 2) + '" y="' + (T - 8) + '" text-anchor="middle" class="ax per">' + esc(r.periode) + '</text>';
      if (mode === 'notes' && r.classe != null) g += '<line x1="' + a + '" x2="' + (a + Math.max(8, b - a)) + '" y1="' + yv(r.classe) + '" y2="' + yv(r.classe) + '" class="cls"><title>Moyenne de la classe (' + r.periode + ') : ' + f20(r.classe) + '</title></line>';
    });
    if (mode === 'competences') C.COMPETENCES.forEach(function (c, i) { var yy = B - 10 - i / 3 * (B - T - 20); g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yy + '" y2="' + yy + '" class="grid"/><text x="' + (L - 6) + '" y="' + (yy + 4) + '" text-anchor="end" class="ax">' + c + '</text>'; });
    else [0, 5, 10, 15, 20].forEach(function (v) { g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + yv(v) + '" y2="' + yv(v) + '" class="grid' + (v === 10 ? ' mid' : '') + '"/><text x="' + (L - 6) + '" y="' + (yv(v) + 4) + '" text-anchor="end" class="ax">' + v + '</text>'; });
    days.forEach(function (d) { var h = Math.min(20, 6 + byDay[d] * 3); g += '<rect x="' + (x(d) - 2.5) + '" y="' + (H - 10 - h) + '" width="5" height="' + h + '" rx="2.5" class="sophia"><title>' + esc(dateFr(d)) + ' : ' + byDay[d] + ' activité(s) avec Sophia</title></rect>'; });
    if (days.length) g += '<text x="' + L + '" y="' + (H - 36) + '" class="ax">Avec Sophia</text>';
    var counted = notes.filter(C.counted), top = C.best(notes);
    if (mode === 'notes') {
      var run = C.runningAverage(notes);
      if (run.length > 1) g += '<polyline class="avg" points="' + run.map(function (p) { return x(p.date) + ',' + yv(p.moyenne); }).join(' ') + '"/>';
    } else if (counted.length > 1) g += '<polyline class="avg thin" points="' + counted.map(function (n) { return x(n.date) + ',' + yc(n); }).join(' ') + '"/>';
    notes.forEach(function (n) {
      var tip = esc(dateFr(n.date) + ' · ' + (n.intitule || 'Évaluation') + ' · ');
      if (n.absent) { g += '<circle cx="' + x(n.date) + '" cy="' + (B - 4) + '" r="6" class="pt absent"><title>' + tip + 'absente</title></circle>'; return; }
      var cx = x(n.date), cy = mode === 'notes' ? yv(C.on20(n)) : yc(n), fill = mode === 'notes' ? band(C.on20(n)) : COMP_COLORS[n.competence];
      if (n === top) g += '<g class="best">' + ui.star(cx, cy, true, 13) + '<title>' + tip + 'meilleur résultat</title></g>';
      else g += '<circle cx="' + cx + '" cy="' + cy + '" r="7" fill="' + fill + '" class="pt"><title>' + tip + (mode === 'notes' ? C.fr(n.note, 2) + '/' + C.fr(n.bareme, 2) : C.COMPETENCE_NOMS[n.competence]) + '</title></circle>';
    });
    return '<svg class="carnet-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Courbe de progression">' + g + '</svg>' +
      '<p class="src legend">' + (mode === 'notes' ? '<span class="dot" style="background:#2fbf98"></span> 15 et plus · <span class="dot" style="background:#7ab8ff"></span> 10 à 15 · <span class="dot" style="background:#ffa25c"></span> moins de 10 · ★ ta meilleure note · — ta moyenne · <span class="dash"></span> la classe'
        : '★ ton meilleur résultat') + (days.length ? ' · <span class="sw"></span> travail avec Sophia' : '') + '</p>';
  }

  // ---------- Résumé ----------
  function hero(notes, rows, byDay, mode, who) {
    var out = [], counted = notes.filter(C.counted);
    if (!counted.length) return '';
    if (mode === 'notes') {
      var cur = rows.filter(function (r) { return r.eleve != null; }), last = cur[cur.length - 1], prev = cur[cur.length - 2];
      if (last) {
        var delta = prev ? last.eleve - prev.eleve : null;
        out.push('<div class="hero" style="--c:' + band(last.eleve) + '"><div class="big-num">' + f20(last.eleve) + '<small> / 20</small></div><div><b>' + esc(PERIOD_NAMES[last.periode] || last.periode) + '</b>' +
          (last.eleveBulletin ? ' <span class="tag">bulletin</span>' : '') + '<br><span>' + bandWord(last.eleve) + (who ? '' : ' !') + '</span>' +
          (delta != null && Math.abs(delta) >= 0.1 ? '<br><span class="delta ' + (delta > 0 ? 'up' : 'down') + '">' + (delta > 0 ? '▲ +' : '▼ ') + avg2(delta) + ' depuis le ' + esc(PERIOD_NAMES[prev.periode] || prev.periode) + '</span>' : '') +
          (last.classe != null ? '<br><span class="src">Classe : ' + f20(last.classe) + '</span>' : '') + '</div></div>');
      }
      var top = C.best(notes), ab = C.aboveClass(notes);
      var facts = ['<li>★ Meilleure note : <b>' + C.fr(top.note, 2) + '/' + C.fr(top.bareme, 2) + '</b>' + (top.intitule ? ' (' + esc(top.intitule) + ')' : '') + '</li>'];
      if (ab.sur) facts.push('<li>Au niveau de la classe ou au-dessus : <b>' + ab.au_dessus + ' fois sur ' + ab.sur + '</b></li>');
      out.push('<ul class="facts">' + facts.join('') + '</ul>');
    } else {
      var c = C.counts(notes);
      out.push('<div class="stack" role="img" aria-label="Répartition des résultats">' + C.COMPETENCES.map(function (k) { return c[k] ? '<span style="flex:' + c[k] + ';background:' + COMP_COLORS[k] + '">' + k + ' · ' + c[k] + '</span>' : ''; }).join('') + '</div>');
      var good = c.A + c['A+'];
      if (good) out.push('<p>' + (who ? esc(who) + ' a' : 'Tu as') + ' réussi <b>' + good + '</b> évaluation' + (good > 1 ? 's' : '') + ' sur ' + counted.length + '.</p>');
    }
    var tr = C.trend(notes);
    if (tr) out.push('<p>' + { hausse: '📈 Ça monte sur les dernières évaluations !', baisse: 'Les dernières évaluations sont un peu moins bonnes : regarde ce qu\'il faut travailler.', stable: 'Résultats réguliers sur les dernières évaluations.' }[tr] + '</p>');
    var eff = C.sophiaEffect(notes, byDay);
    if (eff && eff.avant != null) {
      var fmt = mode === 'notes' ? function (v) { return avg2(v * 20) + '/20'; } : function (v) { return C.COMPETENCES[Math.round(v * 3)]; };
      out.push('<p class="callout safe">Avant le travail avec Sophia (' + eff.nAvant + ' évaluations) : <b>' + fmt(eff.avant) + '</b> en moyenne. Depuis (' + eff.nApres + ') : <b>' + fmt(eff.apres) + '</b>.</p>');
    } else if (eff) out.push('<p class="src">Travail avec Sophia dans cette matière depuis le ' + esc(dateFr(eff.depuis)) + '. Avec quelques évaluations de plus, avant et après, le carnet montrera la différence.</p>');
    return out.join('');
  }

  // Tableau des périodes (collège) : moi, la classe, et la saisie du bulletin.
  function periodsHTML(rows, readOnly) {
    if (!rows.length) return '';
    var years = {}; rows.forEach(function (r) { years[r.annee] = true; });
    var body = rows.map(function (r) {
      var w = r.eleve == null ? 0 : r.eleve / 20 * 100, cw = r.classe == null ? null : r.classe / 20 * 100;
      return '<tr><th scope="row">' + esc(r.periode) + (Object.keys(years).length > 1 ? ' <span class="src">' + esc(r.annee) + '</span>' : '') + '</th>' +
        '<td><b>' + f20(r.eleve) + '</b>' + (r.eleveBulletin ? '<sup title="du bulletin">B</sup>' : '') + '</td><td>' + f20(r.classe) + (r.classeBulletin ? '<sup title="du bulletin">B</sup>' : '') + '</td>' +
        '<td class="barcell"><span class="bar"><i style="width:' + w + '%;background:' + band(r.eleve || 0) + '"></i>' + (cw != null ? '<em style="left:' + cw + '%"></em>' : '') + '</span></td>' +
        (readOnly ? '' : '<td><button class="btn alt small" data-bul="' + esc(r.annee + '/' + r.periode) + '">Bulletin</button></td>') + '</tr>';
    }).join('');
    var yrs = Object.keys(years).map(function (y) {
      var me = C.yearAverage(rows, y), cl = C.yearAverage(rows, y, 'classe');
      return me == null ? '' : '<tr class="year"><th scope="row">Année' + (Object.keys(years).length > 1 ? ' ' + esc(y) : '') + '</th><td><b>' + f20(me) + '</b></td><td>' + f20(cl) + '</td><td class="barcell"><span class="bar"><i style="width:' + (me / 20 * 100) + '%;background:' + band(me) + '"></i>' + (cl != null ? '<em style="left:' + (cl / 20 * 100) + '%"></em>' : '') + '</span></td>' + (readOnly ? '' : '<td></td>') + '</tr>';
    }).join('');
    return '<table class="periods"><thead><tr><th></th><th>' + (readOnly ? 'Moyenne' : 'Moi') + '</th><th>Classe</th><th><span class="sr">Comparaison</span></th>' + (readOnly ? '' : '<th></th>') + '</tr></thead><tbody>' + body + yrs + '</tbody></table>' +
      '<p class="src">B : moyenne recopiée du bulletin ; sinon, calculée avec les évaluations et leurs coefficients. Le petit trait : la classe.</p>';
  }

  function workHTML(notes) {
    var w = C.toWork(notes);
    if (!w.length) return '<p class="src">Rien à signaler. 👍</p>';
    return '<ul class="plain">' + w.map(function (n) { return '<li>' + esc(n.intitule || 'Évaluation') + ' <span class="src">· ' + esc(dateFr(n.date)) + ' · ' + (n.competence ? esc(n.competence) : C.fr(n.note, 2) + '/' + C.fr(n.bareme, 2)) + '</span>' + (n.remarque ? '<br><small>' + esc(n.remarque) + '</small>' : '') + '</li>'; }).join('') + '</ul>';
  }

  function listHTML(notes, readOnly) {
    if (!notes.length) return '<p class="src">Aucune évaluation pour l\'instant.</p>';
    return '<div class="list">' + notes.slice().reverse().map(function (n) {
      var ic = n.absent ? 'abs' : n.competence ? esc(n.competence) : C.fr(C.on20(n));
      var bg = n.absent ? '#eee' : n.competence ? COMP_COLORS[n.competence] : band(C.on20(n));
      return '<div class="item static carnet-item"><span class="ic" style="background:' + bg + '">' + ic + '</span><span><strong>' + esc(n.intitule || 'Évaluation') + '</strong><small>' + esc(dateFr(n.date)) + ' · ' + esc(C.periodOf(n)) + ' · ' + result(n) + '</small>' +
        (n.remarque ? '<small>' + esc(n.remarque) + '</small>' : '') + (!readOnly && reactions && reactions[n.note_id] ? '<small class="sophia-line">Sophia : ' + esc(reactions[n.note_id]) + '</small>' : '') + '</span>' +
        (readOnly ? '' : '<span class="row"><button class="btn alt small" data-edit="' + esc(n.note_id) + '">Modifier</button><button class="btn alt small" data-del="' + esc(n.note_id) + '">Retirer</button></span>') + '</div>';
    }).join('') + '</div>';
  }

  // ---------- Formulaires ----------
  function periodSelect(id, value, auto) {
    return '<select id="' + id + '"><option value="">Auto (' + esc(auto) + ')</option>' + ['T1', 'T2', 'T3', 'S1', 'S2'].map(function (p) {
      return '<option value="' + p + '"' + (value === p ? ' selected' : '') + '>' + PERIOD_NAMES[p] + '</option>';
    }).join('') + '</select>';
  }
  function formHTML(n, mode) {
    n = n || {};
    var d = n.date || today();
    var common = '<div class="row carnet-num"><label class="field" for="c-date">Date de l\'évaluation<input type="date" id="c-date" max="' + today() + '" value="' + esc(d) + '"></label>' +
      '<label class="field" for="c-periode">Période' + periodSelect('c-periode', n.periode, C.guessPeriod(d)) + '</label></div>' +
      '<label class="field" for="c-intitule">Sur quoi ? <span class="src">(facultatif)</span><input id="c-intitule" maxlength="120" placeholder="Ex. : contrôle sur les états de l\'eau" value="' + esc(n.intitule || '') + '"></label>' +
      '<label class="check"><input type="checkbox" id="c-absent"' + (n.absent ? ' checked' : '') + '> Absente, ou pas encore notée</label>';
    var specific;
    if (mode === 'competences') {
      specific = '<fieldset class="field" id="c-result"><legend>Résultat</legend><div class="opts comp-pick">' + C.COMPETENCES.map(function (k) {
        return '<label><input type="radio" name="c-comp" value="' + k + '"' + (n.competence === k ? ' checked' : '') + '><b class="comp" style="background:' + COMP_COLORS[k] + '">' + k + '</b> ' + C.COMPETENCE_NOMS[k] + '</label>';
      }).join('') + '</div></fieldset>';
    } else {
      var bar = n.bareme == null ? 20 : n.bareme, std = [5, 10, 20].indexOf(bar) !== -1, coef = n.coef == null ? 1 : n.coef, stdC = [0.25, 0.5, 1, 2, 3, 4].indexOf(coef) !== -1;
      specific = '<div class="row carnet-num" id="c-result">' +
        '<label class="field" for="c-note">Note<input id="c-note" inputmode="decimal" autocomplete="off" value="' + (n.note == null ? '' : C.fr(n.note, 2)) + '"></label>' +
        '<label class="field" for="c-bareme">Sur<select id="c-bareme">' + [5, 10, 20].map(function (b) { return '<option value="' + b + '"' + (bar === b ? ' selected' : '') + '>' + b + '</option>'; }).join('') + '<option value="autre"' + (std ? '' : ' selected') + '>autre</option></select></label>' +
        '<label class="field" for="c-bareme-autre"' + (std ? ' hidden' : '') + ' id="c-bareme-autre-l">Barème<input id="c-bareme-autre" inputmode="decimal" value="' + (std ? '' : C.fr(bar, 2)) + '"></label>' +
        '<label class="field" for="c-coef">Coefficient<select id="c-coef">' + [0.25, 0.5, 1, 2, 3, 4].map(function (c) { return '<option value="' + c + '"' + (coef === c ? ' selected' : '') + '>' + C.fr(c, 2) + '</option>'; }).join('') + '<option value="autre"' + (stdC ? '' : ' selected') + '>autre</option></select></label>' +
        '<label class="field" for="c-coef-autre"' + (stdC ? ' hidden' : '') + ' id="c-coef-autre-l">Coef.<input id="c-coef-autre" inputmode="decimal" value="' + (stdC ? '' : C.fr(coef, 2)) + '"></label>' +
        '<label class="field" for="c-moy">Moyenne de la classe <span class="src">(facultatif)</span><input id="c-moy" inputmode="decimal" autocomplete="off" value="' + (n.moyenne_classe == null ? '' : C.fr(n.moyenne_classe, 2)) + '"></label></div>';
    }
    return '<div class="carnet-form">' + common + specific +
      '<label class="field" for="c-remarque">À retravailler <span class="src">(facultatif)</span><textarea id="c-remarque" maxlength="300" rows="2" placeholder="Ex. : les accords du participe passé">' + esc(n.remarque || '') + '</textarea></label>' +
      '<div id="c-err"></div><div class="row"><button class="btn" id="c-save">Enregistrer</button><button class="btn alt" id="c-cancel">Annuler</button></div></div>';
  }
  function readForm(mode, base) {
    var f = { note_id: base.note_id, niveau: base.niveau, date: $('c-date').value, periode: $('c-periode').value, intitule: $('c-intitule').value, remarque: $('c-remarque').value, absent: $('c-absent').checked };
    if (mode === 'competences') { var c = document.querySelector('input[name="c-comp"]:checked'); f.competence = c ? c.value : null; }
    else {
      f.note = $('c-note').value;
      f.bareme = $('c-bareme').value === 'autre' ? $('c-bareme-autre').value : $('c-bareme').value;
      f.coef = $('c-coef').value === 'autre' ? $('c-coef-autre').value : $('c-coef').value;
      f.moyenne_classe = $('c-moy').value;
    }
    return f;
  }
  function bulletinFormHTML(b, annee, periode) {
    b = b || {};
    return '<div class="carnet-form"><p>Recopie les moyennes du bulletin du <b>' + esc(PERIOD_NAMES[periode] || periode) + '</b> (' + esc(annee) + '), sur 20. Laisse vide ce que tu ne connais pas.</p><div class="row carnet-num">' +
      '<label class="field" for="b-moy">Ma moyenne<input id="b-moy" inputmode="decimal" value="' + (b.moyenne == null ? '' : C.fr(b.moyenne, 2)) + '"></label>' +
      '<label class="field" for="b-cls">Moyenne de la classe<input id="b-cls" inputmode="decimal" value="' + (b.moyenne_classe == null ? '' : C.fr(b.moyenne_classe, 2)) + '"></label></div>' +
      '<div id="c-err"></div><div class="row"><button class="btn" id="b-save">Enregistrer</button><button class="btn alt" id="c-cancel">Annuler</button></div></div>';
  }

  // ---------- Fenêtre d'une matière ----------
  // opts : { events, readOnly, who, back: { label, go } } ; sans events, le journal de l'élève connecté.
  function open(niveau, matiere, opts) {
    opts = opts || {};
    var mode = notation(niveau), editing = null, bul = null;
    function draw() {
      var ev = events(opts), notes = C.ofSubject(C.fold(ev), matiere, niveau).filter(function (n) { return !opts.annee || C.schoolYearOf(n.date) === opts.annee; }), bulletins = C.bulletins(ev);
      if (opts.annee) { var b2 = {}; Object.keys(bulletins).forEach(function (k) { if (bulletins[k].annee === opts.annee) b2[k] = bulletins[k]; }); bulletins = b2; }
      var rows = mode === 'notes' ? C.periods(notes, bulletins, niveau, matiere) : [], byDay = C.activityByDay(ev, D.activites, matiere);
      $('win-title').textContent = (opts.readOnly ? 'Carnet de ' + opts.who : 'Mon carnet') + ' · ' + subjectName(matiere);
      var head = '<div class="row"><span class="tag">Carnet de notes · ' + esc(levelName(niveau)) + (opts.annee ? ' · ' + esc(opts.annee) : '') + '</span><span class="src">' +
        (mode === 'competences' ? 'Résultats NA, PA, A, A+, sans note ni comparaison.' : 'Notes, coefficients, moyennes du bulletin.') + '</span></div>';
      var html;
      if (editing) html = '<h3 class="h3">' + (notes.some(function (n) { return n.note_id === editing.note_id; }) ? 'Modifier l\'évaluation' : 'Nouvelle évaluation') + '</h3>' + formHTML(editing, mode);
      else if (bul) html = '<h3 class="h3">Bulletin</h3>' + bulletinFormHTML(C.bulletin(bulletins, niveau, matiere, bul.annee, bul.periode), bul.annee, bul.periode);
      else html = (notes.length || rows.length ? hero(notes, rows, byDay, mode, opts.readOnly ? opts.who : '') + chart(notes, rows, byDay, mode) :
          '<p>' + (opts.readOnly ? 'Pas encore d\'évaluation dans cette matière.' : 'Recopie ici les évaluations de ton école : tu verras ta progression, ce qu\'il faut travailler, et ce que change le travail avec Sophia.') + '</p>') +
        (opts.readOnly ? '' : '<div class="row"><button class="btn" id="c-add">Ajouter une évaluation</button>' + (mode === 'notes' ? '<button class="btn alt" id="c-bulletin">Tout le bulletin</button>' : '') + '</div>') +
        (rows.length ? '<section><h3>Par période</h3>' + periodsHTML(rows, opts.readOnly) + '</section>' : '') +
        (notes.length ? '<section><h3>À travailler</h3>' + workHTML(notes) + '</section><section><h3>Évaluations</h3>' + listHTML(notes, opts.readOnly) + '</section>' : '');
      $('win-body').innerHTML = head + html + (opts.back ? '<div class="row"><button class="btn alt" id="c-back">' + esc(opts.back.label) + '</button></div>' : '');
      if (opts.back) $('c-back').addEventListener('click', opts.back.go);
      if (editing) return bindForm();
      if (bul) return bindBulletin(bulletins);
      if (opts.readOnly) return;
      $('c-add').addEventListener('click', function () { editing = { note_id: newId(), niveau: niveau }; draw(); $('c-date').focus(); });
      if ($('c-bulletin')) $('c-bulletin').addEventListener('click', function () { openBulletin(niveau, { annee: opts.annee, back: { label: 'Retour à ' + subjectName(matiere), go: function () { open(niveau, matiere, opts); } } }); });
      $('win-body').querySelectorAll('[data-bul]').forEach(function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-bul').split('/'); bul = { annee: k[0], periode: k[1] }; draw(); }); });
      $('win-body').querySelectorAll('[data-edit]').forEach(function (b) { b.addEventListener('click', function () {
        editing = notes.filter(function (n) { return n.note_id === b.getAttribute('data-edit'); })[0]; draw();
      }); });
      $('win-body').querySelectorAll('[data-del]').forEach(function (b) { b.addEventListener('click', function () {
        var row = b.closest('.carnet-item');
        if (b.dataset.sure) { record({ type: 'note_retiree', activite: matiere, note_id: b.getAttribute('data-del') }); ui.toast('Évaluation retirée du carnet.'); draw(); return; }
        b.dataset.sure = '1'; b.textContent = 'Vraiment retirer ?'; b.classList.add('danger'); if (row) row.classList.add('warn');
      }); });
    }
    function bindForm() {
      ['bareme', 'coef'].forEach(function (k) {
        var sel = $('c-' + k); if (sel) sel.addEventListener('change', function () { $('c-' + k + '-autre-l').hidden = sel.value !== 'autre'; });
      });
      // La période « auto » suit la date.
      $('c-date').addEventListener('change', function () { var o = $('c-periode').options[0]; if ($('c-date').value) o.textContent = 'Auto (' + C.guessPeriod($('c-date').value) + ')'; });
      var sync = function () { $('c-result').hidden = $('c-absent').checked; };
      $('c-absent').addEventListener('change', sync); sync();
      $('c-cancel').addEventListener('click', function () { editing = null; draw(); });
      $('c-save').addEventListener('click', function () {
        var r = C.check(Object.assign(readForm(mode, editing), { annee: opts.annee }), mode, today());
        if (r.erreur) { $('c-err').innerHTML = '<div class="callout">' + esc(r.erreur) + '</div>'; return; }
        var isNew = !C.fold(events(opts)).some(function (x) { return x.note_id === r.note.note_id; });
        record(Object.assign({ type: 'note_ecole', activite: matiere }, r.note));
        editing = null; ui.toast('Évaluation enregistrée dans ton carnet.'); draw();
        if (isNew && !r.note.absent) react(r.note.note_id);
      });
    }
    // Sophia réagit à une nouvelle note (félicitations ou encouragements, décidés par le serveur).
    function react(noteId) {
      var s = School.app.store;
      if (!s.reaction) return;
      var slot = document.createElement('div'); slot.id = 'c-sophia'; slot.innerHTML = bubble('Sophia lit ta note…', true);
      var anchor = $('win-body').querySelector('.tag'); if (anchor) anchor.closest('.row').after(slot);
      $('win-body').scrollTop = 0;          // la bulle est en haut : on y remonte
      s.reaction(noteId).then(function (res) {
        reactions = reactions || {}; reactions[noteId] = res.texte;
        var el = $('c-sophia'); if (el) el.innerHTML = bubble(res.texte);
      }, function () { var el = $('c-sophia'); if (el) el.remove(); });
    }
    function bindBulletin() {
      $('c-cancel').addEventListener('click', function () { bul = null; draw(); });
      $('b-save').addEventListener('click', function () {
        var r = C.checkBulletin({ niveau: niveau, annee: bul.annee, periode: bul.periode, moyenne: $('b-moy').value, moyenne_classe: $('b-cls').value });
        if (r.erreur) { $('c-err').innerHTML = '<div class="callout">' + esc(r.erreur) + '</div>'; return; }
        record(Object.assign({ type: 'bulletin_ecole', activite: matiere }, r.bulletin));
        bul = null; ui.toast('Bulletin enregistré.'); draw();
      });
    }
    ui.openWin('Carnet', '');
    if (opts.readOnly) draw(); else loadReactions(draw);
  }

  // ---------- Mon bulletin : toutes les matières d'un niveau ----------
  // Une barre par matière (la classe : un trait), la moyenne générale de la période, et la
  // courbe de la moyenne générale de période en période.
  function generalChart(points) {
    if (points.length < 2) return '';
    var W = 640, H = 170, L = 40, R = 20, T = 18, B = 140, step = (W - L - R) / (points.length - 1);
    var y = function (v) { return B - v / 20 * (B - T); }, g = '';
    [0, 10, 20].forEach(function (v) { g += '<line x1="' + L + '" x2="' + (W - R) + '" y1="' + y(v) + '" y2="' + y(v) + '" class="grid' + (v === 10 ? ' mid' : '') + '"/><text x="' + (L - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end" class="ax">' + v + '</text>'; });
    var line = function (key, cls) {
      var pts = points.map(function (p, i) { return p[key] == null ? null : (L + i * step) + ',' + y(p[key]); }).filter(Boolean);
      return pts.length > 1 ? '<polyline class="' + cls + '" points="' + pts.join(' ') + '"/>' : '';
    };
    g += line('classe', 'cls-line') + line('eleve', 'avg');
    points.forEach(function (p, i) {
      g += '<text x="' + (L + i * step) + '" y="' + (H - 8) + '" text-anchor="middle" class="ax per">' + esc(p.label) + '</text>';
      if (p.eleve != null) g += '<circle cx="' + (L + i * step) + '" cy="' + y(p.eleve) + '" r="7" fill="' + band(p.eleve) + '" class="pt"><title>' + esc(p.label) + ' : ' + f20(p.eleve) + '</title></circle>';
    });
    return '<svg class="carnet-chart" viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Moyenne générale, période par période">' + g + '</svg>' +
      '<p class="src legend">— ta moyenne générale · <span class="dash"></span> celle de la classe</p>';
  }
  function niveauxWithNotes(ev) {
    var ids = {};
    C.fold(ev).forEach(function (n) { ids[n.niveau] = true; });
    Object.keys(C.bulletins(ev)).forEach(function (k) { ids[k.split('/')[0]] = true; });
    return D.niveaux.map(function (n) { return n.id; }).filter(function (id) { return ids[id]; });
  }
  // opts : { events, readOnly, who, back } ; tab : « annee/periode » ou « annee/annee ».
  function openBulletin(niveau, opts) {
    opts = opts || {};
    var tab = null;
    function draw() {
      var ev = events(opts), mode = notation(niveau), subs = C.subjectsOf(ev, niveau, opts.annee);
      var order = (niveauDef(niveau) || {}).matieres || [];
      subs.sort(function (a, b) { return (order.indexOf(a.matiere) + 1 || 99) - (order.indexOf(b.matiere) + 1 || 99); });
      var tabs = [];
      subs.forEach(function (s) { s.rows.forEach(function (r) { var k = r.annee + '/' + r.periode; if (tabs.indexOf(k) === -1) tabs.push(k); }); });
      tabs.sort(function (a, b) { var A = a.split('/'), B = b.split('/'); return A[0] !== B[0] ? (A[0] < B[0] ? -1 : 1) : C.PERIOD_ORDER.indexOf(A[1]) - C.PERIOD_ORDER.indexOf(B[1]); });
      var years = {}; tabs.forEach(function (k) { years[k.split('/')[0]] = true; });
      var all = tabs.concat(Object.keys(years).map(function (y) { return y + '/annee'; }));
      if (!tab || all.indexOf(tab) === -1) tab = tabs[tabs.length - 1] || null;
      $('win-title').textContent = (opts.who ? 'Bulletin de ' + opts.who : 'Mon bulletin') + ' · ' + levelName(niveau) + (opts.annee ? ' · ' + opts.annee : '');
      var html = '';
      if (mode === 'competences') {
        html = subs.length ? '<div class="list">' + subs.map(function (s) {
          var c = C.counts(s.notes);
          return '<button class="item" data-subj-open="' + esc(s.matiere) + '"><span class="ic" style="background:' + subjectColor(s.matiere) + '"></span><span><strong>' + esc(subjectName(s.matiere)) + '</strong>' +
            '<span class="stack small">' + C.COMPETENCES.map(function (k) { return c[k] ? '<span style="flex:' + c[k] + ';background:' + COMP_COLORS[k] + '">' + k + ' ' + c[k] + '</span>' : ''; }).join('') + '</span></span><span class="st">Carnet</span></button>';
        }).join('') + '</div>' : '';
      } else if (tab) {
        var p = tab.split('/'), isYear = p[1] === 'annee';
        var val = function (s, key) { return isYear ? C.yearAverage(s.rows, p[0], key) : ((s.rows.filter(function (r) { return r.annee === p[0] && r.periode === p[1]; })[0] || {})[key]); };
        var gen = C.generalAverage(subs, p[0], isYear ? null : p[1]), genC = C.generalAverage(subs, p[0], isYear ? null : p[1], 'classe');
        html = '<div class="tabs" role="tablist">' + all.map(function (k) {
          var q = k.split('/'), label = (q[1] === 'annee' ? 'Année' : q[1]) + (Object.keys(years).length > 1 ? ' ' + q[0].slice(2, 4) + '-' + q[0].slice(7) : '');
          return '<button role="tab" class="chip' + (k === tab ? ' on' : '') + '" aria-selected="' + (k === tab) + '" data-tab="' + esc(k) + '">' + esc(label) + '</button>';
        }).join('') + '</div>' +
          (gen ? '<div class="hero" style="--c:' + band(gen.moyenne) + '"><div class="big-num">' + f20(gen.moyenne) + '<small> / 20</small></div><div><b>Moyenne générale</b><br><span>' + bandWord(gen.moyenne) + '</span>' +
            (genC ? '<br><span class="src">Classe : ' + f20(genC.moyenne) + '</span>' : '') + '<br><span class="src">' + gen.matieres + ' matière' + (gen.matieres > 1 ? 's' : '') + '</span></div></div>' : '') +
          '<div class="bars">' + subs.map(function (s) {
            var me = val(s, 'eleve'), cl = val(s, 'classe');
            if (me == null && cl == null) return '';
            var k = s.coefs[p[0]] || 1;
            return '<button class="barrow" data-subj-open="' + esc(s.matiere) + '"><span class="lbl">' + esc(subjectName(s.matiere)) + (k !== 1 ? ' <span class="src">×' + C.fr(k, 2) + '</span>' : '') + '</span><span class="bar big"><i style="width:' + ((me || 0) / 20 * 100) + '%;background:' + subjectColor(s.matiere) + '"></i>' +
              (cl != null ? '<em style="left:' + (cl / 20 * 100) + '%" title="Classe : ' + f20(cl) + '"></em>' : '') + '</span><b>' + f20(me) + '</b><span class="src">' + (cl != null ? 'cl. ' + f20(cl) : '') + '</span></button>';
          }).join('') + '</div><p class="src">Clique sur une matière pour voir son carnet. Le trait sur chaque barre : la moyenne de la classe.</p>' +
          coefsHTML(subs, p[0], opts.readOnly) +
          '<section><h3>Moyenne générale, période par période</h3>' + generalChart(tabs.map(function (k) {
            var q = k.split('/'), me = C.generalAverage(subs, q[0], q[1]), cl = C.generalAverage(subs, q[0], q[1], 'classe');
            return { label: q[1] + (Object.keys(years).length > 1 ? ' ' + q[0].slice(2, 4) : ''), eleve: me && me.moyenne, classe: cl && cl.moyenne };
          })) + '</section>';
      }
      if (!subs.length) html = '<p>' + (opts.readOnly ? 'Pas encore de notes à ce niveau.' : 'Pas encore de notes à ce niveau. Ajoute-les matière par matière (casier de la matière), ou importe ton tableau.') + '</p>';
      if (!subs.length && opts.archive) html = '<p>Pas de notes rangées pour cette année. Tu peux importer ton tableau de cette année-là.</p>';
      var nxt = nextLevel(niveau), endYear = !opts.readOnly && !opts.archive && opts.annee ?
        '<details class="coefs year-end"><summary>Fin d\'année : changer de classe</summary><p class="src">À la rentrée, ta classe de ' + esc(levelName(niveau)) + ' (' + esc(opts.annee) + ') part dans la malle aux archives : tu pourras toujours y relire tes notes et tes bulletins.</p>' +
        '<div class="row">' + (nxt ? '<button class="btn" data-pass="' + esc(nxt) + '">Passer en ' + esc(levelName(nxt)) + '</button>' : '') +
        '<button class="btn alt" data-pass="' + esc(niveau) + '">Refaire la ' + esc(levelName(niveau)) + '</button></div><div id="y-confirm"></div></details>' : '';
      $('win-body').innerHTML = '<div class="row"><span class="tag">Bulletin · ' + esc(levelName(niveau)) + (opts.annee ? ' · ' + esc(opts.annee) : '') + '</span>' + (opts.archive ? '<span class="tag">archives</span>' : '') + '</div>' + html + endYear +
        '<div class="row">' + (opts.readOnly && !opts.importable ? '' : '<button class="btn alt" id="c-import">Importer depuis un tableur</button>') + (opts.back ? '<button class="btn alt" id="c-back">' + esc(opts.back.label) + '</button>' : '') + '</div>';
      $('win-body').querySelectorAll('[data-pass]').forEach(function (b) { b.addEventListener('click', function () {
        var to = b.getAttribute('data-pass'), year = C.nextYear(opts.annee);
        $('y-confirm').innerHTML = '<div class="callout">Nouvelle classe : <b>' + esc(levelName(to)) + '</b>, année <b>' + esc(year) + '</b>. La ' + esc(levelName(niveau)) + ' ' + esc(opts.annee) + ' va dans les archives.</div><div class="row"><button class="btn" id="y-yes">C\'est parti !</button><button class="btn alt" id="y-no">Pas encore</button></div>';
        $('y-no').addEventListener('click', function () { $('y-confirm').innerHTML = ''; });
        $('y-yes').addEventListener('click', function () {
          record({ type: 'scolarite', activite: 'scolarite', niveau: to, annee: year });
          ui.closeWin(); ui.toast('Bienvenue en ' + levelName(to) + ' !');
          location.hash = '/classe/' + to; School.app.render();
        });
      }); });
      $('win-body').querySelectorAll('[data-tab]').forEach(function (b) { b.addEventListener('click', function () { tab = b.getAttribute('data-tab'); draw(); }); });
      $('win-body').querySelectorAll('[data-subj-open]').forEach(function (b) { b.addEventListener('click', function () {
        open(niveau, b.getAttribute('data-subj-open'), Object.assign({}, opts, { readOnly: opts.readOnly || opts.archive, back: { label: 'Retour au bulletin', go: function () { openBulletin(niveau, opts); } } }));
      }); });
      if ($('k-save')) $('k-save').addEventListener('click', function () {
        var annee = $('k-save').getAttribute('data-annee'), bad = false, changes = [];
        $('win-body').querySelectorAll('[data-coef]').forEach(function (inp) {
          var m = inp.getAttribute('data-coef'), v = C.num(inp.value), s = subs.filter(function (x) { return x.matiere === m; })[0];
          if (!(v > 0 && v <= 20)) { bad = true; return; }
          if (v !== (s.coefs[annee] || 1)) changes.push({ type: 'coef_matiere', activite: m, niveau: niveau, annee: annee, coef: v });
        });
        if (bad) { $('k-err').innerHTML = '<div class="callout">Un coefficient est un nombre entre 0 et 20 (1 si toutes les matières comptent pareil).</div>'; return; }
        changes.forEach(record);
        ui.toast(changes.length ? 'Coefficients enregistrés pour ' + annee + '.' : 'Rien n\'a changé.');
        draw();
      });
      if ($('c-import')) $('c-import').addEventListener('click', function () { openImport(niveau, { annee: opts.annee, after: function () { openBulletin(niveau, opts); }, back: { label: 'Retour au bulletin', go: function () { openBulletin(niveau, opts); } } }); });
      if (opts.back) $('c-back').addEventListener('click', opts.back.go);
    }
    ui.openWin('Bulletin', '');
    draw();
  }

  // Coefficients des matières de l'année, repliés : en 6e et 5e, toutes à 1 ; au lycée, ça change.
  function coefsHTML(subs, annee, readOnly) {
    var any = subs.some(function (s) { return (s.coefs[annee] || 1) !== 1; });
    if (readOnly && !any) return '';
    return '<details class="coefs"' + (any ? ' open' : '') + '><summary>Coefficients des matières (' + esc(annee) + ')</summary>' +
      '<p class="src">Pour la moyenne générale. Fixés pour toute l\'année scolaire ; 1 si toutes les matières comptent pareil.</p>' +
      '<div class="coef-grid">' + subs.map(function (s) {
        var k = s.coefs[annee] || 1;
        return '<label class="field">' + esc(subjectName(s.matiere)) + (readOnly ? '<b>' + C.fr(k, 2) + '</b>' : '<input inputmode="decimal" data-coef="' + esc(s.matiere) + '" value="' + C.fr(k, 2) + '">') + '</label>';
      }).join('') + '</div>' + (readOnly ? '' : '<div id="k-err"></div><button class="btn alt small" id="k-save" data-annee="' + esc(annee) + '">Enregistrer les coefficients</button>') + '</details>';
  }

  // ---------- Import depuis un tableur ----------
  function openImport(niveau, opts) {
    opts = opts || {};
    var parsed = null;
    ui.openWin('Importer des notes · ' + levelName(niveau) + (opts.annee ? ' · ' + opts.annee : ''), '<p>Dans ton tableur, sélectionne le tableau à partir de la ligne des matières (Maths, Français…), copie-le, puis colle-le ici. Format : pour chaque matière, 4 colonnes date, note, barème, coefficient ; des lignes « 1er Trimestre », « 2ème Trimestre »… ; la ligne « Classe » donne la moyenne de la classe.</p>' +
      '<textarea id="i-text" rows="8" class="paste" placeholder="Colle ici (Ctrl+V)"></textarea>' +
      '<div class="row"><button class="btn" id="i-read">Lire le tableau</button>' + (opts.back ? '<button class="btn alt" id="c-back">' + esc(opts.back.label) + '</button>' : '') + '</div><div id="i-out"></div>');
    if (opts.back) $('c-back').addEventListener('click', opts.back.go);
    $('i-read').addEventListener('click', function () {
      parsed = C.importSheet($('i-text').value, niveau, opts.annee);
      if (parsed.erreur) { $('i-out').innerHTML = '<div class="callout">' + esc(parsed.erreur) + '</div>'; return; }
      var per = {};
      parsed.notes.forEach(function (n) { var k = n.matiere; per[k] = per[k] || { n: 0, abs: 0 }; per[k][n.absent ? 'abs' : 'n']++; });
      $('i-out').innerHTML = '<h3 class="h3">Ce que j\'ai lu (' + esc(parsed.annee || '?') + ')</h3><ul class="plain">' + Object.keys(per).map(function (m) {
        return '<li><b>' + esc(subjectName(m)) + '</b> : ' + per[m].n + ' note' + (per[m].n > 1 ? 's' : '') + (per[m].abs ? ', ' + per[m].abs + ' absence' + (per[m].abs > 1 ? 's' : '') : '') + '</li>';
      }).join('') + '</ul>' + (parsed.bulletins.length ? '<p>' + parsed.bulletins.length + ' moyenne' + (parsed.bulletins.length > 1 ? 's' : '') + ' de classe (par matière et par trimestre).</p>' : '') +
        (parsed.ignorees.length ? '<p class="src">Colonnes ignorées : ' + esc(parsed.ignorees.join(', ')) + '.</p>' : '') +
        (parsed.alertes.length ? '<div class="callout"><b>À vérifier</b><ul class="plain">' + parsed.alertes.map(function (a) { return '<li>' + esc(a) + '</li>'; }).join('') + '</ul></div>' : '') +
        '<p class="src">Importer deux fois le même tableau ne crée pas de doublon.</p><div class="row"><button class="btn" id="i-go">Importer ' + parsed.notes.length + ' évaluation' + (parsed.notes.length > 1 ? 's' : '') + '</button></div>';
      $('i-go').addEventListener('click', function () {
        var bul = C.bulletins(School.app.store.get().events);
        parsed.notes.forEach(function (n) { var e = Object.assign({ type: 'note_ecole', activite: n.matiere }, n); delete e.matiere; record(e); });
        parsed.bulletins.forEach(function (b) {
          var old = C.bulletin(bul, b.niveau, b.matiere, b.annee, b.periode);     // garde la moyenne de l'élève déjà saisie
          record({ type: 'bulletin_ecole', activite: b.matiere, niveau: b.niveau, annee: b.annee, periode: b.periode, moyenne: old ? old.moyenne : null, moyenne_classe: b.moyenne_classe });
        });
        ui.toast(parsed.notes.length + ' évaluations importées.');
        if (opts.after) opts.after(); else openBulletin(niveau, { annee: opts.annee });
      });
    });
  }

  // ---------- Malle aux archives ----------
  // Les années passées, rangées par année scolaire ; carnets et bulletins en lecture seule (on peut
  // y importer le tableau d'une année passée). On peut ajouter une année passée qui n'y est pas.
  // opts : { events, who, readOnly, back } pour un parent (archives d'un enfant, en lecture seule).
  function openArchives(opts) {
    opts = opts || {};
    if (!opts.events && !enabled() && isParent()) return openArchivesParent();
    var adding = false, self = function () { openArchives(opts); };
    function draw() {
      var ev = events(opts), list = C.archives(ev), cur = C.currentClass(ev);
      var years = [], y0 = cur ? cur.annee : C.currentSchoolYear();
      for (var i = 1; i <= 12; i++) { var a = +y0.slice(0, 4) - i; years.push(a + '-' + (a + 1)); }
      $('win-title').textContent = 'Malle aux archives' + (opts.who ? ' de ' + opts.who : '');
      $('win-body').innerHTML = '<p>' + (opts.who ? 'Les années passées de ' + esc(opts.who) + ', rangées par année scolaire, en lecture seule.' : 'Tes années passées, rangées par année scolaire. Tu peux relire tes notes et tes bulletins.') + '</p>' +
        (list.length ? '<div class="list">' + list.map(function (s) {
          var subs = C.subjectsOf(ev, s.niveau, s.annee), n = subs.reduce(function (t, x) { return t + x.notes.length; }, 0);
          return '<button class="item" data-arch="' + esc(s.niveau + '|' + s.annee) + '"><span class="ic">' + esc(levelName(s.niveau)) + '</span><span><strong>' + esc(levelName(s.niveau)) + ' · ' + esc(s.annee) + '</strong><small>' +
            (n ? n + ' évaluation' + (n > 1 ? 's' : '') + ' · ' + subs.length + ' matière' + (subs.length > 1 ? 's' : '') : 'Pas encore de notes') + '</small></span><span class="st">Ouvrir</span></button>';
        }).join('') + '</div>' : '<p class="src">La malle est vide pour l\'instant.</p>') +
        (opts.readOnly ? (opts.back ? '<div class="row"><button class="btn alt" id="c-back">' + esc(opts.back.label) + '</button></div>' : '') : adding ? '<div class="carnet-form"><h3 class="h3">Ajouter une année passée</h3><div class="row carnet-num">' +
          '<label class="field" for="a-annee">Année scolaire<select id="a-annee">' + years.map(function (y) { return '<option>' + y + '</option>'; }).join('') + '</select></label>' +
          '<label class="field" for="a-niveau">Classe<select id="a-niveau">' + D.niveaux.map(function (n) { return '<option value="' + esc(n.id) + '">' + esc(n.nom) + '</option>'; }).join('') + '</select></label></div>' +
          '<div class="row"><button class="btn" id="a-save">Ranger dans la malle</button><button class="btn alt" id="a-cancel">Annuler</button></div></div>'
          : '<div class="row"><button class="btn alt" id="a-add">Ajouter une année passée</button></div>');
      $('win-body').querySelectorAll('[data-arch]').forEach(function (b) { b.addEventListener('click', function () {
        var k = b.getAttribute('data-arch').split('|');
        openBulletin(k[0], { annee: k[1], archive: true, importable: !opts.readOnly, events: opts.events, readOnly: opts.readOnly, who: opts.who,
          back: { label: 'Retour à la malle', go: self } });
      }); });
      if (opts.readOnly && opts.back) $('c-back').addEventListener('click', opts.back.go);
      if ($('a-add')) $('a-add').addEventListener('click', function () { adding = true; draw(); });
      if ($('a-cancel')) $('a-cancel').addEventListener('click', function () { adding = false; draw(); });
      if ($('a-save')) $('a-save').addEventListener('click', function () {
        var annee = $('a-annee').value, niveau = $('a-niveau').value;
        record({ type: 'scolarite', activite: 'scolarite', niveau: niveau, annee: annee });
        openBulletin(niveau, { annee: annee, archive: true, importable: true, back: { label: 'Retour à la malle', go: self } });
      });
    }
    ui.openWin('Malle aux archives', '');
    draw();
  }

  // Parent : choisir l'enfant, puis ses archives (depuis son livret, en lecture seule).
  function openArchivesParent() {
    ui.openWin('Malle aux archives', '<p class="src">Chargement…</p>');
    School.app.store.livrets().then(function (list) {
      var kids = list.filter(function (l) { return !l.moi; });
      $('win-body').innerHTML = kids.length ? '<p>Les archives de quel enfant ?</p><div class="list">' + kids.map(function (l) {
        return '<button class="item" data-kid="' + esc(l.owner) + '"><span class="av">' + ui.avatarHTML(School.store.avatarFromProfile(l.avatar)) + '</span><span><strong>' + esc(l.first_name || l.owner) + '</strong></span><span class="st">Archives</span></button>';
      }).join('') + '</div>' : '<p>Pas encore d\'enfant avec des archives.</p>';
      $('win-body').querySelectorAll('[data-kid]').forEach(function (b) { b.addEventListener('click', function () {
        School.app.store.livret(b.getAttribute('data-kid')).then(function (l) {
          openArchives({ events: l.events, who: l.first_name || l.owner, readOnly: true, back: { label: 'Autre enfant', go: openArchivesParent } });
        }, function () { ui.toast('Ces archives ne peuvent pas être chargées.'); });
      }); });
    }, function () { $('win-body').innerHTML = '<div class="callout">Les archives ne peuvent pas être chargées pour l\'instant. Vérifie le VPN, puis réessaie.</div>'; });
  }

  // Carnet et bulletin de sa classe de l'année.
  function openMine(matiere) { var c = myClass(); if (c) open(c.niveau, matiere, { annee: c.annee }); }
  function openMyBulletin() { var c = myClass(); if (c) openBulletin(c.niveau, { annee: c.annee }); }

  // Première visite d'une élève : sa classe de l'année.
  function ensureClass() {
    if (!enabled() || myClass()) return;
    var annee = C.currentSchoolYear();
    ui.openWin('Ta classe cette année', '<p>En quelle classe es-tu cette année (' + esc(annee) + ') ? Ta classe s\'ouvrira dans le couloir, avec ton carnet de notes.</p>' +
      '<div class="opts">' + D.niveaux.map(function (n) { return '<label><input type="radio" name="my-class" value="' + esc(n.id) + '"> ' + esc(n.nom) + '</label>'; }).join('') + '</div>' +
      '<div class="row"><button class="btn" id="my-class-ok">C\'est ma classe</button></div>');
    $('my-class-ok').addEventListener('click', function () {
      var c = document.querySelector('input[name="my-class"]:checked');
      if (!c) return ui.toast('Choisis ta classe.');
      record({ type: 'scolarite', activite: 'scolarite', niveau: c.value, annee: annee });
      ui.closeWin(); location.hash = '/classe/' + c.value; School.app.render();
    });
  }

  // ---------- Résumés pour le profil et le livret ----------
  // Une ligne par année : la classe de l'année d'abord, puis les archives. attr : « niveau|année|courante ».
  function overviewHTML(ev, attr) {
    var cur = C.currentClass(ev), list = (cur ? [cur] : []).concat(C.archives(ev));
    if (!list.length) return '<p class="src">Aucune évaluation recopiée pour l\'instant. Ouvre le casier d\'une matière de ta classe.</p>';
    return '<div class="list">' + list.map(function (s, i) {
      var subs = C.subjectsOf(ev, s.niveau, s.annee), mode = notation(s.niveau), info, isCur = !!cur && i === 0;
      if (mode === 'notes') {
        var rows = []; subs.forEach(function (x) { x.rows.forEach(function (r) { rows.push(r.annee + '/' + r.periode); }); });
        rows.sort(); var last = rows[rows.length - 1], gen = last ? C.generalAverage(subs, last.split('/')[0], last.split('/')[1]) : null;
        info = gen ? 'Moyenne générale (' + last.split('/')[1] + ') : ' + f20(gen.moyenne) + ' / 20' : subs.length + ' matière' + (subs.length > 1 ? 's' : '');
      } else {
        var c = { NA: 0, PA: 0, A: 0, 'A+': 0 }; subs.forEach(function (x) { var k = C.counts(x.notes); C.COMPETENCES.forEach(function (y) { c[y] += k[y]; }); });
        info = C.COMPETENCES.filter(function (k) { return c[k]; }).map(function (k) { return c[k] + ' ' + k; }).join(' · ') || 'pas encore de résultat';
      }
      return '<button class="item" ' + attr + '="' + esc(s.niveau + '|' + s.annee + '|' + (isCur ? '1' : '')) + '"><span class="ic">' + esc(levelName(s.niveau)) + '</span><span><strong>' + (isCur ? 'Classe de ' : 'Archives · ') + esc(levelName(s.niveau)) + ' · ' + esc(s.annee) + '</strong>' +
        '<small>' + esc(info) + '</small></span><span class="st">Bulletin</span></button>';
    }).join('') + '</div>';
  }
  function openFromOverview(value, opts) {
    var k = value.split('|');
    openBulletin(k[0], Object.assign({ annee: k[1], archive: !k[2] }, opts || {}));
  }

  School.carnetUI = { enabled: enabled, malleVisible: malleVisible, myClass: myClass, isMyClass: isMyClass, open: open, openMine: openMine, openBulletin: openBulletin, openMyBulletin: openMyBulletin,
    openImport: openImport, openArchives: openArchives, ensureClass: ensureClass, overviewHTML: overviewHTML, openFromOverview: openFromOverview, notation: notation };
})(window);

// ---- profile.js ----
// profile.js — Profil de l'élève et livret scolaire.
//
// Version publique : pseudo et avatar choisis ici, sauvegarde dans un fichier.
// Version SophIA : prénom et avatar du profil SophIA (le même que dans le chat), progression
// enregistrée dans le compte ; les parents ouvrent le livret scolaire de leurs enfants, en
// lecture seule (progression et accomplissements, pas les cours).
(function (root) {
  'use strict';
  var School = root.School, ui = School.ui, $ = ui.$, esc = ui.esc;
  var D = root.SCHOOL_DATA;
  var opened = {};

  function store() { return School.app.store; }
  function sophia() { return store().kind === 'sophia'; }
  function profil() { return store().get().profil; }
  function niveauNom(n) { var x = D.niveaux.filter(function (y) { return y.id === n; })[0]; return x ? x.nom : n; }

  function renderBadge() {
    $('me-av').innerHTML = ui.avatarHTML(profil().avatar);
    $('me-name').textContent = profil().pseudo || 'Mon profil';
  }

  // ---------- Avatar ----------
  function avatarPicker(prefix) {
    var av = profil().avatar || {};
    return '<div class="pick">' + Object.keys(ui.AVATARS).map(function (k) {
      return '<button class="av" data-av="' + k + '" aria-label="Avatar ' + ui.AVATAR_NAMES[k] + '" aria-pressed="' + (av.type !== 'photo' && av.id === k) + '">' + ui.AVATARS[k] + '</button>';
    }).join('') + '<label class="upload" for="' + prefix + '-file">Ma photo<input type="file" id="' + prefix + '-file" accept="image/*"></label></div>' +
      '<p class="src">' + (sophia() ? 'Enregistré dans ton profil SophIA : le même avatar que dans le chat.' : 'La photo reste sur cet appareil : elle n\'est envoyée nulle part.') + '</p>';
  }
  function setAvatar(av, after) {
    store().setProfil({ avatar: av }).then(after, function (err) { ui.toast(err.message); after(); });
    after();
  }
  function bindPicker(prefix, after) {
    document.querySelectorAll('[data-av]').forEach(function (b) {
      b.addEventListener('click', function () { setAvatar({ type: 'dessin', id: b.getAttribute('data-av') }, after); });
    });
    var f = $(prefix + '-file');
    if (f) f.addEventListener('change', function () {
      var file = f.files && f.files[0]; if (!file) return;
      ui.photoToAvatar(file, function (err, av) { if (err) return ui.toast(err.message); setAvatar(av, after); });
    });
  }

  function welcome() {
    ui.openWin('Bienvenue à l\'école !', '<p>Avant d\'entrer, choisis comment on t\'appelle et ton avatar. Tu pourras les changer dans ton profil.</p>' +
      '<label class="field" for="w-pseudo">Ton pseudo<input id="w-pseudo" maxlength="24" autocomplete="off" placeholder="Par exemple : Labo-Lynx"></label>' +
      '<div id="w-pick">' + avatarPicker('w') + '</div><div class="row"><button class="btn" id="w-go">C\'est parti !</button></div>');
    function pick() { $('w-pick').innerHTML = avatarPicker('w'); bindPicker('w', pick); renderBadge(); }
    bindPicker('w', pick);
    $('w-go').addEventListener('click', function () {
      var p = $('w-pseudo').value.trim();
      if (!p) return ui.toast('Choisis un pseudo.');
      store().setProfil({ pseudo: p }); renderBadge(); ui.closeWin();
    });
  }

  // ---------- Progression (profil et livret) ----------
  function compute(events) { return School.progress.compute(School.app.model.activities(), School.app.model.badges(), events); }
  function starsHTML(n) { return '<span class="stars" aria-label="' + n + ' étoiles sur 3">' + '★★★'.slice(0, n) + '<span class="off">' + '★★★'.slice(n) + '</span></span>'; }

  function subjectBlocks(P, prefix) {
    var out = '';
    Object.keys(D.matieres).forEach(function (m) {
      var mat = D.matieres[m];
      Object.keys(mat.niveaux).forEach(function (n) {
        var lvl = mat.niveaux[n], key = prefix + m + '/' + n, all = [];
        lvl.themes.forEach(function (t) { t.notions.forEach(function (no) { if (!no.plus) all.push(P.notion(no.id)); }); });
        var pct = all.length ? Math.round(all.reduce(function (a, b) { return a + b; }, 0) / (all.length * 4) * 100) : 0;
        out += '<div class="subj"><button data-subj="' + key + '" aria-expanded="' + !!opened[key] + '"><b>' + esc(mat.nom) + ' · ' + esc(niveauNom(n)) + '</b><span class="pct">' + pct + ' %</span>' +
          '<small>' + (opened[key] ? 'Masquer le détail' : 'Voir le détail par notion') + '</small></button>' +
          (opened[key] ? '<div class="notions">' + lvl.themes.map(function (t) {
            return '<h4>' + esc(t.nom) + ' ' + starsHTML(School.app.themeStarsOf(P, m, n, t.id)) + '</h4>' + t.notions.map(function (no) {
              var l = P.notion(no.id); return '<div class="notion"><span>' + esc(no.nom) + (no.plus ? ' <span class="tag plus">' + esc(no.plus) + ' · facultatif</span>' : '') + '</span><span class="lvl l' + l + '">' + School.progress.LEVELS[l] + '</span></div>';
            }).join('');
          }).join('') + '</div>' : '') + '</div>';
      });
    });
    return out;
  }
  function weakList(P) {
    var out = [];
    Object.keys(D.matieres).forEach(function (m) { Object.keys(D.matieres[m].niveaux).forEach(function (n) {
      D.matieres[m].niveaux[n].themes.forEach(function (t) { t.notions.forEach(function (no) {
        var l = P.notion(no.id); if (!no.plus && (l === 1 || l === 2)) out.push({ href: '#/theme/' + n + '/' + m + '/' + t.id, nom: no.nom, theme: t.nom });
      }); });
    }); });
    return out;
  }
  function summaryHTML(P) {
    return '<div class="row spread"><b>Niveau ' + P.level + '</b><span class="src">' + P.levelPoints + ' / ' + P.levelSize + ' points</span></div>' +
      '<div class="xp" role="progressbar" aria-label="Points du niveau" aria-valuenow="' + P.levelPoints + '" aria-valuemin="0" aria-valuemax="' + P.levelSize + '"><i style="width:' + (P.levelPoints / P.levelSize * 100) + '%"></i></div>' +
      '<p class="src">' + (P.streak > 1 ? P.streak + ' jours d\'affilée · ' : '') + P.badges.length + ' badge' + (P.badges.length > 1 ? 's' : '') + ' · ' + P.xp + ' points au total</p>';
  }
  function badgesHTML(P) {
    return '<div class="badges">' + School.app.model.badges().map(function (b) {
      var got = P.badges.indexOf(b.id) !== -1;
      return '<figure class="' + (got ? '' : 'off') + '">' + ui.medal(b.couleur) + '<figcaption>' + esc(b.nom) + (got ? '' : '<span class="sr"> (pas encore gagné)</span>') + '</figcaption></figure>';
    }).join('') + '</div>';
  }
  function bindSubjects(container, rerender) {
    container.querySelectorAll('[data-subj]').forEach(function (b) { b.addEventListener('click', function () { var k = b.getAttribute('data-subj'); opened[k] = !opened[k]; rerender(); }); });
  }

  // ---------- Profil ----------
  function syncHTML() {
    var s = store();
    if (s.kind !== 'sophia') return '';
    var n = s.pendingCount;
    return '<p class="sync src" id="d-sync">' + (n ? n + ' activité' + (n > 1 ? 's' : '') + ' en attente d\'envoi (connexion au serveur impossible pour l\'instant). Rien n\'est perdu.' : 'Tout est enregistré dans ton compte SophIA.') + '</p>';
  }
  function render() {
    var P = School.app.refresh(), pr = profil(), weak = weakList(P), parent = sophia() && ['admin', 'responsables'].indexOf(pr.role) !== -1;
    var who = sophia()
      ? '<div class="name">' + esc(pr.pseudo) + '</div><small>Prénom et avatar de ton profil SophIA.</small>'
      : '<label class="field" for="d-pseudo">Pseudo<input id="d-pseudo" maxlength="24" value="' + esc(pr.pseudo) + '"></label>' +
        '<small>' + (store().persistent ? 'Enregistré sur cet appareil.' : 'Stockage bloqué : rien ne sera gardé en fermant la page.') + '</small>';
    $('drawer').innerHTML = '<div class="row"><h2>Mon profil</h2><button class="x" id="d-close" aria-label="Fermer">×</button></div>' +
      '<div class="who"><span class="av big">' + ui.avatarHTML(pr.avatar) + '</span><div>' + who + syncHTML() + '</div></div>' +
      (parent ? '<button class="btn alt" id="d-livrets">Livrets scolaires des enfants</button>' : '') +
      '<section><h3>Mon avatar</h3><div id="d-pick">' + avatarPicker('d') + '</div></section>' +
      '<section><h3>Progression</h3>' + summaryHTML(P) + '</section>' +
      '<section><h3>Par matière</h3><div class="list">' + subjectBlocks(P, 'moi:') + '</div></section>' +
      '<section><h3>Mes badges</h3>' + badgesHTML(P) + '</section>' +
      (School.carnetUI.enabled() ? '<section><h3>Mon carnet de notes</h3>' + School.carnetUI.overviewHTML(store().get().events, 'data-carnet') + '</section>' : '') +
      '<section><h3>À retravailler</h3>' + (weak.length ? '<div class="redo">' + weak.map(function (w) {
        return '<a href="' + w.href + '">' + esc(w.nom) + ' <span class="src">· ' + esc(w.theme) + '</span></a>';
      }).join('') + '</div>' : '<p class="src">Rien pour l\'instant. Commence une leçon ou un TP !</p>') + '</section>' +
      (sophia() ? '' : '<section><h3>Ma sauvegarde</h3><p class="src">Pour changer d\'ordinateur, enregistre ta progression dans un fichier, puis ouvre-le sur l\'autre appareil.</p>' +
        '<div class="row"><button class="btn alt" id="d-export">Enregistrer un fichier</button><label class="upload" for="d-import">Ouvrir un fichier<input type="file" id="d-import" accept="application/json,.json"></label></div>' +
        '<div class="row"><button class="btn danger" id="d-reset">Tout effacer</button></div><div id="d-confirm"></div></section>');
    $('d-close').addEventListener('click', close);
    bindPicker('d', function () { render(); renderBadge(); });
    bindSubjects($('drawer'), render);
    $('drawer').querySelectorAll('.redo a').forEach(function (a) { a.addEventListener('click', close); });
    if (parent) $('d-livrets').addEventListener('click', function () { close(); openLivrets(); });
    $('drawer').querySelectorAll('[data-carnet]').forEach(function (b) { b.addEventListener('click', function () {
      close(); School.carnetUI.openFromOverview(b.getAttribute('data-carnet'));
    }); });
    if (sophia()) return;
    $('d-pseudo').addEventListener('change', function () { var v = $('d-pseudo').value.trim(); if (v) { store().setProfil({ pseudo: v }); renderBadge(); } });
    $('d-export').addEventListener('click', function () {
      var blob = new Blob([store().exportJSON()], { type: 'application/json' }), url = URL.createObjectURL(blob), a = document.createElement('a');
      a.href = url; a.download = 'sophia-school-' + (profil().pseudo || 'progression').replace(/[^\w-]+/g, '_') + '.json';
      document.body.appendChild(a); a.click(); a.remove(); setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    });
    $('d-import').addEventListener('change', function (e) {
      var f = e.target.files && e.target.files[0]; if (!f) return;
      f.text().then(function (t) { store().importJSON(t); render(); renderBadge(); School.app.render(); ui.toast('Progression chargée.'); })
        .catch(function (err) { ui.toast(err.message || 'Ce fichier ne peut pas être lu.'); });
    });
    $('d-reset').addEventListener('click', function () {
      $('d-confirm').innerHTML = '<div class="callout">Toute ta progression, tes badges et ton avatar seront effacés de cet appareil. C\'est définitif.</div>' +
        '<div class="row"><button class="btn danger" id="d-yes">Oui, tout effacer</button><button class="btn alt" id="d-no">Non, garder</button></div>';
      $('d-yes').addEventListener('click', function () { store().reset(); close(); School.app.render(); renderBadge(); welcome(); });
      $('d-no').addEventListener('click', function () { $('d-confirm').innerHTML = ''; });
    });
  }

  // ---------- Livret scolaire (version SophIA, lecture seule) ----------
  function dateFr(t) { var d = new Date(t); return isNaN(d) ? '' : d.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long' }) + ', ' + d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }); }
  function historyHTML(events) {
    var acts = D.activites, last = School.progress.applyCorrections(events).filter(function (e) { return !School.carnet.isNote(e); }).sort(function (a, b) { return a.t < b.t ? 1 : -1; }).slice(0, 15);
    if (!last.length) return '<p class="src">Aucune activité pour l\'instant.</p>';
    return '<div class="list">' + last.map(function (e) {
      var a = acts[e.activite], what = e.type === 'defi_termine' ? 'Défi : ' + Math.round((e.score || 0) * 100) + ' % de réussite' : e.type === 'tp_termine' ? 'TP terminé' : e.type === 'fiche_lecture' ? 'Fiche de lecture : ' + ((e.champs && e.champs.titre) || '') : 'Leçon lue';
      return '<div class="item static"><span class="ic">' + (e.type === 'defi_termine' ? '★' : e.type === 'tp_termine' ? 'TP' : 'L') + '</span><span><strong>' + esc(a ? a.titre : e.activite) + '</strong><small>' + esc(what) + '</small></span><span class="st">' + esc(dateFr(e.t)) + '</span></div>';
    }).join('') + '</div>';
  }
  function openLivrets() {
    ui.openWin('Livrets scolaires', '<p class="src">Chargement…</p>');
    store().livrets().then(function (list) {
      var kids = list.filter(function (l) { return !l.moi; });
      $('win-body').innerHTML = kids.length ? '<div class="list">' + kids.map(function (l) {
        return '<button class="item" data-livret="' + esc(l.owner) + '"><span class="av">' + ui.avatarHTML(School.store.avatarFromProfile(l.avatar)) + '</span><span><strong>' + esc(l.first_name || l.owner) + '</strong>' +
          '<small>' + (l.activites ? l.activites + ' activité' + (l.activites > 1 ? 's' : '') + ' · dernière le ' + esc(dateFr(l.derniere)) : 'Pas encore d\'activité') + '</small></span><span class="st">Livret</span></button>';
      }).join('') + '</div>' : '<p>Aucun livret d\'enfant pour l\'instant : un enfant apparaît ici après sa première connexion à SophIA.</p>';
      $('win-body').querySelectorAll('[data-livret]').forEach(function (b) { b.addEventListener('click', function () { openLivret(b.getAttribute('data-livret')); }); });
    }, function () { $('win-body').innerHTML = '<div class="callout">Les livrets ne peuvent pas être chargés pour l\'instant. Vérifie le VPN, puis réessaie.</div>'; });
  }
  // ---------- Dictées sur l'ardoise : vérifier et corriger la lecture de Sophia ----------
  // Chaque dictée garde ses photos d'ardoise, les mots dictés et ce que Sophia a lu ; le parent
  // change les cases et enregistre une correction, qui remplace le score de la dictée.
  function ardoises(events) {
    var all = School.progress.applyCorrections(events || []);
    return all.filter(function (e) { return e && e.type === 'defi_termine' && Array.isArray(e.ardoises) && e.ardoises.length; })
      .sort(function (a, b) { return a.t < b.t ? 1 : -1; });
  }
  function ardoisesHTML(events) {
    var list = ardoises(events);
    if (!list.length) return '';
    return '<section><h3>Dictées sur l\'ardoise</h3><p class="src">Vérifie ce que Sophia a lu sur les photos, et corrige si besoin.</p><div class="list">' + list.map(function (e) {
      var a = D.activites[e.activite], ok = (e.resultats || []).filter(function (r) { return r.ok; }).length;
      return '<button class="item" data-ardoise="' + esc(e.id) + '"><span class="ic">' + ok + '/' + (e.resultats || []).length + '</span><span><strong>' + esc(a ? a.titre : e.activite) + '</strong>' +
        '<small>' + esc(dateFr(e.t)) + (e.corrige_par ? ' · corrigée par toi' : '') + '</small></span><span class="st">Vérifier</span></button>';
    }).join('') + '</div></section>';
  }
  function openArdoise(owner, l, id, back) {
    var e = ardoises(l.events).filter(function (x) { return x.id === id; })[0];
    if (!e) return;
    var a = D.activites[e.activite], k = 0, rows = '';
    e.ardoises.forEach(function (p, pi) {
      rows += '<h4>Ardoise ' + (pi + 1) + '</h4>' + (p.photo ? '<img class="ardoise-photo" alt="Photo de l\'ardoise ' + (pi + 1) + '" src="' + esc(store().photoUrl(p.photo)) + '">' : '<p class="src">Pas de photo : corrigée à la main.</p>') +
        '<div class="list">' + p.mots.map(function (m, j) {
          var r = (e.resultats || [])[k], i = k++;
          return '<label class="item"><input type="checkbox" data-r="' + i + '"' + (r && r.ok ? ' checked' : '') + '><span><strong>' + esc(m) + '</strong>' +
            (p.lus ? '<small>Sophia a lu : ' + (p.lus[j] ? esc(p.lus[j]) : '<i>rien</i>') + '</small>' : '') + '</span></label>';
        }).join('') + '</div>';
    });
    ui.openWin((a ? a.titre : 'Dictée') + ' · ' + dateFr(e.t), '<p class="src">Coche les mots bien écrits sur l\'ardoise.</p>' + rows +
      (e.ardoises.some(function (p) { return p.photo; }) ? '<p class="src">En validant, les photos de cette dictée sont effacées.</p>' : '') +
      '<div class="row"><button class="btn" id="ar-save">Valider la correction</button><button class="btn alt" id="ar-back">Retour au livret</button></div><div id="ar-fb"></div>');
    $('ar-back').addEventListener('click', back);
    School.lecture.bindPhotos($('win-body'));
    $('ar-save').addEventListener('click', function () {
      var res = [];
      $('win-body').querySelectorAll('input[data-r]').forEach(function (c) { res[+c.getAttribute('data-r')] = { ok: c.checked, premier: c.checked, essais: 1 }; });
      var score = res.filter(function (r) { return r.ok; }).length / res.length;
      $('ar-save').disabled = true;
      store().corriger(owner, { type: 'correction', activite: e.activite, corrige: e.id, score: score, resultats: res }).then(function (ev) {
        l.events.push(ev); back();
      }, function () { $('ar-save').disabled = false; $('ar-fb').innerHTML = '<div class="callout">La correction n\'a pas pu être enregistrée. Vérifie le VPN, puis réessaie.</div>'; });
    });
  }

  function lecturesHTML(events) {
    var list = School.lecture.fiches(events);
    if (!list.length) return '';
    return '<section><h3>Fiches de lecture</h3><div class="list">' + list.map(function (e) {
      var c = e.champs || {};
      return '<button class="item" data-lecture="' + esc(e.id) + '"><span><strong>' + esc(c.titre || 'Sans titre') + '</strong><small>' + esc([c.auteur, dateFr(e.t)].filter(Boolean).join(' · ')) + '</small></span><span class="st">Lire</span></button>';
    }).join('') + '</div></section>';
  }

  function openLivret(owner) {
    store().livret(owner).then(function (l) {
      var P = compute(l.events), weak = weakList(P), name = l.first_name || l.owner;
      function draw() {
        $('win-body').innerHTML = '<div class="who"><span class="av big">' + ui.avatarHTML(School.store.avatarFromProfile(l.avatar)) + '</span><div><div class="name">' + esc(name) + '</div>' +
          '<small>Livret scolaire, en lecture seule (sauf la correction des dictées).</small></div></div>' +
          '<section><h3>Progression</h3>' + summaryHTML(P) + '</section>' +
          '<section><h3>Par matière</h3><div class="list">' + subjectBlocks(P, owner + ':') + '</div></section>' +
          '<section><h3>Badges</h3>' + badgesHTML(P) + '</section>' +
          '<section><h3>À retravailler</h3>' + (weak.length ? '<ul class="plain">' + weak.map(function (w) { return '<li>' + esc(w.nom) + ' <span class="src">· ' + esc(w.theme) + '</span></li>'; }).join('') + '</ul>' : '<p class="src">Rien à signaler.</p>') + '</section>' +
          ardoisesHTML(l.events) + lecturesHTML(l.events) +
          '<section><h3>Carnet de notes</h3>' + School.carnetUI.overviewHTML(l.events, 'data-carnet') + '</section>' +
          '<section><h3>Dernières activités</h3>' + historyHTML(l.events) + '</section>' +
          '<div class="row"><button class="btn alt" id="back-livrets">Tous les livrets</button></div>';
        bindSubjects($('win-body'), draw);
        $('back-livrets').addEventListener('click', openLivrets);
        $('win-body').querySelectorAll('[data-lecture]').forEach(function (b) { b.addEventListener('click', function () {
          var e = School.lecture.fiches(l.events).filter(function (x) { return x.id === b.getAttribute('data-lecture'); })[0];
          ui.openWin((e.champs && e.champs.titre) || 'Fiche de lecture', School.lecture.ficheHTML(e, store()) + '<div class="row"><button class="btn alt" id="lv-back">Retour au livret</button></div>');
          $('lv-back').addEventListener('click', function () { $('win-title').textContent = 'Livret de ' + name; draw(); });
          School.lecture.bindPhotos($('win-body'));
        }); });
        $('win-body').querySelectorAll('[data-ardoise]').forEach(function (b) { b.addEventListener('click', function () {
          openArdoise(owner, l, b.getAttribute('data-ardoise'), function () { $('win-title').textContent = 'Livret de ' + name; P = compute(l.events); weak = weakList(P); draw(); });
        }); });
        $('win-body').querySelectorAll('[data-carnet]').forEach(function (b) { b.addEventListener('click', function () {
          School.carnetUI.openFromOverview(b.getAttribute('data-carnet'), { events: l.events, readOnly: true, who: name, back: { label: 'Retour au livret', go: function () { openLivret(owner); } } });
        }); });
      }
      $('win-title').textContent = 'Livret de ' + name;
      draw();
    }, function () { ui.toast('Ce livret ne peut pas être chargé.'); });
  }

  function open() { render(); $('drawer').hidden = false; $('d-close').focus(); }
  function close() { if ($('drawer').hidden) return; $('drawer').hidden = true; $('open-profile').focus(); }
  function init() { $('open-profile').addEventListener('click', open); renderBadge(); }

  School.profile = { init: init, renderBadge: renderBadge, open: open, close: close, welcome: welcome, openLivrets: openLivrets };
})(window);

// ---- app.js ----
// app.js — Contenus, navigation entre les lieux de l'école, état des zones cliquables.
//
// Adresses (dans le « # », pour fonctionner aussi en ouverture directe du fichier) :
//   #/cour  #/couloir  #/classe/5e  #/salle/5e/physique-chimie
//   #/theme/5e/physique-chimie/matiere  #/bibliotheque  #/activite/tp-glacon
(function (root) {
  'use strict';
  var School = root.School, ui = School.ui, $ = ui.$, esc = ui.esc;
  var D = root.SCHOOL_DATA;
  var store = School.store.create();
  // Relecture (version SophIA, rôle admin du SSO, venu de /api/store/profile) : l'adulte qui
  // vérifie les contenus ouvre tout, sans verrou, et rien n'entre dans la progression. Ce n'est
  // pas une barrière de sécurité : tout le contenu est déjà dans la page ; le verrou est pédagogique.
  function relecture() { return store.kind === 'sophia' && (store.get().profil || {}).role === 'admin'; }
  // Classeurs d'une matière (matiere.yaml) : { lecons: { nom, types } … }
  function classeursOf(m) {
    var out = {};
    ((D.matieres[m] && D.matieres[m].classeurs) || []).forEach(function (c) { out[c.id] = c; });
    return out;
  }

  // ---------- Contenus ----------
  var M = {
    niveau: function (id) { return D.niveaux.filter(function (n) { return n.id === id; })[0] || null; },
    matiere: function (id) { return D.matieres[id] || null; },
    level: function (m, n) { var mm = D.matieres[m]; return mm && mm.niveaux[n] || null; },
    theme: function (m, n, t) { var l = M.level(m, n); return l && l.themes.filter(function (x) { return x.id === t; })[0] || null; },
    activities: function () { return Object.keys(D.activites).map(function (k) { return D.activites[k]; }); },
    themeActivities: function (m, n, t, types) {
      return M.activities().filter(function (a) { return a.matiere === m && a.niveau === n && a.theme === t && (!types || types.indexOf(a.type) !== -1); });
    },
    // Activités d'un classeur : par type, ou par difficulté (orthophonie).
    // Bonus : notion qu'éduscol place après la 5e (« bonus: true » dans niveau.yaml). Une activité
    // bonus s'ouvre quand toutes les autres activités du thème sont faites ; elle ne compte pas
    // dans les étoiles.
    isBonus: function (a) {
      if (a.bonus === true) return true;          // activité bonus par elle-même (TP expert)
      var th = M.theme(a.matiere, a.niveau, a.theme);
      return !!th && (a.notions || []).some(function (id) { return th.notions.some(function (no) { return no.id === id && no.bonus; }); });
    },
    bonusOpen: function (m, n, t) {
      return relecture() || M.themeActivities(m, n, t).filter(function (a) { return !M.isBonus(a) && !M.plusOf(a); }).every(function (a) { return !!P.done[a.id]; });
    },
    // Notion du niveau au-dessus (« plus: CM2 » dans niveau.yaml, classe à double niveau) : visible
    // et marquée, jamais fermée par le reste du thème, mais facultative : hors étoiles, hors
    // « À retravailler », et elle ne ferme pas les notions suivantes. Renvoie le niveau, ou null.
    plusOf: function (a) {
      var th = M.theme(a.matiere, a.niveau, a.theme), hit = th && th.notions.filter(function (no) { return no.plus && (a.notions || []).indexOf(no.id) !== -1; })[0];
      return hit ? String(hit.plus) : null;
    },
    // Ouverture progressive (« ouverture: progressive » dans niveau.yaml) : les notions s'ouvrent
    // dans l'ordre des thèmes ; une notion s'ouvre quand la précédente est maîtrisée (niveau 3,
    // un exercice noté réussi). Les thèmes d'un même « parcours » (grammaire, conjugaison…)
    // forment une suite à part. Renvoie la notion qui bloque, ou null.
    notionBlocker: function (m, n, id) {
      var l = M.level(m, n);
      if (!l || l.ouverture !== 'progressive' || relecture()) return null;
      var home = l.themes.filter(function (t) { return t.notions.some(function (no) { return no.id === id; }); })[0];
      // Thème « libre » : rien ne s'y ferme, et il ne ferme rien. « suite » : une suite à part dans
      // la rangée d'un parcours (les dictées n'attendent pas le dictionnaire).
      if (!home || home.libre) return null;
      var chain = function (t) { return t.suite || t.parcours || ''; }, order = [];
      l.themes.forEach(function (t) { if (!t.libre && chain(t) === chain(home)) t.notions.forEach(function (no) { order.push(no); }); });
      // Notion « ouverte » (déjà faite en classe) : ouverte d'emblée ; parmi elles, seule la
      // dernière avant une notion commande son ouverture (dictées 1 à 6 faites → la 7e attend la 6e).
      var k = order.map(function (no) { return no.id; }).indexOf(id);
      if (k === -1 || order[k].ouverte) return null;
      for (var j = 0; j < k; j++) if (!order[j].plus && (!order[j].ouverte || j === k - 1) && P.notion(order[j].id) < 3) return order[j];
      return null;
    },
    activityLock: function (a) {
      var b = (a.notions || []).map(function (id) { return M.notionBlocker(a.matiere, a.niveau, id); }).filter(Boolean)[0];
      return b ? 'S\'ouvre quand tu as réussi « ' + b.nom + ' ».' : null;
    },
    classeurActivities: function (m, n, t, cl) {
      return M.themeActivities(m, n, t).filter(function (a) { return cl.difficulte ? a.difficulte === cl.difficulte : (cl.types || []).indexOf(a.type) !== -1; });
    },
    badges: function () {
      var list = [];
      Object.keys(D.matieres).forEach(function (m) { Object.keys(D.matieres[m].niveaux).forEach(function (n) {
        D.matieres[m].niveaux[n].modules.forEach(function (mod) { (mod.badges || []).forEach(function (b) { list.push(Object.assign({ matiere: m, niveau: n, theme: mod.theme }, b)); }); });
      }); });
      return list.concat(D.badgesGlobaux || []);
    },
    niveauOuvert: function (n) { return Object.keys(D.matieres).some(function (m) { return !!D.matieres[m].niveaux[n]; }); },
  };
  var P = null;
  function refresh() { P = School.progress.compute(M.activities(), M.badges(), store.get().events); return P; }

  // Enregistre une fin d'activité ; renvoie les badges gagnés à cette occasion.
  function record(event) {
    if (relecture()) return [];
    var before = P.badges.slice();
    store.addEvent(event);
    refresh();
    var fresh = P.badges.filter(function (b) { return before.indexOf(b) === -1; });
    return M.badges().filter(function (b) { return fresh.indexOf(b.id) !== -1; });
  }

  // Portes du couloir : les classes de l'année. Version SophIA : celles des enfants (scolarité
  // déclarée, /api/store/school/classes) ; sinon, les niveaux qui ont du contenu. Les plus grands à gauche.
  var classes = null;
  function doorLevels() {
    var order = D.niveaux.map(function (n) { return n.id; }), list = [];
    if (store.kind === 'sophia' && classes) {
      list = classes.map(function (c) { return c.niveau; });
      var mine = School.carnetUI.myClass(); if (mine) list.push(mine.niveau);
    }
    // Moins de deux classes connues (une sœur n'a pas encore dit sa classe) : on complète avec les
    // niveaux qui ont des cours, pour que les deux portes restent visibles.
    list = list.concat(order.filter(M.niveauOuvert).reverse());
    list = list.filter(function (n, i) { return order.indexOf(n) !== -1 && list.indexOf(n) === i; });
    var known = list.length;
    return list.slice(0, Math.min(2, known)).sort(function (a, b) { return order.indexOf(b) - order.indexOf(a); });
  }
  function classeOuverte(n) { return doorLevels().indexOf(n) !== -1; }
  function themeLock(m, n, t) {
    var th = M.theme(m, n, t);
    if (!th) return 'Bientôt !';
    if (!M.themeActivities(m, n, t).length) return 'Bientôt !';
    var first = th.notions[0], b = first && M.notionBlocker(m, n, first.id);
    if (b) return 'Réussis d\'abord « ' + b.nom + ' »';
    if (th.verrou && th.verrou.badges && !relecture() && P.badges.length < th.verrou.badges) return (th.bonus ? 'Bonus : gagne ' : 'Gagne ') + th.verrou.badges + ' badges pour ouvrir';
    return null;
  }
  // Étoiles d'un thème pour une progression (celle de l'élève, ou d'un enfant dans le livret) :
  // par niveau de difficulté si les activités en ont (orthophonie), sinon par notions maîtrisées.
  function themeStarsOf(Pr, m, n, t) {
    var th = M.theme(m, n, t);
    if (!th) return 0;
    var acts = M.themeActivities(m, n, t);
    if (acts.some(function (a) { return a.difficulte; })) return Pr.difficultyStars(acts);
    return School.progress.themeStars(th.notions.filter(function (no) { return !no.bonus && !no.plus; }).map(function (no) { return Pr.notion(no.id); }));
  }
  function themeStars(m, n, t) { return themeStarsOf(P, m, n, t); }

  // ---------- Adresses ----------
  function parse(hash) {
    var p = String(hash || '').replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
    var r = { name: p[0] || 'cour', niveau: null, matiere: null, theme: null, activite: null };
    if (r.name === 'classe') r.niveau = p[1];
    if (r.name === 'salle') { r.niveau = p[1]; r.matiere = p[2]; }
    if (r.name === 'theme') { r.niveau = p[1]; r.matiere = p[2]; r.theme = p[3]; }
    if (r.name === 'activite') r.activite = p[1];
    return r;
  }
  function href(r) {
    if (r.name === 'classe') return '#/classe/' + r.niveau;
    if (r.name === 'salle') return '#/salle/' + r.niveau + '/' + r.matiere;
    if (r.name === 'theme') return '#/theme/' + r.niveau + '/' + r.matiere + '/' + r.theme;
    return '#/' + r.name;
  }
  // Une adresse vers un lieu fermé ou inconnu ramène au lieu ouvert le plus proche.
  function reachable(r) {
    if (r.name === 'activite') return D.activites[r.activite] ? r : { name: 'cour' };
    if (['cour', 'couloir', 'bibliotheque'].indexOf(r.name) !== -1) return r;
    if (!r.niveau) return { name: 'couloir' };
    if (r.name === 'classe') return classeOuverte(r.niveau) ? r : { name: 'couloir' };
    // Salle et thème : il suffit qu'il y ait du contenu (la bibliothèque y mène pour réviser).
    if (!M.level(r.matiere, r.niveau)) return classeOuverte(r.niveau) ? { name: 'classe', niveau: r.niveau } : { name: 'couloir' };
    if (r.name === 'salle') return r;
    if (r.name === 'theme' && !themeLock(r.matiere, r.niveau, r.theme)) return r;
    return { name: 'salle', niveau: r.niveau, matiere: r.matiere };
  }
  function vars(r) {
    var n = r.niveau && M.niveau(r.niveau), m = r.matiere && M.matiere(r.matiere), t = r.theme && M.theme(r.matiere, r.niveau, r.theme);
    return { niveau: r.niveau, niveau_nom: n ? n.nom : r.niveau, matiere: r.matiere, matiere_nom: m ? m.nom : r.matiere, theme: r.theme, theme_nom: t ? t.nom : r.theme };
  }
  function crumbs(r) {
    var list = [["Cour de l'école", '#/cour']];
    if (r.name === 'bibliotheque') list.push(['Bibliothèque', '#/bibliotheque']);
    if (['couloir', 'classe', 'salle', 'theme'].indexOf(r.name) !== -1) list.push(['Couloir', '#/couloir']);
    var v = vars(r);
    if (r.niveau && r.name !== 'couloir') list.push(['Classe de ' + v.niveau_nom, href({ name: 'classe', niveau: r.niveau })]);
    if (r.matiere) list.push([v.matiere_nom, href({ name: 'salle', niveau: r.niveau, matiere: r.matiere })]);
    if (r.theme) list.push([v.theme_nom, href(r)]);
    return list;
  }

  // ---------- Zones ----------
  // « casier-{matiere} » → /^casier-(.+)$/ et la variable « matiere ».
  function zoneDef(scene, zoneId) {
    var defs = scene.zones || {};
    for (var pat in defs) {
      var names = [], re = new RegExp('^' + pat.replace(/[.*+?^$()|[\]\\]/g, '\\$&').replace(/\{(\w+)\}/g, function (m, k) { names.push(k); return '(.+)'; }) + '$');
      var hit = re.exec(zoneId);
      if (hit) {
        var got = {}; names.forEach(function (k, i) { got[k] = hit[i + 1]; });
        if (got.porte) { got.niveau = doorLevels()[+got.porte - 1]; if (!got.niveau) got.hidden = true; }
        return { def: defs[pat], got: got };
      }
    }
    return null;
  }
  // Ce que fait une zone, ici et maintenant : { open, raison, aller, action, etiquette }
  function zoneState(r, def, got) {
    var c = Object.assign({}, r, got), v = vars(c), out = { open: true, raison: '' };
    if (got.classeur) {
      var cl = classeursOf(r.matiere)[got.classeur]; v.classeur_nom = cl ? cl.nom : got.classeur;
      var acts = cl ? M.classeurActivities(r.matiere, r.niveau, r.theme, cl) : [];
      out.compte = acts.length ? acts.filter(function (a) { return P.done[a.id]; }).length + ' / ' + acts.length : '';
      if (!acts.length) { out.open = false; out.raison = 'Bientôt !'; }
    } else if (got.niveau && !classeOuverte(got.niveau)) { out.open = false; out.raison = 'Bientôt !'; }
    else if (r.name === 'classe' && got.matiere && !M.level(got.matiere, r.niveau)) {
      // Version SophIA : la matière s'ouvre quand même, sur le carnet de notes de l'école réelle.
      if (School.carnetUI.isMyClass(r.niveau)) out.carnet = true; else { out.open = false; out.raison = 'Bientôt !'; }
    }
    else if (r.name === 'bibliotheque' && got.matiere && !M.matiere(got.matiere)) { out.open = false; out.raison = 'Bientôt !'; }
    else if (got.theme) {
      var lockMsg = themeLock(r.matiere, r.niveau, got.theme);
      if (lockMsg) { out.open = false; out.raison = lockMsg; }
      out.etoiles = M.theme(r.matiere, r.niveau, got.theme) ? themeStars(r.matiere, r.niveau, got.theme) : null;
    }
    if (v.niveau_nom == null && got.niveau) v.niveau_nom = got.niveau;
    if (got.matiere && !M.matiere(got.matiere)) v.matiere_nom = (D.nomsMatieres || {})[got.matiere] || got.matiere;
    out.etiquette = ui.fill(def.etiquette, v);
    if (def.vers && !out.carnet) out.aller = '#/' + ui.fill(def.vers, c);
    out.action = out.carnet ? 'carnet' : def.action || null;
    out.got = got;
    return out;
  }

  // ---------- Affichage d'un lieu ----------
  var current = null;
  function render() {
    var r = parse(location.hash), ok = reachable(r);
    if (ok !== r) { location.replace(ok.name === 'activite' ? href({ name: 'cour' }) : href(ok)); return; }
    if (r.name === 'activite') {
      var a = D.activites[r.activite];
      location.replace(href({ name: 'theme', niveau: a.niveau, matiere: a.matiere, theme: a.theme }));
      setTimeout(function () { School.activities.open(a.id); }, 0);
      return;
    }
    current = r;
    refresh();
    var def = D.scenes[r.name], v = vars(r);
    var svgText = D.decors[ui.fill(def.fond, v).replace(/\.svg$/, '')];
    if (!svgText) { location.replace('#/cour'); return; }
    $('scene').innerHTML = svgText;
    var svg = $('scene').querySelector('svg');
    svg.setAttribute('class', 'scene-svg');
    svg.setAttribute('role', 'group');
    svg.setAttribute('aria-label', ui.fill(def.titre, v));

    // Textes à remplir
    svg.querySelectorAll('[data-slot]').forEach(function (el) {
      var s = el.getAttribute('data-slot');
      if (s === 'classe-titre') el.textContent = 'Classe de ' + v.niveau_nom;
      else if (/^porte-\d$/.test(s)) { var lv = doorLevels()[+s.slice(6) - 1]; el.textContent = lv ? M.niveau(lv).nom : ''; }
      else if (s === 'theme-titre') el.textContent = (M.matiere(r.matiere).salle === 'labo' ? 'Paillasse · ' : '') + v.theme_nom;
      else if (s.indexOf('theme-') === 0) { var th = M.theme(r.matiere, r.niveau, s.slice(6)); el.textContent = th ? th.nom : 'Bientôt'; }
      // Texte plus long que la pancarte : il rétrécit pour tenir.
      var fit = +el.getAttribute('data-fit'), len = el.getComputedTextLength ? el.getComputedTextLength() : 0;
      if (fit && len > fit) el.setAttribute('font-size', (+el.getAttribute('font-size') * fit / len).toFixed(1));
    });

    var chips = [];
    svg.querySelectorAll('[data-zone]').forEach(function (el) {
      var found = zoneDef(def, el.getAttribute('data-zone'));
      if (!found) return;
      // Porte sans classe, malle hors carnet (adultes, version publique) : l'objet disparaît.
      if (found.got.hidden || (el.getAttribute('data-zone') === 'malle' && !School.carnetUI.malleVisible())) { el.remove(); return; }
      var st = zoneState(r, found.def, found.got);
      el.classList.add('zone');
      // Surface cliquable pleine : un clic entre les barreaux du portail compte aussi.
      var box = el.getBBox();
      el.insertAdjacentHTML('afterbegin', '<rect class="hit" x="' + box.x + '" y="' + box.y + '" width="' + box.width + '" height="' + box.height + '" fill="transparent"/>');
      el.setAttribute('tabindex', '0');
      el.setAttribute('role', 'button');
      el.setAttribute('aria-label', st.etiquette + (st.open ? '' : ' : ' + st.raison));
      if (!st.open) {
        el.classList.add('locked');
        el.setAttribute('aria-disabled', 'true');
        var s = Math.max(0.7, Math.min(1.3, Math.min(box.width, box.height) / 220));
        el.insertAdjacentHTML('beforeend', ui.lock(box.x + box.width / 2, box.y + box.height / 2, s));
      }
      if (st.etoiles != null) {
        var anchor = svg.querySelector('[data-anchor="etoiles-' + st.got.theme + '"]');
        if (anchor) anchor.innerHTML = [0, 1, 2].map(function (i) { return ui.star((i - 1) * 40, 0, i < st.etoiles, 14); }).join('');
      }
      if (st.compte) {
        var an = svg.querySelector('[data-anchor="compte-' + st.got.classeur + '"]');
        if (an) an.innerHTML = '<rect x="-46" y="-24" width="92" height="40" rx="20" fill="#fff" stroke="' + ui.INK + '" stroke-width="3"/><text x="0" y="6" text-anchor="middle" font-size="22" fill="' + ui.INK + '">' + esc(st.compte) + '</text>';
      }
      el._state = st;
      chips.push(st);
    });

    $('crumbs').innerHTML = crumbs(r).map(function (c, i, all) {
      return (i ? '<i aria-hidden="true">›</i>' : '') + (i === all.length - 1 ? '<span aria-current="page">' + esc(c[0]) + '</span>' : '<a href="' + c[1] + '">' + esc(c[0]) + '</a>');
    }).join('');
    var text = ui.fill(def.guide, v);
    if (r.name === 'cour' && store.kind === 'sophia') text = 'Salut ' + store.get().profil.pseudo + ' ! ' + text.replace(/^Bienvenue ! /, '');
    $('guide-text').textContent = text;
    $('rooms').innerHTML = (relecture() ? '<span class="chip relecture" role="note">Relecture : tout est ouvert, rien n\'est compté</span>' : '') + '<span class="lbl">Ici :</span>' + chips.map(function (st, i) {
      return '<button class="chip' + (st.open ? '' : ' locked') + '" data-chip="' + i + '"' + (st.open ? '' : ' aria-disabled="true"') + '>' + esc(st.etiquette) + (st.open ? '' : ' · ' + esc(st.raison)) + '</button>';
    }).join('') + (r.name === 'salle' && School.carnetUI.isMyClass(r.niveau) ? '<button class="chip carnet" id="open-carnet">Mon carnet de notes</button>' : '') +
      (r.name === 'classe' && School.carnetUI.isMyClass(r.niveau) ? '<button class="chip carnet" id="open-bulletin">Mon bulletin</button>' : '') +
      (r.name !== 'cour' ? '<a class="chip" href="' + (crumbs(r).slice(-2)[0][1]) + '">Revenir</a>' : '');
    $('rooms')._chips = chips;
    School.profile.renderBadge();
    document.title = ui.fill(def.titre, v) + ' · Sophia School';
  }

  function activate(st) {
    if (!st.open) return ui.toast(st.raison);
    if (st.aller) { location.hash = st.aller.slice(1); return; }
    if (st.action === 'classeur') return School.activities.openBinder(current, st.got.classeur);
    if (st.action === 'niveaux') return openLevels(st.got.matiere);
    if (st.action === 'carnet') return School.carnetUI.openMine(st.got.matiere);
    if (st.action === 'archives') return School.carnetUI.openArchives();
  }
  function openLevels(m) {
    var mat = M.matiere(m);
    ui.openWin(mat.nom + ' : quel niveau ?', '<div class="list">' + D.niveaux.map(function (n) {
      var on = !!mat.niveaux[n.id];
      return '<button class="item' + (on ? '' : ' off') + '" data-niveau="' + n.id + '"' + (on ? '' : ' aria-disabled="true"') + '><span class="ic">' + esc(n.nom) + '</span><span><strong>' + esc(mat.nom) + ' · ' + esc(n.nom) + '</strong><small>' +
        (on ? mat.niveaux[n.id].themes.length + ' thèmes' : 'Bientôt') + '</small></span><span class="st ' + (on ? 'done' : 'todo') + '">' + (on ? 'Ouvert' : 'Fermé') + '</span></button>';
    }).join('') + '</div>');
    $('win-body').querySelectorAll('[data-niveau]').forEach(function (b) {
      b.addEventListener('click', function () {
        if (b.getAttribute('aria-disabled')) return ui.toast('Ce niveau arrive plus tard.');
        ui.closeWin(); location.hash = '/salle/' + b.getAttribute('data-niveau') + '/' + m;
      });
    });
  }

  // Version SophIA : le guide est Sophia (icône servie par l'interface, même site).
  function guideIdentity() {
    if (D.variante !== 'sophia') return;
    var owl = document.querySelector('.guide .owl');
    if (owl) owl.outerHTML = '<img class="owl sophia" src="/images/SophIA.svg" alt="">';
    var name = document.querySelector('.bubble b'); if (name) name.textContent = 'SOPHIA';
  }

  function boot() {
    ui.bindWin();
    guideIdentity();
    $('scene').addEventListener('click', function (e) { var z = e.target.closest('.zone'); if (z && z._state) activate(z._state); });
    $('scene').addEventListener('keydown', function (e) {
      var z = e.target.closest && e.target.closest('.zone');
      if (z && z._state && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); activate(z._state); }
    });
    $('rooms').addEventListener('click', function (e) {
      if (e.target.closest('#open-carnet')) return School.carnetUI.openMine(current.matiere);
      if (e.target.closest('#open-bulletin')) return School.carnetUI.openMyBulletin();
      var c = e.target.closest('[data-chip]'); if (c) activate($('rooms')._chips[+c.getAttribute('data-chip')]);
    });
    document.addEventListener('keydown', function (e) { if (e.key === 'Escape') { if (!$('veil').hidden) ui.closeWin(); else School.profile.close(); } });
    School.profile.init();
    store.ready().then(function () {
      refresh();
      // Changer de lieu (lien, bouton Précédent du navigateur) referme la fenêtre ou le profil ouverts.
      root.addEventListener('hashchange', function () { ui.closeWin(); School.profile.close(); render(); });
      if (store.onChange) store.onChange(function () { School.profile.renderBadge(); });
      // Version SophIA : classes actives de la famille, puis, pour une élève qui ne l'a pas encore
      // dit, sa classe de l'année.
      var ready = store.classes ? store.classes().then(function (l) { classes = l; }, function () { classes = []; }) : Promise.resolve();
      return ready.then(function () { render(); School.carnetUI.ensureClass(); });
    }).then(function () {
      if (store.kind === 'local' && !store.get().profil.pseudo) School.profile.welcome();
      if (!store.persistent) ui.toast('Ce navigateur bloque l’enregistrement : ta progression sera perdue en fermant la page.');
    }, function (err) {
      $('scene').innerHTML = '<div class="offline" role="alert"><b>L’école n’a pas pu s’ouvrir.</b><span>' + esc(err.message) + '</span>' +
        '<button class="btn" id="reload">Recharger</button></div>';
      $('reload').addEventListener('click', function () { location.reload(); });   // pas de onclick : la CSP l'interdit
    });
  }

  School.app = { model: M, store: store, record: record, relecture: relecture, progress: function () { return P; }, refresh: refresh, render: render,
    current: function () { return current; }, doorLevels: doorLevels, classeursOf: classeursOf, themeStars: themeStars, themeStarsOf: themeStarsOf, zoneDef: zoneDef, parse: parse };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})(window);
