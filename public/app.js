/* =========================================================
   VMW Deutschland Cup 2026 — Frontend
   Pollt /api/data alle 60s, rendert 4 Tabs (VMW Live, Spielplan, Teams, Hausliga).
   Admin (Schiri-Einteilung) via /api/admin/refs mit Passwort-Header.
   ========================================================= */

const POLL_INTERVAL_MS = 60_000;

// VMW-Teams (statisch — passt zur Konfiguration im Scraper)
const TEAMS = [
  { code:'U14',   short:'VMW U14',     pillLabel:'U14',     name:'VMW Berlin U14',   division:'Pupils U14' },
  { code:'U16',   short:'VMW U16',     pillLabel:'U16',     name:'VMW Berlin U16',   division:'Youth U16' },
  { code:'U21',   short:'VMW U21',     pillLabel:'U21',     name:'VMW Berlin U21',   division:'Men U21' },
  { code:'Women', short:'VMW Damen',   pillLabel:'Damen',   name:'VMW Berlin Women', division:'Women' },
  { code:'Men2',  short:'VMW Herren',  pillLabel:'Herren',  name:'VMW Berlin Men2',  division:'Men 2nd class' }
];

/* =========================================================
   STATE
   ========================================================= */
const state = {
  tab:        localStorage.getItem('vmw.tab') || 'live',
  liveDay:    Number(localStorage.getItem('vmw.liveDay'))   || todayTournamentDay(),
  planDay:    Number(localStorage.getItem('vmw.planDay'))   || todayTournamentDay(),
  planScope:  localStorage.getItem('vmw.planScope')  || 'vmw',
  planFilter: localStorage.getItem('vmw.spielplanFilter') || 'all',
  planDivision: localStorage.getItem('vmw.spielplanDivision') || 'all',
  planPastOpen: false,
  teamView:   localStorage.getItem('vmw.teamsView') || 'Women',
  teamsPastOpen: false,
  teamsRefPastOpen: false,
  scorerFilt: localStorage.getItem('vmw.scorersFilter') || 'all',
  scorersAllVisible: false,
  liveExpand: { next: false, ref: false, done: false },
  adminPassword: localStorage.getItem('vmw.adminPwd') || null,
  adminFilter: localStorage.getItem('vmw.adminFilter') || 'all',
  // remote
  snapshot: null,
  refs: {},
  lastFetchOk: 0,
  lastFetchAt: 0,
  fetchError: null,
};
function save(k,v){ localStorage.setItem('vmw.'+k, v); }
function todayTournamentDay(){
  // Vor & während Turnier: Sa=1, So=2, Mo=3. Sonst: Default 1.
  const now = new Date();
  const ymd = now.toISOString().slice(0,10);
  if (ymd === '2026-05-23') return 1;
  if (ymd === '2026-05-24') return 2;
  if (ymd === '2026-05-25') return 3;
  return 1;
}

/* =========================================================
   HELPERS
   ========================================================= */
function teamByCode(c){ return TEAMS.find(t=>t.code===c) }
function isVmw(name){ return /VMW Berlin/i.test(name||'') }
function matchSortKey(m){ return Number((m.time||'00:00').replace(':','')) }
function vmwRoleFor(m){ if(m.vmwTeam) return 'spielt'; if(m.juryVmw) return 'pfeift'; return null }

// Mapping kayakers-Division → Code
function divisionCode(division){
  if(!division) return null;
  if(/Pupils|U14/i.test(division)) return 'U14';
  if(/Youth|U16/i.test(division))  return 'U16';
  if(/U21/i.test(division))        return 'U21';
  if(/Women/i.test(division))      return 'Women';
  if(/1st class/i.test(division))  return 'Men1';
  if(/2nd class/i.test(division))  return 'Men2';
  return null;
}
function divisionLabel(division){
  const c = divisionCode(division);
  return ({U14:'U14',U16:'U16',U21:'U21',Women:'Damen',Men1:'Herren 1',Men2:'Herren 2'})[c] || division || '';
}
function displayName(rawName, vmwCode){
  if(vmwCode){
    const t = teamByCode(vmwCode);
    if(t) return t.short;
  }
  return rawName;
}
// Nutzt aktuelle Berliner Uhrzeit, um "Vergangenheit/Zukunft" zu bestimmen.
function isPast(m){
  if(m.status==='done') return true;
  if(m.status==='live') return false;
  if(!m.time) return false;
  const cur = currentBerlinDayAndTime();
  if (m.day < cur.day) return true;
  if (m.day > cur.day) return false;
  return m.time < cur.time;
}
function currentBerlinDayAndTime(){
  const now = new Date();
  const ymd = now.toLocaleDateString('en-CA', { timeZone:'Europe/Berlin' }); // YYYY-MM-DD
  const hm  = now.toLocaleTimeString('de-DE',  { timeZone:'Europe/Berlin', hour:'2-digit', minute:'2-digit', hour12:false });
  const day = ymd === '2026-05-23' ? 1 : ymd === '2026-05-24' ? 2 : ymd === '2026-05-25' ? 3 : (ymd < '2026-05-23' ? 0 : 4);
  return { day, time: hm };
}
function groupByTime(list){
  const map = new Map();
  list.forEach(m=>{
    const t = m.time || '00:00';
    if(!map.has(t)) map.set(t, []);
    map.get(t).push(m);
  });
  for(const arr of map.values()) arr.sort((a,b)=>Number(a.pitch)-Number(b.pitch));
  return Array.from(map.entries()).sort((a,b)=> Number(a[0].replace(':','')) - Number(b[0].replace(':','')));
}
function refsFor(matchNr){
  const entry = state.refs[matchNr] || state.refs[String(matchNr)];
  return entry?.players ?? null;
}
function refPills(arr){
  if(!arr || !arr.length) return `<span class="refs-empty">— noch nicht eingeteilt</span>`;
  return arr.map(p=>`<span class="ref-pill">${escapeHtml(p)}</span>`).join('');
}
function escapeHtml(s){
  return (s||'').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
}

