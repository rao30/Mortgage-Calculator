const scenariosContainer = document.getElementById('scenarios');
const summaryTable = document.getElementById('summaryTable');
const scheduleTable = document.getElementById('scheduleTable');
const resultsSection = document.getElementById('results');
const emptyState = document.getElementById('emptyState');
const formError = document.getElementById('formError');
const scenarioTabs = document.getElementById('scenarioTabs');
const horizonTable = document.getElementById('horizonTable');
const horizonHeaderRow = document.getElementById('horizonTableHeaders');
const outlookChips = document.getElementById('outlookChips');
const outlookYearInput = document.getElementById('outlookYearInput');
const addOutlookButton = document.getElementById('addOutlook');
const purchasePriceInput = document.getElementById('purchasePrice');
const propertyValueInput = document.getElementById('propertyValue');
const closingCostInput = document.getElementById('closingCostValue');
const closingCostMode = document.getElementById('closingCostMode');
const closingCostPrefix = document.getElementById('closingCostPrefix');
const saveScenarioButton = document.getElementById('saveScenario');
const loadScenarioButton = document.getElementById('loadScenario');
const scenarioFileInput = document.getElementById('scenarioFileInput');
const closingCostToggleButtons = document.querySelectorAll('.closing-cost-toggle .toggle-option');
const propertyAppreciationInput = document.getElementById('annualAppreciation');
const rentIncreaseInput = document.getElementById('annualRentIncrease');
const expenseInflationInput = document.getElementById('annualExpenseInflation');
const resultsTabsNav = document.getElementById('resultsTabsNav');
const insightsPane = document.getElementById('insightsPane');
const amortizationPane = document.getElementById('amortizationPane');
const navToggle = document.getElementById('navToggle');
const loanAnalysisView = document.getElementById('loanAnalysisView');
const otherToolsView = document.getElementById('otherToolsView');
const drawerLinks = document.querySelectorAll('.drawer__link[data-view]');
const appBarTitle = document.querySelector('.app-bar__title');
const defaultOutlookYears = [1, 5];
let selectedOutlookYears = [...defaultOutlookYears];

const scenarioDefaults = {
  label: '',
  firstTerm: 30,
  firstRate: 6.25,
  firstPercent: 80,
  secondTerm: 15,
  secondRate: 8.5,
  secondPercent: 0,
};

const defaultScenarios = [
  {
    label: '15yr single note',
    firstTerm: 15,
    firstRate: 5.5,
    firstPercent: 80,
    secondTerm: null,
    secondRate: null,
    secondPercent: 0,
  },
  {
    label: '30yr single note',
    firstTerm: 30,
    firstRate: 6.5,
    firstPercent: 80,
    secondTerm: null,
    secondRate: null,
    secondPercent: 0,
  },
  {
    label: '5% down primary house hack',
    firstTerm: 30,
    firstRate: 6.5,
    firstPercent: 95,
    secondTerm: null,
    secondRate: null,
    secondPercent: 0,
  },
  {
    label: '50yr single note',
    firstTerm: 50,
    firstRate: 7.0,
    firstPercent: 80,
    secondTerm: null,
    secondRate: null,
    secondPercent: 0,
  },
  {
    label: '50/40/10 stacked',
    firstTerm: 30,
    firstRate: 7.5,
    firstPercent: 50,
    secondTerm: 30,
    secondRate: 3.0,
    secondPercent: 40,
  },

];

const defaultExpenses = {
  propertyTaxes: 8000,
  insurance: 2000,
  repairsPercent: 5,
  capexPercent: 5,
  vacancyPercent: 0,
  managementPercent: 5,
  electricity: 0,
  gas: 0,
  waterSewer: 0,
  hoaFees: 0,
  garbage: 0,
  otherExpenses: 0,
};

let mortgageData = null;
let balanceChart = null;
let compositionChart = null;
let activeScenarioIndex = 0;
let activeResultsTab = 'insights';

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

