import { brokerageAmounts, calculate, enhancedSeniorPolicy, householdOwners, rmdFor, withdrawalTaxBands, EMPTY, EXAMPLE } from './tax.mjs';
import { rulesFor, SUPPORTED_TAX_YEARS } from './tax-rules/catalog.mjs';
import { initGrowthView } from './growth-view.mjs';
import { loadPlanner, savePlanner } from './planner-storage.mjs';

const $ = id => document.getElementById(id);
const dollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 0 });
const preciseDollars = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2 });
const percent = new Intl.NumberFormat('en-US', { style: 'percent' });
const money = value => dollars.format(Math.abs(value) < .5 ? 0 : value);
const exact = value => Number.isInteger(value) ? money(value) : preciseDollars.format(value);
const activeOwners = () => householdOwners(state);
const taxRules = () => rulesFor(state.taxYear);
const ownerName = i => i ? 'Spouse' : state.status === 'joint' ? 'You' : 'Account owner';
const saved = loadPlanner();
let state = saved.scenario;

function updateSaveStatus(available) {
  const status = $('save-status');
  const message = available ? 'Edits are saved in this browser.' : 'Browser storage is unavailable. Edits may be lost when you reload.';
  if (status.textContent !== message) status.textContent = message;
}

function save() {
  updateSaveStatus(savePlanner(state, growthView.settings));
}

const withdrawalParts = {
  iraWithdrawal: ['iraRmd', 'iraExtra'],
  planWithdrawal: ['planRmd', 'planExtra'],
};

function fieldValue(target, field) {
  const parts = withdrawalParts[field];
  return parts ? Math.round(parts.reduce((sum, part) => sum + target[part], 0) * 100) / 100 : target[field];
}

function setAmount(target, field, amount) {
  const parts = withdrawalParts[field];
  if (!parts) {
    target[field] = amount;
    return;
  }
  let remaining = amount;
  for (const part of parts.slice(0, -1)) {
    target[part] = Math.min(target[part], remaining);
    remaining = Math.round((remaining - target[part]) * 100) / 100;
  }
  target[parts.at(-1)] = remaining;
}

function numberInput(id, title, value, options = {}) {
  const { unit = '$', max = 1000000000, step = '.01', hint = '' } = options;
  return `<label class="field" for="${id}"><span>${title}</span>
    <span class="input-shell ${unit === '$' ? 'money' : ''}">${unit === '$' ? '<span class="affix" aria-hidden="true">$</span>' : ''}
    <input id="${id}" data-key="${id}" type="number" inputmode="${step === 1 ? 'numeric' : 'decimal'}" min="0" max="${max}" step="${step}" value="${value}" ${hint ? `aria-describedby="${id}-hint"` : ''}></span>
    ${hint ? `<span class="assist" id="${id}-hint">${hint}</span>` : ''}</label>`;
}

function slider(id, title, value, limits, hint = '', hoverHint = '') {
  const [maximum, step] = limits;
  const descriptions = [hint && id + '-hint', hoverHint && id + '-help'].filter(Boolean).join(' ');
  return `<div class="control${hoverHint ? ' withdrawal-with-help' : ''}">
    <label for="${id}">${title}${hoverHint ? ' <span class="withdrawal-info" aria-hidden="true">?</span>' : ''}</label>
    <span class="input-shell money"><span class="affix" aria-hidden="true">$</span>
      <input id="${id}" data-key="${id}" type="number" inputmode="decimal" min="0" max="1000000000" step=".01" value="${value}" ${descriptions ? `aria-describedby="${descriptions}"` : ''}>
    </span>
    <input id="${id}-slider" data-key="${id}" data-base-max="${maximum}" type="range" min="0" max="${Math.max(maximum, Math.ceil(value / step) * step)}" step="${step}" value="${value}" aria-label="${title} slider" ${descriptions ? `aria-describedby="${descriptions}"` : ''}>
    ${hint ? `<span class="assist" id="${id}-hint">${hint}</span>` : ''}
    ${hoverHint ? `<span class="withdrawal-help" id="${id}-help" role="tooltip">${hoverHint}</span>` : ''}
  </div>`;
}

function check(id, title, selected) {
  return `<label class="check"><input id="${id}" data-key="${id}" type="checkbox" ${selected ? 'checked' : ''}><span>${title}</span></label>`;
}

function accountPair(id, name, target, balance, withdrawal, additional = '', hoverHint = '') {
  const prefix = id ? id + '.' : '';
  return `<section class="account-pair" aria-labelledby="${prefix + balance}-heading">
    <h4 id="${prefix + balance}-heading">${name}</h4>
    <div class="field-grid">
      ${numberInput(prefix + balance, 'Starting balance', target[balance])}
      ${slider(prefix + withdrawal, 'Expected withdrawal', fieldValue(target, withdrawal), [100000, 500], '', hoverHint)}
    </div>
    ${additional}
  </section>`;
}

const brokerageGainFields = {
  brokerageLongTermGain: 'longTerm',
  brokerageShortTermGain: 'shortTerm',
  brokerageIncomeDraw: 'otherIncome',
};

