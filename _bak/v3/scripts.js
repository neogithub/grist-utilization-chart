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

// Per-person per-year targets map from "Utilization Targets"
let targetsByPersonYear = {};

// ===== Utilities & Debug =====
function ensureDebugUI() {
  // Add buttons + textarea if they don't exist (safe to call multiple times)
  if (!document.getElementById('debugButtons')) {
    const controls = document.querySelector('.view-controls') || document.body;
    const wrap = document.createElement('div');
    wrap.id = 'debugButtons';
    wrap.style.marginLeft = '8px';
    wrap.innerHTML = `
      <button id="dumpRecords">Dump Records</button>
      <button id="dumpTargets">Dump Targets</button>
    `;
    controls.appendChild(wrap);
  }
  if (!document.getElementById('debug')) {
    const ta = document.createElement('textarea');
    ta.id = 'debug';
    ta.style.cssText = 'width:100%;height:180px;margin-top:10px;font-family:monospace;display:none;';
    document.body.appendChild(ta);
  }
  if (!document.getElementById('toggleDebug')) {
    // If your HTML already has it, this does nothing. If not, add one.
    const cbWrap = document.createElement('div');
    cbWrap.className = 'checkbox-wrapper';
    cbWrap.innerHTML = `
      <input type="checkbox" id="toggleDebug">
      <label for="toggleDebug">Show Debug</label>
    `;
    (document.querySelector('.view-controls') || document.body).appendChild(cbWrap);
  }
  // Button listeners
  document.getElementById('dumpRecords')?.addEventListener('click', () => {
    log('Records (sample, normalized)', normalizeRecords(currentRecords).slice(0, 10));
  });
  document.getElementById('dumpTargets')?.addEventListener('click', () => {
    log('Targets Map', targetsByPersonYear);
  });
  // Toggle listener
  document.getElementById('toggleDebug')?.addEventListener('change', (e) => {
    const dbg = document.getElementById('debug');
    dbg.style.display = e.target.checked ? 'block' : 'none';
  });
}

function log(message, data) {
  ensureDebugUI();
  const out = document.getElementById('debug');
  const timestamp = new Date().toLocaleTimeString();
  let line = `[${timestamp}] ${message}`;
  if (data !== undefined) {
    try { line += '\n' + JSON.stringify(data, null, 2); } catch {}
  }
  out.value = line + '\n\n' + out.value;
}

// Accepts records that might have Period OR Year/Quarter; returns guaranteed fields.
function normalizeRecord(r) {
  const n = { ...r };
  // Prefer explicit Year/Quarter; otherwise derive from Period like "2025 Q1"
  if (n.Year == null || n.Quarter == null) {
    const p = (n.Period || '').toString().trim();
    if (p.includes(' ')) {
      const [y, q] = p.split(/\s+/, 2);
      const yNum = parseInt(y, 10);
      if (!isNaN(yNum)) n.Year = yNum;
      if (q) n.Quarter = q; // e.g., "Q1"
    }
  }
  // Build Period if missing but Year/Quarter exist
  if (!n.Period && (n.Year != null && n.Quarter)) {
    n.Period = `${n.Year} ${n.Quarter}`;
  }
  // Normalize name and department to strings
  if (n.Name) n.Name = String(n.Name);
  if (n.Department) n.Department = String(n.Department);
  return n;
}
function normalizeRecords(records) { return records.map(normalizeRecord); }

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
  const y = parseInt(year, 10);
  return targetsByPersonYear?.[name.trim()]?.[y] ?? null;
}

// ===== Load per-year Targets from People + Utilization Targets =====
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
      targetsByPersonYear[name][parseInt(year, 10)] = target ?? null;
    });

    log('Loaded targets (count persons)', Object.keys(targetsByPersonYear).length);
  } catch (e) {
    log('Error loading targets', String(e));
  }
}

