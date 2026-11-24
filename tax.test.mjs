import assert from 'node:assert/strict';
import test from 'node:test';
import { calculate, rmdFor, taxableSocialSecurity, enhancedSeniorPolicy, EMPTY, ordinaryTax, withdrawalTaxBands } from './dist/tax.mjs';
import { rulesFor } from './dist/tax-rules/catalog.mjs';

const year2027 = rulesFor(2027);
const STATUSES = year2027.statuses;

const scenario = () => structuredClone(EMPTY);
const rounded = value => Math.round(value * 100) / 100;

test('2027 single filer income, deduction, dividend stack and spendable cash', () => {
  const input = scenario();
  Object.assign(input, { pension: 20000, social: 24000, qualified: 3000 });
  Object.assign(input.owners[0], { age: 74, iraBalance: 255000, iraRmd: 10000, conversion: 20000 });
  const result = calculate(input);
  assert.equal(rmdFor(input.owners[0], year2027).ira, 10000);
  assert.equal(result.taxableSS, 20400);
  assert.equal(result.agi, 73400);
  assert.equal(result.baseDeduction + result.senior, 24700);
  assert.equal(result.taxable, 48700);
  assert.equal(result.ordinary, 45700);
  assert.equal(result.tax, 5228);
  assert.equal(result.cash, 57000);
  assert.equal(result.net, 51772);
  assert.equal(calculate(input, { omitConversion: true }).cash, result.cash);
});

test('2027 ordinary bracket exact boundary', () => {
  assert.equal(ordinaryTax(52025, STATUSES.single.bracket, year2027.ordinaryRates), 5987);
  assert.equal(rounded(ordinaryTax(52026, STATUSES.single.bracket, year2027.ordinaryRates)), 5987.22);
});

test('joint enhancement is phased out separately for each eligible spouse', () => {
  const input = scenario();
  Object.assign(input, { status: 'joint', wages: 175000 });
  input.owners.forEach(owner => owner.age = 67);
  assert.equal(calculate(input).senior, 9000);
  input.wages = 250000;
  assert.equal(calculate(input).senior, 0);
});

test('IRA basis is per owner and pro rata across conversion and distribution', () => {
  const input = scenario();
  input.status = 'joint';
  Object.assign(input.owners[0], { iraBasis: 10000, iraBeforeFlows: 100000, iraExtra: 10000, conversion: 10000 });
  input.owners[1].iraExtra = 10000;
  const result = calculate(input);
  assert.equal(result.traditionalTaxable, 19000);
  assert.equal(result.conversion, 9000);
  assert.equal(calculate(input, { omitConversion: true }).traditionalTaxable, 19000);
});

test('401(k) cash cannot satisfy an IRA RMD and first-year delay does not make RMD eligible for conversion', () => {
  const input = scenario();
  Object.assign(input.owners[0], { age: 73, iraBalance: 265000, planBalance: 530000, planRmd: 30000, conversion: 3000, deferIra: true, priorIra: 2000 });
  const [result] = calculate(input).retirement;
  assert.equal(result.shortfall, 2000);
  assert.equal(result.conversionShortfall, 12000);
  input.owners[0].deferIra = false;
  assert.equal(calculate(input).retirement[0].shortfall, 12000);
});

test('taxable Social Security handles both tiers and married-separate cohabitation', () => {
  assert.equal(taxableSocialSecurity(20000, 16000, 0, STATUSES.single.ss, false, year2027.socialSecurity), 500);
  assert.equal(taxableSocialSecurity(20000, 26000, 0, STATUSES.single.ss, false, year2027.socialSecurity), 6200);
  assert.equal(taxableSocialSecurity(20000, 100000, 0, STATUSES.single.ss, false, year2027.socialSecurity), 17000);
  assert.equal(taxableSocialSecurity(4000, 8000, 0, STATUSES.separate.ss, true, year2027.socialSecurity), 3400);
});

