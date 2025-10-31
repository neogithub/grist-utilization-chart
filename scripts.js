// --- Table IDs (must match Grist Table IDs, not display names) ---
const PEOPLE_TABLE_ID = 'People';               // adjust if your People table ID differs
const UTIL_TARGETS_TABLE_ID = 'Utilization_Targets'; // <-- this is your working ID

// ===== Global Error Handler =====
window.addEventListener('error', (event) => {
  logError('Uncaught Error', event.error || event);
});

window.addEventListener('unhandledrejection', (event) => {
  logError('Unhandled Promise Rejection', { reason: event.reason });
});

// ===== State =====
let currentRecords = [];
let currentFilters = {
  year: 'all',
  quarter: 'all',
  department: 'all',
  location: 'all',
  nameSearch: '',
  sort: 'name-asc'
};
let currentView = 'bar';
let showTarget = true;
let chart = null;

// Per-person per-year targets pulled from "Utilization Targets"
let targetsByPersonYear = {};     // { "Adam Craig": { 2024: 60, 2025: 75 }, ... }

// ===== Enhanced Debug System =====
function log(message, data) {
  try {
    const out = document.getElementById('debugOutput');
    if (!out) {
      console.log('[DEBUG]', message, data);
      return;
    }
    const ts = new Date().toLocaleTimeString();
    let line = `[${ts}] ${message}`;
    if (data !== undefined) {
      try {
        line += '\n' + JSON.stringify(data, null, 2);
      } catch (e) {
        line += '\n[Error stringifying data: ' + e.message + ']';
      }
    }
    out.value = line + '\n' + '='.repeat(80) + '\n' + out.value;
    console.log('[DEBUG]', message, data);
  } catch (e) {
    console.error('Logging failed:', e);
  }
}

function logError(context, error) {
  const errorInfo = {
    message: error.message,
    stack: error.stack,
    context: context
  };
  log('❌ ERROR in ' + context, errorInfo);
  console.error('ERROR in ' + context, error);
}

// Debug button handlers - wrapped in DOMContentLoaded
window.addEventListener('DOMContentLoaded', () => {
  log('🚀 Script loaded, DOM ready');

  // Toggle debug panel
  const toggleBtn = document.getElementById('toggleDebug');
  const debugConsole = document.getElementById('debugConsole');
  if (toggleBtn && debugConsole) {
    toggleBtn.addEventListener('click', () => {
      const isVisible = debugConsole.style.display !== 'none';
      debugConsole.style.display = isVisible ? 'none' : 'block';
      log(isVisible ? '📦 Debug panel hidden' : '👀 Debug panel shown');
    });
  }

  // Clear debug log
  const clearBtn = document.getElementById('clearDebug');
  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      const out = document.getElementById('debugOutput');
      if (out) out.value = '';
      log('🧹 Debug log cleared');
    });
  }

  // Dump records
  const dumpRecordsBtn = document.getElementById('dumpRecords');
  if (dumpRecordsBtn) {
    dumpRecordsBtn.addEventListener('click', () => {
      log('📊 Current Records (first 10)', normalizeRecords(currentRecords).slice(0, 10));
      log('📊 Total Records Count', currentRecords.length);
    });
  }

  // Dump targets
  const dumpTargetsBtn = document.getElementById('dumpTargets');
  if (dumpTargetsBtn) {
    dumpTargetsBtn.addEventListener('click', () => {
      log('🎯 Targets Map', targetsByPersonYear);
    });
  }

  // Dump filters
  const dumpFiltersBtn = document.getElementById('dumpFilters');
  if (dumpFiltersBtn) {
    dumpFiltersBtn.addEventListener('click', () => {
      log('🔍 Current Filters', currentFilters);
      log('📍 Current View', currentView);
      log('🎯 Show Target', showTarget);
    });
  }
});