function brokerageGainControls() {
  return `<details class="inline-detail" id="brokerage-gain-details">
    <summary>Taxable brokerage gain details</summary>
    <div class="brokerage-gain-fields">
      <p class="assist">Leave every field blank to assume 100% long-term gain. Enter net realized gains after subtracting adjusted cost basis and applicable losses. Enter $0 to specify no gain.</p>
      <div class="field-grid">
        ${numberInput('brokerageLongTermGain', 'Net long-term gain', state.brokerageLongTermGain ?? '', { hint: 'Generally, assets held more than one year.' })}
        ${numberInput('brokerageShortTermGain', 'Net short-term gain', state.brokerageShortTermGain ?? '', { hint: 'Generally, assets held one year or less.' })}
      </div>
      ${numberInput('brokerageIncomeDraw', 'Other investment income already reported', state.brokerageIncomeDraw ?? '', { hint: 'Use for dividends or interest already entered under Annual income. The unused portion of the withdrawal is treated as principal.' })}
    </div>
  </details>`;
}

function syncBrokerageGainControls(editedField) {
  const split = brokerageAmounts(state);
  $('brokerageWithdrawal-help').textContent = split.custom
    ? 'Uses the gain amounts entered below. The remaining amount, after any separately entered investment income, is principal.'
    : 'Assumes 100% long-term capital gain until you enter amounts in Taxable brokerage gain details below.';

  for (const [field, part] of Object.entries(brokerageGainFields)) {
    const input = $(field);
    if (state[field] != null) state[field] = split[part];
    input.max = split.custom ? Math.round((split.principal + split[part]) * 100) / 100 : split.total;
    if (field !== editedField) input.value = state[field] ?? '';
  }
}

function household() {
  const statusOptions = Object.entries(taxRules().statuses).map(([id, status]) => `<option value="${id}" ${id === state.status ? 'selected' : ''}>${status.name}</option>`).join('');
  return `<div class="field-grid">
    <label class="field" for="status"><span>Filing status</span><select id="status" data-key="status">${statusOptions}</select></label>
  </div>
  <h3 class="subheading">Shared cash and investments</h3>
  ${accountPair('', 'Cash savings', state, 'savingsBalance', 'savingsDraw')}
  ${accountPair('', 'Taxable brokerage', state, 'brokerageBalance', 'brokerageWithdrawal', brokerageGainControls(), 'Brokerage gain assumption')}
  <div id="separate-controls" ${state.status !== 'separate' ? 'hidden' : ''}>${check('livedTogether', `I lived with my spouse at some point in ${state.taxYear}`, state.livedTogether)}</div>
  <div id="owner-balances">${balances()}</div>
  <details class="advanced"><summary>Deductions</summary>
  ${check('useItemized', 'Use itemized deductions', state.useItemized)}
  <div id="itemized-control" ${state.useItemized ? '' : 'hidden'}>
    ${numberInput('itemized', 'Allowed itemized deductions', state.itemized, { hint: 'Enter your total after applicable limits. If married filing separately and your spouse itemizes, select this and enter your amount, even if it is $0.' })}
  </div>
  ${activeOwners().map((owner, i) => `<div class="owner-section"><h3 class="subheading first">${ownerName(i)}</h3>
    ${check(`${i}.blind`, 'Qualifies as blind for the additional standard deduction', owner.blind)}
    ${check(`${i}.seniorSSN`, 'Has a valid Social Security number for the senior deduction', owner.seniorSSN)}</div>`).join('')}
  </details>`;
}

function balances() {
  const hsaPolicy = taxRules().hsa;
  return activeOwners().map((owner, i) => {
    const fields = (key, label, options) => numberInput(`${i}.${key}`, label, owner[key], options);
    const hsaDetails = `<div class="field-grid">
      ${fields('hsaMedical', 'For qualified medical expenses', { hint: 'Include eligible payments or reimbursements. The rest of the withdrawal is taxable.' })}
    </div>
    <details class="inline-detail"><summary>HSA additional tax details</summary>
      ${numberInput(`${i}.hsaPenaltyBase`, 'Taxable amount subject to the additional tax', owner.hsaPenaltyBase ?? '', {
        hint: `Leave blank to use the default based on your age. If you turn ${hsaPolicy.additionalTaxEndsAt} this year or qualify for a disability exception, enter the taxable amount still subject to the ${percent.format(hsaPolicy.additionalTaxRate)} additional tax, even if zero.`,
      })}
    </details>`;
    return `<h3 class="subheading">${ownerName(i)}</h3><div class="field-grid">
      ${fields('age', `Age attained in ${state.taxYear}`, { unit: '', max: 130, step: 1 })}
      </div>
      ${accountPair(String(i), 'Traditional / SEP / SIMPLE IRA', owner, 'iraBalance', 'iraWithdrawal')}
      ${accountPair(String(i), '401(k) / 403(b)', owner, 'planBalance', 'planWithdrawal')}
      ${accountPair(String(i), 'Roth IRA', owner, 'rothBalance', 'rothCash')}
      ${accountPair(String(i), 'Roth 401(k) / 403(b)', owner, 'rothPlanBalance', 'rothPlanCash')}
      ${accountPair(String(i), 'Health savings account (HSA)', owner, 'hsaBalance', 'hsaWithdrawal', hsaDetails)}`;
  }).join('');
}

