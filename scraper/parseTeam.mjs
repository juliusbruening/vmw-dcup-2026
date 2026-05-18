// scraper/parseTeam.mjs
// Parser für https://cpt.kayakers.nl/Team?id=<TOURN>&tid=<TEAM>
// Erwartete Sektionen:
//   - "Team members" Tabelle: # | Name | G | R | Y | Gr
//   - "Round 1 - Group: X" Tabelle: # | Team | P | GD | GF | GA | Played | Won | Lost | Draw
// Wir ziehen Roster + Gruppentabelle.

import * as cheerio from 'cheerio';

function cleanText(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}
function num(s) {
  const n = Number(cleanText(s).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

/**
 * Erkennt eine "Roster"-Tabelle anhand der Header-Zellen.
 * Erwartet Header in dieser Reihenfolge: # | (Name) | G | R | Y | Gr
 */
function isRosterTable($, $table) {
  const headers = $table
    .find('thead tr th, tr').first()
    .find('th, td').toArray()
    .map(c => cleanText($(c).text()).toLowerCase());
  // Häufig sind die Header so: "#", "", "G", "R", "Y", "Gr"
  const hasNr = headers.some(h => h === '#');
  const hasG  = headers.some(h => /^g$|^goals/.test(h));
  return hasNr && hasG;
}

/**
 * Erkennt eine "Group"-Tabelle anhand der Header-Zellen.
 * Erwartet # | Team | P | GD | GF | GA | Played | Won | Lost | Draw
 */
function isGroupTable($, $table) {
  const headers = $table
    .find('thead tr th, tr').first()
    .find('th, td').toArray()
    .map(c => cleanText($(c).text()).toLowerCase());
  const hasTeam  = headers.includes('team');
  const hasP     = headers.includes('p');
  const hasPlayed= headers.includes('played');
  return hasTeam && hasP && hasPlayed;
}

export function parseTeam(html, { teamCode, teamName }) {
  const $ = cheerio.load(html);

  const roster = [];
  const groupTable = [];

  $('table').each((_, table) => {
    const $t = $(table);

    if (roster.length === 0 && isRosterTable($, $t)) {
      const rows = $t.find('tr').toArray();
      for (const row of rows) {
        const $r = $(row);
        const cells = $r.find('td').toArray();
        if (cells.length < 4) continue;
        const nrTxt = cleanText($(cells[0]).text());
        const nr    = Number(nrTxt);
        if (!Number.isFinite(nr) || nr === 0) continue;
        const name  = cleanText($(cells[1]).text()) || null;
        const goals = num($(cells[2]).text());
        const red   = num($(cells[3]).text());
        const yellow= num($(cells[4]).text());
        const green = num($(cells[5]).text());
        roster.push({ nr, name, goals, red, yellow, green });
      }
      return;
    }

    if (groupTable.length === 0 && isGroupTable($, $t)) {
      const rows = $t.find('tbody tr').toArray();
      const fallback = rows.length ? rows : $t.find('tr').toArray().slice(1);
      for (const row of fallback) {
        const $r = $(row);
        const cells = $r.find('td').toArray();
        if (cells.length < 10) continue;
        const rank = Number(cleanText($(cells[0]).text()));
        const name = cleanText($(cells[1]).text());
        if (!name) continue;
        groupTable.push({
          rank,
          team:   name,
          P:      num($(cells[2]).text()),
          GD:     num($(cells[3]).text()),
          GF:     num($(cells[4]).text()),
          GA:     num($(cells[5]).text()),
          played: num($(cells[6]).text()),
          W:      num($(cells[7]).text()),
          L:      num($(cells[8]).text()),
          D:      num($(cells[9]).text()),
          vmw:    /VMW Berlin/i.test(name),
        });
      }
    }
  });

  return {
    code: teamCode,
    name: teamName,
    roster,
    groupTable,
  };
}