// ===== Normalization =====
function normalizeRecord(r) {
  const n = { ...r };
  if ((n.Year == null || n.Quarter == null) && typeof n.Period === 'string') {
    const [y, q] = n.Period.split(/\s+/, 2);
    const yNum = parseInt(y, 10);
    if (!isNaN(yNum)) n.Year = yNum;
    if (q) n.Quarter = q;
  }
  if (!n.Period && (n.Year != null && n.Quarter)) n.Period = `${n.Year} ${n.Quarter}`;
  if (n.Name) n.Name = String(n.Name);
  if (n.Department) n.Department = String(n.Department);
  // Make sure numeric fields are numbers
  if (n.Billable != null) n.Billable = Number(n.Billable);
  if (n.Non_Billable != null) n.Non_Billable = Number(n.Non_Billable);
  return n;
}
function normalizeRecords(records) { return (records || []).map(normalizeRecord); }

// ===== Department/Location Helpers =====
function parseDepartment(deptString) {
  if (!deptString) return { dept: null, location: null };
  const str = String(deptString).trim();

  // Check if it has a comma (location-based department)
  if (str.includes(',')) {
    const parts = str.split(',').map(s => s.trim());
    return { dept: parts[0].toLowerCase(), location: parts[1] };
  }

  return { dept: str.toLowerCase(), location: null };
}

function getAvailableLocations(records, deptFilter) {
  const locations = new Set();
  records.forEach(r => {
    const { dept, location } = parseDepartment(r.Department);

    // If filtering by a specific department category, only show locations for that dept
    if (deptFilter !== 'all') {
      if (dept && dept === deptFilter && location) {
        locations.add(location);
      }
    } else {
      // Show all locations
      if (location) locations.add(location);
    }
  });

  return Array.from(locations).sort();
}

// ===== Filters logic =====
function matchesFilters(record) {
  const { dept, location } = parseDepartment(record.Department);

  // Department filter
  if (currentFilters.department !== 'all') {
    const deptMatch = dept === currentFilters.department;
    if (!deptMatch) return false;
  }

  // Location filter
  if (currentFilters.location !== 'all') {
    if (location !== currentFilters.location) return false;
  }

  // Name search
  if (currentFilters.nameSearch) {
    const name = String(record.Name || '').toLowerCase();
    const search = currentFilters.nameSearch.toLowerCase();
    if (!name.includes(search)) return false;
  }

  return true;
}

// ===== Targets lookup =====
function getTargetFor(name, year) {
  if (!name || !year || year === 'all') return null;
  const y = parseInt(year, 10);
  const t = targetsByPersonYear?.[String(name).trim()]?.[y];
  return t != null ? Number(t) : null;
}

// ===== Sorting =====
function sortData(data, sortType) {
  const sorted = [...data];

  switch (sortType) {
    case 'name-asc':
      return sorted.sort((a, b) => a.name.localeCompare(b.name));
    case 'name-desc':
      return sorted.sort((a, b) => b.name.localeCompare(a.name));
    case 'billable-asc':
      return sorted.sort((a, b) => a.billable - b.billable);
    case 'billable-desc':
      return sorted.sort((a, b) => b.billable - a.billable);
    case 'target-asc':
      return sorted.sort((a, b) => {
        const aVsTarget = a.target ? (a.billable / a.target) : 0;
        const bVsTarget = b.target ? (b.billable / b.target) : 0;
        return aVsTarget - bVsTarget;
      });
    case 'target-desc':
      return sorted.sort((a, b) => {
        const aVsTarget = a.target ? (a.billable / a.target) : 0;
        const bVsTarget = b.target ? (b.billable / b.target) : 0;
        return bVsTarget - aVsTarget;
      });
    case 'department':
      return sorted.sort((a, b) => a.department.localeCompare(b.department));
    default:
      return sorted;
  }
}

// ===== Color coding by target achievement =====
function getColorForTargetAchievement(billable, target) {
  if (!target || target === 0) return '#4CAF50'; // Default green if no target

  const achievement = (billable / target) * 100;

  if (achievement >= 100) return '#4CAF50';  // Green: Meeting/exceeding
  if (achievement >= 90) return '#FFC107';   // Yellow/Amber: Close
  return '#F44336';                           // Red: Below target
}

