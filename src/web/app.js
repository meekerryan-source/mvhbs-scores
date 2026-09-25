// MVHBS read-only UI. Plain ES module, no framework. Official weeks come from data.json (built by
// `npm run build:web`); the current week is scored LIVE in the browser by engine.js, straight from ESPN.

import { computeLive, currentWeek } from './engine.js';

const GRID_ROWS = [['QB', 3], ['RB', 6], ['WR', 6], ['TE', 3], ['K', 3], ['DST', 3], ['IDP', 6]];
const $ = sel => document.querySelector(sel);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const fmt = n => (n == null || Number.isNaN(n) ? '' : Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));
const signed = n => (n > 0 ? '+' : '') + fmt(n);
const store = {
  get: k => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { localStorage.setItem(k, v); } catch { /* private window: not remembered */ } },
};

let DATA;
let IR = new Map(); // normName|TEAM and normName| → IR record

/** Same key as the engine's normName (strip one Jr/Sr/II/III/IV/V suffix and non-alphanumerics). */
const normName = s => String(s ?? '').trim().replace(/[.,]/g, ' ').replace(/\s+\b(jr|sr|ii|iii|iv|v)\b\s*$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');

function indexIr() {
  IR = new Map();
  for (const p of DATA.ir?.players ?? []) {
    const k = normName(p.name);
    IR.set(`${k}|${p.team}`, p);
    if (!IR.has(`${k}|`)) IR.set(`${k}|`, p);
  }
}
/** Official Injured Reserve record for a rostered player (never D/ST), matched by name + NFL team, then name. */
const irFor = e => (e.bucket === 'DST' ? null : IR.get(`${normName(e.player)}|${e.nfl}`) ?? IR.get(`${normName(e.player)}|`) ?? null);
const irDate = d => (d ? new Date(d + 'T12:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');

const LIVE = { week: null, error: '', timer: 0, busy: false, checked: false };
const STATUS_LABEL = { final: 'Final', provisional: 'Provisional', live: 'Live', unsettled: 'Not settled' };

async function load() {
  const res = await fetch('data.json', { cache: 'no-store' });
  DATA = await res.json();
  DATA.standings = computeStandings();
  indexIr();
  $('#season').textContent = DATA.season;
  updateStamp();
}

function updateStamp() {
  const lw = DATA.weeks.find(w => w.status === 'live');
  $('#generated').textContent = lw?.live
    ? `live · updated ${new Date(lw.live.fetchedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`
    : `official through W${lastFinal() ?? '—'} · built ${new Date(DATA.generatedAt).toLocaleDateString()}`;
}

function lastFinal() {
  const f = DATA.weeks.filter(w => w.status === 'final');
  return f.length ? f[f.length - 1].week : null;
}

function rerender() {
  if ($('#drawer').open) return; // don't yank the audit panel out from under a reader
  const y = window.scrollY;
  route();
  window.scrollTo(0, y);
}

// ---------------------------------------------------------------------------------------------
// Live loop: score the current week in the browser. Every 60 s while a game is on, every 10 min
// otherwise. data.json is re-read every 30 min so Tuesday's official settle replaces the live week.
// ---------------------------------------------------------------------------------------------
async function liveTick() {
  if (LIVE.busy || document.hidden) return;
  LIVE.busy = true;
  let next = 10 * 60_000;
  try {
    LIVE.week ??= await currentWeek(DATA.season);
    const wk = LIVE.week;
    const existing = DATA.weeks.find(w => w.week === wk);
    if (!wk || existing?.status === 'final') return; // off-season, or already official
    const prev = DATA.weeks.filter(w => w.week < wk).at(-1)?.newTotals ?? {};
    const r = await computeLive(DATA.base, wk, prev);
    DATA.weeks = DATA.weeks.filter(w => w.week !== wk).concat(r.week).sort((a, b) => a.week - b.week);
    DATA.standings = computeStandings();
    LIVE.error = '';
    next = r.anyInProgress ? 60_000 : 10 * 60_000;
  } catch (e) {
    LIVE.error = `Live scores unavailable right now (${e.message}). Showing the last update; retrying in 2 minutes.`;
    next = 2 * 60_000;
  } finally {
    LIVE.busy = false;
    LIVE.checked = true;
    updateStamp();
    rerender();
    clearTimeout(LIVE.timer);
    LIVE.timer = setTimeout(liveTick, next);
  }
}

// Don't burn phone data while the screen is off or the tab is in the background; catch up on return.
document.addEventListener('visibilitychange', () => {
  if (document.hidden) { clearTimeout(LIVE.timer); return; }
  if (DATA) liveTick();
});

setInterval(async () => {
  const keep = DATA.weeks.find(w => w.status === 'live');
  try { await load(); } catch { return; }
  if (keep && !DATA.weeks.some(w => w.week === keep.week && w.status === 'final')) {
    DATA.weeks = DATA.weeks.filter(w => w.week !== keep.week).concat(keep).sort((a, b) => a.week - b.week);
    DATA.standings = computeStandings();
  }
  rerender();
}, 30 * 60_000);

async function init() {
  try {
    await load();
  } catch (e) {
    $('#main').innerHTML = `<div class="badbox">Could not load data.json — run <code>npm run build:web</code>. (${esc(e.message)})</div>`;
    return;
  }
  $('#drawer-close').addEventListener('click', () => $('#drawer').close());
  $('#drawer').addEventListener('click', e => { if (e.target === $('#drawer')) $('#drawer').close(); });
  window.addEventListener('hashchange', route);
  const pick = $('#team-pick');
  pick.innerHTML = `<option value="">My team…</option>` + DATA.teams.map(t => `<option value="${esc(t)}">${esc(t)}</option>`).join('');
  pick.value = myTeam() ?? '';
  pick.addEventListener('change', () => {
    if (!pick.value) return;
    store.set('mvhbs.team', pick.value);
    location.hash = `#team/${pick.value}`;
  });
  if (!location.hash && myTeam()) location.hash = `#team/${myTeam()}`;
  route();
  liveTick();
}

function myTeam() {
  const t = store.get('mvhbs.team');
  return DATA.teams.includes(t) ? t : null;
}

function latestWeek() {
  const live = DATA.weeks.find(w => w.status === 'live');
  if (live) return live.week;
  const final = DATA.weeks.filter(w => w.status === 'final');
  return (final.length ? final[final.length - 1] : DATA.weeks[0]).week;
}

function route() {
  const [page = 'week', a1, a2] = location.hash.replace(/^#\/?/, '').split('/').map(decodeURIComponent);
  document.querySelectorAll('#nav a').forEach(a => a.setAttribute('aria-current', a.dataset.page === page ? 'page' : 'false'));
  const myLink = $('#nav a[data-page="team"]');
  myLink.hidden = !myTeam();
  if (myTeam()) myLink.href = `#team/${myTeam()}`;
  const main = $('#main');
  const banner = LIVE.error ? `<div class="warnbox">${esc(LIVE.error)}</div>` : '';
  if (page === 'standings') main.innerHTML = banner + renderStandings();
  else if (page === 'parity') main.innerHTML = renderParity(Number(a1) || null);
  else if (page === 'audit') main.innerHTML = renderAudit();
  else if (page === 'team' && DATA.teams.includes(a1)) { main.innerHTML = banner + renderTeam(a1, Number(a2) || latestWeek()); bindGrid(); }
  else { main.innerHTML = banner + renderWeek(Number(a1) || latestWeek()); bindGrid(); }
}

/** Standings from the weeks on hand (live week included). Avg / Last / Best use final weeks only. */
function computeStandings() {
  const rows = DATA.teams.map(team => {
    const wk = DATA.weeks.map(w => w.weekTotals[team] ?? 0);
    const fin = wk.filter((_, i) => DATA.weeks[i].status === 'final');
    return {
      team, weeks: wk, total: Math.round(wk.reduce((a, b) => a + b, 0) * 100) / 100,
      avg: fin.length ? Math.round(fin.reduce((a, b) => a + b, 0) / fin.length * 10) / 10 : 0,
      last: fin.length ? fin[fin.length - 1] : 0, best: fin.length ? Math.max(...fin) : 0,
    };
  });
  rows.sort((a, b) => b.total - a.total);
  rows.forEach((r, i) => { r.rank = i + 1; r.behind = i === 0 ? null : Math.round((r.total - rows[0].total) * 100) / 100; });
  return rows;
}

function weekPicker(current, base) {
  return `<div class="weekpick">${DATA.weeks.map(w => `<a href="#${base}/${w.week}" aria-current="${w.week === current}">W${w.week}</a>`).join('')}</div>`;
}
const badge = st => `<span class="badge ${st}">${STATUS_LABEL[st] ?? st}</span>`;

// ---------------------------------------------------------------------------------------------
// Week grid
// ---------------------------------------------------------------------------------------------
function renderWeek(n) {
  const w = DATA.weeks.find(x => x.week === n) ?? DATA.weeks[0];
  // Lineup colours only mean something once every game is over (live: all ESPN games final).
  const final = w.status === 'final' || (w.status === 'live' && w.live?.allFinal);
  let h = `<div class="bar"><h1>Week ${w.week}</h1>${badge(w.status)}${weekPicker(w.week, 'week')}</div>`;
  h += `<div class="bar"><span class="muted">${esc(w.statusNote)}${w.live ? ` · ESPN fetched ${new Date(w.live.fetchedAt).toLocaleTimeString()}` : ''}</span></div>`;
  if (w.live) h += renderGames(w.live.games);
  if (w.status === 'unsettled' && !LIVE.checked) h += `<p class="muted note">Loading live scores…</p>`;
  else if (w.status === 'unsettled') h += `<div class="warnbox">nflverse has no official stats for Week ${w.week} yet, so nothing is scored. The sheet's live grid stays the reference until the Tuesday nflverse refresh.</div>`;
  const floors = w.audit.filter(a => a.type.startsWith('pbp_'));
  if (floors.length) h += `<div class="badbox"><b>${floors.length} TD${floors.length > 1 ? 's' : ''} floored to +2</b> — play-by-play distances missing. <a href="#audit">See Audit</a>.</div>`;
  h += `<div class="bar legend">${final ? '<span class="lg-starter">Counted</span><span class="lg-bonus">Bonus slot</span><span class="lg-sixth">6th man</span>' : '<span class="muted">Lineup colours appear once the week is final.</span>'}<span class="lg-doubler">★ Doubler ×2</span>${IR.size ? '<span class="lg-ir">Injured Reserve</span>' : ''}<span class="muted">Click any player for the scoring audit.</span></div>`;

  h += `<div class="card scroll"><table class="grid"><thead><tr><th class="slot">Slot</th>`;
  for (const t of DATA.teams) {
    const s = w.sixth[t];
    const tag = [s.RB && 'RB', s.WR && 'WR'].filter(Boolean).join('+');
    h += `<th colspan="2">${esc(t)}${tag ? ` <span class="pill" title="Sixth-man extra starter">6th ${tag}</span>` : ''}</th>`;
  }
  h += `</tr></thead><tbody>`;
  for (const [b, n] of GRID_ROWS) {
    for (let k = 0; k < n; k++) {
      h += `<tr class="${k === n - 1 ? 'group-end' : ''}"><td class="slot">${b}${k + 1}</td>`;
      for (const t of DATA.teams) {
        const id = w.grid[t][b][k];
        const e = id && w.entries[id];
        if (!e) { h += `<td class="name"></td><td class="pts"></td>`; continue; }
        const ir = irFor(e);
        const cls = [final && e.slot === 'starter' ? (e.sixthMan ? 'sixth' : 'starter') : '', final && e.slot === 'bonus' ? 'bonus' : '', !e.active ? 'inactive' : '', ir ? 'on-ir' : ''].filter(Boolean).join(' ');
        const dcls = e.doubled ? `doubled${ir ? ' on-ir' : ''}` : cls;
        const title = `${e.player} · ${e.pos} ${e.nfl} · ${e.counted}${e.doubled ? ' · doubler' : ''}${ir ? ' · INJURED RESERVE' : ''}${e.active ? '' : ' · no stats this week'}`;
        h += `<td class="cell name ${dcls}" data-id="${id}" title="${esc(title)}">${e.doubled ? '★ ' : ''}${esc(e.player)}</td>`;
        h += `<td class="cell pts ${dcls}" data-id="${id}">${e.doubled ? `<span class="x2">${fmt(e.raw)}×2=</span>${fmt(e.pts)}` : fmt(e.pts)}</td>`;
      }
      h += `</tr>`;
    }
  }
  const totalRow = (label, key, cls) => `<tr class="total ${cls}"><td class="slot">${label}</td>${DATA.teams.map(t => `<td></td><td class="pts">${fmt(w[key][t])}</td>`).join('')}</tr>`;
  h += totalRow('Week total', 'weekTotals', '') + totalRow('Previous', 'previousTotals', '') + totalRow('New Total', 'newTotals', 'new');
  h += `</tbody></table></div>`;
  return h;
}

// ---------------------------------------------------------------------------------------------
// My team: one team's week — headline numbers, the counting lineup, then the bench
// ---------------------------------------------------------------------------------------------

/** NFL team code → { state: pre|in|post|bye|final, text } for this week. */
function gameIndex(w) {
  const out = {};
  if (!w.live) return out;
  for (const g of w.live.games) {
    const score = `${g.away} ${g.as}–${g.hs} ${g.home}`;
    const info = g.state === 'in' ? { state: 'in', text: `${score} · ${g.detail}` }
      : g.state === 'post' ? { state: 'post', text: `Final · ${score}` }
      : { state: 'pre', text: `${g.away} @ ${g.home} · ${g.detail}` };
    out[g.home] = info; out[g.away] = info;
  }
  return out;
}

function gameFor(e, w, games) {
  if (w.status !== 'live') return w.status === 'final' ? { state: 'final', text: '' } : { state: 'pre', text: '' };
  const code = e.nfl || e.match?.statsTeam;
  if (!code) return { state: 'pre', text: 'NFL team unknown' };
  return games[code] ?? { state: 'bye', text: 'No game this week' };
}

function slotTag(e, final) {
  const b = e.bucket;
  if (e.slot === 'bonus') return `<span class="slot-tag bonus">Bonus</span>`;
  if (e.slot === 'starter') return `<span class="slot-tag ${e.sixthMan ? 'sixth' : 'starter'}">${e.sixthMan ? '6th man' : 'Counted'}</span>`;
  return `<span class="slot-tag bench">Bench</span>`;
}

function playerRow(e, w, games, final) {
  const g = gameFor(e, w, games);
  const ptsText = e.doubled ? `<span class="x2">${fmt(e.raw)}×2</span>${fmt(e.pts)}` : fmt(e.pts);
  const ir = irFor(e);
  const line = e.statLine || (ir ? `On Injured Reserve since ${irDate(ir.date)}` : g.state === 'pre' || g.state === 'bye' ? '' : e.active ? 'No scoring stats yet' : 'No stats');
  return `<button type="button" class="prow cell ${e.doubled ? 'is-doubled' : ''} ${ir ? 'on-ir' : ''} g-${g.state}" data-id="${e.id}">
    ${slotTag(e, final)}
    <span class="pmain"><span class="pname">${e.doubled ? '★ ' : ''}${esc(e.player)}${ir ? ' <span class="ir-pill" title="Official NFL Injured Reserve">IR</span>' : ''}</span>
      <span class="pmeta">${esc(e.pos)}${e.nfl ? ' · ' + esc(e.nfl) : ''}${g.text ? ` · <span class="gstate">${g.state === 'in' ? '● ' : ''}${esc(g.text)}</span>` : ''}</span>
      ${line ? `<span class="pline">${esc(line)}</span>` : ''}</span>
    <span class="ppts">${ptsText}</span>
  </button>`;
}

function ordinal(n) { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); }

function renderTeam(team, n) {
  const w = DATA.weeks.find(x => x.week === n) ?? DATA.weeks.at(-1);
  const final = w.status === 'final' || (w.status === 'live' && w.live?.allFinal);
  const games = gameIndex(w);
  const entries = DATA.buckets.flatMap(b => w.grid[team][b].map(id => w.entries[id]));
  const counting = entries.filter(e => e.slot !== 'bench');
  const bench = entries.filter(e => e.slot === 'bench');

  const weekRank = [...DATA.teams].sort((a, b) => w.weekTotals[b] - w.weekTotals[a]).indexOf(team) + 1;
  const st = DATA.standings.find(s => s.team === team);
  const above = DATA.standings[st.rank - 2];
  const below = DATA.standings[st.rank];
  const toPlay = w.status === 'live' ? counting.filter(e => ['pre'].includes(gameFor(e, w, games).state)).length : 0;
  const playing = w.status === 'live' ? counting.filter(e => gameFor(e, w, games).state === 'in').length : 0;

  let h = `<div class="bar"><h1>${esc(team)}</h1>${badge(w.status)}${weekPicker(w.week, `team/${encodeURIComponent(team)}`)}</div>`;
  h += `<section class="summary">
    <div class="stat"><span class="k">Week ${w.week}</span><span class="v">${fmt(w.weekTotals[team])}</span><span class="s">${ordinal(weekRank)} of ${DATA.teams.length} this week</span></div>
    <div class="stat"><span class="k">Season</span><span class="v">${fmt(st.total)}</span><span class="s">${ordinal(st.rank)} overall${st.behind == null ? ' · leading' : ` · ${fmt(-st.behind)} behind 1st`}</span></div>
    <div class="stat"><span class="k">Race</span><span class="v small">${above ? `${fmt(above.total - st.total)} to catch ${esc(above.team)}` : `Up ${fmt(st.total - (below?.total ?? st.total))} on ${esc(below?.team ?? '—')}`}</span><span class="s">${below && above ? `${fmt(st.total - below.total)} ahead of ${esc(below.team)}` : '&nbsp;'}</span></div>
    ${w.status === 'live' ? `<div class="stat"><span class="k">Still to play</span><span class="v">${toPlay}</span><span class="s">${playing ? `${playing} playing now` : 'counting players'}</span></div>` : ''}
  </section>`;
  if (w.status === 'live' && !final) h += `<p class="muted note">Live from ESPN. Your counting lineup is the best one <em>right now</em> and can change until every game ends. Official after Tuesday's nflverse settle.</p>`;
  if (w.status === 'unsettled') h += LIVE.checked ? `<div class="warnbox">Week ${w.week} hasn't started scoring yet.</div>` : `<p class="muted note">Loading live scores…</p>`;
  // Same order as the spreadsheet grid: QB, RB, WR, TE, K, D/ST, IDP — best score first within each.
  h += `<p class="muted note">Counting ${fmt(counting.reduce((a, e) => a + e.pts, 0))} pts · bench ${fmt(bench.reduce((a, e) => a + e.pts, 0))} pts not counted</p>`;
  for (const b of DATA.buckets) {
    const group = w.grid[team][b].map(id => w.entries[id]);
    if (!group.length) continue;
    const n = group.filter(e => e.slot !== 'bench').length;
    h += `<section class="section pgroup"><h2>${b === 'DST' ? 'D/ST' : b} <span class="muted">· ${n} counting</span></h2><div class="plist">${group.map(e => playerRow(e, w, games, final)).join('')}</div></section>`;
  }
  return h;
}

function renderGames(games) {
  const order = { in: 0, post: 1, pre: 2 };
  const sorted = [...games].sort((a, b) => (order[a.state] ?? 3) - (order[b.state] ?? 3));
  return `<div class="games">${sorted.map(g => {
    const score = g.started ? `<b>${g.as}</b>–<b>${g.hs}</b>` : '';
    return `<div class="game ${g.state}"><span>${esc(g.away)} @ ${esc(g.home)}</span><span>${score}</span><span class="gd">${g.state === 'in' ? '● ' : ''}${esc(g.detail)}</span></div>`;
  }).join('')}</div>`;
}

function bindGrid() {
  document.querySelectorAll('.cell[data-id]').forEach(el => el.addEventListener('click', () => openPlayer(el.dataset.id)));
}

// ---------------------------------------------------------------------------------------------
// Player audit drawer
// ---------------------------------------------------------------------------------------------
const MATCH = { team: 'name + NFL team', name: 'name only (team differs — traded?)', short: 'short-name fuzzy match', dst: 'team result', none: 'not found in this week\'s stats' };
const ruleText = id => {
  if (!id) return '';
  const r = DATA.rules.threshold.find(x => x.rule_id === id);
  if (r) return `${r.stat} ${r.max == null ? '≥ ' + r.min : r.min + '–' + r.max} → ${signed(r.points)}`;
  const l = DATA.rules.linear.find(x => x.rule_id === id);
  return l ? `${l.stat} (${l.logic})` : id;
};

function openPlayer(id) {
  const week = Number(id.split('-')[0]);
  const w = DATA.weeks.find(x => x.week === week);
  const e = w.entries[id];
  $('#drawer-title').textContent = `${e.player} — Week ${week}`;
  let h = `<dl class="kv">
    <dt>Team</dt><dd>${esc(e.team)} · ${esc(e.bucket)} (${esc(e.pos)}) · ${esc(e.nfl)}</dd>
    <dt>Lineup</dt><dd>${w.status === 'final' || w.live?.allFinal ? `<b>${esc(e.counted)}</b>${w.status === 'live' ? ' <span class="pill">ESPN, provisional</span>' : ''}` : `<span class="muted">not final${w.status === 'live' ? ` — currently ${esc(e.counted.toLowerCase())}` : ''}</span>`}</dd>
    <dt>Score</dt><dd class="big">${e.doubled ? `${fmt(e.raw)} × 2 = ${fmt(e.pts)} <span class="pill">doubler</span>` : fmt(e.pts)}</dd>
    <dt>Matched</dt><dd>${esc(MATCH[e.match.how])}${e.match.statsName && e.match.statsName !== e.player ? ` → ${esc(e.match.statsName)}` : ''}${e.match.statsTeam ? ` (${esc(e.match.statsTeam)})` : ''}${e.statsPos ? ` · scored as ${esc(e.statsPos)}` : ''}</dd>
    ${e.game ? `<dt>Game</dt><dd>${e.game.pf != null ? `${esc(e.game.team)} ${e.game.pf}–${e.game.pa} vs ${esc(e.game.opp)}` : `${esc(e.game.team)} vs ${esc(e.game.opp)}`}</dd>` : ''}
    ${irFor(e) ? `<dt>Status</dt><dd class="ir-text"><b>Injured Reserve</b>${irFor(e).date ? ` since ${irDate(irFor(e).date)}` : ''}${irFor(e).note ? ` — ${esc(irFor(e).note)}` : ''}<br><span class="muted">Eligible for an IR swap: same NFL team, same position.</span></dd>` : ''}
    ${e.acquired ? `<dt>Acquired</dt><dd>W${e.acquired.week} via ${esc(e.acquired.via)}${e.acquired.replaces ? ` (replaced ${esc(e.acquired.replaces)})` : ''}</dd>` : ''}
  </dl>`;
  if (e.lines.length) {
    h += `<table class="list"><thead><tr><th>Category</th><th>Detail</th><th class="num">Pts</th></tr></thead><tbody>`;
    for (const l of e.lines) h += `<tr><td>${esc(l.c)}</td><td>${esc(l.d)}${l.r ? `<br><span class="muted mono" title="${esc(ruleText(l.r))}">${esc(l.r)} · ${esc(ruleText(l.r))}</span>` : ''}</td><td class="num">${signed(l.p)}</td></tr>`;
    h += `<tr><td colspan="2"><b>Raw total</b></td><td class="num"><b>${fmt(e.raw)}</b></td></tr></tbody></table>`;
  } else {
    h += `<p class="muted">${e.active ? 'Played, no scoring events.' : 'No stats recorded this week (did not play, bye, or not on an nflverse stat line).'}</p>`;
  }
  if (e.stats && Object.keys(e.stats).length) {
    h += `<h2 style="margin-top:16px">${w.status === 'live' ? 'ESPN live stat line' : 'nflverse stat line'}</h2><dl class="kv">${Object.entries(e.stats).map(([k, v]) => `<dt class="mono">${esc(k)}</dt><dd>${esc(v)}</dd>`).join('')}</dl>`;
  }
  $('#drawer-body').innerHTML = h;
  $('#drawer').showModal();
}

// ---------------------------------------------------------------------------------------------
// Standings
// ---------------------------------------------------------------------------------------------
function renderStandings() {
  const weeks = DATA.weeks;
  const top = weeks.map((w, i) => Math.max(...DATA.standings.map(s => s.weeks[i])));
  let h = `<div class="bar"><h1>Standings — ${DATA.season}</h1></div>`;
  h += `<p class="muted">Total-points league: rank = season total. Avg / Last / Best use final weeks only. Bold = top score that week.</p>`;
  h += `<div class="card scroll"><table class="list"><thead><tr><th>#</th><th>Team</th><th class="num">Total</th><th class="num">Avg / wk</th><th class="num">Behind 1st</th><th class="num">Last wk</th><th class="num">Best wk</th>`;
  h += weeks.map(w => `<th class="num">W${w.week}${w.status !== 'final' ? ` <span class="pill">${STATUS_LABEL[w.status]}</span>` : ''}</th>`).join('');
  h += `</tr></thead><tbody>`;
  DATA.standings.forEach((s, i) => {
    h += `<tr class="${i === 0 ? 'lead' : ''}"><td>${s.rank}</td><td><b>${esc(s.team)}</b></td><td class="num big">${fmt(s.total)}</td><td class="num">${s.avg.toFixed(1)}</td><td class="num">${s.behind == null ? '—' : fmt(s.behind)}</td><td class="num">${fmt(s.last)}</td><td class="num">${fmt(s.best)}</td>`;
    h += s.weeks.map((v, k) => `<td class="num">${v === top[k] && v > 0 ? `<b>${fmt(v)}</b>` : fmt(v)}</td>`).join('');
    h += `</tr>`;
  });
  h += `</tbody></table></div>`;
  const halves = DATA.standings.filter(s => !Number.isInteger(s.total));
  if (halves.length) h += `<p class="muted">The sheet displays whole numbers (e.g. ${fmt(halves[0].total)} shows as ${Math.round(halves[0].total)}); exact values are shown here.</p>`;
  return h;
}

// ---------------------------------------------------------------------------------------------
// Parity
// ---------------------------------------------------------------------------------------------
const SECTION_TITLE = {
  rules: 'Rules snapshot vs live Rules_* tabs', player: 'Per-player raw scores', dst: 'Team D/ST scores', slot: 'Slot assignment (Counted / Bonus / 6th man / Bench)',
  grid: 'Week grid cells', week_total: 'Team week totals', season_total: 'Season totals', points_log: 'Points Log per-player sums',
};
function renderParity(n) {
  const weeks = Object.keys(DATA.parity).map(Number).sort((a, b) => a - b);
  if (!weeks.length) return `<h1>Parity</h1><div class="warnbox">No parity report yet — run <code>npm run parity -- --week 1 --week 2</code>, then <code>npm run build:web</code>.</div>`;
  const wk = n && DATA.parity[n] ? n : weeks[weeks.length - 1];
  const r = DATA.parity[wk];
  let h = `<div class="bar"><h1>Parity — Week ${wk}</h1><div class="weekpick">${weeks.map(w => `<a href="#parity/${w}" aria-current="${w === wk}">W${w}</a>`).join('')}</div></div>`;
  h += `<p class="muted">App vs the sheet's published tabs · generated ${new Date(r.generatedAt).toLocaleString()} · app ${STATUS_LABEL[r.appStatus]} · sheet grid ${r.sheetFinal ? 'Final' : 'not final'}</p>`;
  if (!r.asserted) h += `<div class="warnbox">Not asserted: ${esc(r.skipReason ?? '')}</div>`;
  h += r.mismatches.length ? `<div class="badbox"><b>${r.mismatches.length} mismatch${r.mismatches.length > 1 ? 'es' : ''}</b></div>` : `<div class="okbox"><b>Parity clean</b> — every check below matches the sheet.</div>`;
  h += `<div class="card"><table class="list"><thead><tr><th>Check</th><th class="num">Checked</th><th class="num">Mismatches</th></tr></thead><tbody>`;
  for (const [k, title] of Object.entries(SECTION_TITLE)) {
    const c = r.counts[k];
    h += `<tr><td>${esc(title)}</td><td class="num">${r.checked[k] ?? '—'}</td><td class="num ${c ? 'fail' : 'ok'}">${c ? c : '✓'}</td></tr>`;
  }
  h += `</tbody></table></div>`;
  if (r.mismatches.length) {
    h += `<div class="section"><h2>Mismatches</h2><div class="card scroll"><table class="list wrap"><thead><tr><th>Check</th><th>What</th><th>App</th><th>Sheet</th><th>Detail</th></tr></thead><tbody>`;
    for (const m of r.mismatches) h += `<tr><td>${esc(m.section)}</td><td>${esc(m.key)}</td><td class="mono">${esc(m.app)}</td><td class="mono">${esc(m.sheet)}</td><td class="mono">${esc(m.detail ?? '')}</td></tr>`;
    h += `</tbody></table></div></div>`;
  }
  if (r.notes.length) h += `<div class="section"><h2>Notes</h2><ul>${r.notes.map(x => `<li><b>${esc(x.key)}</b> — ${esc(x.msg)}</li>`).join('')}</ul></div>`;
  return h;
}

// ---------------------------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------------------------
function renderAudit() {
  const PROMINENT = /^(pbp_|missing_game|week_unsettled|tx_|doubler_)/;
  let h = `<h1>Audit</h1><p class="muted">Engine warnings. PBP fallbacks flatten TD bonuses to +2, so they are listed first.</p>`;
  const all = [...DATA.seasonAudit.map(a => ({ ...a, week: '—' })), ...DATA.weeks.flatMap(w => w.audit.map(a => ({ ...a, week: w.week })))];
  const sorted = [...all.filter(a => PROMINENT.test(a.type)), ...all.filter(a => !PROMINENT.test(a.type))];
  if (!sorted.length) return h + `<div class="okbox">No warnings.</div>`;
  h += `<div class="card scroll"><table class="list wrap"><thead><tr><th>Week</th><th>Type</th><th>Message</th></tr></thead><tbody>`;
  for (const a of sorted) h += `<tr><td>${esc(a.week)}</td><td><span class="pill ${PROMINENT.test(a.type) ? 'fail' : ''}">${esc(a.type)}</span></td><td>${esc(a.msg)}</td></tr>`;
  h += `</tbody></table></div>`;
  h += `<div class="section"><h2>Transactions applied</h2><div class="card scroll"><table class="list"><thead><tr><th>Week</th><th>Team</th><th>Type</th><th>Out</th><th>In</th><th>Pos</th></tr></thead><tbody>`;
  h += DATA.transactions.map(t => `<tr><td>${t.week}</td><td>${esc(t.fantasy_team)}</td><td>${esc(t.type)}</td><td>${esc(t.player_out)}</td><td>${esc(t.player_in)}</td><td>${esc(t.position_in)}</td></tr>`).join('');
  h += `</tbody></table></div></div>`;
  return h;
}

init();