test('conversion-triggered NIIT is limited to investments and reinvestments stay taxable', () => {
  const input = scenario();
  Object.assign(input, { wages: 195000, qualified: 10000, reinvested: 10000 });
  input.owners[0].conversion = 30000;
  assert.equal(calculate(input).niit, 380);
  assert.equal(calculate(input, { omitConversion: true }).niit, 190);
  assert.equal(calculate(input).cash, 195000);
});

test('qualified Roth and savings principal add cash only, modeled early tax uses the confirmed base', () => {
  const input = scenario();
  input.savingsDraw = 6000;
  Object.assign(input.owners[0], { rothCash: 10000, rothEarnings: 1500, earlyBase: 2000 });
  const result = calculate(input);
  assert.equal(result.agi, 1500);
  assert.equal(result.cash, 16000);
  assert.equal(result.early, 200);
});

test('regular deductions can shelter all preferential income and 15%/20% bands stack correctly', () => {
  const input = scenario();
  input.qualified = 10000;
  assert.equal(calculate(input).tax, 0);
  input.wages = 576600;
  const result = calculate(input);
  assert.equal(result.ordinary, 560000);
  assert.equal(rounded(result.regular - ordinaryTax(560000, STATUSES.single.bracket, year2027.ordinaryRates)), 1840);
});

test('unsupported years fail rather than borrowing another year’s rules', () => {
  const input = scenario();
  input.taxYear = 9999;
  assert.throws(() => calculate(input), /No published rules configured for tax year 9999/);
});

test('temporary senior rule expires and RMD age follows birth cohort when future profiles are supplied', () => {
  assert.ok(enhancedSeniorPolicy({ ...year2027, year: 2028 }));
  assert.equal(enhancedSeniorPolicy({ ...year2027, year: 2029 }), null);
  const owner = { ...scenario().owners[0], iraBalance: 246000 };
  const rules2034 = { ...year2027, year: 2034 };
  assert.equal(rmdFor({ ...owner, age: 74 }, rules2034).ira, 0);
  assert.equal(rmdFor({ ...owner, age: 75 }, rules2034).canDeferIra, false);
  const uncertain = rmdFor({ ...owner, age: 73 }, { ...year2027, year: 2032 });
  assert.equal(uncertain.needsReview, true);
  assert.equal(uncertain.ira, 0);
  const year2035 = { ...year2027, year: 2035 };
  assert.equal(rmdFor({ ...owner, age: 75 }, year2035).ira, 10000);
  assert.equal(rmdFor({ ...owner, age: 75 }, year2035).canDeferIra, true);
});

test('withdrawal tax bands use the same zero color and split taxable 401(k) cash across ordinary brackets', () => {
  const input = scenario();
  Object.assign(input, { wages: 65000, savingsDraw: 5000, brokerageWithdrawal: 3000, brokerageLongTermGain: 0 });
  Object.assign(input.owners[0], { rothCash: 4000, planExtra: 10000 });
  const sources = withdrawalTaxBands(input);
  for (const name of ['Cash savings', 'Taxable brokerage withdrawals', 'Roth IRA withdrawals']) {
    const source = sources.find(row => row.name === name);
    assert.deepEqual(source.bands.filter(band => band.amount), [{ rate: 0, amount: source.gross }]);
  }
  const plan = sources.find(row => row.name === '401(k) / 403(b) withdrawals');
  assert.deepEqual(plan.bands.filter(band => band.amount), [{ rate: .12, amount: 3625 }, { rate: .22, amount: 6375 }]);
  for (const { gross, bands } of sources) {
    assert.equal(rounded(bands.reduce((sum, band) => sum + band.amount, 0)), gross);
  }
});

test('withdrawal tax bands show the portion of 401(k) income sheltered by the standard deduction', () => {
  const input = scenario();
  input.owners[0].planExtra = 20000;
  const plan = withdrawalTaxBands(input).find(row => row.name === '401(k) / 403(b) withdrawals');
  assert.deepEqual(plan.bands.filter(band => band.amount), [{ rate: 0, amount: 16600 }, { rate: .10, amount: 3400 }]);
});

