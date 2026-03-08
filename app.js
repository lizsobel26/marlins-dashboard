/* ============================================
   MIAMI MARLINS PLAYER PERFORMANCE DASHBOARD
   Main Application Script
   ============================================ */

// ---- LocalStorage Keys ----
const LS_GAMES = 'marlins_games';
const LS_PLAYER = 'marlins_player';
const LS_ROSTER = 'marlins_roster';
const LS_LAST_UPDATED = 'marlins_last_updated';
const CACHE_MAX_AGE_MS = 4 * 60 * 60 * 1000; // 4 hours

// ---- MLB API Config ----
const MLB_API = 'https://statsapi.mlb.com/api/v1';
const MARLINS_ID = 146;
const CURRENT_YEAR = new Date().getFullYear();

// Helper: parse "YYYY-MM-DD" without timezone shift
// new Date("2026-03-08") parses as midnight UTC, which shows as 3/7 in US timezones.
// This forces noon local time so getMonth()/getDate() return the correct day.
function parseLocalDate(dateStr) {
  return new Date(dateStr + 'T12:00:00');
}

// ---- State ----
let games = JSON.parse(localStorage.getItem(LS_GAMES) || '[]');
let player = JSON.parse(localStorage.getItem(LS_PLAYER) || 'null') || {
  name: 'SET PLAYER NAME', number: 0, position: 'UTIL',
  bats: 'R', throws: 'R', age: 18, mlbId: null
};
let rosterData = [];

// ---- Chart Instances ----
let avgTrendChart, hitDistChart, radarChart, inningsChart, weeklyChart;

// ---- Color Palette ----
const C = {
  blue: '#00A3E0', blueDim: '#007bb5', blueAlpha: 'rgba(0,163,224,0.3)',
  red: '#EF3340', redDim: '#c4202c', redAlpha: 'rgba(239,51,64,0.3)',
  gold: '#FFD700', purple: '#9b59b6', white: '#e8edf3',
  dim: '#3a4a5c', cardBg: '#0b1a2e', grid: 'rgba(0,163,224,0.08)'
};

// ---- Baseball Facts ----
const FACTS = [
  { emoji: '&#9918;', text: 'A major league baseball has exactly 108 stitches, all hand-sewn with red thread.', source: 'MLB Official' },
  { emoji: '&#127939;', text: 'The distance between bases is 90 feet - a measurement that has remained unchanged since 1845.', source: 'Baseball History' },
  { emoji: '&#128640;', text: 'The fastest pitch ever recorded was 105.8 mph by Aroldis Chapman in 2010.', source: 'Statcast' },
  { emoji: '&#127942;', text: 'The Miami Marlins have won 2 World Series championships (1997 and 2003).', source: 'Marlins History' },
  { emoji: '&#9889;', text: 'A 90 mph fastball reaches home plate in about 400 milliseconds - faster than a blink.', source: 'Sports Science' },
  { emoji: '&#128170;', text: 'Batting average (AVG) is calculated as Hits divided by At Bats. A .300+ AVG is elite.', source: 'Stat Guide' },
  { emoji: '&#128202;', text: 'OPS (On-base Plus Slugging) above .800 is considered very good, above .900 is elite.', source: 'Sabermetrics' },
  { emoji: '&#127944;', text: 'A regulation baseball weighs between 5 and 5.25 ounces and is 9 to 9.25 inches in circumference.', source: 'MLB Rulebook' },
  { emoji: '&#128171;', text: 'A "perfect game" means no batter reaches base - only 24 have occurred in MLB history.', source: 'MLB Records' },
  { emoji: '&#127775;', text: 'The batting order has 9 spots. The 3rd and 4th hitters are typically the strongest batters.', source: 'Strategy Guide' },
  { emoji: '&#128161;', text: 'WAR (Wins Above Replacement) measures a player\'s total contributions. 5+ WAR is All-Star level.', source: 'Sabermetrics' },
  { emoji: '&#9917;', text: 'A curveball can break up to 17 inches from its original trajectory before reaching the plate.', source: 'Sports Science' },
];

// ---- MLB API Functions ----
async function fetchRoster() {
  try {
    // Try current year first, fall back to previous year
    let res = await fetch(`${MLB_API}/teams/${MARLINS_ID}/roster?rosterType=active&season=${CURRENT_YEAR}`);
    let data = await res.json();

    if (!data.roster || data.roster.length === 0) {
      res = await fetch(`${MLB_API}/teams/${MARLINS_ID}/roster?rosterType=active&season=${CURRENT_YEAR - 1}`);
      data = await res.json();
    }

    if (data.roster) {
      rosterData = data.roster.map(p => ({
        id: p.person.id,
        name: p.person.fullName,
        number: p.jerseyNumber || '0',
        position: p.position.abbreviation,
        positionName: p.position.name
      })).sort((a, b) => a.name.localeCompare(b.name));

      localStorage.setItem(LS_ROSTER, JSON.stringify(rosterData));
    }
  } catch (err) {
    console.warn('Could not fetch roster, using cached:', err);
    rosterData = JSON.parse(localStorage.getItem(LS_ROSTER) || '[]');
  }
  renderRosterList();
}

function renderRosterList(filter = '') {
  const list = document.getElementById('rosterList');
  if (!list) return;

  const filtered = filter
    ? rosterData.filter(p => p.name.toLowerCase().includes(filter.toLowerCase()))
    : rosterData;

  if (rosterData.length === 0) {
    list.innerHTML = '<div class="roster-loading">LOADING ROSTER...</div>';
    return;
  }

  if (filtered.length === 0) {
    list.innerHTML = '<div class="roster-loading">NO MATCHING PLAYERS</div>';
    return;
  }

  list.innerHTML = filtered.map(p => `
    <div class="roster-item" data-player-id="${p.id}" data-name="${p.name}" data-num="${p.number}" data-pos="${p.position}">
      <span class="roster-item-num">#${p.number}</span>
      <span class="roster-item-name">${p.name}</span>
      <span class="roster-item-pos">${p.position}</span>
    </div>
  `).join('');

  // Add click handlers
  list.querySelectorAll('.roster-item').forEach(item => {
    item.addEventListener('click', () => selectRosterPlayer(item));
  });
}