/* =========================================================
   CARDS
   ========================================================= */
function scoreHtml(m){
  if(m.score && m.score.a != null && m.score.b != null){
    const cls = m.status==='live' ? 'score live' : 'score';
    return `<span class="${cls}">${m.score.a}<span style="color:var(--ink-3);margin:0 4px">:</span>${m.score.b}</span>`;
  }
  return `<span class="vs">– vs –</span>`;
}
function statusBadgeHtml(m){
  if(m.status==='live') return `<span class="badge live"><span class="pulse-dot" style="background:#0E7C3A"></span>Live</span>`;
  if(m.status==='done') return `<span class="badge done">Beendet</span>`;
  return '';
}

function liveCard(m){
  const role = vmwRoleFor(m);
  const cls = ['card'];
  if(m.status==='live') cls.push('live');
  if(role==='spielt') cls.push('spielt');
  else if(role==='pfeift') cls.push('pfeift');

  const nameA = displayName(m.teamA?.name, isVmw(m.teamA?.name)?m.vmwTeam:null);
  const nameB = displayName(m.teamB?.name, isVmw(m.teamB?.name)?m.vmwTeam:null);
  const aCls  = isVmw(m.teamA?.name) ? 'team vmw' : 'team';
  const bCls  = isVmw(m.teamB?.name) ? 'team vmw right' : 'team right';

  let refBlock = '';
  if(role==='pfeift'){
    const t = teamByCode(m.juryVmw);
    refBlock = `
      <div class="pfeift-row"><span class="icon">⚖️</span> ${t?.short || 'VMW'} pfeift</div>
      <div class="refs">${refPills(refsFor(m.nr))}</div>`;
  }

  return `
    <div class="${cls.join(' ')}">
      <div class="match-top">
        <span class="pitch">F${escapeHtml(String(m.pitch))}</span>
        <span class="division-chip">${escapeHtml(divisionLabel(m.division))}</span>
        ${statusBadgeHtml(m)}
      </div>
      <div class="match-teams">
        <span class="${aCls}">${escapeHtml(nameA||'')}</span>
        ${scoreHtml(m)}
        <span class="${bCls}">${escapeHtml(nameB||'')}</span>
      </div>
      ${refBlock}
    </div>`;
}

function planCard(m, opts={}){
  const role = vmwRoleFor(m);
  const past = isPast(m);
  const cls = ['card','compact'];
  if(m.status==='live') cls.push('live');
  if(past) cls.push('past');
  if(role==='spielt') cls.push('spielt');
  else if(role==='pfeift') cls.push('pfeift');

  const nameA = displayName(m.teamA?.name, isVmw(m.teamA?.name)?m.vmwTeam:null);
  const nameB = displayName(m.teamB?.name, isVmw(m.teamB?.name)?m.vmwTeam:null);
  const aCls  = isVmw(m.teamA?.name) ? 'team vmw' : 'team';
  const bCls  = isVmw(m.teamB?.name) ? 'team vmw right' : 'team right';

  let juryBlock = '';
  if(role==='pfeift'){
    const t = teamByCode(m.juryVmw);
    juryBlock = `
      <div class="pfeift-row"><span class="icon">⚖️</span> ${t?.short || 'VMW'} pfeift</div>
      <div class="refs">${refPills(refsFor(m.nr))}</div>`;
  } else if(opts.showJury){
    juryBlock = `<div class="jury-row">Schiri: <strong>${escapeHtml(m.jury?.name || '—')}</strong></div>`;
  }

  return `
    <div class="${cls.join(' ')}">
      <div class="match-top">
        <span class="pitch">F${escapeHtml(String(m.pitch))}</span>
        <span class="division-chip">${escapeHtml(divisionLabel(m.division))}${m.group && m.group!=='Final'?` · ${escapeHtml(m.group)}`:''}${m.group==='Final'?' · Final':''}</span>
        ${statusBadgeHtml(m)}
      </div>
      <div class="match-teams">
        <span class="${aCls}">${escapeHtml(nameA||'')}</span>
        ${scoreHtml(m)}
        <span class="${bCls}">${escapeHtml(nameB||'')}</span>
      </div>
      ${juryBlock}
    </div>`;
}