test('other taxable income, brokerage principal, and the two Roth accounts flow separately', () => {
  const input = scenario();
  Object.assign(input, { wages: 40000, gains: 3000, brokerageWithdrawal: 12000, brokerageIncomeDraw: 3000 });
  Object.assign(input.owners[0], { rothCash: 2000, rothEarnings: 300, rothPlanCash: 4000, rothPlanEarnings: 500 });
  const result = calculate(input);
  assert.equal(result.agi, 43800);
  assert.equal(result.cash, 58000);
  assert.equal(result.rothTaxable, 800);
  assert.ok(result.tax > 0);
});

test('brokerage long-term gains are counted once and stack after ordinary income and qualified dividends', () => {
  const input = scenario();
  Object.assign(input, { status: 'joint', wages: 130000, qualified: 2000, brokerageWithdrawal: 30000, brokerageLongTermGain: 10000 });
  const result = calculate(input);
  const base = calculate({ ...input, brokerageLongTermGain: 0 });
  assert.equal(result.agi, 142000);
  assert.equal(result.cash, base.cash);
  assert.equal(rounded(result.tax - base.tax), 1005);
  const account = withdrawalTaxBands(input).find(row => row.name === 'Taxable brokerage withdrawals');
  assert.equal(account.gross, 30000);
  assert.deepEqual(account.bands.filter(band => band.amount), [
    { rate: 0, amount: 20000 },
    { rate: 0, preferentialIndex: 0, amount: 3300 },
    { rate: .15, preferentialIndex: 1, amount: 6700 },
  ]);
});

test('default brokerage withdrawals are entirely long-term gains and count toward NIIT', () => {
  const input = scenario();
  Object.assign(input, { wages: 580000, brokerageWithdrawal: 10000 });
  const result = calculate(input);
  assert.equal(result.niit, 380);
  const account = withdrawalTaxBands(input).find(row => row.name === 'Taxable brokerage withdrawals');
  assert.deepEqual(account.bands.filter(band => band.amount), [{ rate: .20, preferentialIndex: 2, amount: 10000 }]);
});

test('custom brokerage gains split ordinary and preferential income while preserving cash', () => {
  const input = scenario();
  Object.assign(input, {
    wages: 65000, brokerageWithdrawal: 12000,
    brokerageLongTermGain: 4000, brokerageShortTermGain: 3000,
  });
  const result = calculate(input);
  const base = calculate({ ...input, brokerageLongTermGain: 0, brokerageShortTermGain: 0 });
  assert.equal(result.agi, 72000);
  assert.equal(result.cash, 77000);
  assert.equal(rounded(result.tax - base.tax), 960);
  const account = withdrawalTaxBands(input).find(row => row.name === 'Taxable brokerage withdrawals');
  assert.deepEqual(account.bands.filter(band => band.amount), [
    { rate: 0, amount: 5000 },
    { rate: .12, amount: 3000, shortTerm: true },
    { rate: .15, preferentialIndex: 1, amount: 4000 },
  ]);
});

test('short-term brokerage gains remain investment income for NIIT', () => {
  const input = scenario();
  Object.assign(input, {
    wages: 200000, brokerageWithdrawal: 10000,
    brokerageShortTermGain: 4000, brokerageLongTermGain: 6000,
  });
  const result = calculate(input);
  assert.equal(result.ordinary, 187400);
  assert.equal(result.niit, 380);
});

test('blank brokerage details assume all long-term gain, while an explicit zero uses principal', () => {
  const input = scenario();
  input.brokerageWithdrawal = 12000;
  assert.equal(calculate(input).brokerage.longTerm, 12000);
  input.brokerageLongTermGain = 0;
  assert.equal(calculate(input).brokerage.principal, 12000);
  input.brokerageLongTermGain = null;
  assert.equal(calculate(input).brokerage.longTerm, 12000);
});