// ===== Summary Statistics =====
function updateSummaryStats(data) {
  const peopleCount = data.length;
  const avgBillable = peopleCount > 0 ? _.meanBy(data, d => d.billable) : 0;

  // Count people meeting target
  const withTargets = data.filter(d => d.target && d.target > 0);
  const meetingTarget = withTargets.filter(d => d.billable >= d.target).length;
  const targetPercent = withTargets.length > 0 ? (meetingTarget / withTargets.length) * 100 : 0;

  // Update UI
  document.getElementById('statPeopleCount').textContent = peopleCount;
  document.getElementById('statAvgBillable').textContent = avgBillable.toFixed(1) + '%';
  document.getElementById('statMeetingTarget').textContent =
    `${meetingTarget} / ${withTargets.length} (${targetPercent.toFixed(0)}%)`;

  // Show department average if filtered
  const deptAvgSection = document.getElementById('statDeptAvg');
  if (currentFilters.department !== 'all' || currentFilters.location !== 'all') {
    deptAvgSection.style.display = 'flex';
    document.getElementById('statDeptAvgValue').textContent = avgBillable.toFixed(1) + '%';
  } else {
    deptAvgSection.style.display = 'none';
  }

  // Show/hide color legend based on whether targets are visible
  const colorLegend = document.querySelector('.color-legend');
  const hasYear = currentFilters.year !== 'all';
  if (colorLegend) {
    colorLegend.style.display = (showTarget && hasYear) ? 'flex' : 'none';
  }
}

// ===== Update location dropdown dynamically =====
function updateLocationFilter(records) {
  const locations = getAvailableLocations(normalizeRecords(records), currentFilters.department);
  const locationFilter = document.getElementById('locationFilter');

  // Store current value
  const currentValue = locationFilter.value;

  // Clear and rebuild
  locationFilter.innerHTML = '<option value="all">All Locations</option>';
  locations.forEach(loc => {
    const opt = new Option(loc, loc);
    locationFilter.add(opt);
  });

  // Restore value if still valid
  if (locations.includes(currentValue)) {
    locationFilter.value = currentValue;
  } else {
    locationFilter.value = 'all';
    currentFilters.location = 'all';
  }
}

// ===== Load People + Utilization Targets tables =====
async function loadTargets() {
  try {
    log('📥 Starting loadTargets...');
    log('📋 People table ID:', PEOPLE_TABLE_ID);
    log('📋 Targets table ID:', UTIL_TARGETS_TABLE_ID);

    // Fetch People to map rowId -> Name (because Utilization Targets.Person is a Ref)
    log('🔍 Fetching People table...');
    const people = await grist.docApi.fetchTable(PEOPLE_TABLE_ID);
    log('✅ People table fetched', { rowCount: people.id?.length || 0 });

    const idToName = {};
    (people.id || []).forEach((id, i) => {
      idToName[id] = (people.Name?.[i] || '').trim();
    });
    log('📇 ID to Name map created', { peopleCount: Object.keys(idToName).length });

    // Fetch Utilization Targets
    log('🔍 Fetching Utilization Targets table...');
    const ut = await grist.docApi.fetchTable(UTIL_TARGETS_TABLE_ID);
    log('✅ Targets table fetched', { rowCount: ut.id?.length || 0 });

    const map = {};
    (ut.id || []).forEach((id, i) => {
      const personId = ut.Person?.[i];
      const year = ut.Year?.[i];
      const target = ut.Target?.[i];
      const name = idToName[personId];
      if (!name || year == null) return;
      if (!map[name]) map[name] = {};
      map[name][parseInt(year, 10)] = Number(target);
    });
    targetsByPersonYear = map;

    log('✅ Targets loaded successfully', {
      peopleWithTargets: Object.keys(map).length,
      sample: Object.fromEntries(Object.entries(map).slice(0, 3))
    });
  } catch (e) {
    logError('loadTargets', e);
  }
}

