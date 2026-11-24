import { DEFAULT_TAX_YEAR, rulesFor } from './tax-rules/catalog.mjs';

const positive = n => Math.max(0, n);
const cents = n => Math.round(n * 100) / 100;
const total = (values, transform) => values.reduce((sum, value) => sum + transform(value), 0);

export function rmdFor(owner, rules) {
  const cohort = rules.rmd.cohorts.find(rule => rules.year - owner.age >= rule.bornFrom);
  const needsReview = cohort.age === null && owner.age >= cohort.reviewFromAge && owner.age < cohort.latestAge;
  const applies = cohort.alreadyRequired || owner.age >= (cohort.age ?? cohort.latestAge);
  const { firstAge, factors } = rules.rmd.table;
  const factorIndex = Math.min(factors.length - 1, owner.age - firstAge);
  const factor = applies ? factors[factorIndex] : null;
  const calculateMinimum = balance => cents(Math.ceil(balance / factor * 100) / 100);
  const ira = factor ? calculateMinimum(owner.iraBalance) : 0;
  const plan = factor && !owner.planExempt ? calculateMinimum(owner.planBalance) : 0;
  return { factor, ira, plan, canDeferIra: owner.age === cohort.age, needsReview };
}

function taxSlices(floor, ceiling, limits, rates) {
  return rates.reduce((tax, rate, index) => {
    const lower = Math.max(floor, limits[index - 1] ?? 0);
    const upper = Math.min(ceiling, limits[index] ?? Infinity);
    return tax + rate * positive(upper - lower);
  }, 0);
}

export function ordinaryTax(amount, bracket, rates) {
  return taxSlices(0, amount, bracket, rates);
}

export function taxableSocialSecurity(benefit, otherIncome, exemptInterest, thresholds, livedTogether, policy) {
  const { provisionalShare, firstRate, topRate } = policy;
  const provisional = otherIncome + exemptInterest + benefit * provisionalShare;
  if (livedTogether) return Math.min(benefit * topRate, positive(provisional) * topRate);
  const [base, upper] = thresholds;
  const first = Math.min(benefit * firstRate, positive(Math.min(provisional, upper) - base) * firstRate);
  return Math.min(benefit * topRate, first + positive(provisional - upper) * topRate);
}

export function enhancedSeniorPolicy(rules) {
  const policy = rules.deductions.enhancedSenior;
  return policy && rules.year >= policy.firstYear && rules.year <= policy.lastYear ? policy : null;
}

function deductions(scenario, owners, status, agi, rules) {
  const aged = owners.filter(owner => owner.age >= rules.deductions.age).length;
  const blind = owners.filter(owner => owner.blind).length;
  const baseDeduction = scenario.useItemized ? scenario.itemized : status.standard + (aged + blind) * status.aged;
  const policy = enhancedSeniorPolicy(rules);
  if (!policy || status.senior === null) return { baseDeduction, senior: 0 };
  const seniors = owners.filter(owner => owner.age >= rules.deductions.age && owner.seniorSSN).length;
  const senior = seniors * positive(policy.amount - policy.phaseout * positive(agi - status.senior));
  return { baseDeduction, senior };
}

export function householdOwners(scenario) {
  return scenario.status === 'joint' ? scenario.owners : scenario.owners.slice(0, 1);
}

function ownerIncome(owner, rules, omitConversion) {
  const rmd = rmdFor(owner, rules);
  const iraCash = owner.iraRmd + owner.iraExtra;
  const planCash = owner.planRmd + owner.planExtra;
  const conversion = omitConversion ? 0 : owner.conversion;
  const iraGross = iraCash + conversion;
  // Model flows at year-end. The Form 8606 denominator includes the
  // remaining year-end value plus the distributions and conversion.
  const basisDenominator = Math.max(owner.iraBeforeFlows, iraGross);
  const iraFreeShare = basisDenominator ? Math.min(1, owner.iraBasis / basisDenominator) : 0;
  const iraTaxable = iraCash * (1 - iraFreeShare);
  const planTaxable = planCash * owner.planTaxable / 100;
  const taxableConversion = conversion * (1 - iraFreeShare);
  const iraDue = (owner.deferIra && rmd.canDeferIra ? 0 : rmd.ira) + owner.priorIra;
  const planDue = (owner.deferPlan ? 0 : rmd.plan) + owner.priorPlan;
  const conversionShortfall = conversion ? cents(positive(rmd.ira + owner.priorIra - iraCash)) : 0;
  const shortfall = cents(positive(iraDue - iraCash) + positive(planDue - planCash));
  return { rmd, iraCash, planCash, iraTaxable, planTaxable, taxableConversion, conversionShortfall, shortfall };
}

