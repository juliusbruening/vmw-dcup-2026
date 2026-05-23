// scripts/testParseMatchList.mjs
// Validiert parseMatchList gegen 3 realistische Szenarien aus dem DC2026-HTML:
//   – Spiel noch nicht gespielt (deutscher Titel "Nicht gespielt", leere data-goals)
//   – Spiel läuft           (deutscher Titel "Wird gespielt", leere data-goals)
//   – Spiel beendet         (deutscher Titel "Gespielt", gefüllte data-goalsa/b)
//
// Vor dem Fix: alle drei landeten auf status='next' + score={a:null,b:null}.
// Nach dem Fix: korrekte Erkennung in allen drei Fällen.

import { parseMatchList } from '../scraper/parseMatchList.mjs';

const HEAD = `
<table>
  <thead>
    <tr><th></th><th>#</th><th>P</th><th>Div</th><th>G</th>
        <th>A</th><th>-</th><th>B</th><th>Jury</th></tr>
  </thead>
  <tbody>
    <!-- Zeit-Header -->
    <tr><td colspan="9"><strong>07:30</strong> May 23rd <strong>07:30</strong></td></tr>
`;
const TAIL = `</tbody></table>`;

function matchRow({ nr, pitch, division, group, teamA, teamB, jury, statusTitle, dataStatus, goalsA, goalsB }) {
  const scoreCell = (goalsA !== '' || goalsB !== '')
    ? `<span data-goalsa="${goalsA}">${goalsA || '...'}</span><span> - </span><span data-goalsb="${goalsB}">${goalsB || '...'}</span>`
    : `<span data-goalsa=""></span><span> - </span><span data-goalsb=""></span>`;
  return `
    <tr>
      <td><div class="matchStatusIcon" data-status="${dataStatus}"><img src="/Images/MatchStatus3.png" title="${statusTitle}"></div></td>
      <td>${nr}</td>
      <td>${pitch}</td>
      <td>${division}</td>
      <td>${group}</td>
      <td><a href="/Team?id=X&tid=t-${nr}A">${teamA}</a></td>
      <td class="text-center">${scoreCell}</td>
      <td><a href="/Team?id=X&tid=t-${nr}B">${teamB}</a></td>
      <td><a href="/Team?id=X&tid=t-jury-${nr}">${jury}</a></td>
    </tr>`;
}

const html = HEAD
  + matchRow({ nr: 101, pitch: 1, division: 'Men 2nd class', group: 'A',
               teamA: 'VMW Berlin Men2', teamB: 'KSV Glauchau Men2', jury: 'PSC Coburg Men2',
               statusTitle: 'Nicht gespielt', dataStatus: '0', goalsA: '', goalsB: '' })
  + matchRow({ nr: 102, pitch: 2, division: 'Women', group: 'B',
               teamA: 'VMW Berlin Women', teamB: 'FOA Liverpool Women', jury: 'KRM Essen Women',
               statusTitle: 'Wird gespielt', dataStatus: '1', goalsA: '3', goalsB: '2' })
  + matchRow({ nr: 103, pitch: 3, division: 'Youth U16', group: 'A',
               teamA: 'VMW Berlin U16', teamB: 'KP Prag U16', jury: 'VMW Berlin Men2',
               statusTitle: 'Gespielt', dataStatus: '2', goalsA: '8', goalsB: '6' })
  // Edge case: kein title, kein data-status, aber Score vorhanden → muss als 'done' erkannt werden (Safety net)
  + matchRow({ nr: 104, pitch: 4, division: 'Pupils U14', group: 'A',
               teamA: 'VMW Berlin U14', teamB: 'KK Neptun U14', jury: '-',
               statusTitle: '', dataStatus: '', goalsA: '5', goalsB: '5' })
  + TAIL;

const matches = parseMatchList(html, 1);

function expect(label, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  console.log(`${ok ? '✓' : '✗'} ${label}  →  ${JSON.stringify(actual)}  (expected ${JSON.stringify(expected)})`);
  if (!ok) process.exitCode = 1;
}

console.log(`Parser hat ${matches.length} Matches gefunden (erwartet 4)\n`);

// Match 101 — Nicht gespielt
const m1 = matches.find(m => m.nr === 101);
expect('M101 status',  m1?.status,  'next');
expect('M101 scoreA',  m1?.score?.a, null);
expect('M101 scoreB',  m1?.score?.b, null);

// Match 102 — Wird gespielt (live)
const m2 = matches.find(m => m.nr === 102);
expect('M102 status',  m2?.status,  'live');
expect('M102 scoreA',  m2?.score?.a, 3);
expect('M102 scoreB',  m2?.score?.b, 2);

// Match 103 — Gespielt (done)
const m3 = matches.find(m => m.nr === 103);
expect('M103 status',  m3?.status,  'done');
expect('M103 scoreA',  m3?.score?.a, 8);
expect('M103 scoreB',  m3?.score?.b, 6);

// Match 104 — Safety net: Score vorhanden + Status leer → done
const m4 = matches.find(m => m.nr === 104);
expect('M104 status (safety-net)', m4?.status, 'done');
expect('M104 scoreA', m4?.score?.a, 5);
expect('M104 scoreB', m4?.score?.b, 5);

if (process.exitCode) {
  console.log('\n❌ Tests fehlgeschlagen');
} else {
  console.log('\n✅ Alle Status- und Score-Tests bestanden');
}