function teamLiteCard(m){
  const past = isPast(m);
  const cls = ['card','compact'];
  if(m.status==='live') cls.push('live');
  if(past) cls.push('past');

  const nameA = displayName(m.teamA?.name, isVmw(m.teamA?.name)?m.vmwTeam:null);
  const nameB = displayName(m.teamB?.name, isVmw(m.teamB?.name)?m.vmwTeam:null);
  const aCls  = isVmw(m.teamA?.name) ? 'team vmw' : 'team';
  const bCls  = isVmw(m.teamB?.name) ? 'team vmw right' : 'team right';

  return `
    <div class="${cls.join(' ')}">
      <div class="match-top">
        <span class="time">Tag ${m.day} · ${escapeHtml(m.time||'')}</span>
        <span class="pitch">F${escapeHtml(String(m.pitch))}</span>
        ${statusBadgeHtml(m)}
      </div>
      <div class="match-teams">
        <span class="${aCls}">${escapeHtml(nameA||'')}</span>
        ${scoreHtml(m)}
        <span class="${bCls}">${escapeHtml(nameB||'')}</span>
      </div>
    </div>`;
}
function teamRefLiteCard(m){
  const past = isPast(m);
  const cls = ['card','compact','pfeift'];
  if(past) cls.push('past');

  return `
    <div class="${cls.join(' ')}">
      <div class="match-top">
        <span class="time">Tag ${m.day} · ${escapeHtml(m.time||'')}</span>
        <span class="pitch">F${escapeHtml(String(m.pitch))}</span>
      </div>
      <div style="font-size:13.5px;font-weight:600;margin-top:2px">pfeift <strong>${escapeHtml(m.teamA?.name||'')} vs ${escapeHtml(m.teamB?.name||'')}</strong></div>
      <div class="refs" style="margin-top:6px">${refPills(refsFor(m.nr))}</div>
    </div>`;
}

/* =========================================================
   RENDER: VMW LIVE
   ========================================================= */
function renderLive(){
  if (!state.snapshot){
    setLiveSections([], [], [], []);
    return;
  }
  const day = state.liveDay;
  document.querySelectorAll('#liveDaySwitch button').forEach(b=>{
    b.classList.toggle('active', Number(b.dataset.day)===day);
  });
  const all = state.snapshot.matches.filter(m=>m.day===day);

  const live = all.filter(m=> m.status==='live' && (m.vmwTeam || m.juryVmw));
  const next = all.filter(m=> m.status==='next' && m.vmwTeam).sort((a,b)=>matchSortKey(a)-matchSortKey(b));
  const refs = all.filter(m=> m.status==='next' && m.juryVmw).sort((a,b)=>matchSortKey(a)-matchSortKey(b));
  const done = all.filter(m=> m.status==='done' && m.vmwTeam).sort((a,b)=>matchSortKey(b)-matchSortKey(a));

  setLiveSections(live, next, refs, done);
}
function setLiveSections(live, next, refs, done){
  document.getElementById('liveNowCount').textContent = live.length;
  document.getElementById('liveNowList').innerHTML = live.length
    ? renderGroupedByTime(live)
    : `<div class="empty">Gerade kein VMW-Spiel live.</div>`;

  renderExpandableSection('liveNextList','liveNextMore','liveNextCount', next, 'next', `<div class="empty">Keine weiteren VMW-Spiele heute.</div>`);
  renderExpandableSection('liveRefList','liveRefMore','liveRefCount', refs, 'ref',  `<div class="empty">Heute keine Schiri-Einsätze mehr.</div>`);
  renderExpandableSection('liveDoneList','liveDoneMore','liveDoneCount', done, 'done', `<div class="empty">Heute noch keine VMW-Spiele beendet.</div>`);
}

// Rendert Match-Liste mit Zeit-Block-Headern (wie im Spielplan)
function renderGroupedByTime(list){
  const groups = groupByTime(list);
  return groups.map(([time, items]) => {
    const isLiveBlock = items.some(m => m.status==='live');
    return `
      <div class="time-block-h ${isLiveBlock?'live-block':''}">
        <span>${escapeHtml(time)} Uhr</span>
        <span class="cnt">${items.length}</span>
      </div>
      ${items.map(liveCard).join('')}`;
  }).join('');
}

function renderExpandableSection(listId, moreBtnId, countId, list, key, emptyHtml){
  document.getElementById(countId).textContent = list.length;
  const listEl = document.getElementById(listId);
  const moreEl = document.getElementById(moreBtnId);
  if (!list.length){
    listEl.innerHTML = emptyHtml;
    moreEl.hidden = true;
    return;
  }
  const expanded = state.liveExpand[key];
  const visible = expanded ? list : list.slice(0,4);
  listEl.innerHTML = renderGroupedByTime(visible);
  if (list.length > 4){
    moreEl.hidden = false;
    moreEl.textContent = expanded ? '× Weniger anzeigen' : `▾ Weitere ${list.length-4} anzeigen`;
  } else {
    moreEl.hidden = true;
  }
}

