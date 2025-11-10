# Mortgage Calculator

This repository contains tools for comparing fixed-rate mortgage scenarios from both the
command line and an interactive web experience. Given a loan amount and one or more
interest rate/term combinations, the utilities calculate monthly payments, total
interest, and amortization schedules for each scenario so you can understand long-term
cost differences.

## Requirements

- Python 3.10+

## Command-line usage

Run the comparison by supplying the loan amount and one or more `--scenario` arguments in
`<years>:<rate>` format:

```bash
python mortgage_calculator.py --loan 450000 \
    --scenario 15:5.75 \
    --scenario 30:6.25 \
    --scenario 50:6.95
```

By default the tool prints a comparison summary. Use `--show-schedules` to include the
full amortization table for each scenario. You can optionally limit the number of rows per
schedule with `--limit` (useful for large terms such as 50-year mortgages):

```bash
python mortgage_calculator.py --loan 450000 \
    --scenario 15:5.75 \
    --scenario 30:6.25 \
    --scenario 50:6.95 \
    --show-schedules \
    --limit 12
```

If no scenarios are provided, the tool defaults to a 15-year, 30-year, and 50-year mortgage
with example rates of 5.5%, 6.25%, and 7% respectively.

## Sample Output

```
Mortgage Comparison Summary
================================================================================
  Term (yrs)        Rate     Monthly Payment      Total Interest
--------------------------------------------------------------------------------
          15        5.50%          $ 2,859.79        $ 164,762.58
          30        6.25%          $ 2,155.01        $ 425,803.67
          50        7.00%          $ 2,105.91        $ 913,545.75
```

Use the amortization table to inspect the breakdown between principal and interest over
time and plan for long-term financial strategies.

## Interactive web experience

The repository also includes a FastAPI-powered web application with a Shadcn-inspired UI
for exploring scenarios visually.

### Install dependencies

```bash
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

### Run the web server

```bash
uvicorn webapp.app:app --reload
```

Navigate to <http://127.0.0.1:8000> to open the interface. You can:

- Configure loan details and multiple mortgage scenarios.
- Review automatically generated summary cards that highlight the cheapest payment,
  highest interest cost, and fastest payoff horizon.
- Inspect comparison tables alongside interactive payoff and payment composition charts.
- Drill into the amortization schedule for each scenario with smooth chart updates.

### REST API

The web server exposes a JSON endpoint at `POST /api/calculate`. Provide the loan amount,
optional scenarios, and an optional amortization row limit:

```bash
curl -X POST http://127.0.0.1:8000/api/calculate \
    -H 'Content-Type: application/json' \
    -d '{
          "loan_amount": 450000,
          "schedule_limit": 120,
          "scenarios": [
            {"term_years": 30, "annual_interest_rate": 6.25},
            {"term_years": 20, "annual_interest_rate": 5.85}
          ]
        }'
```

The response includes the monthly payment, total interest, and amortization rows for each
scenario.
