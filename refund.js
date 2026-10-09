// Owner-only refunds from the phone. Mirrors src/services/returns.js (same pricing, same rows), but as pure builders:
// no network, so Node can test them. The shop computer applies the rows on its next sync.
(function (root) {
  const DAY = 864e5, LIMIT_DAYS = 3, METHODS = ['cash', 'transfer', 'pos'];
  const uid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : require('crypto').randomUUID());
  const base = (c) => ({ created_at: c.now, updated_at: c.now, deleted_at: null, device_id: c.dev, synced_at: null });
  const rec = (tbl, data, c) => ({ tbl, id: data.id, data, device_id: c.dev, updated_at: data.updated_at });
  const naira = (k) => '₦' + (k / 100).toLocaleString('en-NG');
  const dayOf = (ms) => new Date(ms).toLocaleDateString('en-CA');

  // sale = what the cloud function refundable_sale() returns; items = [{ saleItemId, qty, restock: true|false }]
  function quote(o) {
    const sale = o.sale, now = o.now || Date.now(), today = o.today || dayOf(now);
    if (!sale || !sale.sale) throw new Error('Sale not found');
    if (sale.sale.status && sale.sale.status !== 'completed') throw new Error('This sale was voided, so nothing can be returned from it');
    if (now - sale.sale.at > LIMIT_DAYS * DAY) throw new Error(`Returns are only accepted within ${LIMIT_DAYS} days of the sale`);
    if (!Array.isArray(o.items) || !o.items.length) throw new Error('Choose at least one item to return');
    const lines = [];
    for (const it of o.items) {
      const row = sale.rows.find((r) => r.saleItemId === it.saleItemId);
      if (!row) throw new Error('That item is not on this sale');
      if (lines.some((l) => l.row === row)) throw new Error('Each item can only be listed once');
      if (!Number.isInteger(it.qty) || it.qty <= 0) throw new Error('Quantity to return must be a whole number above zero');
      const available = row.qty - row.returned;
      if (it.qty > available) throw new Error(`Only ${available} of ${row.name} can still be returned`);
      if (typeof it.restock !== 'boolean') throw new Error(`Say whether ${row.name} goes back to stock or is damaged`);
      if (it.restock && row.expiry && row.expiry < today) throw new Error(`${row.name} is from an expired batch, so it cannot go back to stock — mark it as damaged or expired`);
      lines.push({ row, qty: it.qty, restock: it.restock });
    }
    const itemsNet = sale.rows.reduce((s, r) => s + r.qty * r.unitPrice, 0);
    if (!(itemsNet > 0)) throw new Error('This sale has no priced items');
    const F = (r, k) => Math.round(k * r.unitPrice * sale.sale.total / itemsNet);   // value of the first k units after any discount
    for (const l of lines) l.amount = F(l.row, l.row.returned + l.qty) - F(l.row, l.row.returned);
    let amount = lines.reduce((s, l) => s + l.amount, 0);
    const all = sale.rows.every((r) => { const l = lines.find((x) => x.row === r); return r.returned + (l ? l.qty : 0) === r.qty; });
    if (all) { lines[lines.length - 1].amount += sale.sale.total - sale.refunded - amount; amount = sale.sale.total - sale.refunded; }   // the last return takes the rounding
    if (amount <= 0 || sale.refunded + amount > sale.sale.total) throw new Error('That refund is more than the sale was worth');
    const debt = Math.min(amount, sale.maxDebt);
    return { lines, amount, debt, toPay: amount - debt, customer: sale.sale.customer || null };
  }

  // The owner refunds directly. o: { dev, adminId, sale, items, reason, payments:[{method,amount,reference}], tillUserId, seq }
  // tillUserId = whose till the money comes from (the owner herself, or a cashier).
  function refund(o) {
    if (!o.adminId) throw new Error('Owner account not found');
    if (!(o.reason || '').trim()) throw new Error('Please write the reason for the return');
    const c = { dev: o.dev, adminId: o.adminId, now: o.now || Date.now() };
    const q = quote({ ...o, now: c.now }), sale = o.sale.sale, payments = o.payments || [];
    if (!Number.isInteger(o.seq) || o.seq <= 0) throw new Error('Refund number missing');
    let paid = 0;
    for (const x of payments) {
      if (!METHODS.includes(x.method)) throw new Error('Choose Cash, Transfer or POS');
      if (!Number.isInteger(x.amount) || x.amount <= 0) throw new Error('Each payout must be above zero');
      paid += x.amount;
    }
    if (paid !== q.toPay) throw new Error(`The money paid out (${naira(paid)}) must add up to ${naira(q.toPay)}` + (q.debt ? ` — ${naira(q.debt)} comes off what ${q.customer || 'the customer'} owes` : ''));
    const refundNo = `${o.dev}-R${String(o.seq).padStart(5, '0')}`, out = [];
    const rf = { id: uid(), ...base(c), refund_no: refundNo, sale_id: sale.id, request_id: null, cashier_id: o.tillUserId || c.adminId, approved_by: c.adminId, amount: q.amount, reason: o.reason.trim() };
    out.push(rec('refunds', rf, c));
    for (const l of q.lines) {
      const r = l.row, e = (qty, why) => rec('stock_entries', { id: uid(), ...base(c), product_id: r.productId, batch_id: r.batchId || null, qty_change: qty, reason: why, ref_id: rf.id, user_id: c.adminId }, c);
      out.push(rec('refund_items', { id: uid(), ...base(c), refund_id: rf.id, sale_item_id: r.saleItemId, product_id: r.productId, batch_id: r.batchId || null, qty: l.qty, amount: l.amount, cost_price: r.costPrice || 0, restock: l.restock ? 1 : 0 }, c));
      out.push(e(l.qty, 'returned'));
      if (!l.restock) out.push(e(-l.qty, 'damaged'));          // lost: the pair keeps the record while the shelf count stays right
    }
    for (const x of payments) out.push(rec('refund_payments', { id: uid(), ...base(c), refund_id: rf.id, method: x.method, amount: x.amount, reference: (x.reference || '').trim() || null }, c));
    if (q.debt > 0) out.push(rec('customer_ledger', { id: uid(), ...base(c), customer_id: sale.customerId, kind: 'adjustment', amount: -q.debt, method: null, reference: null, sale_id: sale.id, user_id: c.adminId, note: 'Refund ' + refundNo }, c));
    out.push(rec('activity_log', { id: uid(), ...base(c), user_id: c.adminId, action: 'phone.refund.create', tbl: 'refunds', record_id: rf.id,
      detail: JSON.stringify({ refundNo, amount: q.amount, approvedBy: c.adminId, lost: q.lines.filter((l) => !l.restock).length }) }, c));
    return { records: out, summary: { refundNo, saleReceiptNo: sale.receiptNo, at: c.now, amount: q.amount, debt: q.debt, customer: q.customer, payments,
      lines: q.lines.map((l) => ({ name: l.row.name, qty: l.qty, amount: l.amount, restock: l.restock })) } };
  }

  const api = { refundQuote: quote, refund, REFUND_LIMIT_DAYS: LIMIT_DAYS };
  root.POS_OPS = Object.assign(root.POS_OPS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;

  // ---------- screens (browser only) ----------
  if (typeof document === 'undefined') return;
  const today = () => new Date().toLocaleDateString('en-CA');
  const fail = (e) => (e.message === 'auth' ? 'Please sign in again' : e.message);
  const money = (v) => Math.round(parseFloat(v || 0) * 100) || 0;
  const when = (ms) => new Date(ms).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const overlay = (html) => { const bg = document.createElement('div'); bg.className = 'sheetbg'; bg.innerHTML = '<div class="sheet">' + html + '</div>'; document.body.appendChild(bg); return bg; };
  const GREY = 'background:#e8efee;color:var(--ink)';

  root.returnsSheet = async function () {
    let list;
    try { list = await rpc('recent_sales', { p_from: Date.now() - LIMIT_DAYS * DAY }); } catch (e) { return toast(fail(e)); }
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Returns and refunds</h2><p class="mute" style="margin:0 0 12px">Sales from the last ${LIMIT_DAYS} days. Pick one, or type a receipt number and press Go.</p>
      <input id="rf_q" placeholder="Receipt number" autocomplete="off" autocapitalize="characters" enterkeyhint="go"><div class="list" id="rf_l"></div><p class="err" id="rf_e"></p>
      <button class="primary" id="rf_x" style="${GREY};margin-top:12px">Close</button>`);
    const $$ = (s) => bg.querySelector(s), err = (m) => { $$('#rf_e').textContent = m || ''; };
    const draw = () => { const q = $$('#rf_q').value.trim().toLowerCase(), rows = list.filter((x) => x.receiptNo.toLowerCase().includes(q));
      $$('#rf_l').innerHTML = rows.map((x) => `<div class="li" data-id="${esc(x.saleId)}" style="cursor:pointer"><span>${esc(x.receiptNo)}<br><small class="mute">${when(x.at)} · ${esc(x.cashier)}</small></span><b>${N(x.total)}</b></div>`).join('') || '<div class="li mute">No sales found</div>';
      $$('#rf_l').querySelectorAll('[data-id]').forEach((el) => { el.onclick = () => { bg.remove(); refundSheet(el.dataset.id); }; }); };
    $$('#rf_q').oninput = draw; draw();
    $$('#rf_q').onkeydown = async (e) => { if (e.key !== 'Enter') return; const q = e.target.value.trim().toUpperCase(); if (!q) return; err('');
      try { const r = await rget(`tbl=eq.sales&data->>receipt_no=eq.${encodeURIComponent(q)}&select=id`); if (!r.length) return err('No sale with that receipt number'); bg.remove(); refundSheet(r[0].id); } catch (x) { err(fail(x)); } };
    $$('#rf_x').onclick = () => bg.remove();
  };

  async function refundSheet(saleId) {
    let rs, users, adminId;
    try { adminId = await getAdmin(); [rs, users] = await Promise.all([rpc('refundable_sale', { p_sale: saleId, p_today: today() }), rget('tbl=eq.users&select=data&limit=200')]); } catch (e) { return toast(fail(e)); }
    if (!rs) return toast('That sale has not reached the cloud yet');
    if (rs.sale.status !== 'completed') return toast('That sale was voided, so nothing can be returned from it');
    const staff = users.map((x) => x.data).filter((u) => u.active && !u.deleted_at && u.id !== adminId);
    const within = Date.now() - rs.sale.at <= LIMIT_DAYS * DAY, t0 = today();
    const rowsHtml = rs.rows.map((r, i) => { const avail = r.qty - r.returned, exp = !!(r.expiry && r.expiry < t0);
      return `<div class="li" style="display:block"><b>${esc(r.name)}</b><br><small class="mute">${r.qty} × ${N(r.unitPrice)}${r.returned ? ' · ' + r.returned + ' already returned' : ''}${r.expiry ? ' · expires ' + esc(r.expiry) : ''}</small>` +
        (avail > 0 && within ? `<div class="row" style="margin-top:8px"><select id="rq${i}" style="margin:0;width:84px">${Array.from({ length: avail + 1 }, (_, n) => `<option>${n}</option>`).join('')}</select>
          <select id="rd${i}" class="grow" style="margin:0">${exp ? '' : '<option value="in">Back to stock</option>'}<option value="out">${exp ? 'Expired — write off' : 'Damaged or lost'}</option></select></div>` : '<br><small class="mute">Nothing left to return</small>') + '</div>'; }).join('');
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Refund — ${esc(rs.sale.receiptNo)}</h2>
      <p class="mute" style="margin:0 0 12px">${when(rs.sale.at)} · total ${N(rs.sale.total)}${rs.refunded ? ' · already refunded ' + N(rs.refunded) : ''}${rs.sale.customer ? ' · ' + esc(rs.sale.customer) : ''}</p>
      ${within ? '' : `<div class="banner" style="margin:0 0 10px">This sale is older than ${LIMIT_DAYS} days, so it can no longer be refunded.</div>`}
      <div class="list">${rowsHtml}</div>
      <p id="rf_sum" class="mute" style="margin:12px 2px"></p>
      <label class="lb">Reason</label><input id="rf_why" autocomplete="off" placeholder="Why is it being returned?">
      <label class="lb">Money comes from</label><select id="rf_from">${[[adminId, 'Me (owner)'], ...staff.map((u) => [u.id, (u.full_name || u.username) + ' (cashier)'])].map((o) => `<option value="${esc(o[0])}">${esc(o[1])}</option>`).join('')}</select>
      <label class="lb">Paid out (₦)</label>
      <div class="row"><input id="rf_cash" type="number" inputmode="decimal" placeholder="Cash"><input id="rf_tr" type="number" inputmode="decimal" placeholder="Transfer"><input id="rf_pos" type="number" inputmode="decimal" placeholder="POS"></div>
      <p class="err" id="rf_e"></p><button class="primary" id="rf_ok"${within ? '' : ' disabled'}>Refund</button><button class="primary" id="rf_x" style="${GREY};margin-top:8px">Cancel</button>`);
    const $$ = (s) => bg.querySelector(s), err = (m) => { $$('#rf_e').textContent = m || ''; }, memo = {}; let touched = false, toPay = 0;
    const picked = () => rs.rows.map((r, i) => { const q = $$('#rq' + i); const n = q ? Number(q.value) : 0; return n > 0 ? { saleItemId: r.saleItemId, qty: n, restock: $$('#rd' + i).value === 'in' } : null; }).filter(Boolean);
    const refresh = () => { err(''); const items = picked(); toPay = 0;
      if (!items.length) { $$('#rf_sum').textContent = 'Choose how many of each item come back.'; return; }
      try { const q = POS_OPS.refundQuote({ sale: rs, items, today: today() }); toPay = q.toPay;
        $$('#rf_sum').innerHTML = `<b style="color:var(--ink)">Refund ${N(q.amount)}</b>${q.debt ? ` · ${N(q.debt)} comes off what ${esc(q.customer || 'the customer')} owes` : ''} · pay out <b style="color:var(--ink)">${N(q.toPay)}</b>`;
        if (!touched) { $$('#rf_cash').value = q.toPay ? q.toPay / 100 : ''; $$('#rf_tr').value = ''; $$('#rf_pos').value = ''; } }
      catch (e) { $$('#rf_sum').textContent = ''; err(e.message); } };
    bg.addEventListener('change', (e) => { if (/^r[qd]/.test(e.target.id)) refresh(); });
    ['#rf_cash', '#rf_tr', '#rf_pos'].forEach((s) => { $$(s).oninput = () => { touched = true; }; });
    refresh(); $$('#rf_x').onclick = () => bg.remove();
    $$('#rf_ok').onclick = async (ev) => { const ok = ev.target; ok.disabled = true; err('');
      try { const items = picked(), reason = $$('#rf_why').value.trim(), till = $$('#rf_from').value;
        const payments = [['cash', '#rf_cash'], ['transfer', '#rf_tr'], ['pos', '#rf_pos']].map((p) => ({ method: p[0], amount: money($$(p[1]).value) })).filter((p) => p.amount > 0);
        const k = JSON.stringify({ items, reason, till, payments });
        if (memo.k !== k) { memo.seq = (Number(localStorage.getItem('rseq')) || 0) + 1; memo.r = POS_OPS.refund({ dev, adminId, sale: rs, items, reason, payments, tillUserId: till, seq: memo.seq, today: today() }); memo.k = k; }   // a retry re-sends the same rows
        const s = memo.r.summary, ls = data && data.t && data.t.lastSync ? new Date(data.t.lastSync).getTime() : 0;
        const warn = !ls || Date.now() - ls > 6 * 36e5 ? '\n\nThe shop computer has not synced for a while. If this item was already refunded on the computer, do NOT refund it again here.' : '';
        if (!confirm(`Refund ${N(s.amount)} on ${s.saleReceiptNo}?\n\n` + (s.debt ? N(s.debt) + ' comes off the customer\'s debt. ' : '') + 'Paid out: ' + (s.payments.map((p) => p.method.toUpperCase() + ' ' + N(p.amount)).join(', ') || 'nothing') + '.' + warn)) { ok.disabled = false; return; }
        await pushRecs(memo.r.records);
        localStorage.setItem('rseq', String(Math.max(Number(localStorage.getItem('rseq')) || 0, memo.seq)));
        bg.remove(); toast('Refund ' + s.refundNo + ' recorded ✓ — reaches the shop computer when it next goes online'); load();
      } catch (e) { err(fail(e)); ok.disabled = false; } };
  }
})(typeof window !== 'undefined' ? window : globalThis);