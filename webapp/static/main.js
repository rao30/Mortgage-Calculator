const scenariosContainer = document.getElementById('scenarios');
const summaryTable = document.getElementById('summaryTable');
const scheduleTable = document.getElementById('scheduleTable');
const resultsSection = document.getElementById('results');
const emptyState = document.getElementById('emptyState');
const formError = document.getElementById('formError');
const scenarioTabs = document.getElementById('scenarioTabs');
const horizonTable = document.getElementById('horizonTable');

const defaultScenarios = [
  { term_years: 15, annual_interest_rate: 5.5 },
  { term_years: 30, annual_interest_rate: 6.25 },
  { term_years: 50, annual_interest_rate: 7 },
];

let mortgageData = null;
let balanceChart = null;
let compositionChart = null;
let activeScenarioIndex = 0;

const hoverAxisPlugin = {
  id: 'hoverAxis',
  afterDraw(chart) {
    const tooltip = chart.tooltip;
    if (!tooltip || tooltip.opacity === 0 || !tooltip.dataPoints?.length) {
      return;
    }

    const { ctx, chartArea } = chart;
    const x = tooltip.dataPoints[0].element.x;
    const y = tooltip.dataPoints[0].element.y;
    ctx.save();
    ctx.beginPath();
    ctx.moveTo(x, chartArea.top);
    ctx.lineTo(x, chartArea.bottom);
    ctx.moveTo(chartArea.left, y);
    ctx.lineTo(chartArea.right, y);
    ctx.lineWidth = 1;
    ctx.strokeStyle = 'rgba(226, 232, 240, 0.35)';
    ctx.stroke();
    ctx.restore();
  },
};

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function formatCurrency(value) {
  return currencyFormatter.format(value);
}

function formatSignedCurrency(value) {
  const formatted = currencyFormatter.format(Math.abs(value));
  return value >= 0 ? `+${formatted}` : `-${formatted}`;
}

function sampleSchedule(schedule, maxPoints = 720) {
  if (schedule.length <= maxPoints) {
    return schedule;
  }
  const step = Math.ceil(schedule.length / maxPoints);
  const sampled = [];
  for (let i = 0; i < schedule.length; i += step) {
    sampled.push(schedule[i]);
  }
  if (sampled[sampled.length - 1] !== schedule[schedule.length - 1]) {
    sampled.push(schedule[schedule.length - 1]);
  }
  return sampled;
}

function createScenarioRow(termYears = '', rate = '') {
  const row = document.createElement('div');
  row.className = 'scenario-row';
  row.innerHTML = `
    <label class="flex flex-col gap-2">
      <span class="text-xs uppercase tracking-wide text-slate-400">Term (years)</span>
      <input type="number" min="1" step="1" value="${termYears}" required />
    </label>
    <label class="flex flex-col gap-2">
      <span class="text-xs uppercase tracking-wide text-slate-400">Rate (%)</span>
      <input type="number" min="0" step="0.01" value="${rate}" required />
    </label>
    <button type="button" class="btn ghost remove-scenario">Remove</button>
  `;
  scenariosContainer.appendChild(row);
}

function readScenarios() {
  return Array.from(scenariosContainer.querySelectorAll('.scenario-row')).map((row) => {
    const [termInput, rateInput] = row.querySelectorAll('input');
    return {
      term_years: parseInt(termInput.value, 10),
      annual_interest_rate: parseFloat(rateInput.value),
    };
  });
}

function showError(message) {
  if (!message) {
    formError.classList.add('hidden');
    formError.textContent = '';
    return;
  }
  formError.textContent = message;
  formError.classList.remove('hidden');
}

function buildSummaryTable(data) {
  summaryTable.innerHTML = data.scenarios
    .map(
      (scenario) => `
        <tr>
          <td>${scenario.term_years} yrs</td>
          <td>${scenario.annual_interest_rate.toFixed(2)}%</td>
          <td>${formatCurrency(scenario.monthly_payment)}</td>
          <td class="${scenario.monthly_cashflow >= 0 ? 'positive' : 'negative'}">
            ${formatSignedCurrency(scenario.monthly_cashflow)}
          </td>
          <td>${formatCurrency(scenario.year_one_equity)}</td>
          <td>${formatCurrency(scenario.five_year_equity)}</td>
          <td>${formatCurrency(scenario.total_interest)}</td>
        </tr>
      `,
    )
    .join('');
}