async function selectRosterPlayer(item) {
  const mlbId = item.dataset.playerId;
  const name = item.dataset.name;
  const num = item.dataset.num;
  const pos = item.dataset.pos;

  // Show loading state
  item.classList.add('roster-item-loading');
  item.querySelector('.roster-item-name').textContent = name + ' — LOADING STATS...';

  try {
    // Fetch player details
    const detailRes = await fetch(`${MLB_API}/people/${mlbId}`);
    const detailData = await detailRes.json();
    const info = detailData.people ? detailData.people[0] : {};

    const batSide = info.batSide ? info.batSide.code : 'R';
    const throwHand = info.pitchHand ? info.pitchHand.code : 'R';
    const age = info.currentAge || 0;

    // Save player profile
    player = {
      name, number: parseInt(num) || 0, position: pos,
      bats: batSide, throws: throwHand, age, mlbId: parseInt(mlbId)
    };
    localStorage.setItem(LS_PLAYER, JSON.stringify(player));
    loadPlayer();

    // Fetch season stats & game log
    await fetchPlayerStats(mlbId);

    // Close modal and render
    document.getElementById('playerModalOverlay').classList.remove('open');
    renderAll();
  } catch (err) {
    console.error('Error loading player:', err);
    item.querySelector('.roster-item-name').textContent = name + ' — ERROR, TRY AGAIN';
    item.classList.remove('roster-item-loading');
  }
}

// Map full team names to abbreviations for spring training data
const TEAM_ABBREVS = {
  'Arizona Diamondbacks':'ARI','Atlanta Braves':'ATL','Baltimore Orioles':'BAL',
  'Boston Red Sox':'BOS','Chicago Cubs':'CHC','Chicago White Sox':'CWS',
  'Cincinnati Reds':'CIN','Cleveland Guardians':'CLE','Colorado Rockies':'COL',
  'Detroit Tigers':'DET','Houston Astros':'HOU','Kansas City Royals':'KC',
  'Los Angeles Angels':'LAA','Los Angeles Dodgers':'LAD','Miami Marlins':'MIA',
  'Milwaukee Brewers':'MIL','Minnesota Twins':'MIN','New York Mets':'NYM',
  'New York Yankees':'NYY','Oakland Athletics':'OAK','Philadelphia Phillies':'PHI',
  'Pittsburgh Pirates':'PIT','San Diego Padres':'SD','San Francisco Giants':'SF',
  'Seattle Mariners':'SEA','St. Louis Cardinals':'STL','Tampa Bay Rays':'TB',
  'Texas Rangers':'TEX','Toronto Blue Jays':'TOR','Washington Nationals':'WSH'
};
function teamAbbrev(name) {
  return TEAM_ABBREVS[name] || name.split(' ').pop().substring(0, 3).toUpperCase();
}

async function fetchPlayerStats(mlbId) {
  let season = CURRENT_YEAR;
  let gameLogData = [];
  let statLabel = 'REG';

  // Helper to check if an API response has game splits
  function hasSplits(data) {
    return data.stats && data.stats[0] && data.stats[0].splits && data.stats[0].splits.length > 0;
  }

  try {
    // 1. Try current year regular season
    let res = await fetch(`${MLB_API}/people/${mlbId}/stats?stats=gameLog&season=${season}&group=hitting`);
    let data = await res.json();

    if (hasSplits(data)) {
      gameLogData = data.stats[0].splits;
      statLabel = 'REG';
    } else {
      // 2. Try current year spring training (gameType=S)
      res = await fetch(`${MLB_API}/people/${mlbId}/stats?stats=gameLog&season=${season}&group=hitting&gameType=S`);
      data = await res.json();

      if (hasSplits(data)) {
        gameLogData = data.stats[0].splits;
        statLabel = 'SPRING';
      } else {
        // 3. Fall back to previous year regular season
        season = CURRENT_YEAR - 1;
        res = await fetch(`${MLB_API}/people/${mlbId}/stats?stats=gameLog&season=${season}&group=hitting`);
        data = await res.json();

        if (hasSplits(data)) {
          gameLogData = data.stats[0].splits;
          statLabel = 'REG';
        } else {
          // 4. Fall back to previous year spring training
          res = await fetch(`${MLB_API}/people/${mlbId}/stats?stats=gameLog&season=${season}&group=hitting&gameType=S`);
          data = await res.json();

          if (hasSplits(data)) {
            gameLogData = data.stats[0].splits;
            statLabel = 'SPRING';
          }
        }
      }
    }
  } catch (err) {
    console.error('Error fetching stats:', err);
  }

  // Convert MLB game log to our format
  games = gameLogData.map(g => {
    const s = g.stat;
    const opp = g.opponent
      ? (g.opponent.abbreviation || teamAbbrev(g.opponent.name))
      : (g.team ? (g.team.abbreviation || teamAbbrev(g.team.name)) : '???');
    const pos = g.positionsPlayed ? g.positionsPlayed.map(p => p.abbreviation) : [];
    const isWin = g.isWin !== undefined ? g.isWin : null;
    return {
      date: g.date,
      opp: opp,
      isWin: isWin,
      AB: s.atBats || 0,
      H: s.hits || 0,
      '2B': s.doubles || 0,
      '3B': s.triples || 0,
      HR: s.homeRuns || 0,
      RBI: s.rbi || 0,
      BB: s.baseOnBalls || 0,
      SO: s.strikeOuts || 0,
      SB: s.stolenBases || 0,
      R: s.runs || 0,
      IP: s.innings ? parseFloat(s.innings) : 9,
      E: 0,
      HBP: s.hitByPitch || 0,
      SF: s.sacFlies || 0,
      '1B': (s.hits || 0) - (s.doubles || 0) - (s.triples || 0) - (s.homeRuns || 0),
      positions: pos
    };
  });

  localStorage.setItem(LS_GAMES, JSON.stringify(games));

  // Update position display with all positions played (sorted by frequency)
  if (games.length > 0) {
    const posCounts = {};
    games.forEach(g => {
      (g.positions || []).forEach(p => { posCounts[p] = (posCounts[p] || 0) + 1; });
    });
    const sortedPositions = Object.entries(posCounts).sort((a, b) => b[1] - a[1]);
    if (sortedPositions.length > 0) {
      player.position = sortedPositions.map(([p]) => p).join(' / ');
      localStorage.setItem(LS_PLAYER, JSON.stringify(player));
      document.getElementById('playerPosition').textContent = player.position;
    }
  }

  // Update season year display with stat type label
  const yearLabel = statLabel === 'SPRING' ? `${season} SPRING` : `${season}`;
  document.getElementById('seasonYear').textContent = yearLabel;
}

function isCacheStale() {
  const lastUpdated = localStorage.getItem(LS_LAST_UPDATED);
  if (!lastUpdated) return true;
  const lastTime = Number(lastUpdated);
  // Stale if older than 4 hours
  if ((Date.now() - lastTime) > CACHE_MAX_AGE_MS) return true;
  // Also stale if last update was on a different calendar day (catches new game days)
  const lastDate = new Date(lastTime).toDateString();
  const today = new Date().toDateString();
  if (lastDate !== today) return true;
  return false;
}