function income() {
  return `${numberInput('wages', 'Other taxable income (including part-time wages)', state.wages, { hint: 'Enter annual taxable pay or other ordinary income. Enter pensions, Social Security, interest, dividends, and gains separately.' })}
    ${slider('pension', 'Pension income', state.pension, [100000, 500])}
    ${slider('social', 'Social Security benefits', state.social, [100000, 500])}
    ${slider('qualified', 'Qualified dividends', state.qualified, [40000, 250])}
    ${slider('dividends', 'Nonqualified dividends', state.dividends, [40000, 250], 'Form 1099-DIV box 1a minus box 1b.')}
    <details class="advanced"><summary>Other income and taxable amounts</summary><div class="field-grid">
      ${numberInput('pensionTaxable', 'Taxable pension (%)', state.pensionTaxable, { unit: '%', max: 100, hint: 'Use the taxable share from your plan or Form 1099-R.' })}
      ${numberInput('interest', 'Taxable interest', state.interest)}
      ${numberInput('exempt', 'Tax-exempt interest', state.exempt)}
      ${numberInput('gains', 'Other net long-term gains at preferential rates', state.gains, { hint: 'Enter eligible gains you did not enter under Taxable brokerage.' })}
      ${numberInput('reinvested', 'Investment income kept invested', state.reinvested, { hint: 'Included in taxes and excluded from spending cash.' })}
    </div></details>`;
}

function withdrawals() {
  const qcd = taxRules().rmd.qcd;
  const minAge = qcd.minAge === 70.5 ? '70½' : qcd.minAge;
  return activeOwners().map((owner, i) => {
    const amount = (key, label, max = 100000, step = 500, hint) => slider(`${i}.${key}`, label, owner[key], [max, step], hint);
    const field = (key, label, options) => numberInput(`${i}.${key}`, label, owner[key], options);
    const flag = (key, label) => check(`${i}.${key}`, label, owner[key]);
    const inner = `<div class="rmd-note"><span id="rmd-${i}"></span><button type="button" class="button" data-rmd="${i}">Use minimums</button></div>
      ${amount('iraRmd', 'RMD portion of traditional IRA cash withdrawal')}
      ${amount('planRmd', 'RMD portion of workplace-plan withdrawal')}
      <details class="advanced" ${owner.iraCharity ? 'open' : ''}><summary>Qualified charitable distributions (QCDs)</summary>
        ${field('iraCharity', 'Direct IRA transfer to eligible charity', { hint: `Enter separately from your IRA cash withdrawal. An eligible transfer at age ${minAge} or older can count toward the IRA RMD. The ${state.taxYear} exclusion limit is ${money(qcd.annualLimit)} per person.` })}
        <div id="qcd-age-confirmation-${i}" hidden>
          ${flag('qcdAgeConfirmed', `I will be at least ${minAge} at the time of the transfer`)}
        </div>
        ${field('qcdOffset', 'Unused deductible IRA contributions at age ' + minAge + ' or older', { hint: 'Enter the amount from the IRS QCD Adjustment Worksheet that still reduces your exclusion. Leave at zero if none.' })}
        <p class="assist" id="qcd-result-${i}" hidden></p>
      </details>
      ${amount('conversion', 'Traditional IRA to Roth IRA conversion', 150000, 500)}
      <p class="assist" id="conversion-warning-${i}" hidden></p>
      <details class="advanced"><summary>Account tax details and RMD timing</summary>
        <div class="field-grid">
          ${field('iraBasis', 'Available nondeductible IRA basis', { hint: 'Per owner, using Form 8606.' })}
          ${field('iraBeforeFlows', 'Projected IRA value before withdrawals', { hint: `Enter all Dec. 31, ${state.taxYear} traditional, SEP and SIMPLE IRA values plus cash withdrawals, direct charitable transfers, and the conversion.` })}
          ${field('planTaxable', 'Taxable non-Roth workplace-plan cash (%)', { unit: '%', max: 100 })}
          ${field('rothEarnings', 'Taxable Roth IRA earnings withdrawn')}
          ${field('rothPlanEarnings', 'Taxable Roth workplace-plan earnings withdrawn')}
          ${field('earlyBase', `Amount subject to ${percent.format(taxRules().earlyDistribution.rate)} early-distribution tax`, { hint: 'Enter only amounts still subject to the tax after any exceptions or Roth recapture rules.' })}
          ${field('priorIra', `${state.taxYear - 1} IRA RMD still due in ${state.taxYear}`)}
          ${field('priorPlan', `${state.taxYear - 1} workplace-plan RMD still due in ${state.taxYear}`)}
        </div>
        ${flag('planExempt', 'Current-employer plan allows a still-working RMD delay and I satisfy the ownership rule')}
        ${flag('deferIra', `Delay first IRA RMD to April 1, ${state.taxYear + 1} (if first due this year)`)}
        ${flag('deferPlan', `Delay first eligible workplace-plan RMD to April 1, ${state.taxYear + 1} (including a first year after retirement)`)}
      </details>`;
    if (i) return `<details class="advanced owner-section"><summary>Spouse’s withdrawals &amp; conversions</summary>${inner}</details>`;
    return `<div class="owner-section">${state.status === 'joint' ? '<h3 class="subheading first">Your accounts</h3>' : ''}${inner}</div>`;
  }).join('');
}

