"""Mortgage comparison tool for analyzing payment schedules and total interest."""
from __future__ import annotations

from dataclasses import dataclass
from typing import Iterable, List, Sequence
import argparse
import math


@dataclass(frozen=True)
class MortgageScenario:
    """Represents a mortgage configuration."""

    term_years: int
    annual_interest_rate: float

    def monthly_interest_rate(self) -> float:
        return self.annual_interest_rate / 100 / 12

    def total_payments(self) -> int:
        return self.term_years * 12


@dataclass(frozen=True)
class AmortizationPayment:
    payment_number: int
    payment: float
    principal: float
    interest: float
    balance: float


def calculate_monthly_payment(loan_amount: float, scenario: MortgageScenario) -> float:
    """Calculate the constant monthly payment for a mortgage."""
    rate = scenario.monthly_interest_rate()
    periods = scenario.total_payments()
    if rate == 0:
        return loan_amount / periods
    numerator = loan_amount * rate * math.pow(1 + rate, periods)
    denominator = math.pow(1 + rate, periods) - 1
    return numerator / denominator


def generate_amortization_schedule(
    loan_amount: float, scenario: MortgageScenario
) -> List[AmortizationPayment]:
    """Generate the full amortization schedule for the given scenario."""
    balance = loan_amount
    payment = calculate_monthly_payment(loan_amount, scenario)
    schedule: List[AmortizationPayment] = []
    rate = scenario.monthly_interest_rate()

    for n in range(1, scenario.total_payments() + 1):
        if rate == 0:
            interest_payment = 0.0
        else:
            interest_payment = balance * rate
        principal_payment = payment - interest_payment

        # Ensure the final payment zeroes the balance to avoid floating point drift
        if n == scenario.total_payments():
            principal_payment = balance
            payment_amount = principal_payment + interest_payment
            balance = 0.0
        else:
            balance = max(balance - principal_payment, 0.0)
            payment_amount = payment

        schedule.append(
            AmortizationPayment(
                payment_number=n,
                payment=payment_amount,
                principal=principal_payment,
                interest=interest_payment,
                balance=balance,
            )
        )

    return schedule


def total_interest(schedule: Sequence[AmortizationPayment]) -> float:
    return sum(p.interest for p in schedule)


def summarize_scenarios(
    loan_amount: float, scenarios: Iterable[MortgageScenario]
) -> List[tuple[MortgageScenario, float, float]]:
    """Return the payment and total interest for each scenario."""
    summary = []
    for scenario in scenarios:
        schedule = generate_amortization_schedule(loan_amount, scenario)
        payment = schedule[0].payment
        interest_paid = total_interest(schedule)
        summary.append((scenario, payment, interest_paid))
    return summary


def format_currency(value: float) -> str:
    return f"$ {value:,.2f}"


def print_summary_table(summary: Sequence[tuple[MortgageScenario, float, float]]) -> None:
    print("Mortgage Comparison Summary")
    print("=" * 80)
    header = (
        f"{'Term (yrs)':>12}"
        f"{'Rate':>12}"
        f"{'Monthly Payment':>20}"
        f"{'Total Interest':>20}"
    )
    print(header)
    print("-" * 80)
    for scenario, payment, total_int in summary:
        print(
            f"{scenario.term_years:>12}"
            f"{scenario.annual_interest_rate:>12.2f}%"
            f"{format_currency(payment):>20}"
            f"{format_currency(total_int):>20}"
        )
    print()


def print_amortization_schedule(
    scenario: MortgageScenario, schedule: Sequence[AmortizationPayment]
) -> None:
    print(
        f"Amortization Schedule - {scenario.term_years}-year @ {scenario.annual_interest_rate:.3f}%"
    )
    print("=" * 80)
    header = (
        f"{'#':>6}"
        f"{'Payment':>14}"
        f"{'Principal':>14}"
        f"{'Interest':>14}"
        f"{'Balance':>14}"
    )
    print(header)
    print("-" * 80)
    for payment in schedule:
        print(
            f"{payment.payment_number:>6}"
            f"{format_currency(payment.payment):>14}"
            f"{format_currency(payment.principal):>14}"
            f"{format_currency(payment.interest):>14}"
            f"{format_currency(payment.balance):>14}"
        )
    print()


def parse_scenario(text: str) -> MortgageScenario:
    try:
        parts = text.replace("@", ":").replace(",", ":").split(":")
        if len(parts) != 2:
            raise ValueError
        term_years = int(parts[0])
        rate = float(parts[1])
    except ValueError as exc:
        raise argparse.ArgumentTypeError(
            "Scenarios must be provided as '<years>:<rate>' (e.g. 30:6.5)."
        ) from exc
    return MortgageScenario(term_years=term_years, annual_interest_rate=rate)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        description="Compare mortgage scenarios and generate amortization tables.",
    )
    parser.add_argument(
        "--loan",
        type=float,
        required=True,
        help="Loan amount (principal) in dollars.",
    )
    parser.add_argument(
        "--scenario",
        type=parse_scenario,
        action="append",
        help="Mortgage scenario in the form '<term>:<rate>' (e.g. 30:6.5). Can be repeated.",
    )
    parser.add_argument(
        "--show-schedules",
        action="store_true",
        help="Display the full amortization table for each scenario.",
    )
    parser.add_argument(
        "--limit",
        type=int,
        default=None,
        help="Limit the amortization table to the first N payments (if provided).",
    )
    return parser


def main(args: Sequence[str] | None = None) -> None:
    parser = build_arg_parser()
    parsed = parser.parse_args(args=args)
    scenarios = parsed.scenario or [
        MortgageScenario(term_years=15, annual_interest_rate=5.5),
        MortgageScenario(term_years=30, annual_interest_rate=6.25),
        MortgageScenario(term_years=50, annual_interest_rate=7.0),
    ]

    summary = summarize_scenarios(parsed.loan, scenarios)
    print_summary_table(summary)

    if parsed.show_schedules:
        for scenario, _, _ in summary:
            schedule = generate_amortization_schedule(parsed.loan, scenario)
            if parsed.limit is not None:
                schedule = schedule[: parsed.limit]
            print_amortization_schedule(scenario, schedule)


if __name__ == "__main__":
    main()