async function refreshStats() {
  if (!player.mlbId) return;
  await fetchPlayerStats(player.mlbId);
  localStorage.setItem(LS_LAST_UPDATED, String(Date.now()));
  renderAll();
}

// ---- Initialize ----
document.addEventListener('DOMContentLoaded', () => {
  setDate();
  loadPlayer();
  renderAll();
  setupEventListeners();
  initFacts();
  fetchRoster();

  // Always fetch fresh stats and schedule on page load
  if (player.mlbId) {
    refreshStats();
  }
  fetchSchedule();

  // Show player setup if first time
  if (player.name === 'SET PLAYER NAME') {
    window.scrollTo(0, 0);
    const overlay = document.getElementById('playerModalOverlay');
    overlay.classList.add('open');
    overlay.scrollTop = 0;
  }
});

// ---- Date Display ----
function setDate() {
  const d = new Date();
  const opts = { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' };
  document.getElementById('currentDate').textContent = d.toLocaleDateString('en-US', opts).toUpperCase();
  document.getElementById('seasonYear').textContent = d.getFullYear();
}

// ---- Player Profile ----
function loadPlayer() {
  document.getElementById('playerName').textContent = player.name;
  document.getElementById('playerNumber').textContent = `#${player.number}`;
  document.getElementById('jerseyNumSvg').textContent = `#${player.number}`;
  document.getElementById('playerPosition').textContent = player.position;
  document.getElementById('playerBats').textContent = `Bats: ${player.bats}`;
  document.getElementById('playerThrows').textContent = `Throws: ${player.throws}`;
  document.getElementById('playerAge').textContent = `Age: ${player.age}`;

  // Load MLB headshot
  const headshot = document.getElementById('playerHeadshot');
  const fallback = document.getElementById('avatarFallback');
  if (player.mlbId) {
    const url = `https://midfield.mlbstatic.com/v1/people/${player.mlbId}/spots/120`;
    headshot.src = url;
    headshot.onload = () => { headshot.style.display = 'block'; fallback.style.display = 'none'; };
    headshot.onerror = () => { headshot.style.display = 'none'; fallback.style.display = 'block'; };
  } else {
    headshot.style.display = 'none';
    fallback.style.display = 'block';
  }

  // Update news/social links
  renderNewsLinks();
}

// ---- Compute Season Stats ----
function computeStats() {
  if (games.length === 0) {
    return {
      G: 0, AB: 0, H: 0, '2B': 0, '3B': 0, HR: 0, RBI: 0,
      R: 0, BB: 0, SO: 0, SB: 0, HBP: 0, SF: 0, E: 0,
      AVG: '.000', OBP: '.000', SLG: '.000', OPS: '.000',
      '1B': 0, TB: 0, PA: 0, IP_total: 0,
      avgNum: 0, obpNum: 0, slgNum: 0, opsNum: 0
    };
  }

  const s = { G: games.length, AB: 0, H: 0, '2B': 0, '3B': 0, HR: 0, RBI: 0, R: 0, BB: 0, SO: 0, SB: 0, HBP: 0, SF: 0, E: 0, IP_total: 0 };

  games.forEach(g => {
    s.AB += g.AB || 0;
    s.H += g.H || 0;
    s['2B'] += g['2B'] || 0;
    s['3B'] += g['3B'] || 0;
    s.HR += g.HR || 0;
    s.RBI += g.RBI || 0;
    s.R += g.R || 0;
    s.BB += g.BB || 0;
    s.SO += g.SO || 0;
    s.SB += g.SB || 0;
    s.HBP += g.HBP || 0;
    s.SF += g.SF || 0;
    s.E += g.E || 0;
    s.IP_total += g.IP || 0;
  });

  s['1B'] = s.H - s['2B'] - s['3B'] - s.HR;
  s.TB = s['1B'] + s['2B'] * 2 + s['3B'] * 3 + s.HR * 4;
  s.PA = s.AB + s.BB + s.HBP + s.SF;

  const avg = s.AB > 0 ? s.H / s.AB : 0;
  const obp = s.PA > 0 ? (s.H + s.BB + s.HBP) / s.PA : 0;
  const slg = s.AB > 0 ? s.TB / s.AB : 0;
  const ops = obp + slg;

  s.AVG = avg.toFixed(3).replace(/^0/, '');
  s.OBP = obp.toFixed(3).replace(/^0/, '');
  s.SLG = slg.toFixed(3).replace(/^0/, '');
  s.OPS = ops.toFixed(3).replace(/^0/, '');
  s.avgNum = avg;
  s.obpNum = obp;
  s.slgNum = slg;
  s.opsNum = ops;

  return s;
}

// ---- Render Everything ----
function renderAll() {
  const stats = computeStats();
  renderQuickStats(stats);
  renderSeasonStats(stats);
  renderAvgTrend();
  renderHitDist(stats);
  renderGameLog();
  renderRadar(stats);
  renderSprayChart();
  renderZones();
  renderInnings(stats);
  renderMilestones(stats);
  renderStreaks();
  renderWeekly();
}

// ---- Quick Stats in Banner ----
function renderQuickStats(s) {
  document.getElementById('qsAvg').textContent = s.AVG;
  document.getElementById('qsHR').textContent = s.HR;
  document.getElementById('qsRBI').textContent = s.RBI;
  document.getElementById('qsOPS').textContent = s.OPS;
}

// ---- Season Stats Grid ----
function renderSeasonStats(s) {
  const grid = document.getElementById('seasonStatsGrid');
  const items = [
    ['G', s.G], ['AB', s.AB], ['H', s.H], ['1B', s['1B']],
    ['2B', s['2B']], ['3B', s['3B']], ['HR', s.HR], ['RBI', s.RBI],
    ['R', s.R], ['BB', s.BB], ['SO', s.SO], ['SB', s.SB],
    ['AVG', s.AVG], ['OBP', s.OBP], ['SLG', s.SLG], ['OPS', s.OPS],
    ['PA', s.PA], ['TB', s.TB], ['HBP', s.HBP], ['E', s.E]
  ];

  grid.innerHTML = items.map(([label, val]) => `
    <div class="stat-cell">
      <span class="stat-value">${val}</span>
      <span class="stat-label">${label}</span>
    </div>
  `).join('');
}

// ---- Batting Average Trend Chart ----
function renderAvgTrend(range) {
  const ctx = document.getElementById('avgTrendChart').getContext('2d');

  if (avgTrendChart) avgTrendChart.destroy();

  const sorted = [...games].sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));
  let displayGames = sorted;
  if (range === 10) displayGames = sorted.slice(-10);
  else if (range === 25) displayGames = sorted.slice(-25);

  // Compute running average
  const labels = [];
  const avgData = [];
  const obpData = [];
  let totalH = 0, totalAB = 0, totalBB = 0, totalHBP = 0, totalSF = 0;

  sorted.forEach((g, i) => {
    totalH += g.H || 0;
    totalAB += g.AB || 0;
    totalBB += g.BB || 0;
    totalHBP += g.HBP || 0;
    totalSF += g.SF || 0;

    const startIdx = sorted.length - displayGames.length;
    if (i >= startIdx) {
      const d = parseLocalDate(g.date);
      labels.push(`${d.getMonth() + 1}/${d.getDate()}`);
      avgData.push(totalAB > 0 ? +(totalH / totalAB).toFixed(3) : 0);
      const pa = totalAB + totalBB + totalHBP + totalSF;
      obpData.push(pa > 0 ? +((totalH + totalBB + totalHBP) / pa).toFixed(3) : 0);
    }
  });

  if (labels.length === 0) {
    labels.push('No Data');
    avgData.push(0);
    obpData.push(0);
  }

  avgTrendChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'AVG',
          data: avgData,
          borderColor: C.blue,
          backgroundColor: C.blueAlpha,
          borderWidth: 2,
          fill: true,
          tension: 0.35,
          pointRadius: 3,
          pointBackgroundColor: C.blue,
          pointBorderColor: C.blue
        },
        {
          label: 'OBP',
          data: obpData,
          borderColor: C.red,
          backgroundColor: 'transparent',
          borderWidth: 2,
          borderDash: [5, 5],
          tension: 0.35,
          pointRadius: 2,
          pointBackgroundColor: C.red,
          pointBorderColor: C.red
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: true, labels: { color: C.white, font: { family: 'Orbitron', size: 10 } } }
      },
      scales: {
        x: { grid: { color: C.grid }, ticks: { color: C.dim, font: { family: 'Inter', size: 10 } } },
        y: {
          grid: { color: C.grid },
          ticks: { color: C.dim, font: { family: 'Inter', size: 10 } },
          suggestedMin: 0,
          suggestedMax: 0.5
        }
      }
    }
  });
}

