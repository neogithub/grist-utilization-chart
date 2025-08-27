// ===== State =====
let currentRecords = [];
let currentFilters = {
  year: 'all',
  quarter: 'all',
  department: 'all',
  departmentType: 'all',
  name: 'all'
};
let currentView = 'bar';
let showTarget = true;
let chart = null;

// Option 2: per-person per-year targets map
let targetsByPersonYear = {};

// ===== Utilities =====
function log(message, data) {
  const debugDiv = document.getElementById('debug');
  const timestamp = new Date().toISOString();
  debugDiv.textContent = `${timestamp}: ${message}\n` + (data ? JSON.stringify(data, null, 2) : '');
}

function matchesDepartmentType(department, departmentType) {
  if (!department) return false;
  switch (departmentType) {
    case 'all': return true;
    case '3d': return department.toLowerCase().includes('3d');
    case 'design': return department.toLowerCase().includes('design');
    case 'custom':
      return currentFilters.department === 'all' || department === currentFilters.department;
    default: return true;
  }
}

function getTargetFor(name, year) {
  if (!name || !year || year === 'all') return null;
  const y = parseInt(year);
  return targetsByPersonYear?.[name.trim()]?.[y] ?? null;
}

// Build targets map from People + Utilization Targets tables
async function loadTargets() {
  try {
    const people = await grist.docApi.fetchTable('People');
    const byId = {};
    (people.id || []).forEach((id, i) => {
      byId[id] = (people.Name?.[i] || '').trim();
    });

    const ut = await grist.docApi.fetchTable('Utilization Targets');
    targetsByPersonYear = {};
    (ut.id || []).forEach((id, i) => {
      const personId = ut.Person?.[i];
      const year = ut.Year?.[i];
      const target = ut.Target?.[i];
      const name = byId[personId];
      if (!name || !year) return;
      if (!targetsByPersonYear[name]) targetsByPersonYear[name] = {};
      targetsByPersonYear[name][parseInt(year)] = target ?? null;
    });
    log('Loaded targets', targetsByPersonYear);
  } catch (e) {
    log('Error loading targets', { error: String(e) });
  }
}

// (rest of scripts.js continues with createBarChart, createTrendChart, filters, listeners, processData… same as in my last message)

// Bar Chart
function createBarChart(data) {
  if (chart) chart.destroy();
  const ctx = document.getElementById('chart').getContext('2d');

  chart = new Chart(ctx, {
    type: 'bar',
    data: {
      labels: data.map(d => d.name),
      datasets: [
        { label: 'Billable', data: data.map(d => d.billable), backgroundColor: 'steelblue' },
        { label: 'Non-Billable', data: data.map(d => d.nonBillable), backgroundColor: 'lightgray' },
      ].concat(showTarget ? [{
        label: 'Target',
        data: data.map(d => d.target),
        type: 'line',
        borderColor: 'red',
        borderDash: [5, 5],
        fill: false,
        pointRadius: 5
      }] : [])
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt, elements) => {
        // Find the bar index that was clicked (prefer the bar datasets)
        const points = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
        if (!points || !points.length) return;
        // Pick first non-Target dataset to resolve the person name
        const p = points.find(pt => chart.data.datasets[pt.datasetIndex].type !== 'line') || points[0];
        const idx = p.index;
        const name = chart.data.labels[idx];
        openHistory(name);
      }
    }
  });
}

// Debug logger
function logDebug(msg, data) {
  const out = document.getElementById('debugOutput');
  let str = `[${new Date().toLocaleTimeString()}] ${msg}`;
  if (data !== undefined) {
    str += " " + JSON.stringify(data, null, 2);
  }
  out.value = str + "\n" + out.value; // prepend new logs
}

// Wire Debug button
document.getElementById('debugBtn').addEventListener('click', () => {
  logDebug("Current state", {
    filters: currentFilters,
    view: currentView,
    showTarget,
    targetsByPersonYear
  });
});

// Trend Chart
function createTrendChart(records) {
  if (chart) chart.destroy();
  const ctx = document.getElementById('chart').getContext('2d');

  const grouped = _.groupBy(records, r => r.Name.trim());
  const allPeriods = _.uniq(records.map(r => r.Period)).sort();

  const datasets = [];

  _.forEach(grouped, (group, name) => {
    const data = allPeriods.map(period => {
      const rec = group.find(r => r.Period === period);
      return rec ? rec.Billable : null;
    });
    datasets.push({ label: name, data, borderWidth: 2, fill: false });

    if (showTarget) {
      datasets.push({
        label: `${name} Target`,
        data: allPeriods.map(period => {
          const yearStr = period.split(' ')[0]; // "2026 Q1" -> "2026"
          return getTargetFor(name, parseInt(yearStr));
        }),
        borderColor: 'red',
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
      responsive: true,
      maintainAspectRatio: false,
      onClick: (evt) => {
        // Resolve nearest dataset/point then normalize to the person's name
        const points = chart.getElementsAtEventForMode(evt, 'nearest', { intersect: true }, true);
        if (!points || !points.length) return;
        const dsLabel = chart.data.datasets[points[0].datasetIndex].label || '';
        const name = dsLabel.endsWith(' Target') ? dsLabel.replace(/\sTarget$/, '') : dsLabel;
        openHistory(name);
      }
    }
  });
}

// Wire modal close
document.addEventListener('click', (e) => {
  if (e.target.id === 'closeHistory' || e.target.id === 'historyModal') {
    closeHistory();
  }
});

// Main hook
grist.onRecords(async records => {
  await loadTargets();
  currentRecords = records;
  updateFilters(records);
  document.getElementById('departmentFilter').disabled = true;
  processData(records);
});
