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
  Object.assign(input, { wages: 65000, savingsDraw: 5000, brokeragePrincipal: 3000 });
  Object.assign(input.owners[0], { rothCash: 4000, planExtra: 10000 });
  const sources = withdrawalTaxBands(input);
  for (const name of ['Cash savings', 'Taxable brokerage principal', 'Roth IRA withdrawals']) {
    const source = sources.find(row => row.name === name);
    assert.deepEqual(source.bands.filter(band => band.amount), [{ rate: 0, amount: source.gross }]);
  }
  const plan = sources.find(row => row.name === 'Non-Roth 401(k) withdrawals');
  assert.deepEqual(plan.bands.filter(band => band.amount), [{ rate: .12, amount: 3625 }, { rate: .22, amount: 6375 }]);
  for (const { gross, bands } of sources) {
    assert.equal(rounded(bands.reduce((sum, band) => sum + band.amount, 0)), gross);
  }
});

test('withdrawal tax bands show the portion of 401(k) income sheltered by the standard deduction', () => {
  const input = scenario();
  input.owners[0].planExtra = 20000;
  const plan = withdrawalTaxBands(input).find(row => row.name === 'Non-Roth 401(k) withdrawals');
  assert.deepEqual(plan.bands.filter(band => band.amount), [{ rate: 0, amount: 16600 }, { rate: .10, amount: 3400 }]);
});

test('other taxable income, brokerage principal, and the two Roth accounts flow separately', () => {
  const input = scenario();
  Object.assign(input, { wages: 40000, gains: 3000, brokeragePrincipal: 9000, brokerageIncomeDraw: 3000 });
  Object.assign(input.owners[0], { rothCash: 2000, rothEarnings: 300, rothPlanCash: 4000, rothPlanEarnings: 500 });
  const result = calculate(input);
  assert.equal(result.agi, 43800);
  assert.equal(result.cash, 58000);
  assert.equal(result.rothTaxable, 800);
  assert.ok(result.tax > 0);
});
