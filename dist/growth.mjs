import { householdOwners } from './tax.mjs';

export const GROWTH_DEFAULTS = Object.freeze({ rate: 5, years: 20, repeat: false });

function investmentAccounts(scenario) {
  const accounts = [{
    id: 'brokerage', name: 'Taxable brokerage', opening: scenario.brokerageBalance,
    withdrawal: scenario.brokeragePrincipal + scenario.brokerageIncomeDraw,
  }, { id: 'savings', name: 'Cash savings', opening: scenario.savingsBalance, withdrawal: scenario.savingsDraw }];
  householdOwners(scenario).forEach((owner, index) => {
    const label = scenario.status !== 'joint' ? '' : index === 0 ? 'Your ' : 'Spouse’s ';
    accounts.push(
      { id: `ira${index}`, name: label + 'Traditional IRA', opening: owner.iraBalance, withdrawal: owner.iraRmd + owner.iraExtra, conversion: owner.conversion, destination: `roth${index}` },
      { id: `plan${index}`, name: label + 'Non-Roth 401(k)', opening: owner.planBalance, withdrawal: owner.planRmd + owner.planExtra },
      { id: `roth${index}`, name: label + 'Roth IRA', opening: owner.rothBalance, withdrawal: owner.rothCash },
      { id: `rothPlan${index}`, name: label + 'Roth 401(k)', opening: owner.rothPlanBalance, withdrawal: owner.rothPlanCash },
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
  const rothAccounts = accounts.filter(account => account.id.startsWith('roth'));
  const otherAccounts = accounts.filter(account => !account.id.startsWith('roth'));
  const conversions = accounts.filter(account => account.conversion > 0);
  const opening = Object.fromEntries(accounts.map(account => [account.id, account.opening]));
  const planned = { ...opening };
  const baseline = { ...opening };
  const withdrawn = Object.fromEntries(accounts.map(({ id }) => [id, 0]));
  const unmet = { ...withdrawn };
  function pay(account) {
    const paid = debit(planned, account.id, account.withdrawal);
    withdrawn[account.id] += paid;
    unmet[account.id] += account.withdrawal - paid;
  }
  const investments = accounts.filter(account => account.id !== 'savings');
  const sum = balances => investments.reduce((value, account) => value + balances[account.id], 0);
  const points = [];
  const snapshot = year => ({
    year,
    planned: { ...planned, total: sum(planned) },
    baseline: { ...baseline, total: sum(baseline) },
  });
  points.push(snapshot(scenario.taxYear - 1));
  let unconverted = 0;
  for (let offset = 0; offset < years; offset++) {
    for (const { id } of investments) {
      planned[id] *= 1 + rate / 100;
      baseline[id] *= 1 + rate / 100;
    }
    if (offset === 0 || repeat) {
      // Apply IRA cash distributions before the conversion. Roth cash comes out
      // after the transfer, so the remaining Roth balance includes converted dollars.
      otherAccounts.forEach(pay);
      if (offset === 0) {
        for (const { id, destination, conversion } of conversions) {
          const transferred = debit(planned, id, conversion);
          planned[destination] += transferred;
          baseline[id] -= transferred;
          baseline[destination] += transferred;
          unconverted += conversion - transferred;
        }
      }
      rothAccounts.forEach(pay);
    }
    points.push(snapshot(scenario.taxYear + offset));
  }
  return {
    accounts, points, withdrawn: { ...withdrawn, total: sum(withdrawn) },
    unmet: { ...unmet, total: sum(unmet) }, unconverted,
  };
}
