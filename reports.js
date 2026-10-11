// Reports for any day or period, and reopening any past sale's receipt, on the owner's phone.
// Mirrors dailyReport(), rangeReport() and getSale() in src/services/reports.js. Read-only: nothing here changes any record.
(function (root) {
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  const startOf = (s) => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  // The start and end (milliseconds) of the day(s) from..to, inclusive, in the phone's own clock. Same checks and wording as the computer.
  function reportBounds(from, to) {
    for (const d of [from, to]) if (!DATE.test(d || '')) throw new Error('Choose valid dates');
    const [y, m, d] = to.split('-').map(Number), a = startOf(from), b = new Date(y, m - 1, d + 1).getTime();
    if (b <= a) throw new Error('The end date must not be before the start date');
    if (b - a > 367 * 864e5) throw new Error('Choose a period of one year or less');
    return { from: a, to: b };
  }
  // A sale as the cloud's sale_detail() returns it, turned into what receiptText() prints. Price cuts are already in each line's price,
  // so only the extra whole-sale discount (what the lines add up to above the total) is shown as a discount.
  function saleSummary(d) {
    const sumLines = d.lines.reduce((s, l) => s + l.qty * l.price, 0);
    return { receiptNo: d.receiptNo, at: d.at, lines: d.lines, discount: Math.max(0, sumLines - d.total), total: d.total, payments: d.payments, credit: (d.credit && d.credit.c) || 0, customer: (d.credit && d.credit.n) || null, status: d.status, rx: d.rx };
  }
  const api = { reportBounds, saleSummary };
  for (const k of Object.keys(api)) if (root.POS_OPS && k in root.POS_OPS) throw new Error('POS_OPS name clash: ' + k + ' is already defined by another phone file');
  root.POS_OPS = Object.assign(root.POS_OPS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;

  // ---------- screens (browser only) ----------
  if (typeof document === 'undefined') return;
  const fail = (e) => (e.message === 'auth' ? 'Please sign in again' : e.message);
  const iso = (d) => d.toLocaleDateString('en-CA'), shift = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return iso(d); };
  const overlay = (html) => { const bg = document.createElement('div'); bg.className = 'sheetbg'; bg.innerHTML = '<div class="sheet">' + html + '</div>'; document.body.appendChild(bg); return bg; };
  const GREY = 'background:#e8efee;color:var(--ink)', tz = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Africa/Lagos';
  const hm = (ms) => new Date(ms).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' }), dm = (s) => new Date(s + 'T12:00:00').toLocaleDateString('en-NG', { weekday: 'short', day: 'numeric', month: 'short' });
  const card = (l, v, s) => `<div class="card"><small>${l}</small><b style="font-size:19px">${v}</b>${s ? `<small>${s}</small>` : ''}</div>`;
  const rows = (arr, f, empty) => `<div class="list">${arr.map(f).join('') || `<div class="li mute">${empty || 'None'}</div>`}</div>`;
  const li = (a, b, sub) => `<div class="li"><span>${a}${sub ? `<br><small class="mute">${sub}</small>` : ''}</span><b>${b}</b></div>`;
  const OUT = { accepted: 'Accepted', explained: 'Explained', repay: 'Cashier to repay', investigating: 'Investigating' };
  const diffTxt = (s) => ['cash', 'transfer', 'pos'].map((m) => [m, s['cnt_' + m] - s['exp_' + m]]).filter((x) => x[1]).map((x) => x[0].toUpperCase() + (x[1] < 0 ? ' short ' : ' over ') + N(Math.abs(x[1]))).join(' · ');

  root.reportsSheet = function (preset) {
    const bg = overlay(`<h2 style="margin:0 0 10px;font-size:19px">Reports</h2>
      <div class="row" style="flex-wrap:wrap;margin-bottom:10px">${[['today', 'Today'], ['yest', 'Yesterday'], ['week', 'Last 7 days'], ['month', 'This month']].map((p) => `<button class="mini" style="background:var(--line);color:var(--ink);margin:0;padding:9px 12px;font-size:13px" data-p="${p[0]}">${p[1]}</button>`).join('')}</div>
      <div class="row"><div class="grow"><label class="lb">From</label><input id="rp_a" type="date" value="${shift(0)}"></div><div class="grow"><label class="lb">To</label><input id="rp_b" type="date" value="${shift(0)}"></div></div>
      <button class="primary" id="rp_go">Show report</button><p class="err" id="rp_e"></p><div id="rp_r"></div><button class="primary" id="rp_x" style="${GREY};margin-top:12px">Close</button>`);
    const $$ = (s) => bg.querySelector(s), err = (m) => { $$('#rp_e').textContent = m || ''; };
    const preset$ = (p) => { const n = new Date(), a = { today: shift(0), yest: shift(-1), week: shift(-6), month: iso(new Date(n.getFullYear(), n.getMonth(), 1)) }[p], b = p === 'yest' ? shift(-1) : shift(0); $$('#rp_a').value = a; $$('#rp_b').value = b; show(); };
    bg.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => preset$(b.dataset.p); }); $$('#rp_go').onclick = () => show(); $$('#rp_x').onclick = () => bg.remove();
    async function show() { err(''); $$('#rp_r').innerHTML = '<p class="mute" style="text-align:center">Loading…</p>';
      try { const a = $$('#rp_a').value, b = $$('#rp_b').value, w = POS_OPS.reportBounds(a, b);
        if (a === b) $$('#rp_r').innerHTML = dayHtml(await rpc('daily_report', { p_from: w.from, p_to: w.to })); else $$('#rp_r').innerHTML = rangeHtml(await rpc('range_report', { p_from: w.from, p_to: w.to, p_tz: tz() }));
        $$('#rp_r').querySelectorAll('[data-sale]').forEach((el) => { el.onclick = () => saleReceipt(el.dataset.sale); });
        $$('#rp_r').querySelectorAll('[data-day]').forEach((el) => { el.onclick = () => { $$('#rp_a').value = $$('#rp_b').value = el.dataset.day; show(); }; });
      } catch (e) { $$('#rp_r').innerHTML = ''; err(fail(e)); } }
    if (preset) preset$(preset); else show();
  };
  const rangeHtml = (r) => `<div class="cards" style="margin:14px 0">${card('Revenue', N(r.totals.revenue), r.totals.count + ' sales')}${card('Profit', N(r.totals.profit))}${card('Refunds', N(r.totals.refunds))}${card('Discounts', N(r.totals.discount))}</div>
    <h3>Money received (before refunds)</h3>${rows(r.byMethod, (m) => li(m.method.toUpperCase(), N(m.amount)))}
    <h3>Credit</h3><div class="list">${li('Given on credit', N(r.credit.given))}${li('Paid back', N(r.credit.repaid))}</div>
    <h3>Day by day <span class="mute" style="font-weight:400">· tap a day for its full report</span></h3>${rows(r.days, (d) => `<div class="li" data-day="${d.date}" style="cursor:pointer"><span>${dm(d.date)}<br><small class="mute">${d.count} sales · profit ${N(d.profit)}${d.refunds ? ' · refunds ' + N(d.refunds) : ''}</small></span><b>${N(d.revenue)}</b></div>`, 'No sales in this period')}`;
  const dayHtml = (r) => `<div class="cards" style="margin:14px 0">${card('Revenue', N(r.revenue), r.count + ' sales')}${card('Profit', N(r.profit))}${card('Refunds', N(r.refunds.total), r.refunds.count + ' refund(s)')}${card('Discounts', N(r.discount))}</div>
    ${r.belowCost.n ? `<div class="banner bad" style="margin:0 0 10px">${r.belowCost.n} item(s) sold below cost — loss ${N(r.belowCost.loss)}</div>` : ''}${r.voided.n ? `<div class="banner" style="margin:0 0 10px">${r.voided.n} sale(s) voided · ${N(r.voided.total)}</div>` : ''}
    <h3>Money in hand (after refunds)</h3>${rows(r.byMethod, (m) => li(m.method.toUpperCase(), N(m.amount)))}
    <h3>Credit</h3><div class="list">${li('Given on credit', N(r.credit.given))}${li('Paid back', N(r.credit.repaid))}</div>
    ${r.refunds.count ? `<h3>Refunds</h3><div class="list">${li('Paid out', N(r.refunds.total), r.refunds.byMethod.map((m) => m.method.toUpperCase() + ' ' + N(m.amount)).join(' · '))}${r.refunds.lostCost ? li('Damaged or lost goods (cost)', N(r.refunds.lostCost)) : ''}</div>` : ''}
    <h3>Best sellers</h3>${rows(r.top, (t) => li(esc(t.name), t.qty + ' sold', N(t.amount)))}
    <h3>By cashier</h3>${rows(r.byCashier, (c) => li(esc(c.username || '—'), N(c.total), c.n + ' sales'))}
    ${r.discByCashier.length ? `<h3>Discounts given</h3>${rows(r.discByCashier, (c) => li(esc(c.username || '—'), N(c.total), c.n + ' sales'))}` : ''}
    ${r.shifts.length ? `<h3>Cashier counts</h3>${rows(r.shifts, (s) => li(esc(s.cashier || '—'), s.outcome ? OUT[s.outcome] || s.outcome : (diffTxt(s) ? 'Not reviewed' : 'Matches'), `${hm(s.ts)} · ${diffTxt(s) || 'no difference'}${s.note ? ' — ' + esc(s.note) : ''}`))}` : ''}
    <h3>Sales of the day <span class="mute" style="font-weight:400">· tap one for its receipt</span></h3>${rows(r.sales, (s) => `<div class="li" data-sale="${esc(s.id)}" style="cursor:pointer;${s.status === 'voided' ? 'opacity:.5' : ''}"><span>${esc(s.receiptNo)}<br><small class="mute">${hm(s.ts)} · ${esc(s.cashier || '—')}${s.status === 'voided' ? ' · voided' : ''}<br>${s.items.map((i) => esc(i.name) + ' ×' + i.qty).join(', ')}</small></span><b>${N(s.total)}</b></div>`, 'No sales on this day')}`;

  async function shopInfo() {
    const fallback = { name: (C && C.name) || '', address: '', phone: '', rc: '', footer: 'Thank you for your patronage!' };
    try { const rs = (await rget('tbl=eq.settings&select=data&limit=50')).map((x) => x.data).filter((r) => !r.deleted_at), g = (k) => (rs.find((r) => r.key === k) || {}).value;
      return { name: g('shop_name') || fallback.name, address: g('shop_address') || '', phone: g('shop_phone') || '', rc: g('shop_rc') || '', footer: g('receipt_footer') === undefined ? fallback.footer : g('receipt_footer') }; } catch (e) { return fallback; }
  }
  root.saleReceipt = async function (saleId) {
    let d, shop; try { [d, shop] = await Promise.all([rpc('sale_detail', { p_sale: saleId }), shopInfo()]); } catch (e) { return toast(fail(e)); }
    if (!d) return toast('That sale has not reached the cloud yet');
    const s = saleSummary(d), text = (d.status === 'voided' ? '*** VOIDED SALE ***\n\n' : '') + POS_OPS.receiptText(shop, s) + (d.rx ? '\nPrescription: ' + d.rx : '') + (d.cashier ? '\nServed by: ' + d.cashier : '');
    const bg = overlay(`<h2 style="margin:0 0 10px;font-size:19px">Receipt ${esc(d.receiptNo)}</h2><pre style="white-space:pre-wrap;word-break:break-word;font:13px/1.45 ui-monospace,Menlo,monospace;background:var(--bg);padding:12px;border-radius:12px;margin:0 0 12px">${esc(text)}</pre>
      ${navigator.share ? '<button class="primary" id="sr_sh">Share receipt</button>' : ''}<button class="primary" id="sr_cp" style="${GREY};margin-top:8px">Copy receipt</button><button class="primary" id="sr_x" style="${GREY};margin-top:8px">Close</button>`);
    const sh = bg.querySelector('#sr_sh'); if (sh) sh.onclick = async () => { try { await navigator.share({ title: 'Receipt ' + d.receiptNo, text }); } catch (e) { /* closed */ } };
    bg.querySelector('#sr_cp').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Receipt copied'); } catch (e) { toast('Could not copy — press and hold the text to copy it'); } };
    bg.querySelector('#sr_x').onclick = () => bg.remove();
  };
})(typeof window !== 'undefined' ? window : globalThis);