// ===== Charts =====
function createBarChart(data) {
  try {
    log('📊 Creating bar chart', { dataPoints: data.length });

    const ctx = document.getElementById('utilizationChart').getContext('2d');
    if (chart) {
      log('🔄 Destroying existing chart');
      chart.destroy();
    }

    // Dynamic chart height based on data size
    const chartContainer = document.getElementById('chartContainer');
    const dataCount = data.length;
    let height = 400;
    if (dataCount <= 10) height = 350;
    else if (dataCount <= 20) height = 450;
    else if (dataCount <= 30) height = 550;
    else height = 650;
    chartContainer.style.height = height + 'px';
    log('📏 Chart height set to', height + 'px');

  // Build datasets with color coding
  const billableColors = data.map(d => getColorForTargetAchievement(d.billable, d.target));

  const base = [
    { label: 'Billable %',     data: data.map(d => Number(d.billable)),    backgroundColor: billableColors, order: 2 },
    { label: 'Non-Billable %', data: data.map(d => Number(d.nonBillable)), backgroundColor: '#FF9800', order: 2 },
  ];

  const hasYear = currentFilters.year !== 'all';
  if (showTarget && hasYear) {
    base.push({
      label: 'Target',
      data: data.map(d => getTargetFor(d.name, currentFilters.year)),
      type: 'line',
      borderColor: 'red',
      borderWidth: 2,
      borderDash: [5, 5],
      fill: false,
      pointRadius: 4,
      pointStyle: 'circle',
      order: 1
    });
  }

    chart = new Chart(ctx, {
      type: 'bar',
      data: { labels: data.map(d => d.name.trim()), datasets: base },
      options: {
        responsive: true, maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100 } },
        plugins: {
          tooltip: { callbacks: { label: c => `${c.dataset.label}: ${(c.parsed.y ?? 0).toFixed(1)}%` } },
          legend: { labels: { filter: item => !item.text.includes('Target') || item.text === 'Target' } }
        },
        // Click to open history
        onClick: (evt) => {
          const points = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
          if (!points?.length) return;
          const p = points.find(pt => chart.data.datasets[pt.datasetIndex].type !== 'line') || points[0];
          const idx = p.index;
          const name = chart.data.labels[idx];
          openHistory(name);
        }
      }
    });
    log('✅ Bar chart created successfully');
  } catch (e) {
    logError('createBarChart', e);
  }
}

function createTrendChart(records) {
  const ctx = document.getElementById('utilizationChart').getContext('2d');
  if (chart) chart.destroy();

  const grouped = _.groupBy(records, r => r.Name.trim());
  const allPeriods = [...new Set(records.map(r => `${r.Year} ${r.Quarter}`))].sort();
  const datasets = [];

  Object.entries(grouped).forEach(([name, personRecords]) => {
    const series = allPeriods.map(period => {
      const rec = personRecords.find(r => `${r.Year} ${r.Quarter}` === period);
      return rec ? Number(rec.Billable) : null;
    });
    datasets.push({
      label: name,
      data: series,
      borderColor: '#4CAF50',
      backgroundColor: 'rgba(76,175,80,0.1)',
      tension: 0.1,
      fill: false
    });

    if (showTarget) {
      datasets.push({
        label: `${name} Target`,
        data: allPeriods.map(period => {
          const yearStr = period.split(' ')[0];
          return getTargetFor(name, yearStr);
        }),
        borderColor: 'red',
        borderWidth: 2,
        borderDash: [5, 5],
        fill: false,
        pointRadius: 0
      });
    }
  });

  chart = new Chart(ctx, {
    type: 'line',
    data: { labels: allPeriods, datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, max: 100, title: { display: true, text: 'Billable %' } },
        x: { title: { display: true, text: 'Time Period' } }
      },
      plugins: {
        tooltip: { callbacks: { label: c => `${c.dataset.label}: ${(c.parsed.y ?? 0).toFixed(1)}%` } },
        legend: { labels: { filter: item => !item.text.includes('Target') || item.text === 'Target' } }
      },
      // Click to open history
      onClick: (evt) => {
        const points = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
        if (!points?.length) return;
        const dsLabel = chart.data.datasets[points[0].datasetIndex].label || '';
        const name = dsLabel.endsWith(' Target') ? dsLabel.replace(/\sTarget$/, '') : dsLabel;
        openHistory(name);
      }
    }
  });
}

