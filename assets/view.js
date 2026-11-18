
const fmt = v => v == null ? '—' : (v >= 1e6 ? (v/1e6).toFixed(2)+'M' : v >= 1e3 ? (v/1e3).toFixed(0)+'k' : String(v));
const ms = v => v == null ? '—' : v.toFixed(3);
function render(D, cols) {
  document.getElementById('status').textContent = D.status;
  if (D.headline) { const h = document.createElement('p'); h.className = 'muted'; h.innerHTML = D.headline;
    document.getElementById('builds').before(h); }
  const B = D.shown_builds || ['unstable', 'frontier'], two = B.length > 1;
  const b = Object.fromEntries(B.map(k => [k, D.builds[k]]));
  document.getElementById('builds').innerHTML = Object.entries(b).map(([k, x]) =>
    `<dt>${x.label}</dt><dd><code>${x.sha}</code> (${x.branch}, committed ${x.committed})</dd>`).join('')
    + `<dt>harness</dt><dd>${D.harness.offbench}; ${D.harness.build}</dd>`;
  document.getElementById('setup').innerHTML = Object.entries(D.setup).map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('');
  const lat = ['ops', 'p50_ms', 'p99_ms', 'p999_ms', 'max_ms'];
  const head = cols.map(c => `<th class=l>${c}</th>`).join('')
    + B.map(k => lat.map(m => `<th>${k} ${m.replace('_ms','')}</th>`).join('')).join('')
    + '<th>reps</th>' + (two ? '<th>frontier/unstable</th>' : '');
  const rows = D.cells.map(c => {
    const cmp = c.compare;
    const r = cmp ? `${cmp.ratio.toFixed(3)} ${cmp.verdict}${cmp.high_var ? ' (high variance)' : ''}` : '—';
    const miss = c.missing;   // no verdict: the build's numbers are not shown (never as zero), the reason is
    const vals = B.map(k => miss && miss.builds.includes(k) ? `<td class=missing colspan=${lat.length}>MISSING</td>` :
      [c[k].ops == null ? '—' : fmt(c[k].ops) + (c[k].range ? ` <span class=muted>(${fmt(c[k].range[0])}–${fmt(c[k].range[1])})</span>` : ''),
        ms(c[k].p50_ms), ms(c[k].p99_ms), ms(c[k].p999_ms), ms(c[k].max_ms)]
      .map(v => `<td class="${v==='—'?'empty':''}">${v}</td>`).join('')).join('');
    const reps = x => x.valid == null ? '0' : `${x.valid}/${x.reps.length}`;
    return `<tr>${cols.map(k => `<td class=l>${c[k]}</td>`).join('')}${vals}<td>${B.map(k => reps(c[k])).join(' · ')}</td>${two ? (miss ? `<td class="l missing">MISSING: ${miss.reason}</td>` : `<td>${r}</td>`) : ''}</tr>`;
  }).join('');
  document.getElementById('cells').innerHTML = `<thead><tr>${head}</tr></thead><tbody>${rows}</tbody>`;
  const nmiss = D.cells.filter(c => c.missing).length;
  document.getElementById('n').textContent = D.cells.length + (nmiss ? `, ${nmiss} MISSING` : '');
  if (!document.getElementById('missing-style')) document.head.insertAdjacentHTML('beforeend',
    '<style id=missing-style>td.missing{color:var(--pend);font-weight:600;text-align:left;white-space:normal}</style>');
  const lg = document.getElementById('legend');
  if (lg && !two) lg.textContent = `Absolute ops/s for ${D.builds[B[0]].label}; latency in ms. Each value is the median of the valid reps; the rep count and range go with it.`;
  if (D.per_core && Object.values(D.per_core).some(v => v && v.capacity)) {
    const t = document.createElement('div');
    const rows = Object.entries(D.per_core).filter(([c, v]) => v && v.capacity).map(([c, v]) => {
      const u = v.capacity.unstable || {}, f = v.capacity.frontier || {};
      return `<tr><td>${c}</td><td>${u.x_writes || '—'} / ${f.x_writes || '—'}</td><td>${u.y_reads || '—'} / ${f.y_reads || '—'}</td>` +
        `<td class=l>${u.capacity || '—'}<br><span class=muted>${u.more_reads || ''}</span></td>` +
        `<td class=l>${f.capacity || '—'}<br><span class=muted>${f.more_reads || ''}</span></td></tr>`;
    }).join('');
    t.innerHTML = `<h2>Replica reads/s while in sync</h2><p class=muted>Highest replica read rate over in-sync steps below the first step where the replica fell behind, at the primary load X writes/s and Y reads/s (unstable / frontier as delivered). Per-step numbers are in the table below.</p>` +
      `<table><thead><tr><th>cores</th><th>X writes/s</th><th>Y reads/s</th><th class=l>${D.builds.unstable.label}</th><th class=l>${D.builds.frontier.label}</th></tr></thead><tbody>${rows}</tbody></table>`;
    document.getElementById('setup').after(t);
  }
  if (D.setup && D.setup.caveat) {
    const p = document.createElement('p'); p.className = 'pend'; p.style.display = 'block'; p.style.padding = '6px 10px';
    p.textContent = D.setup.caveat; document.getElementById('builds').before(p);
  }
  const cv = document.getElementById('chart');
  if (cv && D.view === 'core-scaling') scalingChart(D, cv);
}
// Core scaling: ops/s against cores, one line per build and workload, points labelled by instance.
function scalingChart(D, cv) {
  const B = D.shown_builds || ['unstable', 'frontier'];
  const have = D.cells.some(c => B.some(b => c[b].ops));
  if (!have || typeof Chart === 'undefined') { cv.replaceWith(Object.assign(document.createElement('p'),
    {className: 'muted', textContent: 'Chart appears when the first step has data.'})); return; }
  const sel = document.getElementById('shape'), shapes = [...new Set(D.cells.map(c => `${c.workload} P${c.P}`))];
  sel.innerHTML = shapes.map(s => `<option>${s}</option>`).join('');
  let chart;
  const draw = () => {
    const cs = D.cells.filter(c => `${c.workload} P${c.P}` === sel.value).sort((a, b) => a.cores - b.cores);
    const ds = B.map((b, i) => ({label: D.builds[b].label, borderDash: i ? [] : [6, 4],
      data: cs.map(c => ({x: c.cores, y: c[b].ops, inst: c.instance}))}));
    if (chart) chart.destroy();
    chart = new Chart(cv, {type: 'line', data: {datasets: ds}, options: {parsing: false,
      scales: {x: {type: 'linear', title: {display: true, text: 'cores (instance)'}, ticks: {stepSize: 2,
        callback: v => { const c = cs.find(c => c.cores === v); return c ? `${v} (${c.instance})` : ''; }}},
        y: {beginAtZero: true, title: {display: true, text: 'ops/s'}}},
      plugins: {tooltip: {callbacks: {label: t => `${t.dataset.label} ${t.raw.inst}: ${fmt(t.raw.y)} ops/s`}}}}});
  };
  sel.onchange = draw; draw();
}