// ---- Hit Distribution Donut ----
function renderHitDist(s) {
  const ctx = document.getElementById('hitDistChart').getContext('2d');
  if (hitDistChart) hitDistChart.destroy();

  const data = [s['1B'], s['2B'], s['3B'], s.HR];
  const hasData = data.some(v => v > 0);

  hitDistChart = new Chart(ctx, {
    type: 'doughnut',
    data: {
      labels: ['Singles', 'Doubles', 'Triples', 'Home Runs'],
      datasets: [{
        data: hasData ? data : [1, 0, 0, 0],
        backgroundColor: [C.blue, C.gold, C.purple, C.red],
        borderColor: C.cardBg,
        borderWidth: 3,
        hoverOffset: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '65%',
      plugins: {
        legend: { display: false },
        tooltip: { enabled: hasData }
      }
    }
  });

  // Legend
  const legend = document.getElementById('hitLegend');
  const items = [
    ['Singles', s['1B'], C.blue],
    ['Doubles', s['2B'], C.gold],
    ['Triples', s['3B'], C.purple],
    ['HR', s.HR, C.red]
  ];
  legend.innerHTML = items.map(([l, v, c]) =>
    `<span><span style="display:inline-block;width:8px;height:8px;border-radius:50%;background:${c};margin-right:4px;"></span>${l}: ${v}</span>`
  ).join('');
}

// ---- Game Log Table ----
function renderGameLog() {
  const body = document.getElementById('gameLogBody');
  const sorted = [...games].sort((a, b) => parseLocalDate(b.date) - parseLocalDate(a.date));

  if (sorted.length === 0) {
    body.innerHTML = `<tr><td colspan="13" style="color:var(--text-dim);padding:30px;font-family:var(--font-display);font-size:0.75rem;letter-spacing:2px;">NO GAMES LOGGED YET &mdash; CLICK "LOG GAME" TO START</td></tr>`;
    return;
  }

  // Need running averages (from earliest to latest)
  const chronological = [...games].sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));
  const runningAvg = {};
  let rH = 0, rAB = 0;
  chronological.forEach(g => {
    rH += g.H || 0;
    rAB += g.AB || 0;
    runningAvg[g.date + g.opp] = rAB > 0 ? (rH / rAB).toFixed(3).replace(/^0/, '') : '.000';
  });

  body.innerHTML = sorted.map(g => {
    const d = parseLocalDate(g.date);
    const dateStr = `${d.getMonth() + 1}/${d.getDate()}`;
    const gameAvg = (g.AB > 0 ? (g.H / g.AB) : 0);
    const cls = gameAvg >= 0.400 ? 'hot-game' : (gameAvg === 0 && g.AB > 0 ? 'cold-game' : '');

    const wlBadge = g.isWin === true ? '<span class="wl-badge wl-win">W</span>'
      : g.isWin === false ? '<span class="wl-badge wl-loss">L</span>' : '-';

    return `<tr class="${cls}">
      <td>${dateStr}</td>
      <td>${g.opp}</td>
      <td>${wlBadge}</td>
      <td>${g.AB}</td>
      <td>${g.H}</td>
      <td>${g['2B']}</td>
      <td>${g['3B']}</td>
      <td>${g.HR}</td>
      <td>${g.RBI}</td>
      <td>${g.BB}</td>
      <td>${g.SO}</td>
      <td>${g.SB}</td>
      <td>${runningAvg[g.date + g.opp] || '.000'}</td>
    </tr>`;
  }).join('');
}

