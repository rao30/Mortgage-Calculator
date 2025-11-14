import math

import pytest

from webapp import app
from webapp.app import (
    ExpenseInputs,
    ScenarioInput,
    CalculationRequest,
    _equity_built,
    _merge_component_schedules,
    _net_cashflow,
    calculate_mortgage,
)
from webapp.mortgage_calculator import (
    MortgageScenario,
    calculate_monthly_payment,
    generate_amortization_schedule,
    summarize_scenarios,
    total_interest,
)


def test_calculate_monthly_payment_zero_interest():
    scenario = MortgageScenario(term_years=30, annual_interest_rate=0)
    payment = calculate_monthly_payment(120_000, scenario)
    assert math.isclose(payment, 120000 / (30 * 12), rel_tol=0, abs_tol=1e-9)


def test_generate_schedule_sums_to_loan():
    scenario = MortgageScenario(term_years=15, annual_interest_rate=5)
    loan_amount = 250_000
    schedule = generate_amortization_schedule(loan_amount, scenario)
    assert schedule[-1].balance == pytest.approx(0, abs=1e-6)
    total_principal = sum(payment.principal for payment in schedule)
    assert total_principal == pytest.approx(loan_amount, rel=1e-6)
    assert total_interest(schedule) == pytest.approx(
        sum(payment.interest for payment in schedule)
    )


def test_summarize_scenarios_includes_all_inputs():
    scenarios = [
        MortgageScenario(term_years=10, annual_interest_rate=4.5),
        MortgageScenario(term_years=30, annual_interest_rate=6.25),
    ]
    summary = summarize_scenarios(100_000, scenarios)
    assert len(summary) == len(scenarios)
    for (scenario, payment, interest), original in zip(summary, scenarios):
        assert scenario == original
        assert payment > 0
        assert interest > 0


def test_equity_and_cashflow_helpers():
    scenario = MortgageScenario(term_years=5, annual_interest_rate=4)
    schedule = generate_amortization_schedule(50_000, scenario)
    first_year_equity = _equity_built(schedule, 12)
    assert first_year_equity > 0
    # cashflow limited to schedule length
    cashflow = _net_cashflow(schedule, monthly_rent=2000, monthly_costs=500, months=999)
    cashflow_direct = sum(2000 - 500 - payment.payment for payment in schedule)
    assert cashflow == pytest.approx(cashflow_direct)


def test_merge_component_schedules_combines_series():
    base = MortgageScenario(term_years=5, annual_interest_rate=4)
    schedule_a = generate_amortization_schedule(40_000, base)
    schedule_b = generate_amortization_schedule(20_000, base)
    merged = _merge_component_schedules([schedule_a, schedule_b])
    assert len(merged) == len(schedule_a)
    for idx, payment in enumerate(merged):
        assert payment.payment == pytest.approx(
            schedule_a[idx].payment + schedule_b[idx].payment
        )
        assert payment.principal == pytest.approx(
            schedule_a[idx].principal + schedule_b[idx].principal
        )
        assert payment.interest == pytest.approx(
            schedule_a[idx].interest + schedule_b[idx].interest
        )


def test_expense_inputs_monthly_calculation():
    expenses = ExpenseInputs(
        property_taxes_annual=6000,
        insurance_annual=1200,
        repairs_percent=5,
        capex_percent=4,
        vacancy_percent=3,
        management_percent=8,
        electricity_monthly=50,
        gas_monthly=25,
        water_sewer_monthly=30,
        hoa_monthly=10,
        garbage_monthly=15,
        other_monthly=20,
    )
    monthly = expenses.monthly_operating_costs(4000)
    fixed = (6000 + 1200) / 12 + 50 + 25 + 30 + 10 + 15 + 20
    variable = 4000 * ((5 + 4 + 3 + 8) / 100)
    assert monthly == pytest.approx(fixed + variable)


def test_scenario_input_validation():
    with pytest.raises(ValueError):
        ScenarioInput(
            first_term_years=30,
            first_annual_interest_rate=6,
            first_lien_percent=70,
            second_lien_percent=40,
        )
    with pytest.raises(ValueError):
        ScenarioInput(
            first_term_years=30,
            first_annual_interest_rate=6,
            first_lien_percent=90,
            second_lien_percent=15,
            second_term_years=20,
            second_annual_interest_rate=2,
        )


def test_calculate_mortgage_with_expenses():
    request = CalculationRequest(
        purchase_price=500_000,
        closing_costs_value=3,
        closing_costs_mode="percent",
        monthly_rent=5700,
        expenses=ExpenseInputs(
            property_taxes_annual=8000,
            insurance_annual=2000,
            repairs_percent=5,
            capex_percent=5,
            vacancy_percent=0,
            management_percent=5,
        ),
        scenarios=[
            ScenarioInput(
                label="Test 80% LTV",
                first_term_years=30,
                first_annual_interest_rate=6.25,
                first_lien_percent=80,
            ),
            ScenarioInput(
                label="Stacked 50/30",
                first_term_years=30,
                first_annual_interest_rate=7.25,
                first_lien_percent=50,
                second_term_years=15,
                second_annual_interest_rate=5.0,
                second_lien_percent=30,
            ),
        ],
        schedule_limit=12,
    )

    response = calculate_mortgage(request)
    assert len(response.scenarios) == 2
    first = response.scenarios[0]
    assert first.monthly_payment > 0
    assert first.cash_to_close > first.down_payment_amount  # closing costs added
    assert math.isfinite(first.cash_on_cash_return)
    stacked = response.scenarios[1]
    assert len(stacked.components) == 2
    assert stacked.components[0].label == "First lien"
    assert stacked.components[1].label == "Second lien"