/* =========================================================
   RENDER: SPIELPLAN
   ========================================================= */
function renderPlan(){
  const day = state.planDay;
  const scope = state.planScope;
  const f = state.planFilter;
  const df = state.planDivision;

  document.querySelectorAll('#planDaySwitch button').forEach(b=>{
    b.classList.toggle('active', Number(b.dataset.day)===day);
  });
  document.querySelectorAll('#scopeSeg button').forEach(b=>{
    b.classList.toggle('active', b.dataset.scope===scope);
  });
  document.querySelectorAll('#planTeamPills button').forEach(b=>{
    b.classList.toggle('active', b.dataset.team===f);
  });
  document.querySelectorAll('#planDivisionPills button').forEach(b=>{
    b.classList.toggle('active', b.dataset.div===df);
  });
  document.getElementById('planTeamPills').style.display     = scope==='vmw' ? '' : 'none';
  document.getElementById('planDivisionPills').style.display = scope==='vmw' ? 'none' : '';

  const out = document.getElementById('planList');
  if (!state.snapshot){
    out.innerHTML = `<div class="loading-skel">Lade Spielplan …</div>`;
    return;
  }

  let list = state.snapshot.matches.filter(m=>m.day===day);
  if(scope==='vmw'){
    list = list.filter(m=>m.vmwTeam || m.juryVmw);
    if(f!=='all') list = list.filter(m=>m.vmwTeam===f || m.juryVmw===f);
  } else {
    if(df!=='all') list = list.filter(m=>divisionCode(m.division)===df);
  }
  list.sort((a,b)=>matchSortKey(a)-matchSortKey(b));

  if(!list.length){
    out.innerHTML = `<div class="empty">Keine Spiele für diese Auswahl.</div>`;
    return;
  }

  const isCurrentDay = day === currentBerlinDayAndTime().day;
  const past = list.filter(m=>isPast(m));
  const future = list.filter(m=>!isPast(m));
  const showJury = scope==='all';

  function renderBlock(blockMatches){
    const groups = groupByTime(blockMatches);
    return groups.map(([time, matches])=>{
      const isLiveBlock = matches.some(m=>m.status==='live');
      return `
        <div class="time-block-h ${isLiveBlock?'live-block':''}">
          <span>${escapeHtml(time)} Uhr</span>
          <span class="cnt">${matches.length}</span>
        </div>
        ${matches.map(m=>planCard(m,{showJury})).join('')}`;
    }).join('');
  }

  let html = '';
  if(isCurrentDay && past.length){
    html += `
      <button class="past-toggle ${state.planPastOpen?'open':''}" id="pastToggle">
        <span class="arrow">▶</span>
        <span>Beendete Spiele</span>
        <span class="cnt">${past.length}</span>
      </button>`;
    if(state.planPastOpen) html += `<div style="opacity:.85">${renderBlock(past)}</div>`;
  } else if(!isCurrentDay){
    html += renderBlock(list);
  }

  if(isCurrentDay){
    if(future.length){
      html += `<div class="now-divider"><span class="dot"></span>jetzt<span class="dot"></span></div>`;
      html += renderBlock(future);
    } else {
      html += `<div class="now-divider" style="opacity:.6"><span class="dot"></span>alle Spiele beendet<span class="dot"></span></div>`;
    }
  }

  out.innerHTML = html;
  const pt = document.getElementById('pastToggle');
  if(pt) pt.addEventListener('click', ()=>{ state.planPastOpen = !state.planPastOpen; renderPlan(); });
}

/* =========================================================
   RENDER: TEAMS
   ========================================================= */