function row(label, value, options = {}) {
  return `<div${options.total ? ' class="total"' : ''}><dt>${options.color !== undefined ? `<span class="key key-${options.color}" aria-hidden="true"></span>` : ''}${label}</dt><dd>${value}</dd></div>`;
}

function cashChart(calc) {
  const cash = [
    ['Pension & Social Security', state.pension + state.social],
    ['Retirement withdrawals', calc.traditionalCash + calc.roth],
    ['Investment income received', calc.investments - calc.reinvested + state.exempt],
    ['Other taxable income & principal withdrawals', state.wages + state.savingsDraw + calc.brokerage.principal],
    ...(calc.hsa.gross ? [['HSA withdrawals', calc.hsa.gross]] : []),
  ];
  const bar = $('income-bar');
  bar.setAttribute('aria-label', 'Cash by source. ' + cash.map(([name, amount]) => `${name} ${money(amount)}`).join('. '));
  bar.replaceChildren(...cash.map(([, amount]) => {
    const part = document.createElement('span');
    part.className = 'bar-part';
    part.style.flexBasis = calc.cash ? (100 * amount / calc.cash) + '%' : '0%';
    return part;
  }));
  $('breakdown').innerHTML = cash.map(([label, amount], color) => row(label, money(amount), { color })).join('')
    + row('Adjusted gross income (AGI)', money(calc.agi), { total: true })
    + row('Taxable income after deductions', money(calc.taxable));
}

function issueList(calc) {
  const issues = [];
  calc.owners.forEach((owner, i) => {
    const { rmd, iraDistributed, planCash, shortfall, conversionShortfall, charity, hsa } = calc.retirement[i];
    const label = ownerName(i);
    const minimum = [`IRA ${exact(rmd.ira)}`, `Workplace plan ${exact(rmd.plan)}`].join(' · ');
    $(`rmd-${i}`).textContent = rmd.needsReview ? 'RMD eligibility needs confirmation for this birth cohort' : `Calculated ${state.taxYear} minimums · ` + minimum;
    const button = document.querySelector(`[data-rmd="${i}"]`);
    button.disabled = !(rmd.ira + rmd.plan + owner.priorIra + owner.priorPlan);
    if (shortfall > .005) issues.push(`${label}: ${exact(shortfall)} in estimated RMDs due in ${state.taxYear} is still unpaid in this scenario. Any excise tax is separate.`);
    const warning = $(`conversion-warning-${i}`);
    warning.hidden = !conversionShortfall;
    warning.textContent = conversionShortfall ? `Distribute ${exact(conversionShortfall)} more from the IRA before converting.` : '';
    if (conversionShortfall) issues.push(`${label}: distribute at least ${exact(conversionShortfall)} more from the IRA to satisfy the RMD before making the modeled conversion.`);
    $(`qcd-age-confirmation-${i}`).hidden = !charity.ageConfirmationNeeded;
    const qcdResult = $(`qcd-result-${i}`);
    qcdResult.hidden = !charity.gross;
    qcdResult.textContent = `${money(charity.excluded)} excluded as a QCD. ${money(charity.taxable)} included in ordinary income.`;
    if (charity.gross && !charity.ageEligible) issues.push(`${label}: confirm you reached the QCD qualifying age by the transfer date. The IRA gift uses ordinary IRA distribution rules until age eligibility is established.`);
    if (iraDistributed + owner.conversion > owner.iraBalance && owner.iraBalance > 0) issues.push(`${label}: IRA withdrawals, charitable transfers, and conversion exceed the starting IRA balance. Verify projected funds.`);
    if (planCash > owner.planBalance && owner.planBalance > 0) issues.push(`${label}: workplace-plan withdrawals exceed the starting balance. Verify projected funds.`);
    if (owner.rothCash > owner.rothBalance && owner.rothBalance > 0) issues.push(`${label}: Roth withdrawals exceed the starting Roth balance. Verify projected funds.`);
    if (owner.rothPlanCash > owner.rothPlanBalance && owner.rothPlanBalance > 0) issues.push(`${label}: Roth workplace-plan withdrawals exceed the starting balance. Verify projected funds.`);
    if (owner.rothEarnings > owner.rothCash || owner.rothPlanEarnings > owner.rothPlanCash) issues.push(`${label}: taxable Roth earnings were capped at the Roth cash withdrawn.`);
    if (owner.age < Math.ceil(taxRules().earlyDistribution.minAge) && !owner.earlyBase && (iraDistributed || planCash || owner.rothEarnings || owner.rothPlanEarnings)) issues.push(`${label}: verify age at withdrawal and any early-distribution exception. The tax estimate uses the penalty base you enter.`);
    if (owner.iraBasis && owner.iraBeforeFlows < iraDistributed + owner.conversion) issues.push(`${label}: check the projected IRA value used for the pro rata calculation. Include the modeled distributions, conversion, and balance remaining at year-end.`);
    if (hsa.gross > owner.hsaBalance && owner.hsaBalance > 0) issues.push(`${label}: HSA withdrawals exceed the starting HSA balance. Verify projected funds.`);
    if (owner.hsaMedical > hsa.gross) issues.push(`${label}: qualified medical expenses were capped at the HSA withdrawal.`);
    if (hsa.taxable && owner.age === taxRules().hsa.additionalTaxEndsAt && owner.hsaPenaltyBase == null) issues.push(`${label}: the HSA estimate assumes your taxable withdrawals occur after you turn ${taxRules().hsa.additionalTaxEndsAt}. Use HSA additional tax details for earlier withdrawals.`);
    if (rmd.needsReview && (owner.iraBalance || owner.planBalance)) issues.push(`${label}: confirm the RMD start age before using this estimate. The current-year minimum was skipped where eligibility is unresolved.`);
    if (owner.deferIra && !rmd.canDeferIra) issues.push(`${label}: the IRA first-year delay applies only in the first required distribution year. The model included any known current minimum.`);
  });
  if (fieldValue(state, 'brokerageWithdrawal') > state.brokerageBalance && state.brokerageBalance > 0) issues.push('The brokerage withdrawal exceeds the starting balance. Verify projected funds.');
  const investmentCash = calc.investments - calc.brokerage.longTerm - calc.brokerage.shortTerm - calc.reinvested + state.exempt;
  if (calc.brokerage.otherIncome - investmentCash > .005) issues.push('The brokerage withdrawal includes more investment income than the amount available as cash under Annual income. Check reported income and reinvestment.');
  if (state.savingsBalance && state.savingsDraw > state.savingsBalance) issues.push('The savings draw exceeds the starting savings balance. Verify projected funds.');
  if (calc.agi > 100000 && state.useItemized) issues.push('This estimate uses the itemized amount you entered. Confirm applicable limits and whether alternative minimum tax applies.');
  $('review').hidden = !issues.length;
  $('issues').replaceChildren(...issues.map(issue => {
    const li = document.createElement('li');
    li.textContent = issue;
    return li;
  }));
}

