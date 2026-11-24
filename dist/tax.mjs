export const RATES = [.10, .12, .22, .24, .32, .35, .37];

export const STATUSES = {
  single: { name: 'Single', bracket: [12800, 52025, 109125, 208325, 264550, 661375], standard: 16600, aged: 2100, gains: [51050, 563200], ss: [25000, 34000], niit: 200000, senior: 75000 },
  joint: { name: 'Married filing jointly', bracket: [25600, 104050, 218250, 416650, 529100, 793650], standard: 33200, aged: 1700, gains: [102100, 633600], ss: [32000, 44000], niit: 250000, senior: 150000 },
  separate: { name: 'Married filing separately', bracket: [12800, 52025, 109125, 208325, 264550, 396825], standard: 16600, aged: 1700, gains: [51050, 316800], ss: [25000, 34000], niit: 125000, senior: 0 },
  head: { name: 'Head of household', bracket: [18250, 69650, 109100, 208300, 264550, 661350], standard: 24925, aged: 2100, gains: [68350, 598400], ss: [25000, 34000], niit: 200000, senior: 75000 },
  surviving: { name: 'Qualifying surviving spouse', bracket: [25600, 104050, 218250, 416650, 529100, 793650], standard: 33200, aged: 1700, gains: [102100, 633600], ss: [25000, 34000], niit: 250000, senior: 75000 },
};

// IRS Publication 590-B, Table III, ages 73 through 120 and over.
const FACTORS = [
  26.5, 25.5, 24.6, 23.7, 22.9, 22, 21.1, 20.2, 19.4, 18.5, 17.7, 16.8,
  16, 15.2, 14.4, 13.7, 12.9, 12.2, 11.5, 10.8, 10.1, 9.5, 8.9, 8.4,
  7.8, 7.3, 6.8, 6.4, 6, 5.6, 5.2, 4.9, 4.6, 4.3, 4.1, 3.9, 3.7,
  3.5, 3.4, 3.3, 3.1, 3, 2.9, 2.8, 2.7, 2.5, 2.3, 2,
];

const positive = n => Math.max(0, n);
const cents = n => Math.round(n * 100) / 100;
const total = (values, transform) => values.reduce((sum, value) => sum + transform(value), 0);

export function rmdFor(owner) {
  const factor = owner.age >= 73 ? FACTORS[Math.min(120, Math.floor(owner.age)) - 73] : null;
  const ira = factor ? cents(Math.ceil(owner.iraBalance / factor * 100) / 100) : 0;
  const plan = factor && !owner.planExempt ? cents(Math.ceil(owner.planBalance / factor * 100) / 100) : 0;
  return { factor, ira, plan };
}

export function ordinaryTax(amount, bracket) {
  return total(RATES, (rate) => {
    const i = RATES.indexOf(rate);
    const floor = i ? bracket[i - 1] : 0;
    return rate * positive(Math.min(amount, bracket[i] ?? Infinity) - floor);
  });
}

export function taxableSocialSecurity(benefit, otherIncome, exemptInterest, thresholds, livedTogether) {
  const provisional = otherIncome + exemptInterest + benefit * .5;
  if (livedTogether) return Math.min(benefit * .85, positive(provisional) * .85);
  const [base, upper] = thresholds;
  const first = Math.min(benefit * .5, positive(Math.min(provisional, upper) - base) * .5);
  return Math.min(benefit * .85, first + positive(provisional - upper) * .85);
}

function ownerIncome(owner, omitConversion) {
  const rmd = rmdFor(owner);
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
  const iraDue = (owner.deferIra && owner.age === 73 ? 0 : rmd.ira) + owner.priorIra;
  const planDue = (owner.deferPlan ? 0 : rmd.plan) + owner.priorPlan;
  const conversionShortfall = conversion ? positive(rmd.ira + owner.priorIra - iraCash) : 0;
  const shortfall = cents(positive(iraDue - iraCash) + positive(planDue - planCash));
  return { rmd, iraCash, planCash, iraTaxable, planTaxable, taxableConversion, conversionShortfall, shortfall };
}

