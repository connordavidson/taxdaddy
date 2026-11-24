import { householdOwners } from './tax.mjs';

export const GROWTH_DEFAULTS = Object.freeze({ rate: 5, years: 20, repeat: true });

function investmentAccounts(scenario) {
  const accounts = [{
    id: 'brokerage', name: 'Taxable brokerage', opening: scenario.brokerageBalance,
    withdrawal: scenario.brokerageWithdrawal,
  }, { id: 'savings', name: 'Cash savings', opening: scenario.savingsBalance, withdrawal: scenario.savingsDraw }];
  householdOwners(scenario).forEach((owner, index) => {
    const label = scenario.status !== 'joint' ? '' : index === 0 ? 'Your ' : 'Spouse’s ';
    accounts.push(
      { id: `ira${index}`, name: label + 'Traditional IRA', opening: owner.iraBalance, withdrawal: owner.iraRmd + owner.iraExtra + (owner.iraCharity ?? 0), conversion: owner.conversion, destination: `roth${index}` },
      { id: `plan${index}`, name: label + 'Non-Roth 401(k) / 403(b)', opening: owner.planBalance, withdrawal: owner.planRmd + owner.planExtra },
      { id: `roth${index}`, name: label + 'Roth IRA', opening: owner.rothBalance, withdrawal: owner.rothCash },
      { id: `rothPlan${index}`, name: label + 'Roth 401(k) / 403(b)', opening: owner.rothPlanBalance, withdrawal: owner.rothPlanCash },
      { id: `hsa${index}`, name: label + 'HSA', opening: owner.hsaBalance ?? 0, withdrawal: owner.hsaWithdrawal ?? 0 },
    );
  });
  return accounts;
}

function debit(balances, id, requested) {
  const paid = Math.min(balances[id], requested);
  balances[id] -= paid;
  return paid;
}

export function projectGrowth(scenario, { rate, years, repeat } = GROWTH_DEFAULTS) {
  if (!Number.isFinite(rate) || rate < -100 || !Number.isInteger(years) || years < 1 || years > 50) {
    throw new RangeError('Growth requires a valid annual rate and 1 to 50 years.');
  }
  const accounts = investmentAccounts(scenario);
  const opening = Object.fromEntries(accounts.map(account => [account.id, account.opening]));
  const planned = { ...opening };
  // Both paths fund the same opening conversion after reserving the first
  // year's IRA withdrawals and charitable transfers.
  let unconverted = 0;
  for (const { id, destination, conversion, withdrawal } of accounts) {
    if (!conversion) continue;
    const transferred = Math.min(conversion, Math.max(0, opening[id] - withdrawal));
    planned[id] -= transferred;
    planned[destination] += transferred;
    unconverted += conversion - transferred;
  }
  const baseline = { ...planned };
  const withdrawn = Object.fromEntries(accounts.map(({ id }) => [id, 0]));
  const unmet = { ...withdrawn };
  const depletedAt = {};
  function pay(account, year) {
    const paid = debit(planned, account.id, account.withdrawal);
    withdrawn[account.id] += paid;
    unmet[account.id] += account.withdrawal - paid;
    if (account.withdrawal > 0 && planned[account.id] < .005) depletedAt[account.id] ??= year;
  }
  const investments = accounts.filter(account => account.id !== 'savings');
  const sum = balances => investments.reduce((value, account) => value + balances[account.id], 0);
  const points = [];
  const snapshot = (year, isOpening = false) => ({
    year, isOpening,
    planned: { ...planned, total: sum(planned) },
    baseline: { ...baseline, total: sum(baseline) },
  });
  points.push(snapshot(scenario.taxYear, true));
  for (let offset = 0; offset < years; offset++) {
    const year = scenario.taxYear + offset;
    for (const { id } of investments) {
      planned[id] *= 1 + rate / 100;
      baseline[id] *= 1 + rate / 100;
    }
    if (offset === 0 || repeat) accounts.forEach(account => pay(account, year));
    points.push(snapshot(year));
  }
  return {
    accounts, points, withdrawn: { ...withdrawn, total: sum(withdrawn) },
    unmet: { ...unmet, total: sum(unmet) }, depletedAt, unconverted,
  };
}