function teamStats(code){
  if (!state.snapshot) return { Sp:0, W:0, D:0, L:0, GF:0, GA:0, GD:0, P:0, PPG:0 };
  const games = state.snapshot.matches.filter(m=>m.vmwTeam===code && m.status==='done' && m.score?.a!=null);
  let W=0,D=0,L=0,GF=0,GA=0;
  games.forEach(m=>{
    const our   = isVmw(m.teamA?.name) ? m.score.a : m.score.b;
    const their = isVmw(m.teamA?.name) ? m.score.b : m.score.a;
    GF+=our; GA+=their;
    if(our>their) W++; else if(our<their) L++; else D++;
  });
  const Sp=games.length, P=W*3+D, PPG=Sp>0?P/Sp:0;
  return { Sp, W, D, L, GF, GA, GD:GF-GA, P, PPG };
}
function splitPastFuture(list){
  return { past: list.filter(m=>isPast(m)), future: list.filter(m=>!isPast(m)) };
}
function renderTeams(){
  const code = state.teamView;
  document.querySelectorAll('#teamPills button').forEach(b=>{
    b.classList.toggle('active', b.dataset.team===code);
  });
  const team = teamByCode(code);
  const out = document.getElementById('teamDetail');
  if (!state.snapshot){
    out.innerHTML = `<div class="loading-skel">Lade Team-Daten …</div>`;
    return;
  }

  const teamMatches = state.snapshot.matches
    .filter(m=>m.vmwTeam===code)
    .sort((a,b)=>(a.day*1e4+matchSortKey(a))-(b.day*1e4+matchSortKey(b)));
  const refMatches  = state.snapshot.matches
    .filter(m=>m.juryVmw===code)
    .sort((a,b)=>(a.day*1e4+matchSortKey(a))-(b.day*1e4+matchSortKey(b)));
  const remoteTeam = state.snapshot.teams.find(t=>t.code===code);
  const roster = remoteTeam?.roster || [];
  const s = teamStats(code);
  const goalsTotal = roster.reduce((sum,p)=>sum+(p.goals||0),0);

  const tm = splitPastFuture(teamMatches);
  const rf = splitPastFuture(refMatches);

  const bilanzTable = `
    <div class="table-wrap">
      <table class="t">
        <thead><tr>
          <th>Sp</th><th>S</th><th>U</th><th>N</th>
          <th>Tore</th><th>Diff</th><th>Pkt</th><th>PPG</th>
        </tr></thead>
        <tbody><tr>
          <td>${s.Sp}</td><td>${s.W}</td><td>${s.D}</td><td>${s.L}</td>
          <td>${s.GF}:${s.GA}</td><td>${s.GD>=0?'+':''}${s.GD}</td>
          <td><strong>${s.P}</strong></td>
          <td class="ppg">${s.Sp>0 ? s.PPG.toFixed(2) : '—'}</td>
        </tr></tbody>
      </table>
    </div>`;

  function matchesSection(label, icon, future, past, openState, toggleId, cardFn){
    let html = `<h3 class="section">${icon} ${label} <span class="count">${(future.length+past.length)}</span></h3>`;
    if(past.length){
      html += `
        <button class="past-toggle ${openState?'open':''}" id="${toggleId}">
          <span class="arrow">▶</span>
          <span>Vergangene</span>
          <span class="cnt">${past.length}</span>
        </button>`;
      if(openState) html += past.map(cardFn).join('');
    }
    if(future.length){
      html += future.map(cardFn).join('');
    } else if(!past.length){
      html += `<div class="empty">Keine ${label.toLowerCase()} geplant.</div>`;
    }
    return html;
  }

  out.innerHTML = `
    <div style="background:#fff;border-radius:var(--radius);box-shadow:var(--shadow);padding:14px 14px 12px;margin-bottom:14px">
      <div style="font-size:13px;color:var(--ink-3);font-weight:600">${escapeHtml(divisionLabel(team.division))}</div>
      <div style="font-size:20px;font-weight:800;color:var(--vmw-red);margin-top:2px">${escapeHtml(team.name)}</div>
    </div>

    <h3 class="section">📊 Bilanz</h3>
    ${bilanzTable}

    ${matchesSection('Spiele','📅', tm.future, tm.past, state.teamsPastOpen, 'teamsPastToggle', teamLiteCard)}
    ${matchesSection('Schiri-Einsätze','🟠', rf.future, rf.past, state.teamsRefPastOpen, 'teamsRefPastToggle', teamRefLiteCard)}

    <h3 class="section">👤 Kader & Tore <span class="count">${goalsTotal} Tore</span></h3>
    <div class="table-wrap" style="padding:0">
      ${roster.length === 0
        ? `<div class="empty" style="border-radius:0">Noch kein Kader hinterlegt.</div>`
        : roster.map(p=>`
        <div class="roster-row">
          <div class="nr">${p.nr}</div>
          <div class="name ${p.name?'':'empty'}">${p.name ? escapeHtml(p.name) : '— Vorname nicht hinterlegt —'}</div>
          <div class="goals">${p.goals||0}<small>Tore</small></div>
        </div>`).join('')}
    </div>
  `;
  const pt = document.getElementById('teamsPastToggle');
  if(pt) pt.addEventListener('click', ()=>{ state.teamsPastOpen = !state.teamsPastOpen; renderTeams(); });
  const rt = document.getElementById('teamsRefPastToggle');
  if(rt) rt.addEventListener('click', ()=>{ state.teamsRefPastOpen = !state.teamsRefPastOpen; renderTeams(); });
}

/* =========================================================
   RENDER: HAUSLIGA
   ========================================================= */
