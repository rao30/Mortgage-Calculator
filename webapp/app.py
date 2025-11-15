"""FastAPI web application providing mortgage comparison data and static UI."""
from __future__ import annotations

from pathlib import Path
from typing import List, Sequence, Literal

from fastapi import FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field, validator

from .mortgage_calculator import (
    AmortizationPayment,
    MortgageScenario,
    generate_amortization_schedule,
    total_interest,
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


def _merge_component_schedules(
    schedules: Sequence[Sequence[AmortizationPayment]],
) -> list[AmortizationPayment]:
    """Combine multiple amortization schedules into a single blended view."""
    if not schedules:
        return []

    horizon = max(len(schedule) for schedule in schedules)
    merged: list[AmortizationPayment] = []

    for idx in range(horizon):
        payment = principal = interest = balance = 0.0
        for schedule in schedules:
            if idx < len(schedule):
                component_payment = schedule[idx]
                payment += component_payment.payment
                principal += component_payment.principal
                interest += component_payment.interest
                balance += component_payment.balance
        merged.append(
            AmortizationPayment(
                payment_number=idx + 1,
                payment=payment,
                principal=principal,
                interest=interest,
                balance=balance,
            )
        )

    return merged


DEFAULT_HORIZON_YEARS = (1, 5, 10, 15)



class ScenarioInput(BaseModel):
    label: str | None = Field(
        default=None,
        description="Optional label used throughout the UI to identify the scenario.",
    )
    first_term_years: int = Field(..., gt=0, description="First lien term in years")
    first_annual_interest_rate: float = Field(
        ..., ge=0, description="First lien annual interest rate percentage"
    )
    first_lien_percent: float = Field(
        ..., gt=0, le=100, description="Percent of property value financed by the first lien."
    )
    second_lien_percent: float = Field(
        default=0,
        ge=0,
        le=100,
        description="Percent of property value financed by the second lien.",
    )
    second_term_years: int | None = Field(
        default=None, gt=0, description="Second lien term in years."
    )
    second_annual_interest_rate: float | None = Field(
        default=None, ge=0, description="Second lien annual interest rate percentage."
    )

    @validator("second_term_years", "second_annual_interest_rate", always=True)
    def _validate_second_lien_fields(
        cls, value: int | float | None, values: dict[str, object], field
    ) -> int | float | None:
        second_percent = values.get("second_lien_percent", 0) or 0
        if second_percent > 0 and value is None:
            raise ValueError(f"{field.name.replace('_', ' ')} is required for a second lien")
        if second_percent == 0:
            return None
        return value

    @validator("second_lien_percent")
    def _validate_percentages(cls, second_percent: float, values: dict[str, object]) -> float:
        first_percent = values.get("first_lien_percent", 0) or 0
        total = first_percent + second_percent
        if total > 100.0001:
            raise ValueError("Combined lien percentages cannot exceed 100% of the property value")
        return second_percent


class CalculationRequest(BaseModel):
    loan_amount: float | None = Field(
        default=None, ge=0, description="Optional aggregate loan principal amount."
    )
    purchase_price: float = Field(
        default=500_000,
        gt=0,
        description="Home value used to compute lien allocations and equity share.",
    )
    property_value: float | None = Field(
        default=None,
        gt=0,
        description="Observed or appraised property value used for equity calculations.",
    )
    closing_costs_value: float = Field(
        default=3.0,
        ge=0,
        description="Closing costs value interpreted based on the selected mode.",
    )
    closing_costs_mode: Literal["percent", "fixed"] = Field(
        default="percent",
        description="Whether closing costs represent a percent of the purchase price or a fixed dollar amount.",
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
    expenses: ExpenseInputs | None = Field(
        default=None,
        description="Detailed expense inputs used to derive operating costs.",
    )
    future_assumptions: FutureAssumptions = Field(
        default_factory=lambda: FutureAssumptions(),
        description="Annual growth assumptions applied to rent, expenses, and property value.",
    )
    outlook_years: Sequence[int] = Field(
        default_factory=lambda: list(DEFAULT_HORIZON_YEARS),
        description="List of years to build horizon snapshots for each scenario.",
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

    @validator("outlook_years", pre=True, always=True)
    def _validate_outlook_years(cls, value: Sequence[int] | None) -> Sequence[int]:
        source = value or DEFAULT_HORIZON_YEARS
        normalized: list[int] = []
        seen: set[int] = set()
        for entry in source:
            try:
                year = int(entry)
            except (TypeError, ValueError):
                raise ValueError("Each outlook year must be a positive integer.")
            if year <= 0:
                raise ValueError("Outlook years must be positive.")
            if year in seen:
                continue
            seen.add(year)
            normalized.append(year)
        if not normalized:
            normalized = list(DEFAULT_HORIZON_YEARS)
        return normalized


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


class ExpenseInputs(BaseModel):
    property_taxes_annual: float = Field(
        default=8000,
        ge=0,
        description="Annual property tax expense.",
    )
    insurance_annual: float = Field(
        default=2000,
        ge=0,
        description="Annual insurance expense.",
    )
    repairs_percent: float = Field(
        default=5,
        ge=0,
        description="Repairs & maintenance percentage of gross monthly rent.",
    )
    capex_percent: float = Field(
        default=5,
        ge=0,
        description="Capital expenditures percentage of gross monthly rent.",
    )
    vacancy_percent: float = Field(
        default=0,
        ge=0,
        description="Vacancy allowance percentage of gross monthly rent.",
    )
    management_percent: float = Field(
        default=5,
        ge=0,
        description="Management fee percentage of gross monthly rent.",
    )
    electricity_monthly: float = Field(
        default=0,
        ge=0,
        description="Monthly electricity expense.",
    )
    gas_monthly: float = Field(
        default=0,
        ge=0,
        description="Monthly gas expense.",
    )
    water_sewer_monthly: float = Field(
        default=0,
        ge=0,
        description="Monthly water & sewer expense.",
    )
    hoa_monthly: float = Field(
        default=0,
        ge=0,
        description="Monthly HOA fees.",
    )
    garbage_monthly: float = Field(
        default=0,
        ge=0,
        description="Monthly garbage expense.",
    )
    other_monthly: float = Field(
        default=0,
        ge=0,
        description="Other recurring monthly expenses.",
    )

    @validator("repairs_percent", "capex_percent", "vacancy_percent", "management_percent")
    def _percent_non_negative(cls, value: float) -> float:
        if value < 0:
            raise ValueError("Expense percentages cannot be negative")
        return value

    def monthly_operating_costs(self, monthly_rent: float) -> float:
        return self.fixed_monthly_costs() + monthly_rent * self.percent_factor()

    def fixed_monthly_costs(self) -> float:
        """Return the fixed monthly costs that do not vary with rent."""
        return (
            (self.property_taxes_annual / 12.0)
            + (self.insurance_annual / 12.0)
            + self.electricity_monthly
            + self.gas_monthly
            + self.water_sewer_monthly
            + self.hoa_monthly
            + self.garbage_monthly
            + self.other_monthly
        )

    def percent_factor(self) -> float:
        """Return the cumulative percentage-based expense factor applied to rent."""
        return (
            self.repairs_percent
            + self.capex_percent
            + self.vacancy_percent
            + self.management_percent
        ) / 100.0


class FutureAssumptions(BaseModel):
    annual_property_appreciation_percent: float = Field(
        default=0.0,
        ge=0,
        description="Annual property appreciation percentage.",
    )
    annual_rent_growth_percent: float = Field(
        default=0.0,
        ge=0,
        description="Annual rent growth assumption as a percentage.",
    )
    annual_expense_inflation_percent: float = Field(
        default=0.0,
        ge=0,
        description="Annual expense inflation percentage applied to fixed costs.",
    )


class ScenarioHorizonOutlook(BaseModel):
    horizon_years: int
    cashflow: float
    equity: float
    loan_payoff: float
    appreciation_equity: float


class ScenarioSummary(BaseModel):
    label: str
    total_financed: float
    down_payment_amount: float
    down_payment_percent: float
    monthly_payment: float
    total_interest: float
    monthly_cashflow: float
    cash_on_cash_return: float | None
    cash_to_close: float
    loan_to_value: float | None
    year_one_equity: float
    five_year_equity: float
    ten_year_equity: float
    fifteen_year_equity: float
    loan_payoff_year_one: float
    loan_payoff_five_year: float
    loan_payoff_ten_year: float
    loan_payoff_fifteen_year: float
    appreciation_equity_year_one: float
    appreciation_equity_five_year: float
    appreciation_equity_ten_year: float
    appreciation_equity_fifteen_year: float
    interest_to_equity_ratio: float
    cashflow_five_year: float
    cashflow_ten_year: float
    cashflow_fifteen_year: float
    horizon_outlooks: Sequence[ScenarioHorizonOutlook]
    components: Sequence["LoanComponentSummary"]
    schedule: Sequence[PaymentResponse]


class LoanComponentSummary(BaseModel):
    label: str
    amount: float
    share_percent: float
    term_years: int
    annual_interest_rate: float
    monthly_payment: float
    total_interest: float


ScenarioSummary.update_forward_refs()
CalculationRequest.update_forward_refs()


class CalculationResponse(BaseModel):
    loan_amount: float
    property_value: float
    monthly_rent: float
    monthly_operating_costs: float
    scenarios: Sequence[ScenarioSummary]
    future_assumptions: FutureAssumptions


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
    purchase_price = request.purchase_price or 500_000
    property_value = request.property_value or purchase_price
    base_loan_amount = request.loan_amount or purchase_price
    if request.closing_costs_mode == "percent":
        closing_costs_amount = purchase_price * (request.closing_costs_value / 100)
    else:
        closing_costs_amount = request.closing_costs_value
    closing_costs_amount = max(0.0, closing_costs_amount)
    monthly_rent = request.monthly_rent
    assumptions = request.future_assumptions or FutureAssumptions()
    rent_growth_rate = assumptions.annual_rent_growth_percent / 100.0
    appreciation_rate = assumptions.annual_property_appreciation_percent / 100.0
    expense_inflation_rate = assumptions.annual_expense_inflation_percent / 100.0

    if request.expenses is not None:
        expense_inputs = request.expenses
        base_fixed_costs = expense_inputs.fixed_monthly_costs()
        variable_expense_factor = expense_inputs.percent_factor()
        monthly_operating_costs = expense_inputs.monthly_operating_costs(monthly_rent)
    else:
        base_fixed_costs = request.monthly_operating_costs
        variable_expense_factor = 0.0
        monthly_operating_costs = request.monthly_operating_costs

    default_structures = [
        ScenarioInput(
            label="15yr single note",
            first_term_years=15,
            first_annual_interest_rate=5.5,
            first_lien_percent=80,
        ),
        ScenarioInput(
            label="30yr single note",
            first_term_years=30,
            first_annual_interest_rate=6.5,
            first_lien_percent=80,
        ),
         ScenarioInput(
            label="5% down primary house hack",
            first_term_years=30,
            first_annual_interest_rate=6.5,
            first_lien_percent=95,
        ),
        ScenarioInput(
            label="50yr single note",
            first_term_years=50,
            first_annual_interest_rate=7.0,
            first_lien_percent=80,
        ),
        ScenarioInput(
            label="50/40/10 stacked",
            first_term_years=30,
            first_annual_interest_rate=7.5,
            first_lien_percent=50,
            second_term_years=30,
            second_annual_interest_rate=3.0,
            second_lien_percent=40,
        ),

    ]

    scenario_inputs = request.scenarios or default_structures
    scenario_payload: list[ScenarioSummary] = []
    horizon_years = list(request.outlook_years)

    for index, scenario in enumerate(scenario_inputs, start=1):
        first_amount = purchase_price * (scenario.first_lien_percent / 100)
        component_summaries: list[LoanComponentSummary] = []
        component_schedules: list[Sequence[AmortizationPayment]] = []
        total_financed = 0.0

        if first_amount <= 0:
            raise HTTPException(
                status_code=400, detail="First lien percent must result in financed dollars."
            )

        first_note = MortgageScenario(
            term_years=scenario.first_term_years,
            annual_interest_rate=scenario.first_annual_interest_rate,
        )
        first_schedule = generate_amortization_schedule(first_amount, first_note)
        component_schedules.append(first_schedule)
        total_financed += first_amount
        component_summaries.append(
            LoanComponentSummary(
                label="First lien",
                amount=first_amount,
                share_percent=scenario.first_lien_percent,
                term_years=first_note.term_years,
                annual_interest_rate=first_note.annual_interest_rate,
                monthly_payment=first_schedule[0].payment if first_schedule else 0.0,
                total_interest=total_interest(first_schedule),
            )
        )

        if scenario.second_lien_percent > 0:
            second_amount = purchase_price * (scenario.second_lien_percent / 100)
            second_rate = (
                scenario.second_annual_interest_rate
                if scenario.second_annual_interest_rate is not None
                else scenario.first_annual_interest_rate
            )
            second_note = MortgageScenario(
                term_years=scenario.second_term_years or scenario.first_term_years,
                annual_interest_rate=second_rate,
            )
            second_schedule = generate_amortization_schedule(second_amount, second_note)
            component_schedules.append(second_schedule)
            total_financed += second_amount
            component_summaries.append(
                LoanComponentSummary(
                    label="Second lien",
                    amount=second_amount,
                    share_percent=scenario.second_lien_percent,
                    term_years=second_note.term_years,
                    annual_interest_rate=second_note.annual_interest_rate,
                    monthly_payment=second_schedule[0].payment if second_schedule else 0.0,
                    total_interest=total_interest(second_schedule),
                )
            )

        blended_schedule = _merge_component_schedules(component_schedules)
        truncated_schedule = (
            blended_schedule[: request.schedule_limit]
            if request.schedule_limit is not None
            else blended_schedule
        )

        monthly_payment = blended_schedule[0].payment if blended_schedule else 0.0
        total_interest_paid = sum(total_interest(s) for s in component_schedules)

        def rent_for_month(payment_number: int) -> float:
            year = (payment_number - 1) // 12
            return monthly_rent * ((1 + rent_growth_rate) ** year)

        def cost_for_month(payment_number: int) -> float:
            year = (payment_number - 1) // 12
            fixed = base_fixed_costs * ((1 + expense_inflation_rate) ** year)
            return fixed + rent_for_month(payment_number) * variable_expense_factor

        def mortgage_payment_for_index(payment_index: int) -> float:
            if payment_index < len(blended_schedule):
                return blended_schedule[payment_index].payment
            return 0.0

        def net_cash_for_month(payment_index: int) -> float:
            payment_number = payment_index + 1
            mortgage_payment = mortgage_payment_for_index(payment_index)
            return rent_for_month(payment_number) - cost_for_month(payment_number) - mortgage_payment

        def sum_cashflows(months: int) -> float:
            total = 0.0
            if months <= 0:
                return total
            for idx in range(months):
                total += net_cash_for_month(idx)
            return total

        def balance_after_months(months: int) -> float:
            if not blended_schedule or months <= 0:
                return total_financed
            idx = min(len(blended_schedule), months) - 1
            return blended_schedule[idx].balance

        def property_value_after_months(months: int) -> float:
            years = max(months // 12, 0)
            return property_value * ((1 + appreciation_rate) ** years)

        def equity_after_months(months: int) -> float:
            return max(property_value_after_months(months) - balance_after_months(months), 0.0)

        def loan_payoff_after_months(months: int) -> float:
            balance = balance_after_months(months)
            payoff = total_financed - balance
            return max(payoff, 0.0)

        def appreciation_equity_after_months(months: int) -> float:
            return max(property_value_after_months(months) - total_financed, 0.0)

        monthly_cashflow = net_cash_for_month(0) if blended_schedule else 0.0

        snapshot_cache: dict[int, dict[str, float]] = {}

        def snapshot_for_months(months: int) -> dict[str, float]:
            key = max(1, months)
            if key not in snapshot_cache:
                snapshot_cache[key] = {
                    "cashflow": sum_cashflows(key),
                    "equity": equity_after_months(key),
                    "loan_payoff": loan_payoff_after_months(key),
                    "appreciation_equity": appreciation_equity_after_months(key),
                }
            return snapshot_cache[key]

        def snapshot_for_years(years: int) -> dict[str, float]:
            return snapshot_for_months(years * 12)

        year_one_snapshot = snapshot_for_years(1)
        five_year_snapshot = snapshot_for_years(5)
        ten_year_snapshot = snapshot_for_years(10)
        fifteen_year_snapshot = snapshot_for_years(15)

        year_one_equity = year_one_snapshot["equity"]
        five_year_equity = five_year_snapshot["equity"]
        ten_year_equity = ten_year_snapshot["equity"]
        fifteen_year_equity = fifteen_year_snapshot["equity"]

        five_year_cashflow = five_year_snapshot["cashflow"]
        ten_year_cashflow = ten_year_snapshot["cashflow"]
        fifteen_year_cashflow = fifteen_year_snapshot["cashflow"]
        total_months = len(blended_schedule)
        total_equity = equity_after_months(total_months) if total_months else 0.0
        interest_to_equity_ratio = (
            total_interest_paid / total_equity if total_equity else float("inf")
        )

        loan_payoff_year_one = year_one_snapshot["loan_payoff"]
        loan_payoff_five_year = five_year_snapshot["loan_payoff"]
        loan_payoff_ten_year = ten_year_snapshot["loan_payoff"]
        loan_payoff_fifteen_year = fifteen_year_snapshot["loan_payoff"]

        appreciation_equity_year_one = year_one_snapshot["appreciation_equity"]
        appreciation_equity_five_year = five_year_snapshot["appreciation_equity"]
        appreciation_equity_ten_year = ten_year_snapshot["appreciation_equity"]
        appreciation_equity_fifteen_year = fifteen_year_snapshot["appreciation_equity"]
        down_payment_percent = max(
            0.0, 100.0 - scenario.first_lien_percent - scenario.second_lien_percent
        )
        down_payment_amount = purchase_price * (down_payment_percent / 100)
        total_cash_invested = down_payment_amount + closing_costs_amount
        cash_to_close = total_cash_invested
        if total_cash_invested <= 0:
            cash_on_cash_return = None
        else:
            annualized_cash = monthly_cashflow * 12
            cash_on_cash_return = annualized_cash / total_cash_invested
        scenario_label = (scenario.label or "").strip() or " / ".join(
            filter(
                None,
                [
                    f"{scenario.first_lien_percent:.0f}% first",
                    f"{scenario.second_lien_percent:.0f}% second"
                    if scenario.second_lien_percent
                    else None,
                    f"{down_payment_percent:.0f}% down" if down_payment_percent else None,
                ],
            )
        ) or f"Scenario {index}"
        loan_to_value = total_financed / property_value if property_value else None

        horizon_outlooks = [
            ScenarioHorizonOutlook(
                horizon_years=year,
                cashflow=snapshot_for_years(year)["cashflow"],
                equity=snapshot_for_years(year)["equity"],
                loan_payoff=snapshot_for_years(year)["loan_payoff"],
                appreciation_equity=snapshot_for_years(year)["appreciation_equity"],
            )
            for year in horizon_years
        ]

        scenario_payload.append(
            ScenarioSummary(
                label=scenario_label,
                total_financed=total_financed,
                down_payment_amount=down_payment_amount,
                down_payment_percent=down_payment_percent,
                monthly_payment=monthly_payment,
                total_interest=total_interest_paid,
                monthly_cashflow=monthly_cashflow,
                cash_on_cash_return=cash_on_cash_return,
                cash_to_close=cash_to_close,
                loan_to_value=loan_to_value,
                year_one_equity=year_one_equity,
                five_year_equity=five_year_equity,
                ten_year_equity=ten_year_equity,
                fifteen_year_equity=fifteen_year_equity,
                interest_to_equity_ratio=interest_to_equity_ratio,
                cashflow_five_year=five_year_cashflow,
                cashflow_ten_year=ten_year_cashflow,
                cashflow_fifteen_year=fifteen_year_cashflow,
                loan_payoff_year_one=loan_payoff_year_one,
                loan_payoff_five_year=loan_payoff_five_year,
                loan_payoff_ten_year=loan_payoff_ten_year,
                loan_payoff_fifteen_year=loan_payoff_fifteen_year,
                appreciation_equity_year_one=appreciation_equity_year_one,
                appreciation_equity_five_year=appreciation_equity_five_year,
                appreciation_equity_ten_year=appreciation_equity_ten_year,
                appreciation_equity_fifteen_year=appreciation_equity_fifteen_year,
                horizon_outlooks=horizon_outlooks,
                components=component_summaries,
                schedule=[PaymentResponse.from_payment(p) for p in truncated_schedule],
            )
        )

    return CalculationResponse(
        loan_amount=base_loan_amount,
        property_value=property_value,
        monthly_rent=monthly_rent,
        monthly_operating_costs=monthly_operating_costs,
        scenarios=scenario_payload,
        future_assumptions=assumptions,
    )
