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
  debugDiv.textContent =
    `${timestamp}: ${message}\n` +
    (data ? JSON.stringify(data, null, 2) : '');
}

function matchesDepartmentType(department, departmentType) {
  if (!department) return false;
  switch (departmentType) {
    case 'all':
      return true;
    case '3d':
      return department.toLowerCase().includes('3d');
    case 'design':
      return department.toLowerCase().includes('design');
    case 'custom':
      return (
        currentFilters.department === 'all' ||
        department === currentFilters.department
      );
    default:
      return true;
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

// ===== Charts =====
function createBarChart(data) {
  const ctx = document.getElementById('utilizationChart').getContext('2d');
  if (chart) chart.destroy();

  const datasets = [
    {
      label: 'Billable %',
      data: data.map((d) => d.billable),
      backgroundColor: '#4CAF50',
      order: 2,
    },
    {
      label: 'Non-Billable %',
      data: data.map((d) => d.nonBillable),
      backgroundColor: '#FF9800',
      order: 2,
    },
  ];

  if (showTarget) {
    datasets.push({
      label: 'Target',
      data: data.map((d) => d.target),
      type: 'line',
      borderColor: 'red',
      borderWidth: 2,
      borderDash: [5, 5],
      fill: false,
      pointRadius: 4,
      pointStyle: 'circle',
      order: 1,
    });
  }

  chart = new Chart(ctx, {
    type: 'bar',
    data: { labels: data.map((d) => d.name.trim()), datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: { beginAtZero: true, stacked: false, max: 100 },
        x: { stacked: false },
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: function (context) {
              const label = context.dataset.label || '';
              const value = context.parsed.y?.toFixed(1) || 0;
              return `${label}: ${value}%`;
            },
          },
        },
        legend: {
          labels: {
            filter: (item) =>
              !item.text.includes('Target') || item.text === 'Target',
          },
        },
      },
    },
  });
}

function createTrendChart(records) {
  const ctx = document.getElementById('utilizationChart').getContext('2d');
  if (chart) chart.destroy();

  const groupedByName = _.groupBy(records, (r) => r.Name.trim());
  const allPeriods = [...new Set(records.map((r) => `${r.Year} ${r.Quarter}`))].sort();
  const datasets = [];

  Object.entries(groupedByName).forEach(([name, personRecords]) => {
    const sortedRecords = _.sortBy(personRecords, [
      (r) => r.Year,
      (r) => r.Quarter.substring(1),
    ]);
    datasets.push({
      label: name,
      data: allPeriods.map((period) => {
        const rec = sortedRecords.find(
          (r) => `${r.Year} ${r.Quarter}` === period
        );
        return rec ? rec.Billable : null;
      }),
      borderColor: '#4CAF50',
      backgroundColor: 'rgba(76, 175, 80, 0.1)',
      tension: 0.1,
      fill: false,
    });

    if (showTarget) {
      datasets.push({
        label: `${name} Target`,
        data: allPeriods.map((period) => {
          const yearStr = period.split(' ')[0];
          return getTargetFor(name, yearStr);
        }),
        borderColor: 'red',
        borderWidth: 2,
        borderDash: [5, 5],
        fill: false,
        pointRadius: 0,
        hidden: false,
      });
    }
  });

  chart = new Chart(ctx, {
    type: 'line',
    data: { labels: allPeriods, datasets },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        y: {
          beginAtZero: true,
          max: 100,
          title: { display: true, text: 'Billable %' },
        },
        x: { title: { display: true, text: 'Time Period' } },
      },
      plugins: {
        tooltip: {
          callbacks: {
            label: function (context) {
              const label = context.dataset.label || '';
              const value = context.parsed.y?.toFixed(1) || 0;
              return `${label}: ${value}%`;
            },
          },
        },
        legend: {
          labels: {
            filter: (item) =>
              !item.text.includes('Target') || item.text === 'Target',
          },
        },
      },
    },
  });
}

