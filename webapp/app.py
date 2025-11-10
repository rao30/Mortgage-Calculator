"""FastAPI web application providing mortgage comparison data and static UI."""
from __future__ import annotations

from pathlib import Path
from typing import List, Sequence

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, validator

from mortgage_calculator import (
    AmortizationPayment,
    MortgageScenario,
    generate_amortization_schedule,
    summarize_scenarios,
)


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
    scenarios: List[ScenarioInput] | None = Field(
        default=None,
        description="List of mortgage scenarios. Defaults are used if omitted.",
    )
    schedule_limit: int | None = Field(
        default=360,
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
    schedule: Sequence[PaymentResponse]


class CalculationResponse(BaseModel):
    loan_amount: float
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
        schedule = generate_amortization_schedule(request.loan_amount, scenario)
        if request.schedule_limit is not None:
            schedule = schedule[: request.schedule_limit]
        scenario_payload.append(
            ScenarioSummary(
                term_years=scenario.term_years,
                annual_interest_rate=scenario.annual_interest_rate,
                monthly_payment=monthly_payment,
                total_interest=total_interest_paid,
                schedule=[PaymentResponse.from_payment(p) for p in schedule],
            )
        )

    return CalculationResponse(loan_amount=request.loan_amount, scenarios=scenario_payload)