export function calculate(scenario, omitConversion = false) {
  const status = STATUSES[scenario.status];
  const owners = scenario.status === 'joint' ? scenario.owners : [scenario.owners[0]];
  const retirement = owners.map(owner => ownerIncome(owner, omitConversion));
  const traditionalCash = total(retirement, owner => owner.iraCash + owner.planCash);
  const traditionalTaxable = total(retirement, owner => owner.iraTaxable + owner.planTaxable);
  const conversion = total(retirement, owner => owner.taxableConversion);
  const roth = total(owners, owner => owner.rothCash);
  const rothTaxable = total(owners, owner => Math.min(owner.rothCash, owner.rothEarnings));
  const pensionTaxable = scenario.pension * scenario.pensionTaxable / 100;
  const preferential = scenario.qualified + scenario.gains;
  const investments = scenario.interest + scenario.dividends + preferential;
  const nonSocialIncome = scenario.wages + pensionTaxable + traditionalTaxable + conversion + rothTaxable + investments;
  const taxableSS = taxableSocialSecurity(scenario.social, nonSocialIncome, scenario.exempt, status.ss, scenario.status === 'separate' && scenario.livedTogether);
  const agi = nonSocialIncome + taxableSS;
  const aged = owners.filter(owner => owner.age >= 65).length;
  const blind = owners.filter(owner => owner.blind).length;
  const baseDeduction = scenario.useItemized ? scenario.itemized : status.standard + (aged + blind) * status.aged;
  const seniorCount = owners.filter(owner => owner.age >= 65 && owner.seniorSSN).length;
  const senior = status.senior ? seniorCount * positive(6000 - .06 * positive(agi - status.senior)) : 0;
  const taxable = positive(agi - baseDeduction - senior);
  const preferredTaxable = Math.min(taxable, preferential);
  const ordinary = taxable - preferredTaxable;
  const [zeroMax, fifteenMax] = status.gains;
  const fifteen = positive(Math.min(taxable, fifteenMax) - Math.max(ordinary, zeroMax));
  const twenty = positive(taxable - Math.max(ordinary, fifteenMax));
  const regular = Math.min(ordinaryTax(taxable, status.bracket), ordinaryTax(ordinary, status.bracket) + fifteen * .15 + twenty * .20);
  const niit = Math.min(investments, positive(agi - status.niit)) * .038;
  const early = total(owners, owner => owner.earlyBase) * .10;
  const tax = regular + niit + early;
  const cash = scenario.wages + scenario.pension + scenario.social + traditionalCash + roth + investments - Math.min(scenario.reinvested, investments) + scenario.exempt + scenario.savingsDraw;
  const marginalIndex = status.bracket.findIndex(limit => ordinary < limit);
  const marginal = RATES[marginalIndex === -1 ? 6 : marginalIndex];
  return { owners, retirement, status, traditionalCash, traditionalTaxable, roth, conversion, taxableSS, agi, baseDeduction, senior, taxable, ordinary, regular, niit, early, tax, cash, net: cash - tax, marginal, investments };
}

export const EMPTY_OWNER = {
  age: 60, iraBalance: 0, planBalance: 0, rothBalance: 0, iraRmd: 0, planRmd: 0,
  iraExtra: 0, planExtra: 0, rothCash: 0, conversion: 0, iraBasis: 0, iraBeforeFlows: 0,
  planTaxable: 100, rothEarnings: 0, earlyBase: 0, priorIra: 0, priorPlan: 0,
  planExempt: false, deferIra: false, deferPlan: false, blind: false, seniorSSN: true,
};

export const EMPTY = {
  status: 'single', owners: [{ ...EMPTY_OWNER }, { ...EMPTY_OWNER }], savingsBalance: 0,
  pension: 0, pensionTaxable: 100, social: 0, wages: 0, interest: 0, qualified: 0,
  dividends: 0, gains: 0, exempt: 0, reinvested: 0, savingsDraw: 0, useItemized: false,
  itemized: 0, livedTogether: false,
};

export const EXAMPLE = {
  ...EMPTY, status: 'joint', savingsBalance: 125000, pension: 36000, social: 42000,
  interest: 2500, qualified: 8000, dividends: 1800,
  owners: [
    { ...EMPTY_OWNER, age: 74, iraBalance: 510000, planBalance: 255000, rothBalance: 180000, iraRmd: 20000, planRmd: 10000, conversion: 30000 },
    { ...EMPTY_OWNER, age: 67, iraBalance: 160000, rothBalance: 85000 },
  ],
};
