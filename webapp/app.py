"""FastAPI web application providing mortgage comparison data and static UI."""
from __future__ import annotations

from pathlib import Path
from typing import List, Sequence

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, validator

from .mortgage_calculator import (
    AmortizationPayment,
    MortgageScenario,
    calculate_monthly_payment,
    generate_amortization_schedule,
    summarize_scenarios,
)


def _equity_built(schedule: Sequence[AmortizationPayment], months: int) -> float:
    """Return total principal paid within the provided horizon."""
    return sum(payment.principal for payment in schedule[:months])


def _net_cashflow(
    schedule: Sequence[AmortizationPayment],
    monthly_rent: float,
    monthly_costs: float,
    months: int,
) -> float:
    """Return total net cashflow (rent - costs - payment) for the horizon."""
    horizon = min(months, len(schedule))
    net = 0.0
    for payment in schedule[:horizon]:
        net += monthly_rent - monthly_costs - payment.payment
    return net


def _irr(cashflows: Sequence[float]) -> float | None:
    """Compute an annualized IRR from periodic cashflows using Newton's method."""
    if not cashflows or all(cf == 0 for cf in cashflows):
        return None

    guess = 0.08 / 12  # monthly rate guess
    for _ in range(100):
        npv = 0.0
        derivative = 0.0
        for period, cash in enumerate(cashflows):
            discount = (1 + guess) ** period
            if discount == 0:
                continue
            npv += cash / discount
            derivative -= (period * cash) / (discount * (1 + guess))

        if abs(npv) < 1e-6:
            return (1 + guess) ** 12 - 1

        if derivative == 0:
            break

        guess -= npv / derivative

    return None


def _build_value_band(base: float, band: float, minimum: float) -> List[float]:
    values = {max(minimum, base - band), max(minimum, base), max(minimum, base + band)}
    return sorted(values)


def _build_sensitivity_matrix(
    loan_amount: float,
    property_value: float,
    base_scenario: MortgageScenario,
    config: SensitivityConfig,
    monthly_rent: float,
    monthly_costs: float,
) -> List[SensitivityPoint]:
    if not config.enabled:
        return []

    term_values = [int(round(v)) for v in _build_value_band(base_scenario.term_years, config.term_band, 1)]
    rate_values = _build_value_band(base_scenario.annual_interest_rate, config.rate_band, 0)
    point_values = _build_value_band(config.points_base, config.points_band, 0)
    horizon_months = config.horizon_years * 12

    down_payment = max(property_value - loan_amount, 0.0)
    matrix: List[SensitivityPoint] = []

    for term_years in term_values:
        for rate in rate_values:
            scenario = MortgageScenario(term_years=term_years, annual_interest_rate=rate)
            schedule = generate_amortization_schedule(loan_amount, scenario)
            monthly_payment = calculate_monthly_payment(loan_amount, scenario)
            debt_service = monthly_payment * 12
            annual_noi = (monthly_rent - monthly_costs) * 12
            dscr = None
            if debt_service > 0:
                dscr = annual_noi / debt_service if debt_service else None

            horizon_count = min(horizon_months, len(schedule))
            if horizon_count == 0:
                horizon_count = len(schedule)
            truncated_schedule = schedule[:horizon_count]
            horizon_cashflow = _net_cashflow(truncated_schedule, monthly_rent, monthly_costs, horizon_count)
            horizon_equity = _equity_built(truncated_schedule, horizon_count)

            remaining_balance = truncated_schedule[-1].balance if truncated_schedule else 0.0

            for points_percent in point_values:
                points_cost = loan_amount * (points_percent / 100)
                initial_equity = down_payment + points_cost
                cashflows = [-initial_equity]
                for payment in truncated_schedule:
                    cashflows.append(monthly_rent - monthly_costs - payment.payment)
                if cashflows and len(cashflows) > 1:
                    cashflows[-1] += property_value - remaining_balance
                horizon_irr = _irr(cashflows) if initial_equity > 0 else None

                matrix.append(
                    SensitivityPoint(
                        term_years=term_years,
                        annual_interest_rate=rate,
                        points_percent=points_percent,
                        monthly_payment=monthly_payment,
                        dscr=dscr,
                        horizon_years=min(config.horizon_years, term_years),
                        horizon_cashflow=horizon_cashflow,
                        horizon_equity=horizon_equity,
                        horizon_irr=horizon_irr,
                    )
                )

    return matrix