// ---- Performance Radar ----
function renderRadar(s) {
  const ctx = document.getElementById('radarChart').getContext('2d');
  if (radarChart) radarChart.destroy();

  // Normalize each stat to 0-100 scale based on reasonable benchmarks
  const norm = (val, max) => Math.min(100, Math.round((val / max) * 100));

  const gamesPlayed = Math.max(s.G, 1);
  const power = norm(s.HR / gamesPlayed, 0.3);          // HR per game
  const contact = norm(s.avgNum, 0.350);                  // Batting avg
  const discipline = norm(s.BB / Math.max(s.PA, 1), 0.15);// Walk rate
  const speed = norm(s.SB / gamesPlayed, 0.3);            // SB per game
  const xbh = norm((s['2B'] + s['3B'] + s.HR) / gamesPlayed, 0.5); // XBH rate
  const clutch = norm(s.RBI / gamesPlayed, 1.0);           // RBI per game

  radarChart = new Chart(ctx, {
    type: 'radar',
    data: {
      labels: ['POWER', 'CONTACT', 'DISCIPLINE', 'SPEED', 'XBH', 'CLUTCH'],
      datasets: [{
        label: 'Player',
        data: [power, contact, discipline, speed, xbh, clutch],
        backgroundColor: C.blueAlpha,
        borderColor: C.blue,
        borderWidth: 2,
        pointBackgroundColor: C.blue,
        pointBorderColor: C.white,
        pointRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        r: {
          beginAtZero: true,
          max: 100,
          ticks: { display: false, stepSize: 25 },
          grid: { color: C.grid },
          angleLines: { color: C.grid },
          pointLabels: {
            color: C.blue,
            font: { family: 'Orbitron', size: 9, weight: '600' }
          }
        }
      }
    }
  });
}

// ---- Spray Chart ----
function renderSprayChart() {
  const canvas = document.getElementById('sprayChart');
  const ctx = canvas.getContext('2d');
  const W = canvas.width;
  const H = canvas.height;

  ctx.clearRect(0, 0, W, H);

  // Draw field
  const cx = W / 2;
  const base = H - 30;
  const radius = Math.min(W, H) - 60;

  // Outfield arc
  ctx.beginPath();
  ctx.arc(cx, base, radius, Math.PI, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(0,163,224,0.2)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // Infield arc
  ctx.beginPath();
  ctx.arc(cx, base, radius * 0.45, Math.PI, 2 * Math.PI);
  ctx.strokeStyle = 'rgba(0,163,224,0.15)';
  ctx.stroke();

  // Foul lines
  ctx.beginPath();
  ctx.moveTo(cx, base);
  ctx.lineTo(cx - radius, base - radius);
  ctx.strokeStyle = 'rgba(0,163,224,0.12)';
  ctx.stroke();

  ctx.beginPath();
  ctx.moveTo(cx, base);
  ctx.lineTo(cx + radius, base - radius);
  ctx.stroke();

  // Zone labels
  ctx.font = '10px Orbitron';
  ctx.fillStyle = 'rgba(0,163,224,0.25)';
  ctx.textAlign = 'center';
  ctx.fillText('LF', cx - radius * 0.6, base - radius * 0.6);
  ctx.fillText('CF', cx, base - radius * 0.75);
  ctx.fillText('RF', cx + radius * 0.6, base - radius * 0.6);

  // Home plate
  ctx.beginPath();
  ctx.arc(cx, base, 5, 0, 2 * Math.PI);
  ctx.fillStyle = C.white;
  ctx.fill();

  // Draw hit points from game data (simulated distribution)
  if (games.length === 0) {
    ctx.font = '12px Rajdhani';
    ctx.fillStyle = C.dim;
    ctx.textAlign = 'center';
    ctx.fillText('Log games to see spray data', cx, base - radius * 0.5);
    return;
  }

  // Generate spray points based on actual hit data
  const allHits = [];
  games.forEach(g => {
    // Distribute hits randomly across field
    for (let i = 0; i < (g['1B'] || (g.H - (g['2B']||0) - (g['3B']||0) - (g.HR||0))); i++)
      allHits.push({ type: 'single', seed: Math.random() });
    for (let i = 0; i < (g['2B'] || 0); i++)
      allHits.push({ type: 'double', seed: Math.random() });
    for (let i = 0; i < (g['3B'] || 0); i++)
      allHits.push({ type: 'triple', seed: Math.random() });
    for (let i = 0; i < (g.HR || 0); i++)
      allHits.push({ type: 'hr', seed: Math.random() });
    // Outs (AB - H)
    const outs = (g.AB || 0) - (g.H || 0);
    for (let i = 0; i < outs; i++)
      allHits.push({ type: 'out', seed: Math.random() });
  });

  const colorMap = {
    single: C.blue, double: C.gold, triple: C.purple, hr: C.red, out: C.dim
  };

  const distMap = {
    single: [0.25, 0.55],
    double: [0.45, 0.75],
    triple: [0.6, 0.85],
    hr: [0.8, 1.0],
    out: [0.15, 0.6]
  };

  // Use a seeded-ish random for consistent positions
  function seededPos(seed, type) {
    const [minR, maxR] = distMap[type];
    const r = (minR + seed * (maxR - minR)) * radius;
    // Angle between PI (left foul line) and 2PI (right foul line)
    const angle = Math.PI + (hashFloat(seed) * Math.PI);
    const x = cx + r * Math.cos(angle);
    const y = base + r * Math.sin(angle);
    return { x, y };
  }

  function hashFloat(s) {
    // Simple pseudo-hash for visual variety
    return ((Math.sin(s * 9999.137) + 1) / 2);
  }

  allHits.forEach(hit => {
    const pos = seededPos(hit.seed, hit.type);
    ctx.beginPath();
    ctx.arc(pos.x, pos.y, hit.type === 'hr' ? 5 : 4, 0, 2 * Math.PI);
    ctx.fillStyle = colorMap[hit.type];
    ctx.globalAlpha = 0.75;
    ctx.fill();
    ctx.globalAlpha = 1;
  });
}

// ---- Hot/Cold Zones ----
function renderZones() {
  const grid = document.getElementById('zoneGrid');

  // Simulated zone data based on overall performance
  const stats = computeStats();
  const baseAvg = stats.avgNum || 0;

  // Generate zone batting averages with variation
  const zones = [];
  const zoneSeeds = [0.85, 1.15, 0.75, 1.25, 1.0, 0.9, 0.65, 1.1, 0.95];
  const zoneABs = [12, 18, 10, 20, 25, 15, 8, 16, 14];

  for (let i = 0; i < 9; i++) {
    const zAvg = Math.min(1, baseAvg * zoneSeeds[i]);
    const count = games.length > 0 ? Math.round(zoneABs[i] * games.length / 10) : 0;
    zones.push({ avg: zAvg, count });
  }

  grid.innerHTML = zones.map(z => {
    const pct = z.avg;
    let bg;
    if (pct >= 0.300) bg = `rgba(239,51,64,${0.3 + pct * 0.6})`; // Hot
    else if (pct >= 0.200) bg = `rgba(255,215,0,${0.2 + pct * 0.4})`; // Warm
    else bg = `rgba(0,163,224,${0.2 + (1 - pct) * 0.3})`; // Cold

    return `<div class="zone-cell" style="background:${bg}">
      <span class="zone-avg">${pct.toFixed(3).replace(/^0/, '')}</span>
      <span class="zone-count">${z.count} AB</span>
    </div>`;
  }).join('');
}

// ---- Innings / Playing Time Chart ----
function renderInnings(stats) {
  const ctx = document.getElementById('inningsChart').getContext('2d');
  if (inningsChart) inningsChart.destroy();

  const sorted = [...games].sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date)).slice(-15);
  const labels = sorted.map(g => {
    const d = parseLocalDate(g.date);
    return `${d.getMonth() + 1}/${d.getDate()}`;
  });
  const ipData = sorted.map(g => g.IP || 0);

  if (labels.length === 0) {
    labels.push('No Data');
    ipData.push(0);
  }

  inningsChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Innings Played',
        data: ipData,
        backgroundColor: ipData.map(v => v >= 9 ? C.blue : (v >= 5 ? C.gold : C.dim)),
        borderColor: 'transparent',
        borderRadius: 4,
        barThickness: 18
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        x: { grid: { display: false }, ticks: { color: C.dim, font: { family: 'Inter', size: 9 } } },
        y: {
          grid: { color: C.grid },
          ticks: { color: C.dim, font: { family: 'Inter', size: 10 } },
          suggestedMax: 9
        }
      }
    }
  });

  // Summary
  const summary = document.getElementById('inningsSummary');
  const totalIP = stats.IP_total;
  const avgIP = games.length > 0 ? (totalIP / games.length).toFixed(1) : '0.0';
  const fullGames = games.filter(g => (g.IP || 0) >= 9).length;

  summary.innerHTML = `
    <div class="innings-stat"><span class="innings-stat-val">${totalIP}</span><span class="innings-stat-lbl">TOTAL IP</span></div>
    <div class="innings-stat"><span class="innings-stat-val">${avgIP}</span><span class="innings-stat-lbl">AVG IP/G</span></div>
    <div class="innings-stat"><span class="innings-stat-val">${fullGames}</span><span class="innings-stat-lbl">FULL GAMES</span></div>
  `;
}