function project() {
  const calc = calculate(state);
  const baseline = calculate(state, { omitConversion: true });
  $('net').textContent = money(calc.net);
  $('cash').textContent = money(calc.cash);
  $('tax').textContent = money(calc.tax);
  $('hsa-cash-note').hidden = !calc.hsa.medical;
  $('summary-warning').hidden = !calc.retirement.some((owner, index) => owner.conversionShortfall > 0 || (owner.rmd.needsReview && calc.owners[index].conversion > 0));
  $('mobile-net').textContent = money(calc.net);
  $('mobile-tax').textContent = money(calc.tax);
  cashChart(calc);
  $('tax-detail').innerHTML = [
    row('Taxable Social Security', money(calc.taxableSS)),
    row(state.useItemized ? 'Itemized deductions' : 'Standard deduction with any age or blind add-ons', money(calc.baseDeduction)),
    row('Enhanced senior deduction', money(calc.senior)),
    row('Ordinary federal bracket', percent.format(calc.marginal)),
    row('Regular income tax', money(calc.regular)),
    row('Net investment income tax', money(calc.niit)),
    row('Early-distribution additional tax', money(calc.early)),
    ...(calc.hsa.gross ? [
      row('Taxable HSA withdrawals', money(calc.hsa.taxable)),
      row('HSA additional tax', money(calc.hsa.additionalTax)),
    ] : []),
    ...(calc.charity.gross ? [
      row('IRA gifts to charity', money(calc.charity.gross)),
      row('Excluded as QCDs', money(calc.charity.excluded)),
      row('Taxable portion of IRA gifts', money(calc.charity.taxable)),
    ] : []),
  ].join('');
  $('comparison').innerHTML = [
    row('Taxable Roth conversion', money(calc.conversion)),
    row('Tax owed', money(calc.tax - baseline.tax), { total: true }),
  ].join('');
  issueList(calc);
  renderWithdrawalBands(calc);
  bracketTable(state.status);
  if (!$('scenario').hidden) growthView.render();
}

