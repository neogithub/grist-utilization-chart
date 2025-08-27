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

// Per-person per-year targets pulled from "Utilization Targets"
let targetsByPersonYear = {};     // { "Adam Craig": { 2024: 60, 2025: 75 }, ... }

// ===== Debug helpers =====
function log(message, data) {
  const out = document.getElementById('debug');
  const ts = new Date().toLocaleTimeString();
  let line = `[${ts}] ${message}`;
  if (data !== undefined) {
    try { line += '\n' + JSON.stringify(data, null, 2); } catch {}
  }
  out.value = line + '\n\n' + out.value;
}

// Buttons + toggle
document.getElementById('dumpRecords').addEventListener('click', () => {
  log('Records (sample, normalized)', normalizeRecords(currentRecords).slice(0, 10));
});
document.getElementById('dumpTargets').addEventListener('click', () => {
  log('Targets Map', targetsByPersonYear);
});
document.getElementById('toggleDebug').addEventListener('change', (e) => {
  document.getElementById('debug').style.display = e.target.checked ? 'block' : 'none';
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

// ===== Filters logic =====
function matchesDepartmentType(dept, type) {
  if (!dept) return false;
  const d = String(dept).toLowerCase();
  if (type === 'all') return true;
  if (type === '3d') return d.includes('3d');
  if (type === 'design') return d.includes('design');
  if (type === 'custom') return currentFilters.department === 'all' || dept === currentFilters.department;
  return true;
}

// ===== Targets lookup =====
function getTargetFor(name, year) {
  if (!name || !year || year === 'all') return null;
  const y = parseInt(year, 10);
  const t = targetsByPersonYear?.[String(name).trim()]?.[y];
  return t != null ? Number(t) : null;
}

// ===== Load People + Utilization Targets tables =====
async function loadTargets() {
  try {
    // Fetch People to map rowId -> Name (because Utilization Targets.Person is a Ref)
    const people = await grist.docApi.fetchTable('People');
    const idToName = {};
    (people.id || []).forEach((id, i) => {
      idToName[id] = (people.Name?.[i] || '').trim();
    });

    // Fetch Utilization Targets
    const ut = await grist.docApi.fetchTable('Utilization_Targets');
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

    // Early debug so you can verify immediately
    log('Loaded targets summary', Object.fromEntries(Object.entries(map).slice(0,5)));
  } catch (e) {
    log('Error loading targets', String(e));
  }
}

// ===== Charts =====
function createBarChart(data) {
  const ctx = document.getElementById('utilizationChart').getContext('2d');
  if (chart) chart.destroy();

  // Build datasets
  const base = [
    { label: 'Billable %',     data: data.map(d => Number(d.billable)),    backgroundColor: '#4CAF50', order: 2 },
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
  const departments = [...new Set(records.map(r => r.Department).filter(Boolean))].sort();
  const names = [...new Set(records.map(r => (r.Name || '').trim()).filter(Boolean))].sort();

  const yearFilter = document.getElementById('yearFilter');
  const quarterFilter = document.getElementById('quarterFilter');
  const departmentFilter = document.getElementById('departmentFilter');
  const nameFilter = document.getElementById('nameFilter');

  yearFilter.innerHTML = '<option value="all">All Years</option>';
  quarterFilter.innerHTML = '<option value="all">All Quarters</option>';
  departmentFilter.innerHTML = '<option value="all">All Departments</option>';
  nameFilter.innerHTML = '<option value="all">All Names</option>';

  years.forEach(y => yearFilter.add(new Option(y, y)));
  quarters.forEach(q => quarterFilter.add(new Option(q, q)));
  departments.forEach(d => departmentFilter.add(new Option(d, d)));
  names.forEach(n => nameFilter.add(new Option(n, n)));

  yearFilter.value = currentFilters.year;
  quarterFilter.value = currentFilters.quarter;
  departmentFilter.value = currentFilters.department;
  nameFilter.value = currentFilters.name;
}

// ===== Processing & rendering =====
function processData(recordsRaw) {
  const records = normalizeRecords(recordsRaw);
  let filtered = records;

  if (currentFilters.year !== 'all') {
    filtered = filtered.filter(r => r.Year === parseInt(currentFilters.year, 10));
  }
  if (currentFilters.quarter !== 'all') {
    filtered = filtered.filter(r => r.Quarter === currentFilters.quarter);
  }

  filtered = filtered.filter(r => matchesDepartmentType(r.Department, currentFilters.departmentType));

  if (currentFilters.departmentType === 'custom' && currentFilters.department !== 'all') {
    filtered = filtered.filter(r => r.Department === currentFilters.department);
  }
  if (currentFilters.name !== 'all') {
    filtered = filtered.filter(r => (r.Name || '').trim() === currentFilters.name);
  }

  if (currentView === 'bar') {
    const selectedYear = currentFilters.year;
    const grouped = _.groupBy(filtered, r => (r.Name || '').trim());
    const processed = _.map(grouped, (group, name) => ({
      name,
      department: group[0]?.Department ?? '',
      billable: _.meanBy(group, r => Number(r.Billable)),
      nonBillable: _.meanBy(group, r => Number(r.Non_Billable)),
      target: selectedYear !== 'all' ? getTargetFor(name, selectedYear) : null
    }));
    // Debug: first 5 rows to verify targets exist
    log('Bar processed (first 5)', processed.slice(0,5));
    createBarChart(processed);
  } else {
    log('Trend processed count', filtered.length);
    createTrendChart(filtered);
  }
}

// ===== Init & listeners =====
grist.ready();

// Department radios
document.querySelectorAll('input[name="departmentType"]').forEach(radio => {
  radio.addEventListener('change', (e) => {
    currentFilters.departmentType = e.target.value;
    const departmentFilter = document.getElementById('departmentFilter');
    if (currentFilters.departmentType === 'custom') {
      departmentFilter.disabled = false;
    } else {
      departmentFilter.disabled = true;
      currentFilters.department = 'all';
      departmentFilter.value = 'all';
    }
    processData(currentRecords);
  });
});

// Dropdown listeners
['year', 'quarter', 'department', 'name'].forEach(id => {
  document.getElementById(id + 'Filter').addEventListener('change', (e) => {
    currentFilters[id] = e.target.value;
    processData(currentRecords);
  });
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
  log('onRecords received', { count: records?.length ?? 0 });
  await loadTargets();
  currentRecords = records || [];
  updateFilters(currentRecords);
  document.getElementById('departmentFilter').disabled = currentFilters.departmentType !== 'custom';
  processData(currentRecords);
});