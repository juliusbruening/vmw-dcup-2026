// scraper/parseTeam.mjs
// Parser für https://cpt.kayakers.nl/Team?id=<TOURN>&tid=<TEAM>
// Wir ziehen Roster + Gruppentabelle.
//
// Erkennung über Tabellen-Form statt strikter Header-Strings, weil kayakers
// die Header-Beschriftung gelegentlich variiert.

import * as cheerio from 'cheerio';

function cleanText(s) {
  return (s || '').replace(/\s+/g, ' ').trim();
}
function num(s) {
  const n = Number(cleanText(s).replace(',', '.'));
  return Number.isFinite(n) ? n : 0;
}

export function parseTeam(html, { teamCode, teamName }) {
  const $ = cheerio.load(html);
  let roster = [];
  let groupTable = [];

  $('table').each((_, table) => {
    const $t = $(table);
    const rows = $t.find('tr').toArray();
    if (rows.length === 0) return;

    const firstRowText = cleanText($(rows[0]).text()).toLowerCase();

    // ─── Group-Table-Erkennung ─────────────────────────────
    // Signatur: enthält "team" und "played" in der ersten Zeile.
    // Verwenden absichtlich .includes() statt \b, weil mancher HTML-Renderer
    // zwischen <th>-Tags kein Whitespace einfügt → Wörter kleben aneinander.
    const looksLikeGroup = firstRowText.includes('team') && firstRowText.includes('played');

    if (looksLikeGroup && groupTable.length === 0) {
      for (const row of rows.slice(1)) {
        const cells = $(row).find('th, td').toArray();
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
      return;
    }

    // ─── Roster-Erkennung ──────────────────────────────────
    // Signatur: 4–8 Spalten, jede Datenzeile hat eine numerische Trikotnr
    // in der ersten Zelle. Eher datengetrieben als Header-getrieben.
    if (roster.length === 0) {
      const candidates = [];
      for (const row of rows) {
        const cells = $(row).find('th, td').toArray();
        if (cells.length < 4 || cells.length > 8) continue;
        const nrTxt = cleanText($(cells[0]).text());
        const nr = Number(nrTxt);
        if (!Number.isFinite(nr) || nr === 0) continue;
        const name   = cleanText($(cells[1]).text()) || null;
        const goals  = num($(cells[2]).text());
        const red    = cells.length > 3 ? num($(cells[3]).text()) : 0;
        const yellow = cells.length > 4 ? num($(cells[4]).text()) : 0;
        const green  = cells.length > 5 ? num($(cells[5]).text()) : 0;
        candidates.push({ nr, name, goals, red, yellow, green });
      }
      if (candidates.length >= 1) {
        roster = candidates;
      }
    }
  });

  return { code: teamCode, name: teamName, roster, groupTable };
}
