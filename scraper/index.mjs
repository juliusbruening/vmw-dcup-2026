// scraper/index.mjs
// Orchestrator: lädt alle 3 Spieltage + 5 VMW-Team-Detailseiten,
// reduziert auf VMW-relevantes Datenmodell und liefert ein "snapshot"-Objekt.

import { fetchHtml } from './fetch.mjs';
import { parseMatchList } from './parseMatchList.mjs';
import { parseTeam } from './parseTeam.mjs';

const TOURNAMENT_ID = '5500048e-ff41-4b86-9e9b-810043be6461';
const BASE = 'https://cpt.kayakers.nl';

// VMW-Teams am DC2026 — die `tid`-Werte stammen aus dem ersten Scrape.
// Falls sich ein Wert ändert (selten), kann er hier angepasst werden.
export const VMW_TEAMS = [
  { code: 'U14',   pillLabel: 'U14',     short: 'VMW U14',     name: 'VMW Berlin U14',   tid: 'ce8c0949-ee6d-4526-ad31-9486d8e86f18' },
  { code: 'U16',   pillLabel: 'U16',     short: 'VMW U16',     name: 'VMW Berlin U16',   tid: '0948547e-1c67-4492-93bc-618c90442b50' },
  { code: 'U21',   pillLabel: 'U21',     short: 'VMW U21',     name: 'VMW Berlin U21',   tid: 'ecc239cd-2306-41b9-a659-432e7ed1647a' },
  { code: 'Women', pillLabel: 'Damen',   short: 'VMW Damen',   name: 'VMW Berlin Women', tid: '6775d440-1ea0-47ba-8752-7db49f61f988' },
  { code: 'Men2',  pillLabel: 'Herren',  short: 'VMW Herren',  name: 'VMW Berlin Men2',  tid: '7b63cb1c-a63b-4c9e-a896-18f0eddcadbe' },
];

function matchListUrl(day) { return `${BASE}/MatchList/DC2026?day=${day}`; }
function teamUrl(tid)      { return `${BASE}/Team?id=${TOURNAMENT_ID}&tid=${tid}`; }

function vmwCodeForName(name) {
  if (!/VMW Berlin/i.test(name || '')) return null;
  if (/U14/.test(name))   return 'U14';
  if (/U16/.test(name))   return 'U16';
  if (/U21/.test(name))   return 'U21';
  if (/Women/.test(name)) return 'Women';
  if (/Men2/.test(name) || /Men 2/.test(name)) return 'Men2';
  return null;
}

/**
 * Holt alle Daten, parsed sie und liefert ein konsolidiertes Snapshot.
 * Optional `fetcher` injectable for testing.
 */
export async function buildSnapshot({ fetcher = fetchHtml } = {}) {
  // 1) Spielpläne aller 3 Tage parallel
  const dayHtmlList = await Promise.all([1, 2, 3].map(d => fetcher(matchListUrl(d))));
  const allMatchesRaw = dayHtmlList.flatMap((html, idx) => parseMatchList(html, idx + 1));

  // 2) Team-Detailseiten aller 5 VMW-Teams parallel
  const teamHtmlList = await Promise.all(VMW_TEAMS.map(t => fetcher(teamUrl(t.tid))));
  const teams = teamHtmlList.map((html, idx) => {
    const t = VMW_TEAMS[idx];
    const parsed = parseTeam(html, { teamCode: t.code, teamName: t.name });
    return { ...t, roster: parsed.roster, groupTable: parsed.groupTable };
  });

  // 3) Matches anreichern: vmwTeam (wir spielen), juryVmw (wir pfeifen)
  const matches = allMatchesRaw.map(m => {
    const vmwTeam = vmwCodeForName(m.teamA.name) || vmwCodeForName(m.teamB.name);
    const juryVmw = m.jury ? vmwCodeForName(m.jury.name) : null;
    return { ...m, vmwTeam, juryVmw };
  });

  return {
    lastUpdated: new Date().toISOString(),
    tournamentId: TOURNAMENT_ID,
    matches,
    teams,
  };
}