class ScenarioInput(BaseModel):
    term_years: int = Field(..., gt=0, description="Loan term in years")
    annual_interest_rate: float = Field(
        ..., ge=0, description="Annual interest rate percentage"
    )

    def to_scenario(self) -> MortgageScenario:
        return MortgageScenario(
            term_years=self.term_years, annual_interest_rate=self.annual_interest_rate
        )


class SensitivityConfig(BaseModel):
    enabled: bool = Field(default=True, description="Toggle sensitivity matrix generation.")
    term_band: int = Field(
        default=5, ge=0, description="Years added/subtracted from the base term."
    )
    rate_band: float = Field(
        default=0.5,
        ge=0,
        description="Percentage points added/subtracted from the base interest rate.",
    )
    points_base: float = Field(
        default=0.0,
        ge=0,
        description="Baseline origination points (percentage of loan amount).",
    )
    points_band: float = Field(
        default=0.5,
        ge=0,
        description="Points added/subtracted from the baseline for the matrix.",
    )
    horizon_years: int = Field(
        default=5,
        ge=1,
        le=50,
        description="Horizon in years used for cashflow, equity, and IRR calculations.",
    )


class CalculationRequest(BaseModel):
    loan_amount: float = Field(..., gt=0, description="Loan principal amount")
    property_value: float | None = Field(
        default=None,
        gt=0,
        description="Home value used to compute LTV and equity share. Defaults to loan amount.",
    )
    monthly_rent: float = Field(
        default=0,
        ge=0,
        description="Expected gross monthly rent or income produced by the asset.",
    )
    monthly_operating_costs: float = Field(
        default=0,
        ge=0,
        description="Taxes, insurance, HOA, maintenance, and other recurring costs.",
    )
    scenarios: List[ScenarioInput] | None = Field(
        default=None,
        description="List of mortgage scenarios. Defaults are used if omitted.",
    )
    schedule_limit: int | None = Field(
        default=None,
        ge=1,
        description="Maximum number of amortization rows returned per scenario.",
    )
    sensitivity: SensitivityConfig | None = Field(
        default=None,
        description="Configuration for building the sensitivity matrix.",
    )

    @validator("schedule_limit")
    def _validate_schedule_limit(cls, value: int | None) -> int | None:
        if value is not None and value > 1200:
            raise ValueError("Schedule limit cannot exceed 1200 rows")
        return value


class PaymentResponse(BaseModel):
    payment_number: int
    payment: float
    principal: float
    interest: float
    balance: float

    @classmethod
    def from_payment(cls, payment: AmortizationPayment) -> "PaymentResponse":
        return cls(
            payment_number=payment.payment_number,
            payment=payment.payment,
            principal=payment.principal,
            interest=payment.interest,
            balance=payment.balance,
        )


class ScenarioSummary(BaseModel):
    term_years: int
    annual_interest_rate: float
    monthly_payment: float
    total_interest: float
    monthly_cashflow: float
    loan_to_value: float | None
    year_one_equity: float
    five_year_equity: float
    ten_year_equity: float
    fifteen_year_equity: float
    interest_to_equity_ratio: float
    cashflow_five_year: float
    cashflow_ten_year: float
    cashflow_fifteen_year: float
    schedule: Sequence[PaymentResponse]


class SensitivityPoint(BaseModel):
    term_years: int
    annual_interest_rate: float
    points_percent: float
    monthly_payment: float
    dscr: float | None
    horizon_years: int
    horizon_cashflow: float
    horizon_equity: float
    horizon_irr: float | None


class CalculationResponse(BaseModel):
    loan_amount: float
    property_value: float
    monthly_rent: float
    monthly_operating_costs: float
    scenarios: Sequence[ScenarioSummary]
    sensitivity_matrix: Sequence[SensitivityPoint] | None