// ---- Milestones ----
function renderMilestones(s) {
  const list = document.getElementById('milestonesList');

  const milestones = [
    { icon: '&#127942;', title: 'First Hit', target: 1, current: s.H, unit: 'H' },
    { icon: '&#9889;', title: '10 Hits', target: 10, current: s.H, unit: 'H' },
    { icon: '&#128170;', title: '25 Hits', target: 25, current: s.H, unit: 'H' },
    { icon: '&#128293;', title: '50 Hits', target: 50, current: s.H, unit: 'H' },
    { icon: '&#127775;', title: '100 Hits', target: 100, current: s.H, unit: 'H' },
    { icon: '&#128640;', title: 'First Home Run', target: 1, current: s.HR, unit: 'HR' },
    { icon: '&#9917;', title: '5 Home Runs', target: 5, current: s.HR, unit: 'HR' },
    { icon: '&#127939;', title: '10 Stolen Bases', target: 10, current: s.SB, unit: 'SB' },
    { icon: '&#128202;', title: '25 RBIs', target: 25, current: s.RBI, unit: 'RBI' },
    { icon: '&#128171;', title: '50 RBIs', target: 50, current: s.RBI, unit: 'RBI' },
    { icon: '&#9918;', title: '.300 Batting Avg', target: 0.300, current: s.avgNum, unit: 'AVG', isRate: true },
    { icon: '&#128161;', title: '.800 OPS', target: 0.800, current: s.opsNum, unit: 'OPS', isRate: true }
  ];

  list.innerHTML = milestones.map(m => {
    const achieved = m.current >= m.target;
    const pct = m.isRate
      ? Math.min(100, (m.current / m.target) * 100)
      : Math.min(100, (m.current / m.target) * 100);

    return `
      <div class="milestone ${achieved ? 'milestone-achieved' : 'milestone-pending'}">
        <div class="milestone-icon">${m.icon}</div>
        <div class="milestone-info">
          <div class="milestone-title">${m.title}</div>
          <div class="milestone-progress"><div class="milestone-bar" style="width:${pct}%"></div></div>
        </div>
        <div class="milestone-count">${m.isRate ? m.current.toFixed(3).replace(/^0/, '') : m.current} / ${m.isRate ? m.target.toFixed(3).replace(/^0/, '') : m.target}</div>
      </div>
    `;
  }).join('');
}

// ---- Weekly Splits Chart ----
function renderWeekly() {
  const ctx = document.getElementById('weeklyChart').getContext('2d');
  if (weeklyChart) weeklyChart.destroy();

  // Group games by week
  const sorted = [...games].sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));
  if (sorted.length === 0) {
    weeklyChart = new Chart(ctx, {
      type: 'bar',
      data: { labels: ['No Data'], datasets: [{ data: [0], backgroundColor: C.dim }] },
      options: { responsive: true, maintainAspectRatio: false, plugins: { legend: { display: false } }, scales: { x: { grid: { display: false }, ticks: { color: C.dim } }, y: { grid: { color: C.grid }, ticks: { color: C.dim } } } }
    });
    return;
  }

  const weeks = {};
  sorted.forEach(g => {
    const d = parseLocalDate(g.date);
    const weekStart = new Date(d);
    weekStart.setDate(d.getDate() - d.getDay());
    const key = `${weekStart.getMonth() + 1}/${weekStart.getDate()}`;
    if (!weeks[key]) weeks[key] = { AB: 0, H: 0, HR: 0 };
    weeks[key].AB += g.AB || 0;
    weeks[key].H += g.H || 0;
    weeks[key].HR += g.HR || 0;
  });

  const labels = Object.keys(weeks).slice(-8);
  const avgData = labels.map(k => weeks[k].AB > 0 ? +(weeks[k].H / weeks[k].AB).toFixed(3) : 0);
  const hrData = labels.map(k => weeks[k].HR);

  weeklyChart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: labels.map(l => `Wk ${l}`),
      datasets: [
        {
          label: 'AVG',
          data: avgData,
          backgroundColor: C.blue,
          borderRadius: 4,
          barThickness: 14,
          yAxisID: 'y'
        },
        {
          label: 'HR',
          data: hrData,
          backgroundColor: C.red,
          borderRadius: 4,
          barThickness: 14,
          yAxisID: 'y1'
        }
      ]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { labels: { color: C.white, font: { family: 'Orbitron', size: 9 } } }
      },
      scales: {
        x: { grid: { display: false }, ticks: { color: C.dim, font: { family: 'Inter', size: 9 } } },
        y: {
          position: 'left',
          grid: { color: C.grid },
          ticks: { color: C.blue, font: { family: 'Inter', size: 10 } },
          suggestedMax: 0.5,
          title: { display: true, text: 'AVG', color: C.blue, font: { family: 'Orbitron', size: 9 } }
        },
        y1: {
          position: 'right',
          grid: { display: false },
          ticks: { color: C.red, font: { family: 'Inter', size: 10 }, stepSize: 1 },
          title: { display: true, text: 'HR', color: C.red, font: { family: 'Orbitron', size: 9 } }
        }
      }
    }
  });
}

// ---- Facts Carousel ----
let currentFact = 0;

