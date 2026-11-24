import { GROWTH_DEFAULTS, projectGrowth } from './growth.mjs';

export function initGrowthView({ scenario, money }) {
  const get = id => document.getElementById(id);
  const settings = { ...GROWTH_DEFAULTS };
  const canvas = get('growth-chart');
  const account = get('growth-account');
  let chartData;
  get('growth-controls').innerHTML = `
    <label class="field" for="growth-rate"><span>Annual nominal return (%)</span>
      <input id="growth-rate" type="number" inputmode="decimal" min="-25" max="20" step=".1" value="${settings.rate}">
    </label>
    <input id="growth-rate-slider" type="range" min="-25" max="20" step=".1" value="${settings.rate}" aria-label="Annual nominal return slider">
    <label class="field" for="growth-years"><span>Years to project</span>
      <select id="growth-years">${[5, 10, 20, 30, 40].map(year => `<option ${year === settings.years ? 'selected' : ''}>${year}</option>`).join('')}</select>
    </label>
    <label class="check"><input id="growth-repeat" type="checkbox">Repeat the same cash withdrawals each year</label>
`;

  const numericRate = get('growth-rate');
  const rangeRate = get('growth-rate-slider');
  function updateRate(input, other) {
    settings.rate = Math.max(Number(input.min), Math.min(Number(input.max), Number(input.value) || 0));
    other.value = settings.rate;
    render();
  }
  numericRate.addEventListener('input', () => updateRate(numericRate, rangeRate));
  numericRate.addEventListener('change', () => numericRate.value = settings.rate);
  rangeRate.addEventListener('input', () => updateRate(rangeRate, numericRate));
  get('growth-years').addEventListener('change', event => {
    settings.years = Number(event.target.value);
    render();
  });
  get('growth-repeat').addEventListener('change', event => {
    settings.repeat = event.target.checked;
    render();
  });
  account.addEventListener('change', render);

  const compact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
  function draw() {
    if (!chartData || !canvas.clientWidth) return;
    const { points } = chartData;
    const id = account.value;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = width * dpr;
    canvas.height = height * dpr;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.scale(dpr, dpr);
    const left = Math.min(width * .2, 66);
    const right = width - 12;
    const top = 15;
    const bottom = height - 30;
    const maxValue = Math.max(1, ...points.flatMap(point => [point.planned[id], point.baseline[id]]));
    const y = value => bottom - (bottom - top) * value / maxValue;
    const x = i => left + (right - left) * i / (points.length - 1);
    ctx.font = '12px system-ui';
    ctx.fillStyle = '#516171';
    ctx.strokeStyle = '#dce5e7';
    ctx.lineWidth = 1;
    for (let tick = 0; tick <= 4; tick++) {
      const value = tick * maxValue / 4;
      const lineY = y(value);
      ctx.beginPath();
      ctx.moveTo(left, lineY);
      ctx.lineTo(right, lineY);
      ctx.stroke();
      ctx.textAlign = 'right';
      ctx.fillText(compact.format(value), left - 6, lineY + 4, left - 7);
    }

    const last = points.length - 1;
    const years = width < 420 ? [0, Math.round(last / 2), last] : [0, Math.round(last / 4), Math.round(last / 2), Math.round(last * .75), last];
    for (const index of years) {
      ctx.textAlign = index === 0 ? 'left' : index === last ? 'right' : 'center';
      ctx.fillText(points[index].year, x(index), bottom + 20);
    }

    function drawLine(key, color, dash) {
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      ctx.setLineDash(dash);
      ctx.beginPath();
      points.forEach((point, index) => {
        if (index === 0) ctx.moveTo(x(index), y(point[key][id]));
        else ctx.lineTo(x(index), y(point[key][id]));
      });
      ctx.stroke();
    }
    drawLine('planned', '#087366', []);
    drawLine('baseline', '#45628a', [5, 5]);
  }

  function render() {
    const state = scenario();
    chartData = projectGrowth(state, settings);
    const { accounts, points, withdrawn, unmet, unconverted } = chartData;
    const final = points.at(-1);
    const choices = [{ id: 'total', name: 'All investment accounts' }, ...accounts];
    const current = choices.find(option => option.id === account.value) ?? choices[0];
    if (account.options.length !== choices.length) {
      account.replaceChildren(...choices.map(({ id, name }) => new Option(name, id, false, id === current.id)));
    }
    const id = current.id;
    const gap = final.baseline[id] - final.planned[id];
    const growthEffect = gap - withdrawn[id];
    get('growth-effect').textContent = growthEffect < -.005
      ? `The withdrawn dollars avoided ${money(-growthEffect)} of modeled investment losses by ${final.year}.`
      : `Withdrawals reduced compounded growth by ${money(growthEffect)} through ${final.year}.`;
    const numbers = [
      ['With withdrawals', final.planned[id]],
      ['Without withdrawals', final.baseline[id]],
      ['Difference in ending balance', gap],
      ['Cash withdrawn', withdrawn[id]],
    ];
    get('growth-metrics').innerHTML = numbers.map(([label, value]) => `<div><span>${label}</span><strong>${money(value)}</strong></div>`).join('');
    canvas.setAttribute('aria-label', `${current.name} through ${final.year}. ${numbers.map(([label, value]) => `${label} ${money(value)}`).join('. ')}.`);
    const message = [];
    const unfunded = unmet.total + unmet.savings;
    if (unfunded > 0.005) message.push(`Some accounts ran out of funds. The chart leaves ${money(unfunded)} of requested cash withdrawals unfunded.`);
    if (unconverted > 0.005) message.push(`The IRA balance was too low for ${money(unconverted)} of the conversion. Both paths use the amount that could transfer.`);
    const warning = get('growth-warning');
    warning.textContent = message.join(' ');
    warning.hidden = !message.length;
    const rows = choices.map(({ id, name }) => `<tr><th scope="row">${name}</th><td>${money(points[0].planned[id])}</td><td>${money(final.planned[id])}</td><td>${money(final.baseline[id])}</td></tr>`).join('');
    get('growth-table').innerHTML = `<table><caption>Balances at the start and end of the projection</caption><thead>
      <tr><th scope="col">Account</th><th scope="col">Starting</th><th scope="col">With withdrawals</th><th scope="col">Without withdrawals</th></tr>
      </thead><tbody>${rows}</tbody></table>`;
    draw();
  }

  new ResizeObserver(draw).observe(canvas);
  return { render };
}