function computeHausliga(){
  return TEAMS.map(t=>({ code:t.code, pillLabel:t.pillLabel, ...teamStats(t.code) }))
    .sort((a,b)=> b.PPG-a.PPG || b.GD-a.GD);
}
function renderHausliga(){
  const tbody = document.querySelector('#hausligaTable tbody');
  const rows = computeHausliga();
  tbody.innerHTML = rows.map((r,i)=>`
    <tr>
      <td class="rank">${i+1}</td>
      <td class="team-cell">${r.pillLabel}</td>
      <td>${r.Sp}</td><td>${r.W}</td><td>${r.D}</td><td>${r.L}</td>
      <td>${r.GF}:${r.GA}</td><td>${r.GD>=0?'+':''}${r.GD}</td><td><strong>${r.P}</strong></td>
      <td class="ppg">${r.Sp>0 ? r.PPG.toFixed(2) : '—'}</td>
    </tr>`).join('');

  const f = state.scorerFilt;
  document.querySelectorAll('#scorerPills button').forEach(b=>{
    b.classList.toggle('active', b.dataset.team===f);
  });

  let scorers = [];
  TEAMS.forEach(t=>{
    if(f!=='all' && t.code!==f) return;
    const remoteTeam = state.snapshot?.teams.find(x=>x.code===t.code);
    (remoteTeam?.roster || []).forEach(p=>scorers.push({ ...p, team:t.pillLabel, code:t.code }));
  });
  scorers = scorers.filter(s=>(s.goals||0)>0).sort((a,b)=>(b.goals||0)-(a.goals||0));

  const out = document.getElementById('scorersList');
  const moreBtn = document.getElementById('scorersMoreBtn');

  if(!scorers.length){
    out.innerHTML = `<div class="empty" style="border-radius:var(--radius)">Noch keine Tore in dieser Auswahl.</div>`;
    moreBtn.style.display = 'none';
    return;
  }
  const visible = state.scorersAllVisible ? scorers : scorers.slice(0,10);
  out.innerHTML = visible.map((s,i)=>`
    <div class="scorer">
      <span class="rank">${i+1}.</span>
      <span class="team-av team-${s.code}">${escapeHtml(s.team)}</span>
      <span class="name ${s.name?'':'empty'}">${s.name ? escapeHtml(s.name) : '— Vorname fehlt —'}</span>
      <span class="goals">${s.goals||0}<small>Tore</small></span>
    </div>`).join('');

  if(scorers.length > 10){
    moreBtn.style.display = '';
    moreBtn.textContent = state.scorersAllVisible
      ? '× Weniger anzeigen'
      : `▾ Weitere ${scorers.length - 10} anzeigen`;
  } else {
    moreBtn.style.display = 'none';
  }
}

/* =========================================================
   ADMIN MODAL
   ========================================================= */
function renderAdmin(){
  const cont = document.getElementById('adminContent');
  if(!state.adminPassword){
    cont.innerHTML = `
      <h3>Trainer-Login</h3>
      <p style="font-size:13px;color:var(--ink-2);margin:0">
        Nur Trainer:innen mit Passwort. Hier wird die Schiri-Einteilung gepflegt.
      </p>
      <label class="field">
        <span>Passwort</span>
        <input type="password" id="adminPwd" placeholder="••••••••" autocomplete="off">
      </label>
      <button class="btn" id="adminLoginBtn">Login</button>
      <button class="btn secondary" onclick="closeModal('admin')">Abbrechen</button>`;
    document.getElementById('adminLoginBtn').addEventListener('click', adminLogin);
    document.getElementById('adminPwd').addEventListener('keydown', e=>{ if(e.key==='Enter') adminLogin(); });
    return;
  }

  if (!state.snapshot){
    cont.innerHTML = `<h3>Schiri-Einteilung</h3><div class="loading-skel">Lade Daten …</div>`;
    return;
  }

  let upcoming = state.snapshot.matches
    .filter(m => m.juryVmw && !isPast(m))
    .sort((a,b)=>(a.day*1e4+matchSortKey(a))-(b.day*1e4+matchSortKey(b)));
  if(state.adminFilter !== 'all') upcoming = upcoming.filter(m=>m.juryVmw === state.adminFilter);

  const pillsHtml = `
    <div class="pills" style="margin:6px -4px 10px;padding-left:4px;padding-right:4px">
      <button data-team="all" class="${state.adminFilter==='all'?'active':''}">Alle</button>
      ${TEAMS.map(t=>`<button data-team="${t.code}" class="${state.adminFilter===t.code?'active':''}">${t.pillLabel}</button>`).join('')}
    </div>`;

  cont.innerHTML = `
    <h3>Schiri-Einteilung</h3>
    <p style="font-size:13px;color:var(--ink-2);margin:0 0 4px">
      Bitte nur <strong>Vornamen</strong> eintragen, durch <strong>Komma getrennt</strong> — sie erscheinen einzeln als kleine Tags in der App.
    </p>
    ${pillsHtml}
    ${upcoming.length === 0
      ? `<div class="empty">Keine anstehenden Schiri-Einsätze für diese Auswahl.</div>`
      : upcoming.map(m=>{
          const r = refsFor(m.nr) || [];
          const val = r.join(', ');
          const t = teamByCode(m.juryVmw);
          const hasRefs = r.length > 0;
          return `
            <div class="admin-match ${hasRefs?'':'empty'}" id="adm-${m.nr}">
              ${hasRefs ? `<span class="assigned-marker">✓ Eingeteilt</span>` : ''}
              <div class="meta">Tag ${m.day} · ${escapeHtml(m.time||'')} · Feld ${escapeHtml(String(m.pitch))} · #${m.nr}</div>
              <div class="teams"><span style="color:var(--orange)">⚖️ ${t.pillLabel}</span> pfeift <strong>${escapeHtml(m.teamA?.name||'')} vs ${escapeHtml(m.teamB?.name||'')}</strong></div>
              <textarea id="ref-${m.nr}" placeholder="z. B. Lisa, Tom, Klara">${escapeHtml(val)}</textarea>
              <div class="hint">Vornamen durch Komma trennen</div>
              <button class="save" id="save-${m.nr}" data-nr="${m.nr}">Speichern</button>
            </div>`;
        }).join('')}
    <button class="btn secondary" onclick="adminLogout()">Logout</button>
  `;

  cont.querySelectorAll('.pills button').forEach(b=>{
    b.addEventListener('click', ()=>{
      state.adminFilter = b.dataset.team;
      save('adminFilter', state.adminFilter);
      renderAdmin();
    });
  });
  cont.querySelectorAll('.save').forEach(btn=>{
    btn.addEventListener('click', ()=>saveRefs(Number(btn.dataset.nr)));
  });
}

