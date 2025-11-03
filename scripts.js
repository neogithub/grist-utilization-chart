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
  sort: 'name-asc',
  targetAchievement: 'all', // 'all', 'above', 'close', 'below'
  compareQ1: '',
  compareQ2: ''
};
let currentView = 'bar'; // 'bar', 'trend', 'compare', 'alltime'
let showTarget = true;
let compactView = false;
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

  // Toggle debug panel (floating button)
  const toggleBtn = document.getElementById('toggleDebug');
  const debugPanel = document.getElementById('debugPanel');
  const closeDebugBtn = document.getElementById('closeDebug');

  if (toggleBtn && debugPanel) {
    toggleBtn.addEventListener('click', () => {
      debugPanel.classList.toggle('debug-panel-visible');
      log('👀 Debug panel toggled');
    });
  }

  if (closeDebugBtn && debugPanel) {
    closeDebugBtn.addEventListener('click', () => {
      debugPanel.classList.remove('debug-panel-visible');
      log('📦 Debug panel closed');
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
      log('🔬 Compact View', compactView);
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
  if (!name) {
    log('⚠️ getTargetFor: no name provided');
    return null;
  }

  const trimmedName = String(name).trim();
  const targets = targetsByPersonYear?.[trimmedName];

  if (!targets || Object.keys(targets).length === 0) {
    log(`⚠️ getTargetFor: no targets found for "${trimmedName}"`);
    return null;
  }

  // If specific year requested and target exists for that year, use it
  if (year && year !== 'all') {
    const y = parseInt(year, 10);
    if (targets[y] != null) {
      log(`✅ getTargetFor: "${trimmedName}" year ${y} = ${targets[y]}`);
      return Number(targets[y]);
    }

    // Fall back to most recent (latest) target available
    const years = Object.keys(targets).map(y => parseInt(y, 10)).sort((a, b) => b - a);
    const latestYear = years[0];
    const fallbackTarget = targets[latestYear];
    log(`⚠️ getTargetFor: "${trimmedName}" no target for ${y}, using ${latestYear} fallback = ${fallbackTarget}`);
    return fallbackTarget != null ? Number(fallbackTarget) : null;
  }

  // If no specific year, use most recent
  const years = Object.keys(targets).map(y => parseInt(y, 10)).sort((a, b) => b - a);
  const latestYear = years[0];
  log(`✅ getTargetFor: "${trimmedName}" using latest year ${latestYear} = ${targets[latestYear]}`);
  return targets[latestYear] != null ? Number(targets[latestYear]) : null;
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

// ===== Target Achievement Filter =====
function applyTargetAchievementFilter(data) {
  if (currentFilters.targetAchievement === 'all') return data;

  return data.filter(d => {
    if (!d.target || d.target === 0) return false;
    const achievement = (d.billable / d.target) * 100;

    switch (currentFilters.targetAchievement) {
      case 'above':
        return achievement >= 100;
      case 'close':
        return achievement >= 90 && achievement < 100;
      case 'below':
        return achievement < 90;
      default:
        return true;
    }
  });
}

// ===== Compact View - Get Display Name =====
function getDisplayName(fullName) {
  if (!compactView) return fullName;

  // Generate initials
  const parts = fullName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].substring(0, 2).toUpperCase();

  return parts.map(p => p.charAt(0).toUpperCase()).join('');
}

// ===== Color coding by target achievement =====
function getColorForTargetAchievement(billable, target) {
  if (!target || target === 0) return '#4CAF50'; // Default green if no target

  const achievement = (billable / target) * 100;

  if (achievement >= 100) return '#4CAF50';  // Green: Meeting/exceeding
  if (achievement >= 90) return '#FFC107';   // Yellow/Amber: Close
  return '#F44336';                           // Red: Below target
}

// ===== Export Functions =====
function exportAsImage() {
  try {
    log('📷 Exporting chart as image...');
    const canvas = document.getElementById('utilizationChart');
    if (!canvas) {
      log('❌ Canvas not found');
      return;
    }

    const link = document.createElement('a');
    link.download = `utilization-chart-${new Date().toISOString().split('T')[0]}.png`;
    link.href = canvas.toDataURL();
    link.click();
    log('✅ Image exported successfully');
  } catch (e) {
    logError('exportAsImage', e);
  }
}

function exportAsCSV() {
  try {
    log('📊 Exporting data as CSV...');

    const records = normalizeRecords(currentRecords);
    let filtered = records;

    // Apply all current filters
    if (currentFilters.year !== 'all') {
      filtered = filtered.filter(r => r.Year === parseInt(currentFilters.year, 10));
    }
    if (currentFilters.quarter !== 'all') {
      filtered = filtered.filter(r => r.Quarter === currentFilters.quarter);
    }
    filtered = filtered.filter(matchesFilters);

    // Build CSV
    const headers = ['Name', 'Department', 'Year', 'Quarter', 'Billable %', 'Non-Billable %', 'Target', 'vs Target'];
    const rows = filtered.map(r => {
      const target = getTargetFor(r.Name, r.Year);
      const vsTarget = target ? ((r.Billable / target) * 100).toFixed(1) + '%' : 'N/A';
      return [
        r.Name,
        r.Department,
        r.Year,
        r.Quarter,
        r.Billable,
        r.Non_Billable,
        target || 'N/A',
        vsTarget
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n');

    // Download
    const blob = new Blob([csvContent], { type: 'text/csv' });
    const link = document.createElement('a');
    link.download = `utilization-data-${new Date().toISOString().split('T')[0]}.csv`;
    link.href = URL.createObjectURL(blob);
    link.click();

    log('✅ CSV exported successfully', { rows: filtered.length });
  } catch (e) {
    logError('exportAsCSV', e);
  }
}

// ===== Compare Quarters View =====
function createCompareView(records, q1, q2) {
  try {
    log('📊 Creating quarter comparison view', { q1, q2 });

    const [year1, quarter1] = q1.split('-Q');
    const [year2, quarter2] = q2.split('-Q');

    // Filter records for each quarter
    const q1Records = records.filter(r => r.Year === parseInt(year1) && r.Quarter === `Q${quarter1}`);
    const q2Records = records.filter(r => r.Year === parseInt(year2) && r.Quarter === `Q${quarter2}`);

    // Group by person
    const q1Data = _.groupBy(q1Records, r => r.Name.trim());
    const q2Data = _.groupBy(q2Records, r => r.Name.trim());

    // Get all unique names
    const allNames = _.uniq([...Object.keys(q1Data), ...Object.keys(q2Data)]).sort();

    // Build comparison data
    const comparisonData = allNames.map(name => {
      const q1Bill = q1Data[name] ? _.meanBy(q1Data[name], r => Number(r.Billable)) : 0;
      const q2Bill = q2Data[name] ? _.meanBy(q2Data[name], r => Number(r.Billable)) : 0;
      const change = q2Bill - q1Bill;

      return {
        name,
        q1: q1Bill,
        q2: q2Bill,
        change,
        department: (q1Data[name] || q2Data[name])[0].Department
      };
    });

    // Create grouped bar chart
    const ctx = document.getElementById('utilizationChart').getContext('2d');
    if (chart) chart.destroy();

    chart = new Chart(ctx, {
      type: 'bar',
      data: {
        labels: comparisonData.map(d => getDisplayName(d.name)),
        datasets: [
          {
            label: q1,
            data: comparisonData.map(d => d.q1),
            backgroundColor: '#667eea'
          },
          {
            label: q2,
            data: comparisonData.map(d => d.q2),
            backgroundColor: '#764ba2'
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: { y: { beginAtZero: true, max: 100 } },
        plugins: {
          tooltip: {
            callbacks: {
              footer: (items) => {
                const idx = items[0].dataIndex;
                const change = comparisonData[idx].change;
                return `Change: ${change >= 0 ? '+' : ''}${change.toFixed(1)}%`;
              }
            }
          }
        }
      }
    });

    log('✅ Compare view created successfully');
  } catch (e) {
    logError('createCompareView', e);
  }
}

// ===== All Time View =====
function createAllTimeView(records) {
  try {
    log('📋 Creating all-time data table...');

    const tbody = document.getElementById('allTimeTableBody');
    tbody.innerHTML = '';

    // Sort by name then period
    const sorted = records.sort((a, b) => {
      const nameComp = a.Name.localeCompare(b.Name);
      if (nameComp !== 0) return nameComp;
      if (a.Year !== b.Year) return a.Year - b.Year;
      return a.Quarter.localeCompare(b.Quarter);
    });

    sorted.forEach(r => {
      const target = getTargetFor(r.Name, r.Year);
      let vsTargetText = 'N/A';
      let statusClass = '';

      if (target) {
        const achievement = (r.Billable / target) * 100;
        vsTargetText = achievement.toFixed(1) + '%';

        if (achievement >= 100) statusClass = 'status-above';
        else if (achievement >= 90) statusClass = 'status-close';
        else statusClass = 'status-below';
      }

      const row = document.createElement('tr');
      row.innerHTML = `
        <td>${r.Name}</td>
        <td>${r.Department}</td>
        <td>${r.Year} ${r.Quarter}</td>
        <td>${r.Billable.toFixed(1)}%</td>
        <td>${r.Non_Billable.toFixed(1)}%</td>
        <td>${target || 'N/A'}</td>
        <td class="${statusClass}">${vsTargetText}</td>
      `;
      tbody.appendChild(row);
    });

    log('✅ All-time table created', { rows: records.length });
  } catch (e) {
    logError('createAllTimeView', e);
  }
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
      data: { labels: data.map(d => getDisplayName(d.name.trim())), datasets: base },
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
  try {
    log('📈 Creating trend chart...');

    // Check if we have exactly one person
    const uniquePeople = [...new Set(records.map(r => r.Name.trim()))];

    if (uniquePeople.length !== 1) {
      // Show helper message
      log('ℹ️ Multiple people selected - showing helper message');
      document.getElementById('trendHelper').style.display = 'block';
      document.getElementById('chartContainer').style.display = 'none';
      return;
    }

    // Hide helper, show chart
    document.getElementById('trendHelper').style.display = 'none';
    document.getElementById('chartContainer').style.display = 'block';

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

    log('✅ Trend chart created successfully');
  } catch (e) {
    logError('createTrendChart', e);
  }
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

  // Populate compare quarter dropdowns
  const compareQ1 = document.getElementById('compareQuarter1');
  const compareQ2 = document.getElementById('compareQuarter2');

  const yearQuarters = [];
  years.forEach(year => {
    quarters.forEach(quarter => {
      // Check if this combo exists in data
      const exists = records.some(r => r.Year === year && r.Quarter === quarter);
      if (exists) {
        yearQuarters.push({ label: `${year} ${quarter}`, value: `${year}-${quarter}` });
      }
    });
  });

  compareQ1.innerHTML = '<option value="">Select Quarter 1</option>';
  compareQ2.innerHTML = '<option value="">Select Quarter 2</option>';

  yearQuarters.forEach(yq => {
    compareQ1.add(new Option(yq.label, yq.value));
    compareQ2.add(new Option(yq.label, yq.value));
  });

  // Show/hide target filter based on year selection
  const targetFilter = document.getElementById('targetFilter');
  const hasYear = currentFilters.year !== 'all';
  targetFilter.style.display = hasYear ? 'flex' : 'none';
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

    // Handle different views
    if (currentView === 'bar') {
      // Show chart, hide others
      document.getElementById('chartContainer').style.display = 'block';
      document.getElementById('allTimeContainer').style.display = 'none';
      document.getElementById('trendHelper').style.display = 'none';

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

      // Apply target achievement filter
      processed = applyTargetAchievementFilter(processed);
      log('🎯 Target filter applied', { remaining: processed.length });

      // Apply sorting
      processed = sortData(processed, currentFilters.sort);
      log('🔀 Data sorted', { sortType: currentFilters.sort });

      // Update summary statistics
      updateSummaryStats(processed);

      // Debug: first 5 rows to verify targets exist
      log('📊 Bar data processed (first 3)', processed.slice(0, 3));
      createBarChart(processed);

    } else if (currentView === 'trend') {
      // Trend view - person specific
      document.getElementById('allTimeContainer').style.display = 'none';

      const grouped = _.groupBy(filtered, r => (r.Name || '').trim());
      const peopleData = _.map(grouped, (group, name) => ({
        name,
        billable: _.meanBy(group, r => Number(r.Billable)),
        target: currentFilters.year !== 'all' ? getTargetFor(name, currentFilters.year) : null
      }));
      updateSummaryStats(peopleData);

      log('📈 Trend data processed', { recordCount: filtered.length });
      createTrendChart(filtered);

    } else if (currentView === 'compare') {
      // Compare quarters view
      document.getElementById('chartContainer').style.display = 'block';
      document.getElementById('allTimeContainer').style.display = 'none';
      document.getElementById('trendHelper').style.display = 'none';

      if (currentFilters.compareQ1 && currentFilters.compareQ2) {
        createCompareView(filtered, currentFilters.compareQ1, currentFilters.compareQ2);
      } else {
        log('⚠️ Both quarters must be selected for comparison');
      }

    } else if (currentView === 'alltime') {
      // All time table view
      document.getElementById('chartContainer').style.display = 'none';
      document.getElementById('allTimeContainer').style.display = 'block';
      document.getElementById('trendHelper').style.display = 'none';

      createAllTimeView(filtered);
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
    // Update target filter visibility
    updateFilters(currentRecords);
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
function setActiveView(view) {
  currentView = view;
  ['barView', 'trendView', 'compareView', 'allTimeView'].forEach(id => {
    document.getElementById(id).classList.remove('active');
  });
  document.getElementById(view + 'View').classList.add('active');

  // Show/hide compare controls
  const compareControls = document.getElementById('compareControls');
  compareControls.style.display = (view === 'compare') ? 'flex' : 'none';
}

document.getElementById('barView').addEventListener('click', () => {
  setActiveView('bar');
  processData(currentRecords);
});
document.getElementById('trendView').addEventListener('click', () => {
  setActiveView('trend');
  processData(currentRecords);
});
document.getElementById('compareView').addEventListener('click', () => {
  setActiveView('compare');
  processData(currentRecords);
});
document.getElementById('allTimeView').addEventListener('click', () => {
  setActiveView('allTime');
  processData(currentRecords);
});

// Target toggle
document.getElementById('showTarget').addEventListener('change', (e) => {
  showTarget = e.target.checked;
  processData(currentRecords);
});

// Compact view toggle
document.getElementById('compactView').addEventListener('change', (e) => {
  compactView = e.target.checked;
  log('🔬 Compact view toggled', compactView);
  processData(currentRecords);
});

// Target achievement filter buttons
document.getElementById('filterAll').addEventListener('click', () => {
  currentFilters.targetAchievement = 'all';
  updateTargetFilterButtons();
  processData(currentRecords);
});
document.getElementById('filterAbove').addEventListener('click', () => {
  currentFilters.targetAchievement = 'above';
  updateTargetFilterButtons();
  processData(currentRecords);
});
document.getElementById('filterClose').addEventListener('click', () => {
  currentFilters.targetAchievement = 'close';
  updateTargetFilterButtons();
  processData(currentRecords);
});
document.getElementById('filterBelow').addEventListener('click', () => {
  currentFilters.targetAchievement = 'below';
  updateTargetFilterButtons();
  processData(currentRecords);
});

function updateTargetFilterButtons() {
  ['filterAll', 'filterAbove', 'filterClose', 'filterBelow'].forEach(id => {
    document.getElementById(id).classList.remove('active');
  });
  const activeId = 'filter' + currentFilters.targetAchievement.charAt(0).toUpperCase() + currentFilters.targetAchievement.slice(1);
  document.getElementById(activeId).classList.add('active');
}

// Compare quarter selectors
document.getElementById('compareQuarter1').addEventListener('change', (e) => {
  currentFilters.compareQ1 = e.target.value;
  log('📅 Compare Q1 changed', e.target.value);
  processData(currentRecords);
});
document.getElementById('compareQuarter2').addEventListener('change', (e) => {
  currentFilters.compareQ2 = e.target.value;
  log('📅 Compare Q2 changed', e.target.value);
  processData(currentRecords);
});

// Export buttons
document.getElementById('exportImage').addEventListener('click', exportAsImage);
document.getElementById('exportCSV').addEventListener('click', exportAsCSV);

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