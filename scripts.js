// Globals
let currentRecords = [];
let currentFilters = { department: 'all', year: 'all' };
let currentView = 'bar';
let showTarget = true;

let targetsByPersonYear = {};

// Lookup helper
function getTargetFor(name, year) {
  if (!name || !year) return null;
  return targetsByPersonYear?.[name.trim()]?.[parseInt(year)] ?? null;
}

// Load Utilization Targets + People
async function loadTargets() {
  const people = await grist.docApi.fetchTable('People');
  const peopleById = {};
  (people.id || []).forEach((id, i) => {
    peopleById[id] = (people.Name?.[i] || '').trim();
  });

  const ut = await grist.docApi.fetchTable('Utilization Targets');
  targetsByPersonYear = {};
  (ut.id || []).forEach((id, i) => {
    const personId = ut.Person?.[i];
    const year = ut.Year?.[i];
    const target = ut.Target?.[i];
    const name = peopleById[personId];
    if (!name || !year) return;

    if (!targetsByPersonYear[name]) targetsByPersonYear[name] = {};
    targetsByPersonYear[name][parseInt(year)] = target ?? null;
  });
}

// Filter UI setup
function updateFilters(records) {
  const departmentFilter = document.getElementById('departmentFilter');
  const yearFilter = document.getElementById('yearFilter');

  const departments = ['all', ...new Set(records.map(r => r.Department))];
  departmentFilter.innerHTML = departments.map(d => `<option value="${d}">${d}</option>`).join('');

  const years = ['all', ...new Set(records.map(r => r.Period.split(' ')[0]))].sort();
  yearFilter.innerHTML = years.map(y => `<option value="${y}">${y}</option>`).join('');

  departmentFilter.addEventListener('change', e => {
    currentFilters.department = e.target.value;
    processData(currentRecords);
  });

  yearFilter.addEventListener('change', e => {
    currentFilters.year = e.target.value;
    processData(currentRecords);
  });

  document.getElementById('viewToggle').addEventListener('change', e => {
    currentView = e.target.value;
    processData(currentRecords);
  });

  document.getElementById('showTarget').addEventListener('change', e => {
    showTarget = e.target.checked;
    processData(currentRecords);
  });
}

// Process & route to correct chart
function processData(records) {
  const filtered = records.filter(r =>
    (currentFilters.department === 'all' || r.Department === currentFilters.department) &&
    (currentFilters.year === 'all' || r.Period.startsWith(currentFilters.year))
  );

  if (currentView === 'bar') {
    const processed = _.map(
      _.groupBy(filtered, r => r.Name.trim()),
      (group, name) => {
        const yr = currentFilters.year !== 'all' ? parseInt(currentFilters.year) : null;
        return {
          name,
          department: group[0].Department,
          billable: _.meanBy(group, r => r.Billable),
          nonBillable: _.meanBy(group, r => r.Non_Billable),
          target: yr ? getTargetFor(name, yr) : null
        };
      }
    );
    createBarChart(processed);
  } else {
    createTrendChart(filtered);
  }
}

// Chart instance (shared)
let chart;

// History modal helpers
function openHistory(name) {
  if (!name) return;
  const modal = document.getElementById('historyModal');
  const tbody = document.getElementById('historyTable');
  const personEl = document.getElementById('historyPerson');
  personEl.textContent = name;

  const rows = targetsByPersonYear[name] || {};
  const sortedYears = Object.keys(rows).map(y => parseInt(y)).sort((a,b)=>a-b);

  tbody.innerHTML = sortedYears.length
    ? sortedYears.map(y => `<tr><td>${y}</td><td>${rows[y] ?? ''}</td></tr>`).join('')
    : '<tr><td colspan="2" style="color:#999;">No targets found</td></tr>';

  modal.style.display = 'flex';
}

function closeHistory() {
  document.getElementById('historyModal').style.display = 'none';
}

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