export function calculate(scenario, { omitConversion = false } = {}) {
  const rules = rulesFor(scenario.taxYear);
  const status = rules.statuses[scenario.status];
  const owners = householdOwners(scenario);
  const retirement = owners.map(owner => ownerIncome(owner, rules, omitConversion));
  const traditionalCash = total(retirement, owner => owner.iraCash + owner.planCash);
  const traditionalTaxable = total(retirement, owner => owner.iraTaxable + owner.planTaxable);
  const conversion = total(retirement, owner => owner.taxableConversion);
  const roth = total(owners, owner => owner.rothCash);
  const rothTaxable = total(owners, owner => Math.min(owner.rothCash, owner.rothEarnings));
  const pensionTaxable = scenario.pension * scenario.pensionTaxable / 100;
  const preferential = scenario.qualified + scenario.gains;
  const investments = scenario.interest + scenario.dividends + preferential;
  const nonSocialIncome = scenario.wages + pensionTaxable + traditionalTaxable + conversion + rothTaxable + investments;
  const taxableSS = taxableSocialSecurity(scenario.social, nonSocialIncome, scenario.exempt, status.ss, scenario.status === 'separate' && scenario.livedTogether, rules.socialSecurity);
  const agi = nonSocialIncome + taxableSS;
  const { baseDeduction, senior } = deductions(scenario, owners, status, agi, rules);
  const taxable = positive(agi - baseDeduction - senior);
  const preferredTaxable = Math.min(taxable, preferential);
  const ordinary = taxable - preferredTaxable;
  const fullOrdinary = ordinaryTax(taxable, status.bracket, rules.ordinaryRates);
  const preferentialTax = taxSlices(ordinary, taxable, status.gains, rules.preferentialRates);
  const regular = Math.min(fullOrdinary, ordinaryTax(ordinary, status.bracket, rules.ordinaryRates) + preferentialTax);
  const niit = Math.min(investments, positive(agi - status.niit)) * rules.niitRate;
  const early = total(owners, owner => owner.earlyBase) * rules.earlyDistribution.rate;
  const tax = regular + niit + early;
  const cash = scenario.wages + scenario.pension + scenario.social + traditionalCash + roth + investments - Math.min(scenario.reinvested, investments) + scenario.exempt + scenario.savingsDraw + scenario.brokeragePrincipal;
  const marginalIndex = status.bracket.findIndex(limit => ordinary < limit);
  const marginal = marginalIndex === -1 ? rules.ordinaryRates.at(-1) : rules.ordinaryRates[marginalIndex];
  return { owners, retirement, status, traditionalCash, traditionalTaxable, roth, rothTaxable, conversion, taxableSS, agi, baseDeduction, senior, taxable, ordinary, regular, niit, early, tax, cash, net: cash - tax, marginal, investments };
}

export function withdrawalTaxBands(scenario, calculation = calculate(scenario)) {
  const rules = rulesFor(scenario.taxYear);
  const { retirement, roth, rothTaxable, conversion, agi, baseDeduction, senior, status } = calculation;
  const iraTaxable = total(retirement, owner => owner.iraTaxable);
  const planTaxable = total(retirement, owner => owner.planTaxable);
  const iraCash = total(retirement, owner => owner.iraCash);
  const planCash = total(retirement, owner => owner.planCash);
  const converted = total(householdOwners(scenario), owner => owner.conversion);
  const preferential = scenario.qualified + scenario.gains;
  // Attribute withdrawals in display order using the final scenario's taxable
  // Social Security and deductions. Negative offset represents unused deductions.
  let offset = agi - preferential - baseDeduction - senior - iraTaxable - planTaxable - rothTaxable - conversion;
  const sources = [
    ['Cash savings', scenario.savingsDraw, 0],
    ['Taxable brokerage principal', scenario.brokeragePrincipal, 0],
    ['Roth withdrawals', roth, rothTaxable],
    ['Traditional IRA withdrawals', iraCash, iraTaxable],
    ['Non-Roth 401(k) withdrawals', planCash, planTaxable],
    ['IRA-to-Roth conversion', converted, conversion],
  ];
  return sources.map(([name, gross, taxable]) => {
    const end = offset + taxable;
    const zero = positive(gross - taxable) + Math.min(taxable, positive(-offset));
    const bands = rules.ordinaryRates.map((rate, index) => ({
      rate,
      amount: positive(Math.min(end, status.bracket[index] ?? Infinity) - Math.max(offset, status.bracket[index - 1] ?? 0)),
    }));
    offset = end;
    return { name, gross, bands: [{ rate: 0, amount: zero }, ...bands] };
  });
}

export const EMPTY_OWNER = {
  age: 60, iraBalance: 0, planBalance: 0, rothBalance: 0, iraRmd: 0, planRmd: 0,
  iraExtra: 0, planExtra: 0, rothCash: 0, conversion: 0, iraBasis: 0, iraBeforeFlows: 0,
  planTaxable: 100, rothEarnings: 0, earlyBase: 0, priorIra: 0, priorPlan: 0,
  planExempt: false, deferIra: false, deferPlan: false, blind: false, seniorSSN: true,
};

export const EMPTY = {
  taxYear: DEFAULT_TAX_YEAR, status: 'single', owners: [{ ...EMPTY_OWNER }, { ...EMPTY_OWNER }], savingsBalance: 0,
  brokerageBalance: 0, brokeragePrincipal: 0, brokerageIncomeDraw: 0,
  pension: 0, pensionTaxable: 100, social: 0, wages: 0, interest: 0, qualified: 0,
  dividends: 0, gains: 0, exempt: 0, reinvested: 0, savingsDraw: 0, useItemized: false,
  itemized: 0, livedTogether: false,
};

export const EXAMPLE = {
  ...EMPTY, status: 'joint', savingsBalance: 125000, brokerageBalance: 140000, savingsDraw: 10000, pension: 36000, social: 42000,
  interest: 2500, qualified: 8000, dividends: 1800,
  owners: [
    { ...EMPTY_OWNER, age: 74, iraBalance: 510000, planBalance: 255000, rothBalance: 180000, iraRmd: 20000, planRmd: 10000, planExtra: 50000, rothCash: 12000, conversion: 30000 },
    { ...EMPTY_OWNER, age: 67, iraBalance: 160000, rothBalance: 85000 },
  ],
};