async function adminLogin(){
  const v = document.getElementById('adminPwd').value;
  try {
    const res = await fetch('/api/admin/login', {
      method: 'POST',
      headers: { 'x-admin-password': v, 'content-type':'application/json' },
      body: '{}',
    });
    if (res.ok){
      state.adminPassword = v;
      localStorage.setItem('vmw.adminPwd', v);
      showToast('Eingeloggt');
      renderAdmin();
    } else {
      showToast('Passwort falsch');
    }
  } catch (e){
    showToast('Login fehlgeschlagen');
  }
}
function adminLogout(){
  state.adminPassword = null;
  localStorage.removeItem('vmw.adminPwd');
  showToast('Ausgeloggt');
  renderAdmin();
}
async function saveRefs(nr){
  const txt = document.getElementById('ref-'+nr).value.trim();
  const players = txt ? txt.split(',').map(s=>s.trim()).filter(Boolean) : [];
  const btn = document.getElementById('save-'+nr);
  const card = document.getElementById('adm-'+nr);
  btn.disabled = true; btn.textContent = '…';
  try {
    const res = await fetch('/api/admin/refs', {
      method:'POST',
      headers:{ 'content-type':'application/json', 'x-admin-password': state.adminPassword },
      body: JSON.stringify({ matchNr: nr, players }),
    });
    if (!res.ok){
      if (res.status === 401){
        adminLogout();
        return;
      }
      throw new Error('save failed: '+res.status);
    }
    const json = await res.json();
    state.refs = json.refs || {};
    btn.classList.add('ok'); btn.textContent = '✓ Gespeichert';
    if(players.length && card){
      card.classList.remove('empty');
      if(!card.querySelector('.assigned-marker')){
        const span = document.createElement('span');
        span.className = 'assigned-marker';
        span.textContent = '✓ Eingeteilt';
        card.prepend(span);
      }
    } else if(card){
      card.classList.add('empty');
      const marker = card.querySelector('.assigned-marker');
      if(marker) marker.remove();
    }
    setTimeout(()=>{ btn.classList.remove('ok'); btn.textContent='Speichern'; btn.disabled=false; }, 2000);
    renderActiveTab();
  } catch (e){
    btn.textContent='Fehler';
    setTimeout(()=>{ btn.textContent='Speichern'; btn.disabled=false; }, 2000);
    showToast('Speichern fehlgeschlagen');
  }
}

/* =========================================================
   MODAL / TOAST
   ========================================================= */
function openModal(which){
  if(which==='admin') renderAdmin();
  document.getElementById(which+'Modal').classList.add('open');
}
function closeModal(which){
  document.getElementById(which+'Modal').classList.remove('open');
}
window.openModal = openModal;
window.closeModal = closeModal;
window.adminLogout = adminLogout;