test('HSA medical withdrawals stay out of taxable income and the nonmedical portion affects taxable Social Security', () => {
  const input = scenario();
  Object.assign(input, { wages: 20000, social: 20000 });
  Object.assign(input.owners[0], { age: 64, hsaWithdrawal: 10000, hsaMedical: 6000 });
  const result = calculate(input);
  assert.deepEqual(result.hsa, { gross: 10000, medical: 6000, taxable: 4000, additionalTax: 800 });
  assert.equal(result.taxableSS, 4500);
  assert.equal(result.agi, 28500);
  assert.equal(result.cash, 50000);
  assert.equal(result.tax - result.regular, 800);
  assert.equal(result.investments, 0);
  const account = withdrawalTaxBands(input).find(row => row.name === 'HSA withdrawals');
  assert.deepEqual(account.bands.filter(band => band.amount), [{ rate: 0, amount: 6000 }, { rate: .10, amount: 4000 }]);
  input.owners[0].hsaMedical = 15000;
  assert.equal(calculate(input).hsa.additionalTax, 0);
  assert.equal(calculate(input).hsa.medical, 10000);
});

test('joint HSA estimates apply the additional tax separately and support the age-65 and disability exceptions', () => {
  const input = scenario();
  input.status = 'joint';
  Object.assign(input.owners[0], { age: 60, hsaWithdrawal: 5000, hsaPenaltyBase: 0 });
  Object.assign(input.owners[1], { age: 65, hsaWithdrawal: 3000, hsaMedical: 1000 });
  assert.equal(calculate(input).hsa.additionalTax, 0);
  input.owners[1].hsaPenaltyBase = 1000;
  assert.equal(calculate(input).hsa.additionalTax, 200);
  input.owners[1].age = 66;
  assert.equal(calculate(input).hsa.additionalTax, 0);
  assert.equal(calculate(input).hsa.taxable, 7000);
});

test('a QCD counts towards the IRA RMD before conversion and is excluded from spendable cash', () => {
  const input = scenario();
  Object.assign(input.owners[0], { age: 73, iraBalance: 265000, iraRmd: 2000, iraCharity: 8000, conversion: 30000, deferIra: true });
  const result = calculate(input);
  assert.deepEqual(result.charity, { gross: 8000, excluded: 8000, taxable: 0 });
  assert.equal(result.retirement[0].conversionShortfall, 0);
  assert.equal(result.retirement[0].shortfall, 0);
  assert.equal(result.cash, 2000);
  assert.equal(result.agi, 32000);
  const gift = withdrawalTaxBands(input).find(row => row.name === 'Direct IRA gifts to charity');
  assert.deepEqual(gift.bands.filter(band => band.amount), [{ rate: 0, amount: 8000 }]);
  input.owners[0].iraCharity = 6000;
  assert.equal(calculate(input).retirement[0].conversionShortfall, 2000);
});

test('the 2027 QCD limit and unused contribution offsets apply separately to spouses', () => {
  const input = scenario();
  input.status = 'joint';
  Object.assign(input.owners[0], { age: 72, iraCharity: 120000, qcdOffset: 4000 });
  Object.assign(input.owners[1], { age: 71, iraCharity: 9000 });
  assert.deepEqual(calculate(input).charity, { gross: 129000, excluded: 110000, taxable: 19000 });
  input.owners[1].qcdAgeConfirmed = true;
  assert.deepEqual(calculate(input).charity, { gross: 129000, excluded: 119000, taxable: 10000 });
  input.owners[1].age = 69;
  assert.equal(calculate(input).charity.excluded, 110000);
});

test('the QCD uses taxable IRA dollars before basis and adjusts the pro rata cash calculation', () => {
  const input = scenario();
  const owner = input.owners[0];
  Object.assign(owner, { age: 75, iraBeforeFlows: 30000, iraBasis: 10000, iraCharity: 25000, iraExtra: 5000 });
  const exhausted = calculate(input);
  assert.deepEqual(exhausted.charity, { gross: 25000, excluded: 20000, taxable: 0 });
  assert.equal(exhausted.agi, 0);
  assert.equal(exhausted.cash, 5000);

  Object.assign(owner, { iraBeforeFlows: 60000, iraBasis: 10000, iraCharity: 10000, iraExtra: 5000, conversion: 5000 });
  const mixed = calculate(input);
  assert.equal(mixed.retirement[0].iraTaxable, 4000);
  assert.equal(mixed.conversion, 4000);
  assert.equal(mixed.agi, 8000);
  assert.equal(calculate(input, { omitConversion: true }).agi, 4000);
});
