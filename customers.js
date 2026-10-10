// Customers, credit limits and repayments from the owner's phone. Mirrors src/services/customers.js (same rules, same rows, same wording).
// Pure builders (no network) so Node can test them; the shop computer applies the rows on its next sync.
(function (root) {
  const METHODS = ['cash', 'transfer', 'pos'];
  const uid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : require('crypto').randomUUID());
  const base = (c) => ({ created_at: c.now, updated_at: c.now, deleted_at: null, device_id: c.dev, synced_at: null });
  const rec = (tbl, data, c) => ({ tbl, id: data.id, data, device_id: c.dev, updated_at: data.updated_at });
  const log = (c, action, tbl, recordId, detail) => rec('activity_log', { id: uid(), ...base(c), user_id: c.adminId, action: 'phone.' + action, tbl, record_id: recordId, detail: JSON.stringify(detail) }, c);
  const ctx = (o) => { if (!o.adminId) throw new Error('Owner account not found'); return { dev: o.dev, adminId: o.adminId, now: o.now || Date.now() }; };
  const naira = (k) => '₦' + (k / 100).toLocaleString('en-NG');
  const clean = (s) => (s == null ? '' : String(s)).trim(), nul = (s) => clean(s) || null;
  const kobo = (v, what) => { if (!Number.isInteger(v) || v < 0) throw new Error(what + ' must be a whole amount of kobo (0 or more)'); return v; };

  function addCustomer(o) {
    const c = ctx(o); if (!clean(o.name)) throw new Error('Customer name is required');
    const row = { id: uid(), ...base(c), name: clean(o.name), phone: nul(o.phone), credit_limit: kobo(o.creditLimit || 0, 'Credit limit'), active: 1 };
    return { records: [rec('customers', row, c), log(c, 'customer.create', 'customers', row.id, { name: o.name, limit: row.credit_limit })], summary: { name: row.name } };
  }
  function updateCustomer(o) {              // o.customer = the customer's current row from the cloud
    const c = ctx(o); if (!o.customer || !o.customer.id) throw new Error('Customer not found'); if (!clean(o.name)) throw new Error('Customer name is required');
    const row = { ...o.customer, name: clean(o.name), phone: nul(o.phone), credit_limit: kobo(o.creditLimit || 0, 'Credit limit'), active: o.active === false ? 0 : 1, updated_at: Math.max(c.now, (o.customer.updated_at || 0) + 1) };
    return { records: [rec('customers', row, c), log(c, 'customer.update', 'customers', row.id, { limit: o.creditLimit })], summary: { name: row.name } };
  }
  // Money received from a customer who owes. o.customer = { id, name, balance } (balance from the cloud, in kobo)
  function receivePayment(o) {
    const c = ctx(o), cu = o.customer;
    if (!METHODS.includes(o.method)) throw new Error('Choose Cash, Transfer or POS');
    if (!Number.isInteger(o.amount) || o.amount <= 0) throw new Error('Enter the amount received');
    if (!cu || !cu.id) throw new Error('Customer not found');
    if (cu.balance <= 0) throw new Error(cu.name + ' does not owe anything');
    if (o.amount > cu.balance) throw new Error(`That is more than ${cu.name} owes (${naira(cu.balance)})`);
    const l = { id: uid(), ...base(c), customer_id: cu.id, kind: 'repayment', amount: -o.amount, method: o.method, reference: nul(o.reference), sale_id: null, user_id: c.adminId, note: null };
    return { records: [rec('customer_ledger', l, c), log(c, 'customer.repayment', 'customers', cu.id, { amount: o.amount, method: o.method })],
      summary: { customer: cu.name, amount: o.amount, method: o.method, reference: l.reference, at: c.now, balance: cu.balance - o.amount } };
  }
  function writeOffDebt(o) {                // the owner gives up on a debt; recorded, never silent
    const c = ctx(o), cu = o.customer;
    if (!clean(o.note)) throw new Error('Please write the reason');
    if (!cu || !cu.id) throw new Error('Customer not found');
    if (cu.balance <= 0) throw new Error('Nothing is owed');
    const l = { id: uid(), ...base(c), customer_id: cu.id, kind: 'adjustment', amount: -cu.balance, method: null, reference: null, sale_id: null, user_id: c.adminId, note: 'Written off: ' + clean(o.note) };
    return { records: [rec('customer_ledger', l, c), log(c, 'customer.writeoff', 'customers', cu.id, { amount: cu.balance })], summary: { customer: cu.name, amount: cu.balance } };
  }
  const slipText = (shop, s) => [shop.name || '', '', 'PAYMENT RECEIVED', new Date(s.at).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), '',
    'From: ' + s.customer, 'Amount: ' + naira(s.amount), 'Paid by: ' + s.method.toUpperCase() + (s.reference ? ' (' + s.reference + ')' : ''), 'Balance now: ' + naira(s.balance), '', shop.footer || ''].join('\n').trim();
  const KIND = { credit_sale: 'Credit sale', repayment: 'Repayment', adjustment: 'Adjustment' };

  const api = { addCustomer, updateCustomer, receivePayment, writeOffDebt, repaymentSlip: slipText, LEDGER_KIND: KIND };
  for (const k of Object.keys(api)) if (root.POS_OPS && k in root.POS_OPS) throw new Error('POS_OPS name clash: ' + k + ' is already defined by another phone file');   // a clash would silently replace another feature
  root.POS_OPS = Object.assign(root.POS_OPS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;

  // ---------- screens (browser only) ----------
  if (typeof document === 'undefined') return;
  const fail = (e) => (e.message === 'auth' ? 'Please sign in again' : e.message);
  const money = (v) => Math.round(parseFloat(v || 0) * 100) || 0;
  const day = (ms) => new Date(ms).toLocaleDateString('en-NG', { day: 'numeric', month: 'short', year: '2-digit' });
  const overlay = (html) => { const bg = document.createElement('div'); bg.className = 'sheetbg'; bg.innerHTML = '<div class="sheet">' + html + '</div>'; document.body.appendChild(bg); return bg; };
  const GREY = 'background:#e8efee;color:var(--ink)';
  const warnStale = () => { const ls = data && data.t && data.t.lastSync ? new Date(data.t.lastSync).getTime() : 0; return !ls || Date.now() - ls > 6 * 36e5; };

  root.customersSheet = async function () {
    let list; try { list = await rpc('customer_list', {}); } catch (e) { return toast(fail(e)); }
    const owed = list.reduce((a, x) => a + Math.max(0, x.balance), 0);
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Customers and credit</h2><p class="mute" style="margin:0 0 12px">${list.filter((x) => x.balance > 0).length} owe ${N(owed)} in total</p>
      <button class="primary" id="cu_new">＋ New customer</button><input id="cu_q" placeholder="Search by name or phone" autocomplete="off" style="margin-top:10px"><div class="list" id="cu_l"></div>
      <button class="primary" id="cu_x" style="${GREY};margin-top:12px">Close</button>`);
    const $$ = (s) => bg.querySelector(s);
    const draw = () => { const q = $$('#cu_q').value.trim().toLowerCase(), rows = list.filter((x) => (x.name + ' ' + (x.phone || '')).toLowerCase().includes(q));
      $$('#cu_l').innerHTML = rows.map((x) => `<div class="li" data-id="${esc(x.id)}" style="cursor:pointer${x.active ? '' : ';opacity:.55'}"><span>${esc(x.name)}${x.active ? '' : ' <span class="badge">Inactive</span>'}<br><small class="mute">${x.phone ? esc(x.phone) + ' · ' : ''}limit ${N(x.creditLimit)}</small></span>${x.balance > 0 ? `<b style="color:var(--bad)">${N(x.balance)}</b>` : x.balance < 0 ? `<span class="badge low">Overpaid ${N(-x.balance)}</span>` : '<span class="mute">—</span>'}</div>`).join('') || '<div class="li mute">No customers found</div>';
      $$('#cu_l').querySelectorAll('[data-id]').forEach((el) => { el.onclick = () => { bg.remove(); customerDetail(el.dataset.id); }; }); };
    $$('#cu_q').oninput = draw; draw(); $$('#cu_x').onclick = () => bg.remove(); $$('#cu_new').onclick = () => { bg.remove(); newCustomer(); };
  };
  function newCustomer() {
    sheet('New customer', [{ k: 'name', l: 'Customer name' }, { k: 'phone', l: 'Phone number (optional)', t: 'tel' }, { k: 'limit', l: 'Credit limit (₦) — 0 means no credit', t: 'number', v: 0 }],
      async (f, memo) => { const aid = await getAdmin(); await pushRecs(once(memo, f, () => POS_OPS.addCustomer({ dev, adminId: aid, name: f.name, phone: f.phone, creditLimit: Math.round(parseFloat(f.limit || 0) * 100) })).records); });
  }
  async function customerDetail(id) {
    let s; try { s = await rpc('customer_statement', { p_customer: id }); } catch (e) { return toast(fail(e)); }
    if (!s) return toast('That customer has not reached the cloud yet');
    const cu = s.customer, owes = s.balance > 0;
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">${esc(cu.name)}${cu.active ? '' : ' (inactive)'}</h2>
      <p class="mute" style="margin:0 0 14px">${cu.phone ? `<a href="tel:${esc(cu.phone)}" style="color:inherit">${esc(cu.phone)}</a> · ` : ''}limit ${N(cu.creditLimit)} · ${s.balance > 0 ? 'owes <b style="color:var(--bad)">' + N(s.balance) + '</b>' : s.balance < 0 ? 'overpaid ' + N(-s.balance) : 'owes nothing'}</p>
      ${owes ? '<button class="primary" data-a="pay">Receive payment</button>' : ''}<button class="primary" data-a="st" style="${GREY};margin-top:8px">Statement</button><button class="primary" data-a="ed" style="${GREY};margin-top:8px">Edit customer and limit</button>
      ${owes ? '<button class="primary" data-a="wo" style="background:#fbe3e3;color:var(--bad);margin-top:8px">Write off debt</button>' : ''}<button class="primary" data-a="x" style="${GREY};margin-top:8px">Back to customers</button>`);
    bg.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; bg.remove(); const a = b.dataset.a;
      if (a === 'pay') paySheet(cu, s.balance); if (a === 'st') statementSheet(cu, s); if (a === 'ed') editSheet(cu); if (a === 'wo') writeOffSheet(cu, s.balance); if (a === 'x') customersSheet(); };
  }
  function paySheet(cu, balance) {
    sheet('Receive payment — ' + cu.name, [{ k: 'amt', l: 'Amount received (₦) — owes ' + N(balance), t: 'number', v: balance / 100 }, { k: 'method', l: 'Paid by', opts: [['cash', 'Cash'], ['transfer', 'Transfer'], ['pos', 'POS']] }, { k: 'ref', l: 'Reference (optional)' }],
      async (f, memo) => { const aid = await getAdmin(), fresh = await rpc('customer_statement', { p_customer: cu.id });   // the balance is read again, so a payment already made on the computer is seen
        if (warnStale() && !confirm('The shop computer has not synced for a while. If this customer already paid at the shop, check before recording it again.\n\nRecord the payment?')) throw new Error('Not recorded');
        const r = once(memo, f, () => POS_OPS.receivePayment({ dev, adminId: aid, customer: { id: cu.id, name: cu.name, balance: fresh.balance }, amount: Math.round(parseFloat(f.amt || 0) * 100), method: f.method, reference: f.ref }));
        await pushRecs(r.records); setTimeout(() => root.afterRepayment(r.summary), 300); });
  }
  function writeOffSheet(cu, balance) {
    sheet('Write off — ' + cu.name, [{ k: 'note', l: 'Reason (kept on record) — ' + N(balance) + ' will be cleared' }],
      async (f, memo) => { if (!confirm('Write off ' + N(balance) + ' owed by ' + cu.name + '? This cannot be undone.')) throw new Error('Not recorded'); const aid = await getAdmin(), fresh = await rpc('customer_statement', { p_customer: cu.id });
        await pushRecs(once(memo, f, () => POS_OPS.writeOffDebt({ dev, adminId: aid, customer: { id: cu.id, name: cu.name, balance: fresh.balance }, note: f.note })).records); });
  }
  function editSheet(cu) {
    sheet('Edit — ' + cu.name, [{ k: 'name', l: 'Customer name', v: cu.name }, { k: 'phone', l: 'Phone number (optional)', t: 'tel', v: cu.phone || '' }, { k: 'limit', l: 'Credit limit (₦) — 0 stops credit sales', t: 'number', v: cu.creditLimit / 100 },
      { k: 'active', l: 'Status', opts: [['1', 'Active'], ['0', 'Inactive']], sel: cu.active ? '1' : '0' }],
      async (f, memo) => { const aid = await getAdmin(), row = (await rget(`tbl=eq.customers&id=eq.${encodeURIComponent(cu.id)}&select=data`))[0]; if (!row) throw new Error('Customer not found in the cloud');
        await pushRecs(once(memo, f, () => POS_OPS.updateCustomer({ dev, adminId: aid, customer: row.data, name: f.name, phone: f.phone, creditLimit: Math.round(parseFloat(f.limit || 0) * 100), active: f.active === '1' })).records); });
  }
  function statementSheet(cu, s) {
    const what = (r) => (r.kind === 'credit_sale' ? 'Credit sale' + (r.receiptNo ? ' · ' + esc(r.receiptNo) : '') : r.kind === 'repayment' ? 'Repayment · ' + esc((r.method || '').toUpperCase()) + (r.reference ? ' · ' + esc(r.reference) : '') : esc(r.note || 'Adjustment'));
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Statement — ${esc(cu.name)}</h2><p class="mute" style="margin:0 0 12px">Balance now ${N(s.balance)}</p>
      <div class="list">${s.rows.slice().reverse().map((r) => `<div class="li"><span>${what(r)}<br><small class="mute">${day(r.ts)}${r.by ? ' · ' + esc(r.by) : ''}</small></span><span style="text-align:right"><b style="color:${r.amount > 0 ? 'var(--bad)' : 'var(--brand2)'}">${r.amount > 0 ? '+' : '−'}${N(Math.abs(r.amount))}</b><br><small class="mute">owes ${N(r.balance)}</small></span></div>`).join('') || '<div class="li mute">No entries yet</div>'}</div>
      <button class="primary" id="st_x" style="${GREY};margin-top:12px">Back</button>`);
    bg.querySelector('#st_x').onclick = () => { bg.remove(); customerDetail(cu.id); };
  }
  // After a payment, offer a slip the customer can be sent. sheet() closes itself, so this runs on the next tick.
  root.customerDetail = customerDetail;
  root.afterRepayment = async function (slip) {
    let shop = { name: (C && C.name) || '', footer: 'Thank you!' };
    try { const rows = (await rget('tbl=eq.settings&select=data&limit=50')).map((x) => x.data).filter((r) => !r.deleted_at), g = (k) => (rows.find((r) => r.key === k) || {}).value; shop = { name: g('shop_name') || shop.name, footer: g('receipt_footer') === undefined ? shop.footer : g('receipt_footer') }; } catch (e) { /* use the default */ }
    const text = slipText(shop, slip), bg = overlay(`<h2 style="margin:0 0 10px;font-size:19px">Payment recorded ✓</h2><pre style="white-space:pre-wrap;font:13px/1.45 ui-monospace,Menlo,monospace;background:var(--bg);padding:12px;border-radius:12px;margin:0 0 12px">${esc(text)}</pre>
      ${navigator.share ? '<button class="primary" id="sl_sh">Share slip</button>' : ''}<button class="primary" id="sl_ok" style="${GREY};margin-top:8px">Done</button>`);
    const sh = bg.querySelector('#sl_sh'); if (sh) sh.onclick = async () => { try { await navigator.share({ title: 'Payment received', text }); } catch (e) { /* closed */ } };
    bg.querySelector('#sl_ok').onclick = () => bg.remove();
  };
})(typeof window !== 'undefined' ? window : globalThis);