function bracketTable(selected) {
  const wrapper = $('bracket-rules');
  const key = `${state.taxYear}-${selected}`;
  if (wrapper.dataset.status === key) return;
  wrapper.dataset.status = key;
  const rules = taxRules();
  const status = rules.statuses[selected];
  const rows = rules.ordinaryRates.map((rate, index) => `<tr><td>${percent.format(rate)}</td><td>${bracketRange(status.bracket, index)}</td></tr>`).join('');
  wrapper.innerHTML = `<table><caption>Current scenario · ${status.name}</caption>
    <thead><tr><th scope="col">Ordinary rate</th><th scope="col">Taxable ordinary income</th></tr></thead><tbody>${rows}</tbody></table>
    <dl class="breakdown">${row('Base standard deduction', money(status.standard))}
      ${status.gains.map((limit, index) => row(`Qualified dividends & eligible gains · ${percent.format(rules.preferentialRates[index])} ceiling`, money(limit))).join('')}
    </dl>`;
}

function renderInputs() {
  $('household').innerHTML = household();
  $('income').innerHTML = income();
  $('withdrawals').innerHTML = withdrawals();
  syncBrokerageGainControls();
}

function updateSlider(id, value) {
  const range = $(id + '-slider');
  if (!range) return;
  range.max = Math.max(Number(range.dataset.baseMax), Math.ceil(value / Number(range.step)) * Number(range.step));
  range.value = value;
}

function refreshAmount(id, value) {
  $(id).value = value;
  updateSlider(id, value);
}

function setIncludedAmount(target, totalField, portion, amount) {
  const total = fieldValue(target, totalField);
  const parts = withdrawalParts[totalField];
  target[portion] = amount;
  const included = parts.slice(0, -1).reduce((sum, part) => sum + target[part], 0);
  target[parts.at(-1)] = Math.round(Math.max(0, total - included) * 100) / 100;
}

document.addEventListener('input', (event) => {
  const input = event.target;
  const id = input.dataset.key;
  if (!id) return;
  const [owner, key] = id.split('.');
  const target = key ? state.owners[Number(owner)] : state;
  const field = key || id;
  if (input.type === 'checkbox') target[field] = input.checked;
  else if (input.tagName === 'SELECT') target[field] = id === 'taxYear' ? Number(input.value) : input.value;
  else if ((id in brokerageGainFields || field === 'hsaPenaltyBase') && input.value === '') {
    if (input.validity.badInput) return;
    target[field] = null;
  } else {
    const amount = Math.max(0, Math.min(Number(input.max), Number(input.value) || 0));
    const included = Object.entries(withdrawalParts).find(([, parts]) => parts.slice(0, -1).includes(field));
    if (included) {
      const [totalField] = included;
      setIncludedAmount(target, totalField, field, amount);
      refreshAmount(key ? `${owner}.${totalField}` : totalField, fieldValue(target, totalField));
    } else {
      setAmount(target, field, input.step === '1' ? Math.trunc(amount) : amount);
      if (withdrawalParts[field]) {
        for (const portion of withdrawalParts[field].slice(0, -1)) {
          refreshAmount(key ? `${owner}.${portion}` : portion, target[portion]);
        }
      }
    }
    if (input.type === 'range') $(id).value = amount;
    else updateSlider(id, amount);
  }
  if (id === 'status' || id === 'taxYear') {
    renderInputs();
    syncTaxYear();
    $(id).focus();
  }
  if (id === 'brokerageWithdrawal' || id in brokerageGainFields) syncBrokerageGainControls(id);
  if (id === 'useItemized') $('itemized-control').hidden = !state.useItemized;
  project();
  save();
});

document.addEventListener('change', (event) => {
  const input = event.target;
  if (input.type !== 'number' || !input.dataset.key) return;
  const [owner, key] = input.dataset.key.split('.');
  input.value = fieldValue(key ? state.owners[Number(owner)] : state, key || owner) ?? '';
});

$('withdrawals').addEventListener('click', (event) => {
  const button = event.target.closest('[data-rmd]');
  if (!button) return;
  const i = Number(button.dataset.rmd);
  const owner = state.owners[i];
  const { rmd: minimum, iraDue } = calculate(state).retirement[i];
  const round = value => Math.round(Math.max(0, value) * 100) / 100;
  const iraMinimum = owner.conversion ? minimum.ira + owner.priorIra : iraDue;
  setIncludedAmount(owner, 'iraWithdrawal', 'iraRmd', round(iraMinimum - (owner.iraCharity ?? 0)));
  setIncludedAmount(owner, 'planWithdrawal', 'planRmd', round((owner.deferPlan ? 0 : minimum.plan) + owner.priorPlan));
  for (const field of ['iraRmd', 'planRmd', 'iraWithdrawal', 'planWithdrawal']) {
    refreshAmount(`${i}.${field}`, fieldValue(owner, field));
  }
  project();
  save();
});

for (const [id, example] of [['empty', EMPTY], ['example', EXAMPLE]]) {
  $(id).addEventListener('click', () => {
    state = { ...structuredClone(example), taxYear: state.taxYear };
    if (id === 'example') {
      state.owners.forEach(owner => {
        const minimum = rmdFor(owner, taxRules());
        owner.iraRmd = minimum.ira;
        owner.planRmd = minimum.plan;
      });
    }
    renderInputs();
    project();
    save();
  });
}

