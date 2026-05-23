// scraper/parseMatchList.mjs
// Parser für https://cpt.kayakers.nl/MatchList/DC2026?day=N
// Server-rendered HTML. Tabellenzeilen mit fester Spalten-Reihenfolge:
// Status | # | Pitch | Division | Group | Team A | Score | Team B | Jury
// Zwischen den Match-Zeilen gibt es Zeit-Header-Zeilen ("HH:MM May 23rd HH:MM").

import * as cheerio from 'cheerio';

const TID_RX = /tid=([a-f0-9-]+)/i;

function extractTid(href = '') {
  const m = href.match(TID_RX);
  return m ? m[1] : null;
}

function parseTimeFromHeaderText(text) {
  // Zeit-Header-Zeilen sehen aus wie: "07:30 May 23rd 07:30"
  const m = /(\d{1,2}:\d{2})/.exec(text || '');
  return m ? m[1].padStart(5, '0') : null;
}

function cleanText(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}

/**
 * @param {string} html - Roher HTML-Quelltext der MatchList-Seite
 * @param {number} day  - Tagesnummer (1, 2, 3)
 * @returns {Array<Match>}
 */
export function parseMatchList(html, day) {
  const $ = cheerio.load(html);
  const matches = [];
  let currentTime = null;

  // Wir suchen einfach alle <tr> im Dokument und filtern selbst.
  $('tr').each((_, tr) => {
    const $tr = $(tr);
    const cells = $tr.find('td').toArray();

    // Zeit-Header-Zeilen haben üblicherweise sehr wenige Zellen + enthalten ein Zeitformat.
    const rowText = cleanText($tr.text());
    if (cells.length < 8) {
      const t = parseTimeFromHeaderText(rowText);
      if (t) currentTime = t;
      return;
    }

    // Match-Zeile: erwartete Spalten ab 0..8
    // [0] Status (img), [1] #, [2] Pitch, [3] Division, [4] Group,
    // [5] Team A (a), [6] Score, [7] Team B (a), [8] Jury (a oder "-")
    const $statusCell = $(cells[0]);
    const statusImg = $statusCell.find('img').first();
    const matchNrTxt = cleanText($(cells[1]).text());
    const pitchTxt   = cleanText($(cells[2]).text());
    const divisionRaw = cleanText($(cells[3]).text());
    const groupTxt   = cleanText($(cells[4]).text());

    const teamA_a = $(cells[5]).find('a').first();
    const teamB_a = $(cells[7]).find('a').first();
    const jury_a  = $(cells[8]).find('a').first();

    const teamA = cleanText(teamA_a.text() || $(cells[5]).text());
    const teamB = cleanText(teamB_a.text() || $(cells[7]).text());
    const jury  = cleanText(jury_a.text()  || $(cells[8]).text());

    if (!teamA || !teamB) return; // wahrscheinlich keine Match-Zeile

    const matchNr = Number(matchNrTxt.replace(/\D+/g, ''));
    if (!Number.isFinite(matchNr) || matchNr === 0) return;

    // ─── SCORE ───────────────────────────────────────────────
    // kayakers schreibt den Spielstand sowohl als data-Attribut UND als Text in die Zelle.
    // Beobachtetes Markup (Team-Seite, gleicher Backend-Renderer):
    //   <span data-goalsa="">...</span><span> - </span><span data-goalsb="">...</span>
    // Für gespielte Spiele liegt der Wert im data-goalsa/-b-Attribut, der sichtbare
    // Text bleibt teilweise "...", deshalb müssen wir bevorzugt das Attribut lesen.
    let scoreA = null, scoreB = null;
    const $scoreCell = $(cells[6]);
    const goalsA = $scoreCell.find('[data-goalsa]').attr('data-goalsa');
    const goalsB = $scoreCell.find('[data-goalsb]').attr('data-goalsb');
    if (goalsA != null && /^\d+$/.test(goalsA)) scoreA = Number(goalsA);
    if (goalsB != null && /^\d+$/.test(goalsB)) scoreB = Number(goalsB);
    if (scoreA == null || scoreB == null) {
      // Fallback: Text-Regex (für ältere Renderer-Varianten oder "8 - 6"-Klartext)
      const scoreCellText = cleanText($scoreCell.text());
      const ms = scoreCellText.match(/(\d+)\s*[-–]\s*(\d+)/);
      if (ms) { scoreA = Number(ms[1]); scoreB = Number(ms[2]); }
    }

    // ─── STATUS ──────────────────────────────────────────────
    // kayakers serviert den `title=`-Text in der Browser-Sprache der HTTP-Anfrage
    // (Accept-Language). Hier laufen wir aus Deutschland → bekommen oft Deutsch.
    // Deshalb müssen wir multilingual matchen UND zusätzlich data-status/img-src
    // als sprach-unabhängige Fallbacks nutzen.
    let status = detectMatchStatus($, $statusCell, statusImg);

    // Sicherheitsnetz: Wenn ein numerischer Spielstand vorliegt, ist das Spiel
    // mindestens beendet (Score wird vom Backend erst nach Schiri-Eintrag publiziert).
    // Verhindert, dass beendete Spiele durch fehlerhafte Status-Erkennung in "next" hängenbleiben.
    if (status === 'next' && scoreA != null && scoreB != null) {
      status = 'done';
    }

    // Division kompakt: doppelte Wiederholungen vom Markdown-Konverter sind im echten HTML kein Problem,
    // aber sicherheitshalber:
    const division = compactDivision(divisionRaw);

    // Division-Code (intern)
    const divisionCode = inferDivisionCode(division);

    matches.push({
      day,
      nr: matchNr,
      time: currentTime || null,
      pitch: Number(pitchTxt) || pitchTxt,
      division,
      divisionCode,
      group: groupTxt || null,
      teamA: {
        name: teamA,
        tid: extractTid(teamA_a.attr('href') || ''),
      },
      teamB: {
        name: teamB,
        tid: extractTid(teamB_a.attr('href') || ''),
      },
      score: { a: scoreA, b: scoreB },
      status,
      jury: jury
        ? { name: jury, tid: extractTid(jury_a.attr('href') || '') }
        : null,
    });
  });

  return matches;
}