app = FastAPI(title="Mortgage Comparison Tool", version="1.0.0")

_static_dir = Path(__file__).parent / "static"
app.mount("/static", StaticFiles(directory=_static_dir), name="static")


@app.get("/", response_class=HTMLResponse)
def read_index() -> str:
    """Serve the interactive mortgage comparison interface."""
    index_path = _static_dir / "index.html"
    if not index_path.exists():  # pragma: no cover - safety check
        raise HTTPException(status_code=404, detail="UI not found")
    return index_path.read_text(encoding="utf-8")


@app.post("/api/calculate", response_model=CalculationResponse)
def calculate_mortgage(request: CalculationRequest) -> CalculationResponse:
    """Calculate mortgage comparisons and amortization schedules."""
    property_value = request.property_value or request.loan_amount
    monthly_rent = request.monthly_rent
    monthly_costs = request.monthly_operating_costs
    loan_to_value = (
        request.loan_amount / property_value if property_value else None
    )

    scenarios = (
        [scenario.to_scenario() for scenario in request.scenarios]
        if request.scenarios
        else [
            MortgageScenario(term_years=15, annual_interest_rate=5.5),
            MortgageScenario(term_years=30, annual_interest_rate=6.25),
            MortgageScenario(term_years=50, annual_interest_rate=7.0),
        ]
    )

    summary = summarize_scenarios(request.loan_amount, scenarios)
    scenario_payload: list[ScenarioSummary] = []

    for scenario, monthly_payment, total_interest_paid in summary:
        full_schedule = generate_amortization_schedule(request.loan_amount, scenario)
        schedule = (
            full_schedule[: request.schedule_limit]
            if request.schedule_limit is not None
            else full_schedule
        )

        year_one_equity = _equity_built(full_schedule, 12)
        five_year_equity = _equity_built(full_schedule, 60)
        ten_year_equity = _equity_built(full_schedule, 120)
        fifteen_year_equity = _equity_built(full_schedule, 180)
        total_equity = _equity_built(full_schedule, scenario.total_payments())
        monthly_cashflow = monthly_rent - monthly_costs - monthly_payment
        cashflow_five_year = _net_cashflow(full_schedule, monthly_rent, monthly_costs, 60)
        cashflow_ten_year = _net_cashflow(full_schedule, monthly_rent, monthly_costs, 120)
        cashflow_fifteen_year = _net_cashflow(full_schedule, monthly_rent, monthly_costs, 180)
        interest_to_equity_ratio = (
            total_interest_paid / total_equity if total_equity else float("inf")
        )
        scenario_payload.append(
            ScenarioSummary(
                term_years=scenario.term_years,
                annual_interest_rate=scenario.annual_interest_rate,
                monthly_payment=monthly_payment,
                total_interest=total_interest_paid,
                monthly_cashflow=monthly_cashflow,
                loan_to_value=loan_to_value,
                year_one_equity=year_one_equity,
                five_year_equity=five_year_equity,
                ten_year_equity=ten_year_equity,
                fifteen_year_equity=fifteen_year_equity,
                interest_to_equity_ratio=interest_to_equity_ratio,
                cashflow_five_year=cashflow_five_year,
                cashflow_ten_year=cashflow_ten_year,
                cashflow_fifteen_year=cashflow_fifteen_year,
                schedule=[PaymentResponse.from_payment(p) for p in schedule],
            )
        )

    sensitivity_matrix = None
    if request.sensitivity and scenarios:
        sensitivity_matrix = _build_sensitivity_matrix(
            loan_amount=request.loan_amount,
            property_value=property_value,
            base_scenario=scenarios[0],
            config=request.sensitivity,
            monthly_rent=monthly_rent,
            monthly_costs=monthly_costs,
        )

    return CalculationResponse(
        loan_amount=request.loan_amount,
        property_value=property_value,
        monthly_rent=monthly_rent,
        monthly_operating_costs=monthly_costs,
        scenarios=scenario_payload,
        sensitivity_matrix=sensitivity_matrix,
    )