function initFacts() {
  const carousel = document.getElementById('factsCarousel');
  const dots = document.getElementById('factsDots');

  carousel.innerHTML = FACTS.map((f, i) => `
    <div class="fact-card ${i === 0 ? 'active' : ''}">
      <div class="fact-emoji">${f.emoji}</div>
      <div class="fact-text">${f.text}</div>
      <div class="fact-source">${f.source}</div>
    </div>
  `).join('');

  dots.innerHTML = FACTS.map((_, i) =>
    `<div class="fact-dot ${i === 0 ? 'active' : ''}"></div>`
  ).join('');

  document.getElementById('factNext').addEventListener('click', () => navigateFact(1));
  document.getElementById('factPrev').addEventListener('click', () => navigateFact(-1));

  // Auto-rotate
  setInterval(() => navigateFact(1), 8000);
}

function navigateFact(dir) {
  const cards = document.querySelectorAll('.fact-card');
  const dots = document.querySelectorAll('.fact-dot');

  cards[currentFact].classList.remove('active');
  dots[currentFact].classList.remove('active');

  currentFact = (currentFact + dir + FACTS.length) % FACTS.length;

  cards[currentFact].classList.add('active');
  dots[currentFact].classList.add('active');
}

// ---- Streak Tracker ----
function renderStreaks() {
  const grid = document.getElementById('streaksGrid');
  if (!grid) return;

  const sorted = [...games].sort((a, b) => parseLocalDate(a.date) - parseLocalDate(b.date));

  // Current hitting streak
  let currentHitStreak = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if (sorted[i].H > 0) currentHitStreak++;
    else if (sorted[i].AB > 0) break;
  }

  // Longest hitting streak
  let longestHitStreak = 0, tempStreak = 0;
  sorted.forEach(g => {
    if (g.H > 0) { tempStreak++; longestHitStreak = Math.max(longestHitStreak, tempStreak); }
    else if (g.AB > 0) tempStreak = 0;
  });

  // Current on-base streak
  let currentOBStreak = 0;
  for (let i = sorted.length - 1; i >= 0; i--) {
    if ((sorted[i].H || 0) + (sorted[i].BB || 0) + (sorted[i].HBP || 0) > 0) currentOBStreak++;
    else if (sorted[i].AB > 0) break;
  }

  // Multi-hit games
  const multiHitGames = games.filter(g => g.H >= 2).length;

  const streaks = [
    { value: currentHitStreak, label: 'HIT STREAK', sub: 'CURRENT', active: currentHitStreak >= 3 },
    { value: longestHitStreak, label: 'LONGEST STREAK', sub: 'SEASON', active: false },
    { value: currentOBStreak, label: 'ON-BASE STREAK', sub: 'CURRENT', active: currentOBStreak >= 3 },
    { value: multiHitGames, label: 'MULTI-HIT GAMES', sub: `OF ${games.length} G`, active: false }
  ];

  grid.innerHTML = streaks.map(s => `
    <div class="streak-item ${s.active ? 'active-streak' : ''}">
      <span class="streak-value">${s.value}</span>
      <span class="streak-label">${s.label}</span>
      <span class="streak-sub">${s.sub}</span>
    </div>
  `).join('');
}

// ---- Upcoming Schedule ----
async function fetchSchedule() {
  const container = document.getElementById('scheduleList');
  if (!container) return;

  container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-dim);font-family:var(--font-display);font-size:0.7rem;letter-spacing:1px;">LOADING SCHEDULE...</div>';

  try {
    const today = new Date();
    const startDate = today.toISOString().split('T')[0];
    // Look ahead 30 days to cover spring training + regular season start
    const endDate = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
    const todayStr = startDate;

    const res = await fetch(`${MLB_API}/schedule?teamId=${MARLINS_ID}&season=${CURRENT_YEAR}&startDate=${startDate}&endDate=${endDate}&sportId=1&gameType=S,R,E`);
    const data = await res.json();

    const games = [];
    for (const d of (data.dates || [])) {
      for (const g of (d.games || [])) {
        const home = g.teams.home.team;
        const away = g.teams.away.team;
        const isHome = home.id === MARLINS_ID;
        const opponent = isHome ? away : home;
        const oppAbbr = teamAbbrev(opponent.name);
        const gameDate = new Date(g.gameDate);
        const status = g.status ? g.status.detailedState : '';
        const gameType = g.gameType; // S=Spring, R=Regular, E=Exhibition

        games.push({
          date: d.date,
          gameDate,
          oppAbbr,
          oppName: opponent.name,
          isHome,
          status,
          gameType
        });
      }
    }

    // Take next 8 games
    const upcoming = games.slice(0, 8);

    if (upcoming.length === 0) {
      container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-dim);font-family:var(--font-display);font-size:0.7rem;letter-spacing:1px;">NO UPCOMING GAMES</div>';
      return;
    }

    // Update badge with type label
    const hasRegular = upcoming.some(g => g.gameType === 'R');
    const hasSpring = upcoming.some(g => g.gameType === 'S');
    const label = document.getElementById('scheduleLabel');
    if (label) {
      if (hasRegular && hasSpring) label.textContent = 'SPRING + REG';
      else if (hasRegular) label.textContent = 'REGULAR';
      else if (hasSpring) label.textContent = 'SPRING';
    }

    container.innerHTML = upcoming.map(g => {
      const d = new Date(g.date + 'T12:00:00');
      const dayName = d.toLocaleDateString('en-US', { weekday: 'short' }).toUpperCase();
      const monthDay = `${d.getMonth() + 1}/${d.getDate()}`;

      const isToday = g.date === todayStr;
      const isLive = g.status === 'In Progress' || g.status === 'Live';

      // Format time in local timezone
      let timeStr = '';
      if (isLive) {
        timeStr = '<span class="schedule-status-live">LIVE</span>';
      } else if (g.status === 'Final') {
        timeStr = 'FINAL';
      } else {
        const h = g.gameDate.getHours();
        const m = g.gameDate.getMinutes();
        const ampm = h >= 12 ? 'PM' : 'AM';
        const hour = h % 12 || 12;
        timeStr = `${hour}:${String(m).padStart(2, '0')} ${ampm}`;
      }

      const typeLabel = g.gameType === 'S' ? 'ST' : g.gameType === 'R' ? 'REG' : 'EX';

      return `
        <div class="schedule-game ${isToday ? 'schedule-today' : ''}">
          <div class="schedule-date">${dayName}<br>${monthDay}</div>
          <div class="schedule-matchup">
            ${g.isHome ? g.oppAbbr + '<span class="schedule-vs"> @ </span>MIA' : 'MIA<span class="schedule-vs"> @ </span>' + g.oppAbbr}
          </div>
          <span class="schedule-home-away ${g.isHome ? 'schedule-home' : 'schedule-away'}">${g.isHome ? 'HOME' : 'AWAY'}</span>
          <span class="schedule-type">${typeLabel}</span>
          <div class="schedule-time">${timeStr}</div>
        </div>
      `;
    }).join('');
  } catch (err) {
    console.error('Error fetching schedule:', err);
    container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-dim);font-family:var(--font-display);font-size:0.7rem;letter-spacing:1px;">SCHEDULE UNAVAILABLE</div>';
  }
}