function buildScenarioTabs(data) {
  if (!scenarioTabs) return;
  scenarioTabs.innerHTML = data.scenarios
    .map(
      (scenario, index) => `
        <button type="button" class="scenario-tab ${
          index === activeScenarioIndex ? 'active' : ''
        }" data-index="${index}">
          ${scenario.term_years}yr <span class="rate">${scenario.annual_interest_rate.toFixed(2)}%</span>
        </button>
      `,
    )
    .join('');
}

function buildScheduleTable(schedule) {
  scheduleTable.innerHTML = schedule
    .map(
      (payment) => `
        <tr>
          <td class="px-4 py-2">${payment.payment_number}</td>
          <td class="px-4 py-2">${formatCurrency(payment.payment)}</td>
          <td class="px-4 py-2">${formatCurrency(payment.principal)}</td>
          <td class="px-4 py-2">${formatCurrency(payment.interest)}</td>
          <td class="px-4 py-2">${formatCurrency(payment.balance)}</td>
        </tr>
      `,
    )
    .join('');
}

function buildHorizonTable(data) {
  if (!horizonTable) return;
  horizonTable.innerHTML = data.scenarios
    .map(
      (scenario) => {
        const renderCell = (cash, equity) => {
          const total = cash + equity;
          const cashClass = cash >= 0 ? 'positive' : 'negative';
          return `
            <div class="horizon-block">
              <span class="label">Cash</span>
              <span class="value ${cashClass}">${formatSignedCurrency(cash)}</span>
              <span class="label">Equity</span>
              <span class="value">${formatCurrency(equity)}</span>
              <span class="label">Total</span>
              <span class="value total">${formatCurrency(total)}</span>
            </div>
          `;
        };

        return `
        <tr>
          <td>${scenario.term_years} yrs @ ${scenario.annual_interest_rate.toFixed(2)}%</td>
          <td>${renderCell(scenario.cashflow_five_year, scenario.five_year_equity)}</td>
          <td>${renderCell(scenario.cashflow_ten_year, scenario.ten_year_equity)}</td>
          <td>${renderCell(scenario.cashflow_fifteen_year, scenario.fifteen_year_equity)}</td>
        </tr>
      `;
      },
    )
    .join('');
}


function updateBalanceChart(schedule) {
  const ctx = document.getElementById('balanceChart').getContext('2d');
  const labels = schedule.map((p) => p.payment_number);
  const balances = schedule.map((p) => p.balance);

  if (balanceChart) {
    balanceChart.destroy();
  }

  balanceChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Remaining balance',
          data: balances,
          tension: 0.35,
          fill: {
            target: 'origin',
            above: 'rgba(56, 189, 248, 0.2)',
          },
          borderColor: 'rgb(56, 189, 248)',
          pointRadius: 0,
          pointHoverRadius: 4,
          pointHoverBackgroundColor: 'rgb(56, 189, 248)',
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: (context) => `Remaining balance: ${formatCurrency(context.parsed.y)}`,
          },
        },
      },
      scales: {
        x: {
          ticks: { color: 'rgba(148, 163, 184, 0.9)' },
          grid: { color: 'rgba(148, 163, 184, 0.08)' },
        },
        y: {
          ticks: { color: 'rgba(148, 163, 184, 0.9)', callback: (value) => formatCurrency(value) },
          grid: { color: 'rgba(148, 163, 184, 0.08)' },
        },
      },
    },
    plugins: [hoverAxisPlugin],
  });
}