// ===== Charts =====
function createBarChart(data) {
  const canvas = document.getElementById('utilizationChart');
  if (!canvas) { log('Canvas not found'); return; }
  const ctx = canvas.getContext('2d');
  if (chart) chart.destroy();

  const datasets = [
    { label: 'Billable %', data: data.map(d => d.billable), backgroundColor: '#4CAF50', order: 2 },
    { label: 'Non-Billable %', data: data.map(d => d.nonBillable), backgroundColor: '#FF9800', order: 2 },
  ];

  if (showTarget) {
    datasets.push({
      label: 'Target',
      data: data.map(d => d.target),
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
    data: { labels: data.map(d => d.name.trim()), datasets },
    options: {
      responsive: true, maintainAspectRatio: false,
      scales: { y: { beginAtZero: true, max: 100 }, x: {} },
      plugins: {
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${(c.parsed.y ?? 0).toFixed(1)}%` } },
        legend: { labels: { filter: (item) => !item.text.includes('Target') || item.text === 'Target' } }
      }
    }
  });
}

function createTrendChart(records) {
  const canvas = document.getElementById('utilizationChart');
  if (!canvas) { log('Canvas not found'); return; }
  const ctx = canvas.getContext('2d');
  if (chart) chart.destroy();

  const groupedByName = _.groupBy(records, r => r.Name.trim());
  const allPeriods = [...new Set(records.map(r => `${r.Year} ${r.Quarter}`))].sort();
  const datasets = [];

  Object.entries(groupedByName).forEach(([name, personRecords]) => {
    const sorted = _.sortBy(personRecords, [r => r.Year, r => (r.Quarter || '').replace('Q','')]);
    datasets.push({
      label: name,
      data: allPeriods.map(period => {
        const rec = sorted.find(r => `${r.Year} ${r.Quarter}` === period);
        return rec ? rec.Billable : null;
      }),
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
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${(c.parsed.y ?? 0).toFixed(1)}%` } },
        legend: { labels: { filter: (item) => !item.text.includes('Target') || item.text === 'Target' } }
      }
    }
  });
}

// ===== UI Wiring =====
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

  if (!yearFilter || !quarterFilter || !departmentFilter || !nameFilter) {
    log('Filter controls not found');
    return;
  }

  yearFilter.innerHTML = '<option value="all">All Years</option>';
  quarterFilter.innerHTML = '<option value="all">All Quarters</option>';
  departmentFilter.innerHTML = '<option value="all">All Departments</option>';
  nameFilter.innerHTML = '<option value="all">All Names</option>';

  years.forEach(year => yearFilter.add(new Option(year, year)));
  quarters.forEach(q => quarterFilter.add(new Option(q, q)));
  departments.forEach(dept => departmentFilter.add(new Option(dept, dept)));
  names.forEach(name => nameFilter.add(new Option(name, name)));

  yearFilter.value = currentFilters.year;
  quarterFilter.value = currentFilters.quarter;
  departmentFilter.value = currentFilters.department;
  nameFilter.value = currentFilters.name;
}

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
      billable: _.meanBy(group, r => r.Billable),
      nonBillable: _.meanBy(group, r => r.Non_Billable),
      target: selectedYear !== 'all' ? getTargetFor(name, selectedYear) : null
    }));
    createBarChart(processed);
  } else {
    createTrendChart(filtered);
  }

  log('Processed', { totalIn: recordsRaw.length, totalAfter: filtered.length, filters: currentFilters });
}

// ===== Grist Init & Listeners =====
grist.ready();

// Ensure baseline UI and debug tools exist (in case HTML was trimmed)
ensureDebugUI();

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
  const el = document.getElementById(id + 'Filter');
  el?.addEventListener('change', (e) => {
    currentFilters[id] = e.target.value;
    processData(currentRecords);
  });
});

// View buttons
document.getElementById('barView')?.addEventListener('click', () => {
  currentView = 'bar';
  document.getElementById('barView')?.classList.add('active');
  document.getElementById('trendView')?.classList.remove('active');
  processData(currentRecords);
});
document.getElementById('trendView')?.addEventListener('click', () => {
  currentView = 'trend';
  document.getElementById('trendView')?.classList.add('active');
  document.getElementById('barView')?.classList.remove('active');
  processData(currentRecords);
});

// Toggles
document.getElementById('showTarget')?.addEventListener('change', (e) => {
  showTarget = e.target.checked;
  processData(currentRecords);
});

// Records hook — THIS hydrates the data from Grist
grist.onRecords(async (records) => {
  ensureDebugUI();
  log('onRecords: received', { count: records?.length ?? 0 });

  await loadTargets();   // build per-person per-year map
  currentRecords = records || [];
  updateFilters(currentRecords);
  // By default, department dropdown disabled unless "custom" selected
  const departmentFilter = document.getElementById('departmentFilter');
  if (departmentFilter) departmentFilter.disabled = currentFilters.departmentType !== 'custom';
  processData(currentRecords);
});