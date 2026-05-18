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
    const statusImg = $(cells[0]).find('img');
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

    const scoreCellText = cleanText($(cells[6]).text());
    // Score-Spalte: "8 - 6" oder "- -" / "—"
    let scoreA = null, scoreB = null;
    const ms = scoreCellText.match(/(\d+)\s*[-–]\s*(\d+)/);
    if (ms) { scoreA = Number(ms[1]); scoreB = Number(ms[2]); }

    // Status aus dem Title-Attribut
    const statusTitle = (statusImg.attr('title') || '').toLowerCase();
    let status = 'next';
    if (statusTitle.includes('played') && !statusTitle.includes('not')) status = 'done';
    else if (statusTitle.includes('progress') || statusTitle.includes('live')) status = 'live';
    else if (statusTitle.includes('not played')) status = 'next';

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