const SCREENS = ['scenario', 'rules'];
const SCENARIO_SECTIONS = ['withdrawal-tax-brackets', 'growth'];

function syncTaxYear() {
  const rules = taxRules();
  document.querySelectorAll('[data-year]').forEach(element => {
    element.textContent = state.taxYear + Number(element.dataset.year);
  });
  $('year-badge').textContent = `Tax year ${state.taxYear}`;
  $('taxYear').value = state.taxYear;
  $('annual-source').textContent = rules.sources.annual.name;
  $('annual-source').href = rules.sources.annual.url;
  $('social-top').textContent = percent.format(rules.socialSecurity.topRate);
  $('niit-rate').textContent = new Intl.NumberFormat('en-US', { style: 'percent', maximumFractionDigits: 2 }).format(rules.niitRate);
  $('rmd-excise').textContent = percent.format(rules.rmd.excise.rate);
  $('rmd-correction').textContent = percent.format(rules.rmd.excise.correctionRate);
  $('qcd-age').textContent = rules.rmd.qcd.minAge;
  $('qcd-limit').textContent = money(rules.rmd.qcd.annualLimit);
  $('qcd-source').textContent = rules.sources.qcd.name;
  $('qcd-source').href = rules.sources.qcd.url;
  $('hsa-age').textContent = rules.hsa.additionalTaxEndsAt;
  $('hsa-tax-rate').textContent = percent.format(rules.hsa.additionalTaxRate);
  const status = rules.statuses[state.status];
  const senior = enhancedSeniorPolicy(rules);
  const basic = `The selected filing status adds ${money(status.aged)} to the standard deduction per qualifying age or blindness condition. The age threshold is ${rules.deductions.age}.`;
  const additional = senior && status.senior !== null
    ? ` The enhanced senior deduction starts at ${money(senior.amount)} per eligible person with a valid Social Security number. Each person’s amount falls by ${percent.format(senior.phaseout)} of modified AGI above ${money(status.senior)}. The model uses AGI as modified AGI.`
    : ' The enhanced senior deduction is unavailable for this selection.';
  $('deduction-rules').textContent = basic + additional;
}

function bracketRange(limits, index) {
  if (index === 0) return `Up to ${money(limits[0])}`;
  const lower = money(limits[index - 1]);
  return index === limits.length ? `Over ${lower}` : `Over ${lower} through ${money(limits[index])}`;
}

function hideBandTooltip() {
  $('band-tooltip').hidden = true;
}

function showBandTooltip(event) {
  const anchor = event.target.closest('[data-band-hint]');
  if (!anchor || (event.relatedTarget && anchor.contains(event.relatedTarget))) return;

  const tooltip = $('band-tooltip');
  tooltip.textContent = anchor.dataset.bandHint;
  tooltip.hidden = false;
  const anchorBox = anchor.getBoundingClientRect();
  const { width, height } = tooltip.getBoundingClientRect();
  const left = Math.max(8, Math.min(window.innerWidth - width - 8, anchorBox.left + (anchorBox.width - width) / 2));
  const top = anchorBox.top > height + 16 ? anchorBox.top - height - 8 : anchorBox.bottom + 8;
  tooltip.style.left = `${left}px`;
  tooltip.style.top = `${top}px`;
}