function compactDivision(s = '') {
  // "Men 1st class Men 1st class Men 1st class" → "Men 1st class"
  // (kommt nur vor wenn HTML-Renderer mehrere responsive-spans zusammenfasst)
  const t = s.trim();
  if (!t) return t;
  for (const candidate of [
    'Pupils U14', 'Youth U16', 'Men U21', 'Women',
    'Men 1st class', 'Men 2nd class',
  ]) {
    if (t.startsWith(candidate)) return candidate;
  }
  return t.split(/\s{2,}|\t/)[0] || t;
}

/**
 * Sprach-unabhängige Status-Erkennung.
 *
 * Drei kombinierte Signale (vom verlässlichsten zum unsichersten):
 *
 *  1. data-status auf <div class="matchStatusIcon">  (kayakers-internes Schema)
 *       0 = scheduled / nicht gespielt
 *       1 = in progress / live
 *       2 = played / beendet
 *
 *  2. Bildschema MatchStatusN.png im src-Attribut
 *       Annahme entspricht data-status (1-basiert konnte ich nicht final verifizieren,
 *       deshalb nur als Fallback genutzt — Titel ist sicherer).
 *
 *  3. title-Attribut des <img> — multilingual matching für DE+EN+NL+PL.
 *
 * Im DC2026-HTML kommt mind. eine dieser Signale immer durch.
 */
function detectMatchStatus($, $statusCell, statusImg) {
  // 1) data-status — präziseste Quelle wenn vorhanden
  const dataStatusEl = $statusCell.find('[data-status]').first();
  const dataStatus = dataStatusEl.length ? dataStatusEl.attr('data-status') : null;

  // 3) title (multilingual). Wichtig: das "not played"-Token muss VOR dem "played"-Token
  // matchen, weil "Nicht gespielt" auch "Gespielt" als Substring enthält.
  const title = (statusImg.attr('title') || '').toLowerCase();
  const isNotPlayed =
    /not played|nicht gespielt|niet gespeeld|nie zagrane|nie rozegrane/.test(title);
  const isInProgress =
    /in progress|wird gerade gespielt|wird gespielt|laufend|live|loopt|w toku|trwa/.test(title);
  const isPlayed =
    /(?:^|[^a-zäöü])(played|gespielt|gespeeld|zagrane|rozegrane)\b/.test(title) && !isNotPlayed;

  if (isInProgress) return 'live';
  if (isPlayed)     return 'done';
  if (isNotPlayed)  return 'next';

  // 2) data-status als sprach-unabhängiger Fallback
  if (dataStatus === '1') return 'live';
  if (dataStatus === '2') return 'done';
  if (dataStatus === '0') return 'next';

  // Standard: noch nicht gespielt
  return 'next';
}

function inferDivisionCode(division = '') {
  const d = division.toLowerCase();
  if (d.includes('u14') || d.includes('pupils')) return 'U14';
  if (d.includes('u16') || d.includes('youth'))  return 'U16';
  if (d.includes('u21'))                          return 'U21';
  if (d.includes('women'))                        return 'Women';
  if (d.includes('1st class'))                    return 'Men1';
  if (d.includes('2nd class'))                    return 'Men2';
  return null;
}