// ===== History modal =====
function openHistory(name) {
  if (!name) return;
  const modal = document.getElementById('historyModal');
  const tbody = document.getElementById('historyTable');
  const personEl = document.getElementById('historyPerson');
  personEl.textContent = name;

  const rows = targetsByPersonYear[name] || {};
  const years = Object.keys(rows).map(n => parseInt(n,10)).sort((a,b)=>a-b);

  tbody.innerHTML = years.length
    ? years.map(y => `<tr><td>${y}</td><td>${rows[y] ?? ''}</td></tr>`).join('')
    : '<tr><td colspan="2" style="color:#999;">No targets found</td></tr>';

  modal.style.display = 'flex';
}
function closeHistory() {
  document.getElementById('historyModal').style.display = 'none';
}
document.getElementById('closeHistory').addEventListener('click', closeHistory);
document.getElementById('historyModal').addEventListener('click', (e) => {
  if (e.target.id === 'historyModal') closeHistory();
});

// ===== Filters UI =====
function updateFilters(recordsRaw) {
  const records = normalizeRecords(recordsRaw);

  const years = [...new Set(records.map(r => r.Year).filter(v => v != null))].sort();
  const quarters = [...new Set(records.map(r => r.Quarter).filter(Boolean))].sort();

  const yearFilter = document.getElementById('yearFilter');
  const quarterFilter = document.getElementById('quarterFilter');

  yearFilter.innerHTML = '<option value="all">All Years</option>';
  quarterFilter.innerHTML = '<option value="all">All Quarters</option>';

  years.forEach(y => yearFilter.add(new Option(y, y)));
  quarters.forEach(q => quarterFilter.add(new Option(q, q)));

  yearFilter.value = currentFilters.year;
  quarterFilter.value = currentFilters.quarter;

  // Update location filter
  updateLocationFilter(recordsRaw);
}

// ===== Processing & rendering =====
function processData(recordsRaw) {
  try {
    log('🔄 Processing data...', {
      rawRecords: recordsRaw.length,
      filters: currentFilters,
      view: currentView
    });

    const records = normalizeRecords(recordsRaw);
    let filtered = records;
    log('📝 Records normalized', { count: records.length });

    // Apply year/quarter filters
    if (currentFilters.year !== 'all') {
      filtered = filtered.filter(r => r.Year === parseInt(currentFilters.year, 10));
      log('🗓️ Year filter applied', { year: currentFilters.year, remaining: filtered.length });
    }
    if (currentFilters.quarter !== 'all') {
      filtered = filtered.filter(r => r.Quarter === currentFilters.quarter);
      log('📅 Quarter filter applied', { quarter: currentFilters.quarter, remaining: filtered.length });
    }

    // Apply department, location, and name search filters
    const beforeDeptFilter = filtered.length;
    filtered = filtered.filter(matchesFilters);
    log('🏢 Dept/Location/Name filters applied', {
      before: beforeDeptFilter,
      after: filtered.length,
      dept: currentFilters.department,
      location: currentFilters.location,
      search: currentFilters.nameSearch
    });

    if (currentView === 'bar') {
      const selectedYear = currentFilters.year;
      const grouped = _.groupBy(filtered, r => (r.Name || '').trim());
      log('👥 Records grouped by name', { uniquePeople: Object.keys(grouped).length });

      let processed = _.map(grouped, (group, name) => ({
        name,
        department: group[0]?.Department ?? '',
        billable: _.meanBy(group, r => Number(r.Billable)),
        nonBillable: _.meanBy(group, r => Number(r.Non_Billable)),
        target: selectedYear !== 'all' ? getTargetFor(name, selectedYear) : null
      }));

      // Apply sorting
      processed = sortData(processed, currentFilters.sort);
      log('🔀 Data sorted', { sortType: currentFilters.sort });

      // Update summary statistics
      updateSummaryStats(processed);

      // Debug: first 5 rows to verify targets exist
      log('📊 Bar data processed (first 3)', processed.slice(0, 3));
      createBarChart(processed);
    } else {
      // Update summary for trend view
      const grouped = _.groupBy(filtered, r => (r.Name || '').trim());
      const peopleData = _.map(grouped, (group, name) => ({
        name,
        billable: _.meanBy(group, r => Number(r.Billable)),
        target: currentFilters.year !== 'all' ? getTargetFor(name, currentFilters.year) : null
      }));
      updateSummaryStats(peopleData);

      log('📈 Trend data processed', { recordCount: filtered.length });
      createTrendChart(filtered);
    }

    log('✅ Data processing complete');
  } catch (e) {
    logError('processData', e);
  }
}