// ---- News & Social Links ----
function renderNewsLinks() {
  const container = document.getElementById('newsLinks');
  if (!container || !player.name || player.name === 'SET PLAYER NAME') {
    if (container) container.innerHTML = '<div style="text-align:center;padding:20px;color:var(--text-dim);font-family:var(--font-display);font-size:0.7rem;letter-spacing:1px;">SELECT A PLAYER TO SEE LINKS</div>';
    return;
  }

  const nameSlug = player.name.toLowerCase().replace(/\s+/g, '-');
  const nameQuery = encodeURIComponent(player.name);
  const mlbId = player.mlbId || '';

  const links = [
    {
      icon: '&#9918;',
      title: 'MLB PLAYER PAGE',
      desc: `Official profile on MLB.com`,
      url: `https://www.mlb.com/player/${nameSlug}-${mlbId}`
    },
    {
      icon: '&#128270;',
      title: 'GOOGLE NEWS',
      desc: `Latest news articles`,
      url: `https://news.google.com/search?q=${nameQuery}+MLB`
    },
    {
      icon: '&#120143;',
      title: 'X / TWITTER',
      desc: `Posts and mentions`,
      url: `https://x.com/search?q=${nameQuery}+marlins&f=live`
    },
    {
      icon: '&#127909;',
      title: 'YOUTUBE HIGHLIGHTS',
      desc: `Video highlights and clips`,
      url: `https://www.youtube.com/results?search_query=${nameQuery}+marlins+highlights`
    },
    {
      icon: '&#128202;',
      title: 'BASEBALL REFERENCE',
      desc: `Career stats and records`,
      url: `https://www.baseball-reference.com/search/search.fcgi?search=${nameQuery}`
    }
  ];

  container.innerHTML = links.map(l => `
    <a href="${l.url}" target="_blank" rel="noopener" class="news-link">
      <span class="news-link-icon">${l.icon}</span>
      <span class="news-link-info">
        <span class="news-link-title">${l.title}</span>
        <span class="news-link-desc">${l.desc}</span>
      </span>
      <span class="news-link-arrow">&#8599;</span>
    </a>
  `).join('');
}

// ---- Event Listeners ----
function setupEventListeners() {
  // Refresh Stats Button
  document.getElementById('btnRefresh').addEventListener('click', async () => {
    const btn = document.getElementById('btnRefresh');
    if (!player.mlbId) return;
    btn.classList.add('refreshing');
    btn.textContent = 'LOADING...';
    await refreshStats();
    btn.classList.remove('refreshing');
    btn.innerHTML = '&#8635; REFRESH';
  });

  // Add Game Modal
  document.getElementById('btnAddGame').addEventListener('click', () => {
    document.getElementById('fDate').valueAsDate = new Date();
    document.getElementById('modalOverlay').classList.add('open');
  });

  document.getElementById('modalClose').addEventListener('click', () => {
    document.getElementById('modalOverlay').classList.remove('open');
  });

  document.getElementById('modalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
  });

  // Game Form Submit
  document.getElementById('gameForm').addEventListener('submit', e => {
    e.preventDefault();
    const game = {
      date: document.getElementById('fDate').value,
      opp: document.getElementById('fOpp').value.toUpperCase(),
      AB: +document.getElementById('fAB').value,
      H: +document.getElementById('fH').value,
      '2B': +document.getElementById('f2B').value,
      '3B': +document.getElementById('f3B').value,
      HR: +document.getElementById('fHR').value,
      RBI: +document.getElementById('fRBI').value,
      BB: +document.getElementById('fBB').value,
      SO: +document.getElementById('fSO').value,
      SB: +document.getElementById('fSB').value,
      R: +document.getElementById('fR').value,
      IP: +document.getElementById('fIP').value,
      E: +document.getElementById('fE').value,
      HBP: +document.getElementById('fHBP').value,
      SF: +document.getElementById('fSF').value
    };

    // Compute singles
    game['1B'] = game.H - game['2B'] - game['3B'] - game.HR;

    games.push(game);
    localStorage.setItem(LS_GAMES, JSON.stringify(games));

    document.getElementById('modalOverlay').classList.remove('open');
    document.getElementById('gameForm').reset();
    renderAll();
  });

  // Player Profile Modal — shared open function
  function openPlayerSwitcher() {
    document.getElementById('pName').value = player.name === 'SET PLAYER NAME' ? '' : player.name;
    document.getElementById('pNumber').value = player.number;
    document.getElementById('pPosition').value = player.position;
    document.getElementById('pBats').value = player.bats;
    document.getElementById('pThrows').value = player.throws;
    document.getElementById('pAge').value = player.age;
    document.getElementById('rosterSearch').value = '';
    renderRosterList();
    document.getElementById('playerModalOverlay').classList.add('open');
  }

  // FAB button (bottom-right)
  document.getElementById('btnEditProfile').addEventListener('click', openPlayerSwitcher);
  // "SWITCH PLAYER" button in banner
  document.getElementById('btnSwitchPlayer').addEventListener('click', openPlayerSwitcher);
  // Clickable player name
  document.getElementById('playerName').addEventListener('click', openPlayerSwitcher);

  document.getElementById('playerModalClose').addEventListener('click', () => {
    document.getElementById('playerModalOverlay').classList.remove('open');
  });

  document.getElementById('playerModalOverlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) e.currentTarget.classList.remove('open');
  });

  // Roster search filter
  document.getElementById('rosterSearch').addEventListener('input', e => {
    renderRosterList(e.target.value);
  });

  // Manual player form
  document.getElementById('playerForm').addEventListener('submit', e => {
    e.preventDefault();
    player.name = document.getElementById('pName').value || 'Player';
    player.number = +document.getElementById('pNumber').value;
    player.position = document.getElementById('pPosition').value;
    player.bats = document.getElementById('pBats').value;
    player.throws = document.getElementById('pThrows').value;
    player.age = +document.getElementById('pAge').value;
    player.mlbId = null;

    localStorage.setItem(LS_PLAYER, JSON.stringify(player));
    loadPlayer();
    document.getElementById('playerModalOverlay').classList.remove('open');
  });

  // Chart Range Buttons
  document.querySelectorAll('.ctrl-btn[data-range]').forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.ctrl-btn[data-range]').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const range = btn.dataset.range === 'all' ? 'all' : +btn.dataset.range;
      renderAvgTrend(range);
    });
  });
}