function updateCompositionChart(schedule) {
  const ctx = document.getElementById('compositionChart').getContext('2d');
  const sample = sampleSchedule(schedule);
  const labels = sample.map((p) => p.payment_number);
  const principal = sample.map((p) => p.principal);
  const interest = sample.map((p) => p.interest);

  if (compositionChart) {
    compositionChart.destroy();
  }

  compositionChart = new Chart(ctx, {
    type: 'line',
    data: {
      labels,
      datasets: [
        {
          label: 'Principal',
          data: principal,
          borderColor: 'rgb(94, 234, 212)',
          backgroundColor: 'rgba(94, 234, 212, 0.25)',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        },
        {
          label: 'Interest',
          data: interest,
          borderColor: 'rgb(248, 113, 113)',
          backgroundColor: 'rgba(248, 113, 113, 0.2)',
          fill: true,
          tension: 0.35,
          pointRadius: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { intersect: false, mode: 'index' },
      scales: {
        x: {
          ticks: {
            color: 'rgba(148, 163, 184, 0.9)',
            callback: (value, index) => (index % 4 === 0 ? value : ''),
          },
          grid: { color: 'rgba(148, 163, 184, 0.08)' },
        },
        y: {
          ticks: { color: 'rgba(148, 163, 184, 0.9)', callback: (value) => formatCurrency(value) },
          grid: { color: 'rgba(148, 163, 184, 0.08)' },
        },
      },
      plugins: {
        legend: {
          labels: { color: 'rgba(148, 163, 184, 0.9)' },
        },
        tooltip: {
          callbacks: {
            label: (context) => `${context.dataset.label}: ${formatCurrency(context.parsed.y)}`,
          },
        },
      },
    },
    plugins: [hoverAxisPlugin],
  });
}

function updateScenarioDetails(index) {
  if (!mortgageData) return;
  const scenario = mortgageData.scenarios[index];
  if (!scenario) return;
  buildScheduleTable(scenario.schedule);
  updateBalanceChart(scenario.schedule);
  updateCompositionChart(scenario.schedule);
}

function renderResults(data) {
  mortgageData = data;
  activeScenarioIndex = 0;
  buildSummaryTable(data);
  buildScenarioTabs(data);
  buildHorizonTable(data);
  updateScenarioDetails(activeScenarioIndex);
  resultsSection.classList.remove('hidden');
  if (emptyState) {
    emptyState.classList.add('hidden');
  }
}

if (scenarioTabs) {
  scenarioTabs.addEventListener('click', (event) => {
    const tab = event.target.closest('.scenario-tab');
    if (!tab || !mortgageData) return;
    activeScenarioIndex = Number(tab.dataset.index);
    buildScenarioTabs(mortgageData);
    updateScenarioDetails(activeScenarioIndex);
  });
}

scenariosContainer.addEventListener('click', (event) => {
  if (event.target.classList.contains('remove-scenario')) {
    event.target.closest('.scenario-row').remove();
    if (scenariosContainer.children.length === 0) {
      createScenarioRow();
    }
  }
});

function hydrateDefaultScenarios() {
  scenariosContainer.innerHTML = '';
  defaultScenarios.forEach((scenario) => {
    createScenarioRow(scenario.term_years, scenario.annual_interest_rate);
  });
}

hydrateDefaultScenarios();
document.getElementById('loanAmount').value = 450000;
document.getElementById('propertyValue').value = 525000;
document.getElementById('monthlyRent').value = 4200;
document.getElementById('operatingCosts').value = 950;

document.getElementById('addScenario').addEventListener('click', () => {
  createScenarioRow();
});

const calculatorForm = document.getElementById('calculatorForm');
calculatorForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');

  const submitButton = calculatorForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Generating...';

  try {
    const loanAmount = parseFloat(document.getElementById('loanAmount').value);
    const propertyValueInput = document.getElementById('propertyValue').value;
    const propertyValue = propertyValueInput ? parseFloat(propertyValueInput) : null;
    const scheduleLimitInput = document.getElementById('scheduleLimit').value;
    const scheduleLimit = scheduleLimitInput ? parseInt(scheduleLimitInput, 10) : null;
    const monthlyRentInput = document.getElementById('monthlyRent').value;
    const monthlyRent = monthlyRentInput ? parseFloat(monthlyRentInput) : 0;
    const operatingCostsInput = document.getElementById('operatingCosts').value;
    const operatingCosts = operatingCostsInput ? parseFloat(operatingCostsInput) : 0;
    const scenarios = readScenarios();

    if (!Number.isFinite(loanAmount) || loanAmount <= 0) {
      throw new Error('Please enter a valid loan amount.');
    }

    if (propertyValue !== null && (!Number.isFinite(propertyValue) || propertyValue <= 0)) {
      throw new Error('Property value must be a positive number.');
    }

    if (scenarios.some((scenario) => !Number.isFinite(scenario.term_years) || scenario.term_years <= 0)) {
      throw new Error('Each scenario needs a positive term in years.');
    }

    if (
      scenarios.some(
        (scenario) =>
          !Number.isFinite(scenario.annual_interest_rate) || scenario.annual_interest_rate < 0,
      )
    ) {
      throw new Error('Interest rates must be zero or greater.');
    }

    const response = await fetch('/api/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        loan_amount: loanAmount,
        property_value: propertyValue,
        monthly_rent: monthlyRent,
        monthly_operating_costs: operatingCosts,
        schedule_limit: scheduleLimit,
        scenarios,
      }),
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      const message = payload?.detail || 'Unable to calculate mortgage results.';
      throw new Error(message);
    }

    const data = await response.json();
    renderResults(data);
  } catch (error) {
    console.error(error);
    showError(error.message);
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = 'Generate insights';
  }
});