// ===== Init & listeners =====
log('🎬 Initializing Grist widget...');
try {
  grist.ready();
  log('✅ Grist.ready() called successfully');
} catch (e) {
  logError('grist.ready', e);
}

// Department filter
document.getElementById('departmentFilter').addEventListener('change', (e) => {
  try {
    log('🏢 Department filter changed', e.target.value);
    currentFilters.department = e.target.value;
    updateLocationFilter(currentRecords);
    processData(currentRecords);
  } catch (err) {
    logError('departmentFilter.change', err);
  }
});

// Location filter
document.getElementById('locationFilter').addEventListener('change', (e) => {
  try {
    log('📍 Location filter changed', e.target.value);
    currentFilters.location = e.target.value;
    processData(currentRecords);
  } catch (err) {
    logError('locationFilter.change', err);
  }
});

// Year/Quarter filters
document.getElementById('yearFilter').addEventListener('change', (e) => {
  try {
    log('🗓️ Year filter changed', e.target.value);
    currentFilters.year = e.target.value;
    processData(currentRecords);
  } catch (err) {
    logError('yearFilter.change', err);
  }
});

document.getElementById('quarterFilter').addEventListener('change', (e) => {
  try {
    log('📅 Quarter filter changed', e.target.value);
    currentFilters.quarter = e.target.value;
    processData(currentRecords);
  } catch (err) {
    logError('quarterFilter.change', err);
  }
});

// Name search
document.getElementById('nameSearch').addEventListener('input', (e) => {
  try {
    log('🔍 Name search changed', e.target.value);
    currentFilters.nameSearch = e.target.value;
    processData(currentRecords);
  } catch (err) {
    logError('nameSearch.input', err);
  }
});

// Sort filter
document.getElementById('sortFilter').addEventListener('change', (e) => {
  try {
    log('🔀 Sort filter changed', e.target.value);
    currentFilters.sort = e.target.value;
    processData(currentRecords);
  } catch (err) {
    logError('sortFilter.change', err);
  }
});

// View toggles
document.getElementById('barView').addEventListener('click', () => {
  currentView = 'bar';
  document.getElementById('barView').classList.add('active');
  document.getElementById('trendView').classList.remove('active');
  processData(currentRecords);
});
document.getElementById('trendView').addEventListener('click', () => {
  currentView = 'trend';
  document.getElementById('trendView').classList.add('active');
  document.getElementById('barView').classList.remove('active');
  processData(currentRecords);
});

// Target toggle
document.getElementById('showTarget').addEventListener('change', (e) => {
  showTarget = e.target.checked;
  processData(currentRecords);
});

// Hydrate from Grist
grist.onRecords(async (records) => {
  try {
    log('📬 grist.onRecords triggered', { count: records?.length ?? 0 });

    if (!records || records.length === 0) {
      log('⚠️ No records received from Grist');
      return;
    }

    log('📋 Sample record (first one)', records[0]);

    await loadTargets();

    currentRecords = records || [];
    log('💾 Records saved to currentRecords', { count: currentRecords.length });

    updateFilters(currentRecords);
    log('🔧 Filters updated');

    processData(currentRecords);
    log('✅ Initial data processing complete');
  } catch (e) {
    logError('grist.onRecords', e);
  }
});