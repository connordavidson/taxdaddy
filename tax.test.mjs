import assert from 'node:assert/strict';
import test from 'node:test';
import { calculate, rmdFor, taxableSocialSecurity, EMPTY, STATUSES, ordinaryTax } from './dist/tax.mjs';

const scenario = () => structuredClone(EMPTY);
const rounded = value => Math.round(value * 100) / 100;

test('2027 single filer income, deduction, dividend stack and spendable cash', () => {
  const input = scenario();
  Object.assign(input, { pension: 20000, social: 24000, qualified: 3000 });
  Object.assign(input.owners[0], { age: 74, iraBalance: 255000, iraRmd: 10000, conversion: 20000 });
  const result = calculate(input);
  assert.equal(rmdFor(input.owners[0]).ira, 10000);
  assert.equal(result.taxableSS, 20400);
  assert.equal(result.agi, 73400);
  assert.equal(result.baseDeduction + result.senior, 24700);
  assert.equal(result.taxable, 48700);
  assert.equal(result.ordinary, 45700);
  assert.equal(result.tax, 5228);
  assert.equal(result.cash, 57000);
  assert.equal(result.net, 51772);
  assert.equal(calculate(input, true).cash, result.cash);
});

test('2027 ordinary bracket exact boundary', () => {
  assert.equal(ordinaryTax(52025, STATUSES.single.bracket), 5987);
  assert.equal(rounded(ordinaryTax(52026, STATUSES.single.bracket)), 5987.22);
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
  assert.equal(calculate(input, true).traditionalTaxable, 19000);
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
  assert.equal(taxableSocialSecurity(20000, 16000, 0, STATUSES.single.ss, false), 500);
  assert.equal(taxableSocialSecurity(20000, 26000, 0, STATUSES.single.ss, false), 6200);
  assert.equal(taxableSocialSecurity(20000, 100000, 0, STATUSES.single.ss, false), 17000);
  assert.equal(taxableSocialSecurity(4000, 8000, 0, STATUSES.separate.ss, true), 3400);
});

test('conversion-triggered NIIT is limited to investments and reinvestments stay taxable', () => {
  const input = scenario();
  Object.assign(input, { wages: 195000, qualified: 10000, reinvested: 10000 });
  input.owners[0].conversion = 30000;
  assert.equal(calculate(input).niit, 380);
  assert.equal(calculate(input, true).niit, 190);
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
  assert.equal(rounded(result.regular - ordinaryTax(560000, STATUSES.single.bracket)), 1840);
});
