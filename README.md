# Taxdaddy

A browser-only planner for U.S. federal retirement income and taxes in 2027. Start with the example scenario or clear it, then change household income, savings draws, pension income, dividends, required minimum distributions, and IRA-to-Roth conversions. The projection separates spendable cash from taxable income and compares the current scenario with a zero-conversion baseline.

## Run locally

With Python 3, run `python3 -m http.server 8000 --directory dist` from the checkout. Then open [localhost](http://localhost:8000). The site needs a static web server to load its JavaScript modules. There are no dependencies, backend requests, cookies, or saved financial inputs.

## Verify the model

Run `node --test tax.test.mjs`. The Tax rules tab documents the IRS sources, model scope, and planning limits. The calculator uses published 2027 rates and is an estimate for scenario planning.
