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




class ScenarioInput(BaseModel):
    term_years: int = Field(..., gt=0, description="Loan term in years")
    annual_interest_rate: float = Field(
        ..., ge=0, description="Annual interest rate percentage"
    )

    def to_scenario(self) -> MortgageScenario:
        return MortgageScenario(
            term_years=self.term_years, annual_interest_rate=self.annual_interest_rate
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


class CalculationResponse(BaseModel):
    loan_amount: float
    property_value: float
    monthly_rent: float
    monthly_operating_costs: float
    scenarios: Sequence[ScenarioSummary]


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

    return CalculationResponse(
        loan_amount=request.loan_amount,
        property_value=property_value,
        monthly_rent=monthly_rent,
        monthly_operating_costs=monthly_costs,
        scenarios=scenario_payload,
    )