let toastTimer;
function showToast(text){
  const t = document.getElementById('toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(()=>t.classList.remove('show'), 1800);
}

/* =========================================================
   TABS
   ========================================================= */
function setTab(tab){
  state.tab = tab; save('tab', tab);
  document.querySelectorAll('.panel').forEach(p=>p.classList.remove('active'));
  document.getElementById('panel-'+tab).classList.add('active');
  document.querySelectorAll('.tabbar button').forEach(b=>{
    b.classList.toggle('active', b.dataset.tab===tab);
  });
  window.scrollTo({ top:0, behavior:'instant' });
  renderActiveTab();
}
function renderActiveTab(){
  if(state.tab==='live') renderLive();
  else if(state.tab==='plan') renderPlan();
  else if(state.tab==='teams') renderTeams();
  else if(state.tab==='haus') renderHausliga();
}

/* =========================================================
   UPDATE-INDICATOR (Header) — Timestamp passiv
   ========================================================= */
function tickStale(){
  const el  = document.getElementById('updatedText');
  const dot = document.getElementById('updatedDot');

  // Wir zeigen NICHT den Frontend-Sync-Zeitpunkt, sondern wann der Scraper
  // zuletzt frische Daten von kayakers.nl geholt hat (snapshot.lastUpdated).
  const stamp = state.snapshot?.lastUpdated;
  if (!stamp){
    el.textContent = 'lade …';
    if (dot) dot.className = 'dot dead';
    return;
  }

  const last = new Date(stamp);
  const minAgo = Math.floor((Date.now() - last.getTime()) / 60000);

  // Absolute Berlin-Uhrzeit — "Stand 12:34" — einfacher zu scannen als "vor X Min"
  const timeStr = last.toLocaleTimeString('de-DE', {
    timeZone: 'Europe/Berlin',
    hour:   '2-digit',
    minute: '2-digit',
    hour12: false,
  });
  el.textContent = `Stand ${timeStr}`;

  // Dot-Farbe nach Alter:
  //   grün < 20 Min  (Cron läuft 15-Min-Takt, also normal)
  //   gelb < 60 Min  (verzögert, irgendwas hakt)
  //   grau > 60 Min  (alt)
  if (!dot) return;
  if (minAgo < 20)      dot.className = 'dot';
  else if (minAgo < 60) dot.className = 'dot stale';
  else                  dot.className = 'dot dead';
}
setInterval(tickStale, 30_000);

/* =========================================================
   DATEN-FETCH (Polling alle 60s)
   ========================================================= */
async function fetchData(){
  try {
    const res = await fetch('/api/data', { cache: 'default' });
    if (!res.ok) throw new Error('HTTP '+res.status);
    const data = await res.json();
    state.snapshot = data.snapshot;
    state.refs = data.refereeAssignments || {};
    state.lastFetchOk = Date.now();
    state.fetchError = null;
    renderActiveTab();
    tickStale();
  } catch (e){
    state.fetchError = e.message;
    // Wenn wir noch nie Daten hatten, zeige Loading-Skeleton; sonst behalte bestehende Daten.
    renderActiveTab();
  }
}

/* =========================================================
   WIRE UP
   ========================================================= */
document.querySelectorAll('.tabbar button').forEach(b=>{
  b.addEventListener('click', ()=>setTab(b.dataset.tab));
});
document.querySelectorAll('#liveDaySwitch button').forEach(b=>{
  b.addEventListener('click', ()=>{
    state.liveDay = Number(b.dataset.day); save('liveDay', state.liveDay);
    state.liveExpand = { next:false, ref:false, done:false };
    renderLive();
  });
});
document.querySelectorAll('#planDaySwitch button').forEach(b=>{
  b.addEventListener('click', ()=>{
    state.planDay = Number(b.dataset.day); save('planDay', state.planDay);
    state.planPastOpen = false;
    renderPlan();
  });
});
document.querySelectorAll('#scopeSeg button').forEach(b=>{
  b.addEventListener('click', ()=>{
    state.planScope = b.dataset.scope; save('planScope', state.planScope);
    renderPlan();
  });
});
document.querySelectorAll('#planTeamPills button').forEach(b=>{
  b.addEventListener('click', ()=>{
    state.planFilter = b.dataset.team; save('spielplanFilter', state.planFilter);
    renderPlan();
  });
});
document.querySelectorAll('#planDivisionPills button').forEach(b=>{
  b.addEventListener('click', ()=>{
    state.planDivision = b.dataset.div; save('spielplanDivision', state.planDivision);
    renderPlan();
  });
});
document.querySelectorAll('#teamPills button').forEach(b=>{
  b.addEventListener('click', ()=>{
    state.teamView = b.dataset.team; save('teamsView', state.teamView);
    state.teamsPastOpen = false; state.teamsRefPastOpen = false;
    renderTeams();
  });
});
document.querySelectorAll('#scorerPills button').forEach(b=>{
  b.addEventListener('click', ()=>{
    state.scorerFilt = b.dataset.team; save('scorersFilter', state.scorerFilt);
    state.scorersAllVisible = false;
    renderHausliga();
  });
});
document.getElementById('scorersMoreBtn').addEventListener('click', ()=>{
  state.scorersAllVisible = !state.scorersAllVisible;
  renderHausliga();
});
['liveNextMore','liveRefMore','liveDoneMore'].forEach(id=>{
  const key = id.replace('liveNextMore','next').replace('liveRefMore','ref').replace('liveDoneMore','done');
  document.getElementById(id).addEventListener('click', ()=>{
    state.liveExpand[key] = !state.liveExpand[key];
    renderLive();
  });
});

/* INITIAL */
setTab(state.tab);
fetchData();
setInterval(fetchData, POLL_INTERVAL_MS);