// ===== UI Wiring =====
function updateFilters(records) {
  const years = [...new Set(records.map((r) => r.Year))].sort();
  const quarters = [...new Set(records.map((r) => r.Quarter))].sort();
  const departments = [...new Set(records.map((r) => r.Department))].sort();
  const names = [...new Set(records.map((r) => r.Name.trim()))].sort();

  const yearFilter = document.getElementById('yearFilter');
  const quarterFilter = document.getElementById('quarterFilter');
  const departmentFilter = document.getElementById('departmentFilter');
  const nameFilter = document.getElementById('nameFilter');

  yearFilter.innerHTML = '<option value="all">All Years</option>';
  quarterFilter.innerHTML = '<option value="all">All Quarters</option>';
  departmentFilter.innerHTML = '<option value="all">All Departments</option>';
  nameFilter.innerHTML = '<option value="all">All Names</option>';

  years.forEach((year) => yearFilter.add(new Option(year, year)));
  quarters.forEach((quarter) => quarterFilter.add(new Option(quarter, quarter)));
  departments.forEach((dept) => departmentFilter.add(new Option(dept, dept)));
  names.forEach((name) => nameFilter.add(new Option(name, name)));

  yearFilter.value = currentFilters.year;
  quarterFilter.value = currentFilters.quarter;
  departmentFilter.value = currentFilters.department;
  nameFilter.value = currentFilters.name;
}

function processData(records) {
  let filtered = records;

  if (currentFilters.year !== 'all') {
    filtered = filtered.filter((r) => r.Year === parseInt(currentFilters.year));
  }
  if (currentFilters.quarter !== 'all') {
    filtered = filtered.filter((r) => r.Quarter === currentFilters.quarter);
  }

  filtered = filtered.filter((r) =>
    matchesDepartmentType(r.Department, currentFilters.departmentType)
  );

  if (
    currentFilters.departmentType === 'custom' &&
    currentFilters.department !== 'all'
  ) {
    filtered = filtered.filter((r) => r.Department === currentFilters.department);
  }

  if (currentFilters.name !== 'all') {
    filtered = filtered.filter((r) => r.Name.trim() === currentFilters.name);
  }

  if (currentView === 'bar') {
    const selectedYear = currentFilters.year;
    const processed = _.map(
      _.groupBy(filtered, (r) => r.Name.trim()),
      (group, name) => ({
        name,
        department: group[0].Department,
        billable: _.meanBy(group, (r) => r.Billable),
        nonBillable: _.meanBy(group, (r) => r.Non_Billable),
        target: selectedYear !== 'all' ? getTargetFor(name, selectedYear) : null,
      })
    );
    createBarChart(processed);
  } else {
    createTrendChart(filtered);
  }

  log('Processed data', {
    originalRecords: records.length,
    filteredRecords: filtered.length,
    filters: currentFilters,
  });
}

// ===== Grist Init =====
grist.ready();

document
  .querySelectorAll('input[name="departmentType"]')
  .forEach((radio) => {
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

// Other filter listeners
['year', 'quarter', 'department', 'name'].forEach((filterId) => {
  document
    .getElementById(filterId + 'Filter')
    .addEventListener('change', (e) => {
      currentFilters[filterId] = e.target.value;
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

// Show target toggle
document.getElementById('showTarget').addEventListener('change', (e) => {
  showTarget = e.target.checked;
  processData(currentRecords);
});

// Show debug toggle
document.getElementById('toggleDebug').addEventListener('change', (e) => {
  const debugDiv = document.getElementById('debug');
  debugDiv.style.display = e.target.checked ? 'block' : 'none';
});

// Records hook
grist.onRecords(async (records) => {
  await loadTargets(); // build per-person per-year targets
  currentRecords = records;
  updateFilters(records);
  const departmentFilter = document.getElementById('departmentFilter');
  departmentFilter.disabled = true; // default since 'all' is selected
  processData(records);
});