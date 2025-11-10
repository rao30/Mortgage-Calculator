const scenariosContainer = document.getElementById('scenarios');
const summaryTable = document.getElementById('summaryTable');
const summaryCards = document.getElementById('summaryCards');
const scenarioSelect = document.getElementById('scenarioSelect');
const scheduleTable = document.getElementById('scheduleTable');
const resultsSection = document.getElementById('results');
const emptyState = document.getElementById('emptyState');
const formError = document.getElementById('formError');

const defaultScenarios = [
  { term_years: 15, annual_interest_rate: 5.5 },
  { term_years: 30, annual_interest_rate: 6.25 },
  { term_years: 50, annual_interest_rate: 7 },
];

let mortgageData = null;
let balanceChart = null;
let compositionChart = null;

const currencyFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
});

function formatCurrency(value) {
  return currencyFormatter.format(value);
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

function buildSummaryCards(data) {
  const sortedByPayment = [...data.scenarios].sort(
    (a, b) => a.monthly_payment - b.monthly_payment,
  );
  const sortedByInterest = [...data.scenarios].sort(
    (a, b) => b.total_interest - a.total_interest,
  );
  const sortedByTerm = [...data.scenarios].sort((a, b) => a.term_years - b.term_years);

  const cards = [
    {
      title: 'Lowest monthly payment',
      highlight: formatCurrency(sortedByPayment[0].monthly_payment),
      helper: `${sortedByPayment[0].term_years}-year @ ${sortedByPayment[0].annual_interest_rate.toFixed(
        2,
      )}%`,
    },
    {
      title: 'Highest lifetime interest',
      highlight: formatCurrency(sortedByInterest[0].total_interest),
      helper: `${sortedByInterest[0].term_years}-year @ ${sortedByInterest[0].annual_interest_rate.toFixed(
        2,
      )}%`,
    },
    {
      title: 'Fastest payoff horizon',
      highlight: `${sortedByTerm[0].term_years} years`,
      helper: `${sortedByTerm[0].annual_interest_rate.toFixed(2)}% interest rate`,
    },
  ];

  summaryCards.innerHTML = cards
    .map(
      (card) => `
        <article class="card">
          <h3 class="text-sm uppercase tracking-wide text-slate-400">${card.title}</h3>
          <p class="text-3xl font-semibold">${card.highlight}</p>
          <p class="text-sm text-slate-400">${card.helper}</p>
        </article>
      `,
    )
    .join('');
}

function buildSummaryTable(data) {
  summaryTable.innerHTML = data.scenarios
    .map(
      (scenario) => `
        <tr>
          <td class="px-4 py-3 font-medium text-slate-200">${scenario.term_years}</td>
          <td class="px-4 py-3">${scenario.annual_interest_rate.toFixed(2)}%</td>
          <td class="px-4 py-3">${formatCurrency(scenario.monthly_payment)}</td>
          <td class="px-4 py-3">${formatCurrency(scenario.total_interest)}</td>
        </tr>
      `,
    )
    .join('');
}

function buildScenarioSelect(data) {
  scenarioSelect.innerHTML = data.scenarios
    .map(
      (scenario, index) => `
        <option value="${index}">${scenario.term_years}-year @ ${scenario.annual_interest_rate.toFixed(
          2,
        )}%</option>
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
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
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
  });
}

function updateCompositionChart(schedule) {
  const ctx = document.getElementById('compositionChart').getContext('2d');
  const sample = schedule.slice(0, Math.min(schedule.length, 240));
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
          ticks: { color: 'rgba(148, 163, 184, 0.9)' },
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
  buildSummaryCards(data);
  buildSummaryTable(data);
  buildScenarioSelect(data);
  updateScenarioDetails(0);
  resultsSection.classList.remove('hidden');
  emptyState.classList.add('hidden');
}

function handleScenarioSelection(event) {
  const index = Number(event.target.value);
  updateScenarioDetails(index);
}

scenarioSelect.addEventListener('change', handleScenarioSelection);

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
document.getElementById('loanAmount').value = 350000;

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
    const scheduleLimitInput = document.getElementById('scheduleLimit').value;
    const scheduleLimit = scheduleLimitInput ? parseInt(scheduleLimitInput, 10) : null;
    const scenarios = readScenarios();

    if (!Number.isFinite(loanAmount) || loanAmount <= 0) {
      throw new Error('Please enter a valid loan amount.');
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
      body: JSON.stringify({ loan_amount: loanAmount, schedule_limit: scheduleLimit, scenarios }),
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