function renderWithdrawalBands(calc) {
  hideBandTooltip();
  const rows = withdrawalTaxBands(state, calc).filter(source => source.gross > 0);
  $('band-total-income').textContent = money(calc.agi);
  $('band-total-tax').textContent = money(calc.tax);
  $('band-details').hidden = !rows.length;

  const chart = $('withdrawal-bands');
  const rules = taxRules();
  const rates = [0, ...rules.ordinaryRates];
  const colorIndex = index => index === 0 ? 0 : Math.max(1, Math.round(index * 7 / (rates.length - 1)));
  const ranges = ['Tax-free distributions or ordinary income covered by deductions', ...rates.slice(1).map((_, index) => bracketRange(calc.status.bracket, index))];
  const bracketHint = (rate, index) => `${percent.format(rate)} · ${ranges[index]}${index ? ' in taxable ordinary income' : ''}`;
  const hasBrokerageGain = calc.brokerage.longTerm > 0;
  const gainsRanges = rules.preferentialRates.map((_, index) => bracketRange(calc.status.gains, index));
  const gainHint = (rate, index) => `${percent.format(rate)} long-term capital gains · ${gainsRanges[index]} in taxable income`;
  function legendEntry(label, hint, color) {
    return `<span class="band-key" tabindex="0" data-band-hint="${hint}" aria-label="${hint}"><i class="rate-chip ${color}" aria-hidden="true"></i>${label}</span>`;
  }
  $('band-legend').innerHTML = rates.map((rate, index) => legendEntry(percent.format(rate), bracketHint(rate, index), `rate-${colorIndex(index)}`)).join('');
  const gainsLegend = $('gains-legend');
  gainsLegend.hidden = !hasBrokerageGain;
  gainsLegend.innerHTML = hasBrokerageGain
    ? '<strong>Long-term gains</strong>' + rules.preferentialRates.map((rate, index) => legendEntry(percent.format(rate), gainHint(rate, index), `gain-${index}`)).join('')
    : '';
  if (!rows.length) {
    chart.innerHTML = '<p class="muted">Enter a withdrawal, direct IRA gift, or conversion to show its tax bands.</p>';
    $('band-table').replaceChildren();
    return;
  }

  const highest = Math.max(...rows.map(row => row.gross));
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(1, highest / 4)));
  const step = [1, 2, 2.5, 5, 10].map(size => size * magnitude).find(size => size * 4 >= highest);
  const scale = 4 * step;
  const ticks = [4, 3, 2, 1, 0].map(position => `<span>${money(position * step)}</span>`).join('');
  chart.innerHTML = `<div class="band-scroll" tabindex="0" role="region" aria-label="Stacked withdrawal columns">
    <div class="band-chart-grid">
      <div class="band-axis" aria-hidden="true">${ticks}</div>
      <div class="band-columns"></div>
    </div>
  </div>`;

  const columns = chart.querySelector('.band-columns');
  const tableRows = [];
  for (const { name, gross, bands } of rows) {
    const column = document.createElement('div');
    column.className = 'band-column';
    column.innerHTML = `<div class="band-plot"><div class="band-stack" role="img"></div></div>
      <div class="band-caption"><strong>${money(gross)}</strong><span>${name}</span></div>`;
    const track = column.querySelector('.band-stack');
    const amounts = [];
    for (const [index, { rate, amount, preferentialIndex, shortTerm }] of bands.entries()) {
      if (amount < .005) continue;
      const segment = document.createElement('span');
      const isGain = preferentialIndex !== undefined;
      const rateLabel = percent.format(rate);
      const bracketLabel = isGain ? `${rateLabel} LTCG` : shortTerm ? `${rateLabel} STCG` : rateLabel;
      const range = isGain ? gainsRanges[preferentialIndex] : ranges[index];
      const hint = isGain ? gainHint(rate, preferentialIndex) : bracketHint(rate, index);
      const sourceNote = shortTerm ? ' in short-term gains' : '';
      segment.className = isGain ? `gain-${preferentialIndex}` : `rate-${colorIndex(index)}`;
      segment.style.height = `${100 * amount / scale}%`;
      segment.dataset.bandHint = `${hint}. ${money(amount)}${sourceNote} of the ${money(gross)} total.`;
      amounts.push(`${money(amount)} at ${bracketLabel}`);
      track.append(segment);
      tableRows.push(`<tr><th scope="row">${name}</th><td>${bracketLabel}</td><td>${range}</td><td>${money(amount)}</td></tr>`);
    }
    track.setAttribute('aria-label', `${name}, ${money(gross)} total. ${amounts.join(', ')}`);
    columns.append(column);
  }
  $('band-table').innerHTML = `<table><thead><tr><th scope="col">Source</th><th scope="col">Federal bracket</th><th scope="col">Taxable income range</th><th scope="col">Amount</th></tr></thead>
    <tbody>${tableRows.join('')}</tbody></table>`;
}

function navigate() {
  const requested = location.hash.slice(1);
  const active = SCREENS.includes(requested) ? requested : 'scenario';
  const scenarioWasHidden = $('scenario').hidden;
  for (const screen of SCREENS) {
    $(screen).hidden = screen !== active;
    const link = $(screen + '-nav');
    if (screen === active) link.setAttribute('aria-current', 'page');
    else link.removeAttribute('aria-current');
  }
  $('mobile-projection').hidden = active !== 'scenario';
  if (active === 'scenario' && scenarioWasHidden) growthView.render();
  if (SCENARIO_SECTIONS.includes(requested)) $(requested).scrollIntoView();
  else window.scrollTo(0, 0);
}

$('taxYear').innerHTML = SUPPORTED_TAX_YEARS.map(year => `<option value="${year}">${year}</option>`).join('');
$('year-select').hidden = SUPPORTED_TAX_YEARS.length <= 1;
$('year-badge').hidden = !$('year-select').hidden;
const growthView = initGrowthView({ scenario: () => state, money, saved: saved.growth, onChange: save });
updateSaveStatus(saved.available);
renderInputs();
syncTaxYear();
project();
navigate();
window.addEventListener('hashchange', navigate);
const bracketCard = $('withdrawal-tax-brackets');
bracketCard.addEventListener('pointerover', showBandTooltip);
bracketCard.addEventListener('focusin', showBandTooltip);
bracketCard.addEventListener('pointerout', hideBandTooltip);
bracketCard.addEventListener('focusout', hideBandTooltip);
bracketCard.addEventListener('keydown', event => {
  if (event.key === 'Escape') hideBandTooltip();
});
window.addEventListener('scroll', hideBandTooltip, true);
window.addEventListener('resize', hideBandTooltip);