function updateClosingCostPrefix() {
  if (!closingCostPrefix || !closingCostMode) return;
  closingCostPrefix.textContent = closingCostMode.value === 'percent' ? '%' : '$';
}

function setClosingCostMode(mode) {
  if (!closingCostMode) return;
  const normalized = mode === 'fixed' ? 'fixed' : 'percent';
  closingCostMode.value = normalized;
  closingCostToggleButtons.forEach((button) => {
    const buttonMode = button.dataset.mode;
    button.classList.toggle('active', buttonMode === normalized);
  });
  updateClosingCostPrefix();
}

function escapeHtml(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatPercent(value, digits = 1) {
  if (value === null || value === undefined || Number.isNaN(value)) {
    return '—';
  }
  return `${Number(value).toFixed(digits)}%`;
}

function normalizeOutlookYears(years) {
  const inputs = Array.isArray(years) ? years : [];
  const normalized = Array.from(
    new Set(inputs.map((value) => Number(value)).filter((value) => Number.isFinite(value) && value > 0)),
  ).sort((a, b) => a - b);
  return normalized.length ? normalized : [...defaultOutlookYears];
}

function renderOutlookChips() {
  if (!outlookChips) return;
  outlookChips.innerHTML = selectedOutlookYears
    .map((year) => {
      return `
        <button type="button" class="outlook-chip" data-year="${year}" aria-label="Remove ${year}-year outlook">
          <span>${year}yr</span>
          <span class="remove-icon" aria-hidden="true">&times;</span>
        </button>
      `;
    })
    .join('');
}

function setSelectedOutlookYears(years) {
  selectedOutlookYears = normalizeOutlookYears(years);
  renderOutlookChips();
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

function createScenarioRow(config = {}) {
  const values = { ...scenarioDefaults, ...config };
  const row = document.createElement('div');
  row.className = 'scenario-row';
  row.innerHTML = `
    <div class="scenario-row__top">
      <label class="form-field scenario-row__label">
        <span class="form-label">Scenario label</span>
        <div class="scenario-row__label-input">
          <input
            type="text"
            class="text-input"
            data-field="label"
            placeholder="Scenario ${scenariosContainer.children.length + 1}"
          />
        </div>
      </label>
      <div class="scenario-row__actions">
        <button type="button" class="icon-button duplicate-scenario" aria-label="Duplicate scenario">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M16 1H4c-1.1 0-2 .9-2 2v14h2V3h12V1Zm3 4H8c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h11c1.1 0 2-.9 2-2V7c0-1.1-.9-2-2-2Zm0 16H8V7h11v14Z"
            />
          </svg>
        </button>
        <button type="button" class="icon-button danger remove-scenario" aria-label="Remove scenario">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path
              d="M9 3V4H4V6H5V20C5 21.105 5.895 22 7 22H17C18.105 22 19 21.105 19 20V6H20V4H15V3H9ZM7 6H17V20H7V6ZM9 8V18H11V8H9ZM13 8V18H15V8H13Z"
            />
          </svg>
        </button>
      </div>
    </div>
    <div class="scenario-row__grid">
      <label class="form-field">
        <span class="form-label">First lien % of value</span>
        <input type="number" data-field="firstPercent" min="1" max="100" step="1" required />
      </label>
      <label class="form-field">
        <span class="form-label">First term (years)</span>
        <input type="number" data-field="firstTerm" min="1" step="1" required />
      </label>
      <label class="form-field">
        <span class="form-label">First rate (%)</span>
        <input type="number" data-field="firstRate" min="0" step="0.01" required />
      </label>
    </div>
    <div class="scenario-row__grid">
      <label class="form-field">
        <span class="form-label">Second lien %</span>
        <input type="number" data-field="secondPercent" min="0" max="100" step="1" value="0" />
      </label>
      <label class="form-field">
        <span class="form-label">Second term (years)</span>
        <input type="number" data-field="secondTerm" min="1" step="1" />
      </label>
      <label class="form-field">
        <span class="form-label">Second rate (%)</span>
        <input type="number" data-field="secondRate" min="0" step="0.01" />
      </label>
    </div>
  `;
  scenariosContainer.appendChild(row);
  setScenarioRowValues(row, values);
}

function setScenarioRowValues(row, values) {
  row.querySelector('[data-field="label"]').value = values.label ?? '';
  row.querySelector('[data-field="firstPercent"]').value = Number.isFinite(values.firstPercent)
    ? values.firstPercent
    : scenarioDefaults.firstPercent;
  row.querySelector('[data-field="firstTerm"]').value = Number.isFinite(values.firstTerm)
    ? values.firstTerm
    : scenarioDefaults.firstTerm;
  row.querySelector('[data-field="firstRate"]').value = Number.isFinite(values.firstRate)
    ? values.firstRate
    : scenarioDefaults.firstRate;
  row.querySelector('[data-field="secondPercent"]').value = Number.isFinite(values.secondPercent)
    ? values.secondPercent
    : scenarioDefaults.secondPercent;
  row.querySelector('[data-field="secondTerm"]').value = Number.isFinite(values.secondTerm)
    ? values.secondTerm
    : '';
  row.querySelector('[data-field="secondRate"]').value = Number.isFinite(values.secondRate)
    ? values.secondRate
    : '';
}

function readScenarioConfig(row) {
  return {
    label: row.querySelector('[data-field="label"]').value.trim(),
    firstPercent: parseFloat(row.querySelector('[data-field="firstPercent"]').value),
    firstTerm: parseInt(row.querySelector('[data-field="firstTerm"]').value, 10),
    firstRate: parseFloat(row.querySelector('[data-field="firstRate"]').value),
    secondPercent: parseFloat(row.querySelector('[data-field="secondPercent"]').value) || 0,
    secondTerm: parseInt(row.querySelector('[data-field="secondTerm"]').value, 10),
    secondRate: parseFloat(row.querySelector('[data-field="secondRate"]').value),
  };
}

function readScenarios() {
  return Array.from(scenariosContainer.querySelectorAll('.scenario-row')).map((row, index) => {
    const config = readScenarioConfig(row);
    const label = config.label || `Scenario ${index + 1}`;
    const payload = {
      label,
      first_term_years: config.firstTerm,
      first_annual_interest_rate: config.firstRate,
      first_lien_percent: config.firstPercent,
      second_lien_percent: config.secondPercent,
      second_term_years: null,
      second_annual_interest_rate: null,
    };

    if (config.secondPercent > 0) {
      payload.second_term_years = Number.isFinite(config.secondTerm) ? config.secondTerm : null;
      payload.second_annual_interest_rate = Number.isFinite(config.secondRate)
        ? config.secondRate
        : null;
    }

    return payload;
  });
}

function readExpenseInputs() {
  const parseValue = (id) => {
    const input = document.getElementById(id);
    if (!input) return 0;
    const value = parseFloat(input.value);
    return Number.isFinite(value) ? value : 0;
  };

  return {
    property_taxes_annual: parseValue('propertyTaxes'),
    insurance_annual: parseValue('insurance'),
    repairs_percent: parseValue('repairsPercent'),
    capex_percent: parseValue('capexPercent'),
    vacancy_percent: parseValue('vacancyPercent'),
    management_percent: parseValue('managementPercent'),
    electricity_monthly: parseValue('electricity'),
    gas_monthly: parseValue('gas'),
    water_sewer_monthly: parseValue('waterSewer'),
    hoa_monthly: parseValue('hoaFees'),
    garbage_monthly: parseValue('garbage'),
    other_monthly: parseValue('otherExpenses'),
  };
}

function applyExpenseInputs(expenses = {}) {
  const mappings = {
    propertyTaxes: 'property_taxes_annual',
    insurance: 'insurance_annual',
    repairsPercent: 'repairs_percent',
    capexPercent: 'capex_percent',
    vacancyPercent: 'vacancy_percent',
    managementPercent: 'management_percent',
    electricity: 'electricity_monthly',
    gas: 'gas_monthly',
    waterSewer: 'water_sewer_monthly',
    hoaFees: 'hoa_monthly',
    garbage: 'garbage_monthly',
    otherExpenses: 'other_monthly',
  };

  Object.entries(mappings).forEach(([inputId, expenseKey]) => {
    const input = document.getElementById(inputId);
    if (input && expenseKey in expenses) {
      input.value = expenses[expenseKey];
    }
  });
}

function readPercentInput(input) {
  if (!input) return 0;
  const value = parseFloat(input.value);
  return Number.isFinite(value) ? value : 0;
}

function readFutureAssumptions() {
  return {
    annual_property_appreciation_percent: readPercentInput(propertyAppreciationInput),
    annual_rent_growth_percent: readPercentInput(rentIncreaseInput),
    annual_expense_inflation_percent: readPercentInput(expenseInflationInput),
  };
}

function applyFutureAssumptions(assumptions = {}) {
  const setInputValue = (input, value) => {
    if (!input) return;
    if (value === undefined || value === null) {
      input.value = '';
      return;
    }
    input.value = value;
  };

  setInputValue(propertyAppreciationInput, assumptions.annual_property_appreciation_percent);
  setInputValue(rentIncreaseInput, assumptions.annual_rent_growth_percent);
  setInputValue(expenseInflationInput, assumptions.annual_expense_inflation_percent);
}

function submitCalculatorForm() {
  if (!calculatorForm) return;
  if (typeof calculatorForm.requestSubmit === 'function') {
    calculatorForm.requestSubmit();
  } else {
    calculatorForm.dispatchEvent(new Event('submit', { cancelable: true }));
  }
}

const resultsPanes = {
  insights: insightsPane,
  amortization: amortizationPane,
};

function updateResultsTabUI() {
  if (resultsTabsNav) {
    resultsTabsNav.querySelectorAll('.results-tab').forEach((button) => {
      button.classList.toggle('active', button.dataset.tab === activeResultsTab);
    });
  }
  Object.entries(resultsPanes).forEach(([key, pane]) => {
    if (!pane) return;
    pane.classList.toggle('hidden', key !== activeResultsTab);
  });
}

function setResultsView(tab) {
  if (!resultsPanes[tab]) return;
  activeResultsTab = tab;
  updateResultsTabUI();
}

function buildScenarioSnapshot() {
  return {
    version: 1,
    generated_at: new Date().toISOString(),
    inputs: {
      purchase_price: purchasePriceInput ? Number(purchasePriceInput.value) : null,
      property_value: propertyValueInput ? Number(propertyValueInput.value) : null,
      closing_costs: {
        value: closingCostInput ? Number(closingCostInput.value) : null,
        mode: closingCostMode ? closingCostMode.value : 'percent',
      },
      monthly_rent: Number(document.getElementById('monthlyRent').value || 0),
      schedule_limit: document.getElementById('scheduleLimit').value
        ? Number(document.getElementById('scheduleLimit').value)
        : null,
      expenses: readExpenseInputs(),
      future_assumptions: readFutureAssumptions(),
    },
    scenarios: readScenarios(),
  };
}

function hydrateScenarios(scenarios) {
  scenariosContainer.innerHTML = '';
  if (!Array.isArray(scenarios) || scenarios.length === 0) {
    hydrateDefaultScenarios();
    return;
  }

  scenarios.forEach((scenario) => {
    const config = {
      label: scenario.label || '',
      firstTerm: scenario.first_term_years,
      firstRate: scenario.first_annual_interest_rate,
      firstPercent: scenario.first_lien_percent,
      secondTerm: scenario.second_term_years,
      secondRate: scenario.second_annual_interest_rate,
      secondPercent: scenario.second_lien_percent,
    };
    createScenarioRow(config);
  });
}

function loadScenarioSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') {
    throw new Error('Invalid scenario file.');
  }

  const { inputs = {}, scenarios } = snapshot;
  if (purchasePriceInput && inputs.purchase_price !== undefined) {
    purchasePriceInput.value = inputs.purchase_price;
  }
  if (propertyValueInput) {
    if (inputs.property_value !== undefined) {
      propertyValueInput.value = inputs.property_value;
    } else if (inputs.purchase_price !== undefined) {
      propertyValueInput.value = inputs.purchase_price;
    }
  }
  if (closingCostInput && inputs.closing_costs?.value !== undefined) {
    closingCostInput.value = inputs.closing_costs.value;
  }
  if (closingCostMode && inputs.closing_costs?.mode) {
    closingCostMode.value = inputs.closing_costs.mode;
    updateClosingCostPrefix();
  }
  const rentInput = document.getElementById('monthlyRent');
  if (rentInput && inputs.monthly_rent !== undefined) {
    rentInput.value = inputs.monthly_rent;
  }
  const scheduleInput = document.getElementById('scheduleLimit');
  if (scheduleInput && inputs.schedule_limit !== undefined && inputs.schedule_limit !== null) {
    scheduleInput.value = inputs.schedule_limit;
  } else if (scheduleInput) {
    scheduleInput.value = '';
  }
  if (inputs.expenses) {
    applyExpenseInputs(inputs.expenses);
  }
  if (inputs.future_assumptions) {
    applyFutureAssumptions(inputs.future_assumptions);
  }
  hydrateScenarios(scenarios);

  submitCalculatorForm();
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
    .map((scenario, index) => {
      const components = scenario.components ?? [];
      const breakdown = components
        .map(
          (component) => `
            <span>
              ${escapeHtml(component.label)}: ${formatPercent(component.share_percent, 0)}
              • ${component.term_years}yr @ ${component.annual_interest_rate.toFixed(2)}%
            </span>
          `,
        )
        .join('<br />');

      const selectedClass = index === activeScenarioIndex ? 'selected' : '';
      return `
        <tr class="${selectedClass}">
          <td class="structure-cell" data-label="Structure">
            <div class="structure-label">${escapeHtml(scenario.label)}</div>
            ${breakdown ? `<div class="structure-breakdown">${breakdown}</div>` : ''}
          </td>
          <td data-label="Monthly payment">${formatCurrency(scenario.monthly_payment)}</td>
          <td data-label="Cashflow" class="${scenario.monthly_cashflow >= 0 ? 'positive' : 'negative'}">
            ${formatSignedCurrency(scenario.monthly_cashflow)}
          </td>
          <td data-label="Cash to close">${
            Number.isFinite(scenario.cash_to_close)
              ? formatCurrency(scenario.cash_to_close)
              : '—'
          }</td>
          <td data-label="Cash-on-cash">${
            scenario.cash_on_cash_return !== null
              ? formatPercent(scenario.cash_on_cash_return * 100, 1)
              : '—'
          }</td>
          <td data-label="Total interest">${formatCurrency(scenario.total_interest)}</td>
        </tr>
      `;
    })
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
          ${escapeHtml(scenario.label)}
        </button>
      `,
    )
    .join('');

  const summaryRows = summaryTable?.querySelectorAll('tr');
  if (summaryRows) {
    summaryRows.forEach((row, index) => {
      if (index === activeScenarioIndex) {
        row.classList.add('selected');
      } else {
        row.classList.remove('selected');
      }
    });
  }
}

function buildScheduleTable(schedule) {
  scheduleTable.innerHTML = schedule
    .map(
      (payment) => `
        <tr>
          <td class="px-4 py-2" data-label="#">${payment.payment_number}</td>
          <td class="px-4 py-2" data-label="Payment">${formatCurrency(payment.payment)}</td>
          <td class="px-4 py-2" data-label="Principal">${formatCurrency(payment.principal)}</td>
          <td class="px-4 py-2" data-label="Interest">${formatCurrency(payment.interest)}</td>
          <td class="px-4 py-2" data-label="Balance">${formatCurrency(payment.balance)}</td>
        </tr>
      `,
    )
    .join('');
}

function buildHorizonTable(data, outlookYears) {
  if (!horizonTable) return;
  const headers =
    Array.isArray(outlookYears) && outlookYears.length ? outlookYears : defaultOutlookYears;

  if (horizonHeaderRow) {
    const columnHeaders = headers
      .map((year) => `<th>${year}-yr outlook</th>`)
      .join('');
    horizonHeaderRow.innerHTML = `<th>Scenario</th>${columnHeaders}`;
  }

  horizonTable.innerHTML = data.scenarios
    .map((scenario) => {
      const components = scenario.components ?? [];
      const breakdown = components
        .map(
          (component) => `
            <span>
              ${escapeHtml(component.label)}: ${formatPercent(component.share_percent, 0)}
              • ${component.term_years}yr @ ${component.annual_interest_rate.toFixed(2)}%
            </span>
          `,
        )
        .join('<br />');
      const lookups = new Map(
        (scenario.horizon_outlooks ?? []).map((outlook) => [outlook.horizon_years, outlook]),
      );
      const renderCell = (cash, loanPayoff, equity, downPayment) => {
        const cashClass = cash >= 0 ? 'positive' : 'negative';
        const totalReturn = cash + equity;
        return `
          <div class="horizon-block">
            <span class="label">Cashflow</span>
            <span class="value ${cashClass}">${formatSignedCurrency(cash)}</span>
            <span class="label">Loan payoff</span>
            <span class="value positive">${formatCurrency(loanPayoff)}</span>
            <span class="label">Equity</span>
            <span class="value">${formatCurrency(equity)}</span>
            <span class="label">Down payment</span>
            <span class="value">${formatCurrency(downPayment)}</span>
            <span class="label">Total return</span>
            <span class="value total">${formatCurrency(totalReturn)}</span>
          </div>
        `;
      };

      const cells = headers
        .map((year) => {
          const outlook = lookups.get(year);
          if (!outlook) {
            return `<td data-label="${year}-yr outlook">—</td>`;
          }
          return `<td data-label="${year}-yr outlook">${renderCell(
            outlook.cashflow,
            outlook.loan_payoff,
            outlook.equity,
            scenario.down_payment_amount,
          )}</td>`;
        })
        .join('');

      return `
        <tr>
          <td>
            <div class="structure-label">${escapeHtml(scenario.label)}</div>
            ${breakdown ? `<div class="structure-breakdown">${breakdown}</div>` : ''}
          </td>
          ${cells}
        </tr>
      `;
    })
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

  const summaryRows = summaryTable?.querySelectorAll('tr');
  if (summaryRows) {
    summaryRows.forEach((row, rowIndex) => {
      if (rowIndex === index) {
        row.classList.add('selected');
      } else {
        row.classList.remove('selected');
      }
    });
  }
}

function renderResults(data) {
  mortgageData = data;
  activeScenarioIndex = 0;
  buildSummaryTable(data);
  buildScenarioTabs(data);
  buildHorizonTable(data, selectedOutlookYears);
  updateScenarioDetails(activeScenarioIndex);
  updateResultsTabUI();
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

if (outlookChips) {
  outlookChips.addEventListener('click', (event) => {
    const chip = event.target.closest('.outlook-chip');
    if (!chip) return;
    const year = Number(chip.dataset.year);
    if (!year) {
      return;
    }
    if (selectedOutlookYears.length <= 1) {
      return;
    }
    const nextYears = selectedOutlookYears.filter((value) => value !== year);
    if (nextYears.length === selectedOutlookYears.length) {
      return;
    }
    setSelectedOutlookYears(nextYears);
    submitCalculatorForm();
  });
}

if (addOutlookButton) {
  addOutlookButton.addEventListener('click', () => {
    if (!outlookYearInput) return;
    const year = parseInt(outlookYearInput.value, 10);
    outlookYearInput.value = '';
    if (!Number.isFinite(year) || year <= 0) {
      return;
    }
    if (selectedOutlookYears.includes(year)) {
      return;
    }
    setSelectedOutlookYears([...selectedOutlookYears, year]);
    submitCalculatorForm();
  });
}

if (outlookYearInput) {
  outlookYearInput.addEventListener('keydown', (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      addOutlookButton?.click();
    }
  });
}

scenariosContainer.addEventListener('click', (event) => {
  const removeButton = event.target.closest('.remove-scenario');
  if (removeButton) {
    removeButton.closest('.scenario-row').remove();
    if (scenariosContainer.children.length === 0) {
      createScenarioRow();
    }
    return;
  }

  const duplicateButton = event.target.closest('.duplicate-scenario');
  if (duplicateButton) {
    const sourceRow = duplicateButton.closest('.scenario-row');
    if (!sourceRow) return;
    const config = readScenarioConfig(sourceRow);
    if (config.label) {
      config.label = `${config.label} copy`;
    }
    createScenarioRow(config);
  }
});

if (resultsTabsNav) {
  resultsTabsNav.addEventListener('click', (event) => {
    const button = event.target.closest('.results-tab');
    if (!button) return;
    setResultsView(button.dataset.tab);
  });
}

function hydrateDefaultScenarios() {
  scenariosContainer.innerHTML = '';
  defaultScenarios.forEach((scenario) => {
    createScenarioRow(scenario);
  });
}

hydrateDefaultScenarios();
if (purchasePriceInput) {
  purchasePriceInput.value = 500000;
}
if (propertyValueInput) {
  propertyValueInput.value = 500000;
}
if (closingCostInput) {
  closingCostInput.value = 3;
}
closingCostToggleButtons.forEach((button) => {
  button.addEventListener('click', () => {
    const mode = button.dataset.mode;
    if (!mode) return;
    setClosingCostMode(mode);
  });
});

if (closingCostMode) {
  setClosingCostMode('percent');
}
[
  'propertyTaxes',
  'insurance',
  'repairsPercent',
  'capexPercent',
  'vacancyPercent',
  'managementPercent',
  'electricity',
  'gas',
  'waterSewer',
  'hoaFees',
  'garbage',
  'otherExpenses',
].forEach((id) => {
  const input = document.getElementById(id);
  if (input) {
    const defaultValue = defaultExpenses[id];
    input.value = defaultValue !== undefined ? defaultValue : 0;
  }
});
document.getElementById('monthlyRent').value = 5700;
if (propertyAppreciationInput) {
  propertyAppreciationInput.value = 0;
}
if (rentIncreaseInput) {
  rentIncreaseInput.value = 0;
}
if (expenseInflationInput) {
  expenseInflationInput.value = 0;
}

document.getElementById('addScenario').addEventListener('click', () => {
  createScenarioRow();
});

updateResultsTabUI();

if (saveScenarioButton) {
  saveScenarioButton.addEventListener('click', () => {
    try {
      const snapshot = buildScenarioSnapshot();
      const serialized = JSON.stringify(snapshot, null, 2);
      const blob = new Blob([serialized], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `scenario-${new Date().toISOString().replace(/[:.]/g, '-')}.json`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error(error);
      showError('Unable to save scenario.');
    }
  });
}

if (loadScenarioButton && scenarioFileInput) {
  loadScenarioButton.addEventListener('click', () => {
    scenarioFileInput.value = '';
    scenarioFileInput.click();
  });

  scenarioFileInput.addEventListener('change', (event) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    const reader = new FileReader();
    reader.onload = (loadEvent) => {
      try {
        const text = loadEvent.target?.result;
        const snapshot = JSON.parse(text);
        loadScenarioSnapshot(snapshot);
        showError('');
      } catch (error) {
        console.error(error);
        showError('Unable to load scenario file.');
      }
    };
    reader.onerror = () => {
      showError('Unable to read scenario file.');
    };
    reader.readAsText(file);
  });
}

if (navToggle) {
  navToggle.addEventListener('click', () => {
    const drawerOpen = document.body.classList.toggle('drawer-open');
    navToggle.setAttribute('aria-expanded', drawerOpen ? 'true' : 'false');
  });
}

const viewTargets = {
  loan: loanAnalysisView,
  other: otherToolsView,
};

function setAppView(viewKey) {
  Object.entries(viewTargets).forEach(([key, element]) => {
    if (!element) return;
    element.classList.toggle('hidden', key !== viewKey);
  });
  drawerLinks.forEach((link) => {
    const isActive = link.dataset.view === viewKey;
    link.classList.toggle('active', isActive);
    if (isActive && appBarTitle) {
      appBarTitle.textContent = link.textContent.trim();
    }
  });
}

drawerLinks.forEach((link) => {
  link.addEventListener('click', () => {
    const viewKey = link.dataset.view;
    if (!viewKey) return;
    setAppView(viewKey);
    if (document.body.classList.contains('drawer-open')) {
      document.body.classList.remove('drawer-open');
      navToggle?.setAttribute('aria-expanded', 'false');
    }
  });
});

setSelectedOutlookYears(selectedOutlookYears);
setAppView('loan');

const calculatorForm = document.getElementById('calculatorForm');
calculatorForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  showError('');

  const submitButton = calculatorForm.querySelector('button[type="submit"]');
  submitButton.disabled = true;
  submitButton.textContent = 'Generating...';

  try {
    const purchasePrice =
      purchasePriceInput && purchasePriceInput.value ? parseFloat(purchasePriceInput.value) : 0;
    const propertyValue =
      propertyValueInput && propertyValueInput.value
        ? parseFloat(propertyValueInput.value)
        : purchasePrice;
    const closingCostValue =
      closingCostInput && closingCostInput.value ? parseFloat(closingCostInput.value) : 0;
    const closingCostModeValue = closingCostMode ? closingCostMode.value : 'percent';
    const monthlyRentInput = document.getElementById('monthlyRent').value;
    const monthlyRent = monthlyRentInput ? parseFloat(monthlyRentInput) : 0;
    const scheduleLimitInput = document.getElementById('scheduleLimit').value;
    const scheduleLimit = scheduleLimitInput ? parseInt(scheduleLimitInput, 10) : null;
    const scenarios = readScenarios();

    if (!Number.isFinite(purchasePrice) || purchasePrice <= 0) {
      throw new Error('Purchase price must be a positive number.');
    }
    if (!Number.isFinite(propertyValue) || propertyValue <= 0) {
      throw new Error('Property value must be a positive number.');
    }

    if (!Number.isFinite(closingCostValue) || closingCostValue < 0) {
      throw new Error('Closing costs must be zero or greater.');
    }

    if (
      scenarios.some(
        (scenario) =>
          !Number.isFinite(scenario.first_term_years) || scenario.first_term_years <= 0,
      )
    ) {
      throw new Error('Each scenario needs a positive first-lien term in years.');
    }

    if (
      scenarios.some(
        (scenario) =>
          !Number.isFinite(scenario.first_annual_interest_rate) ||
          scenario.first_annual_interest_rate < 0,
      )
    ) {
      throw new Error('First-lien interest rates must be zero or greater.');
    }

    if (
      scenarios.some(
        (scenario) =>
          scenario.second_lien_percent > 0 &&
          (!Number.isFinite(scenario.second_term_years) || scenario.second_term_years <= 0),
      )
    ) {
      throw new Error('Second-lien scenarios need a positive term in years.');
    }

    if (
      scenarios.some(
        (scenario) =>
          scenario.second_lien_percent > 0 &&
          (!Number.isFinite(scenario.second_annual_interest_rate) ||
            scenario.second_annual_interest_rate < 0),
      )
    ) {
      throw new Error('Second-lien interest rates must be zero or greater.');
    }

    const response = await fetch('/api/calculate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        purchase_price: purchasePrice,
        property_value: propertyValue,
        closing_costs_value: closingCostValue,
        closing_costs_mode: closingCostModeValue,
        monthly_rent: monthlyRent,
        schedule_limit: scheduleLimit,
        expenses: readExpenseInputs(),
        future_assumptions: readFutureAssumptions(),
        outlook_years: selectedOutlookYears,
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

submitCalculatorForm();
