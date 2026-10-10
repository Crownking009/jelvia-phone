// Selling from the owner's phone. Mirrors sell() and voidSale() in src/services/stock.js: same rules, same rows, same wording.
// Pure builders (no network) so Node can test them; the shop computer applies the rows on its next sync.
(function (root) {
  const METHODS = ['cash', 'transfer', 'pos'];
  const uid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : require('crypto').randomUUID());
  const base = (c) => ({ created_at: c.now, updated_at: c.now, deleted_at: null, device_id: c.dev, synced_at: null });
  const rec = (tbl, data, c) => ({ tbl, id: data.id, data, device_id: c.dev, updated_at: data.updated_at });
  const naira = (k) => '₦' + (k / 100).toLocaleString('en-NG');
  const ctx = (o) => { if (!o.adminId) throw new Error('Owner account not found'); return { dev: o.dev, adminId: o.adminId, now: o.now || Date.now() }; };
  const byExpiry = (a, b) => ((a.expiry == null) - (b.expiry == null)) || (a.expiry < b.expiry ? -1 : a.expiry > b.expiry ? 1 : 0);   // earliest expiry first, no-expiry last

  // o: { dev, adminId, seq, items:[{ productId, name, price, rx, qty, slash, batches:[{ batchId, remaining, cost, expiry }] }],
  //      payments:[{method, amount, reference}], discount, credit, customer:{ id, name, creditLimit, balance }, rx }   (all money in kobo)
  function sell(o) {
    const c = ctx(o); let subtotal = 0, slashTotal = 0, rxNeeded = false; const lines = [], payments = o.payments || [], discount = o.discount || 0, credit = o.credit || 0;
    if (!Array.isArray(o.items) || !o.items.length) throw new Error('Add at least one item to the sale');
    for (const it of o.items) {
      if (!Number.isInteger(it.qty) || it.qty <= 0) throw new Error('Invalid quantity');
      if (it.rx) rxNeeded = true;
      const slash = it.slash || 0;
      if (!Number.isInteger(slash) || slash < 0 || slash >= it.price) throw new Error(`Price slash must be less than the price of ${it.name}`);
      let need = it.qty;
      for (const b of [...(it.batches || [])].filter((x) => x.remaining > 0).sort(byExpiry)) {
        if (!need) break;
        const take = Math.min(need, b.remaining); need -= take;
        lines.push({ item: it, product_id: it.productId, batch_id: b.batchId, qty: take, unit_price: it.price - slash, list_price: it.price, cost_price: b.cost });
        subtotal += take * it.price; slashTotal += take * slash;
      }
      if (need) throw new Error(`Out of stock: ${it.name} - tell admin`);
    }
    const totalDiscount = slashTotal + discount, total = subtotal - totalDiscount;
    if (!Number.isInteger(discount) || discount < 0 || discount > subtotal - slashTotal) throw new Error('Invalid discount');
    if (!Number.isInteger(credit) || credit < 0) throw new Error('Invalid credit amount');
    if (rxNeeded && !(o.rx || '').trim()) throw new Error('This sale includes a prescription-only item — confirm the prescription was seen');
    if (!payments.length && !credit) throw new Error('Choose how the customer is paying');
    for (const p of payments) {
      if (!METHODS.includes(p.method)) throw new Error('Choose Cash, Transfer or POS');
      if (!Number.isInteger(p.amount) || p.amount <= 0) throw new Error('Each payment must be above zero');
    }
    if (payments.reduce((s, p) => s + p.amount, 0) + credit !== total) throw new Error('Payments do not match total');
    let cust = null;
    if (credit > 0) {
      cust = o.customer;
      if (!cust || !(cust.creditLimit > 0)) throw new Error('Choose a customer who has a credit limit');
      if (cust.balance + credit > cust.creditLimit) throw new Error(`Over the credit limit: ${cust.name} owes ${naira(cust.balance)} of ${naira(cust.creditLimit)}`);
    }
    if (!Number.isInteger(o.seq) || o.seq <= 0) throw new Error('Receipt number missing');
    const receiptNo = `${o.dev}-${String(o.seq).padStart(6, '0')}`, out = [];
    const sale = { id: uid(), ...base(c), receipt_no: receiptNo, cashier_id: c.adminId, customer_id: cust ? cust.id : null, rx_ref: rxNeeded ? o.rx.trim() : null,
      subtotal, discount: totalDiscount, total, status: 'completed' };
    out.push(rec('sales', sale, c));
    if (cust) out.push(rec('customer_ledger', { id: uid(), ...base(c), customer_id: cust.id, kind: 'credit_sale', amount: credit, method: null, reference: null, sale_id: sale.id, user_id: c.adminId, note: null }, c));
    if (slashTotal) out.push(rec('activity_log', { id: uid(), ...base(c), user_id: c.adminId, action: 'phone.sale.price_slash', tbl: 'sales', record_id: sale.id, detail: JSON.stringify({ amount: slashTotal }) }, c));
    for (const l of lines) {
      out.push(rec('sale_items', { id: uid(), ...base(c), sale_id: sale.id, product_id: l.product_id, batch_id: l.batch_id, qty: l.qty, unit_price: l.unit_price, cost_price: l.cost_price, list_price: l.list_price }, c));
      out.push(rec('stock_entries', { id: uid(), ...base(c), product_id: l.product_id, batch_id: l.batch_id, qty_change: -l.qty, reason: 'sold', ref_id: sale.id, user_id: c.adminId }, c));
    }
    for (const p of payments) out.push(rec('sale_payments', { id: uid(), ...base(c), sale_id: sale.id, method: p.method, amount: p.amount, reference: (p.reference || '').trim() || null }, c));
    const grouped = [];                      // the receipt shows one line per product and price, not per batch
    for (const l of lines) { const g = grouped.find((x) => x.productId === l.product_id && x.price === l.unit_price); if (g) g.qty += l.qty; else grouped.push({ productId: l.product_id, name: l.item.name, qty: l.qty, price: l.unit_price, slash: l.list_price - l.unit_price }); }
    return { records: out, summary: { saleId: sale.id, receiptNo, at: c.now, subtotal, discount: totalDiscount, total, payments, credit, customer: cust ? cust.name : null, rx: sale.rx_ref, lines: grouped } };
  }

  // The owner voids a completed sale. o: { dev, adminId, sale, items:[sale_items rows], credits:[customer_ledger credit_sale rows], hasRefunds, reason }
  function voidSale(o) {
    const c = ctx(o), s = o.sale;
    if (!s || s.status === 'voided') throw new Error('Sale not found or already voided');
    if (!(o.reason || '').trim()) throw new Error('Please give a reason for the void');
    if (o.hasRefunds) throw new Error('This sale has returns or a pending return, so it cannot be voided');
    const out = [], reason = o.reason.trim();
    out.push(rec('sales', { ...s, status: 'voided', updated_at: Math.max(c.now, (s.updated_at || 0) + 1) }, c));
    for (const i of o.items) out.push(rec('stock_entries', { id: uid(), ...base(c), product_id: i.product_id, batch_id: i.batch_id || null, qty_change: i.qty, reason: 'returned', ref_id: s.id, user_id: c.adminId }, c));
    out.push(rec('voids_refunds', { id: uid(), ...base(c), sale_id: s.id, reason, approved_by: c.adminId }, c));
    for (const l of o.credits) out.push(rec('customer_ledger', { id: uid(), ...base(c), customer_id: l.customer_id, kind: 'adjustment', amount: -l.amount, method: null, reference: null, sale_id: s.id, user_id: c.adminId, note: 'Sale voided' }, c));
    out.push(rec('activity_log', { id: uid(), ...base(c), user_id: c.adminId, action: 'phone.sale.void', tbl: 'sales', record_id: s.id, detail: JSON.stringify({ reason }) }, c));
    return { records: out, summary: { receiptNo: s.receipt_no, reason } };
  }

  // A plain-text receipt for WhatsApp and similar. shop = { name, address, phone, rc, footer }
  function receiptText(shop, s, fmt) {
    const money = fmt || ((k) => '₦' + (k / 100).toLocaleString('en-NG', { minimumFractionDigits: k % 100 ? 2 : 0 }));
    const L = [shop.name || '', shop.address || '', shop.phone ? 'Tel: ' + shop.phone : '', shop.rc ? 'RC: ' + shop.rc : '', '', 'Receipt ' + s.receiptNo,
      new Date(s.at).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' }), ''].filter((x, i) => x || i > 3);
    for (const l of s.lines) L.push(`${l.name}\n  ${l.qty} × ${money(l.price)} = ${money(l.qty * l.price)}${l.slash ? ' (price cut ' + money(l.slash) + ' each)' : ''}`);
    L.push('');
    if (s.discount) L.push('Discount: -' + money(s.discount));
    L.push('TOTAL: ' + money(s.total));
    for (const p of s.payments) L.push(p.method.toUpperCase() + ': ' + money(p.amount));
    if (s.credit) L.push('On credit' + (s.customer ? ' (' + s.customer + ')' : '') + ': ' + money(s.credit));
    if (shop.footer) L.push('', shop.footer);
    return L.join('\n');
  }

  const api = { sell, voidSale, receiptText };
  root.POS_OPS = Object.assign(root.POS_OPS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;

  // ---------- screens (browser only) ----------
  if (typeof document === 'undefined') return;
  const today = () => new Date().toLocaleDateString('en-CA');
  const fail = (e) => (e.message === 'auth' ? 'Please sign in again' : e.message);
  const money = (v) => Math.round(parseFloat(v || 0) * 100) || 0;
  const when = (ms) => new Date(ms).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
  const overlay = (html) => { const bg = document.createElement('div'); bg.className = 'sheetbg'; bg.innerHTML = '<div class="sheet">' + html + '</div>'; document.body.appendChild(bg); return bg; };
  const GREY = 'background:#e8efee;color:var(--ink)', SMALL = 'background:var(--line);color:var(--ink);margin:0';
  const st = { cart: [], res: [], q: '', loaded: false, t: null };
  const lineAmt = (i) => i.qty * (i.price - i.slash);

  function ask(title, label, value) {           // a small question sheet; resolves to the text typed, or null
    return new Promise((res) => {
      const bg = overlay(`<h2 style="margin:0 0 12px;font-size:19px">${esc(title)}</h2><label class="lb">${esc(label)}</label><input id="aq" type="number" inputmode="decimal" value="${esc(value)}" autocomplete="off"><button class="primary" id="aq_ok">Save</button><button class="primary" id="aq_x" style="${GREY};margin-top:8px">Cancel</button>`);
      bg.querySelector('#aq_ok').onclick = () => { const v = bg.querySelector('#aq').value; bg.remove(); res(v); }; bg.querySelector('#aq_x').onclick = () => { bg.remove(); res(null); }; });
  }

  // ----- the Sell tab: search by name, build a cart -----
  root.sellView = function (v) {
    v.innerHTML = `<input id="sl_q" placeholder="Search product by name…" autocomplete="off" enterkeyhint="search"><div class="list" id="sl_res"></div>
      <h3>Cart</h3><div class="list" id="sl_cart"></div><button class="primary" id="sl_go" style="margin-top:12px"></button>`;
    const q = $('sl_q'); q.value = st.q;
    q.oninput = () => { st.q = q.value; clearTimeout(st.t); st.t = setTimeout(search, 250); };
    $('sl_go').onclick = checkout; drawRes(); drawCart(); if (!st.loaded) search();
  };
  async function search() { try { st.res = await rpc('sell_catalog', { p_q: st.q, p_today: today() }); st.loaded = true; drawRes(); } catch (e) { toast(fail(e)); } }
  function drawRes() {
    const el = $('sl_res'); if (!el) return;
    el.innerHTML = st.res.map((p) => `<div class="li" data-id="${esc(p.id)}" style="cursor:pointer${p.sellable > 0 ? '' : ';opacity:.5'}"><span>${esc(p.name)}${p.rx ? ' <span class="badge low">Rx</span>' : ''}<br><small class="mute">${N(p.price)}${p.nextExpiry ? ' · expires ' + esc(p.nextExpiry) : ''}</small></span>${p.sellable > 0 ? `<span class="badge">${p.sellable}</span>` : '<span class="badge out">Out</span>'}</div>`).join('') || '<div class="li mute">No product found</div>';
    el.querySelectorAll('[data-id]').forEach((x) => { x.onclick = () => add(st.res.find((p) => p.id === x.dataset.id)); });
  }
  function add(p) {
    if (!p) return; if (p.sellable <= 0) return toast(p.name + ' is out of stock');
    const ex = st.cart.find((i) => i.productId === p.id);
    if (ex) { if (ex.qty >= p.sellable) return toast('Only ' + p.sellable + ' of ' + p.name + ' available'); ex.qty++; ex.sellable = p.sellable; }
    else st.cart.push({ productId: p.id, name: p.name, price: p.price, rx: p.rx, sellable: p.sellable, qty: 1, slash: 0 });
    drawCart();
  }
  function drawCart() {
    const el = $('sl_cart'), go = $('sl_go'); if (!el) return;
    el.innerHTML = st.cart.map((i, k) => `<div class="li" style="display:block"><div class="row"><b class="grow">${esc(i.name)}</b><button class="mini" data-x="${k}">✕</button></div>
      <small class="mute">${N(i.price - i.slash)} each${i.slash ? ' (price cut ' + N(i.slash) + ')' : ''}</small>
      <div class="row" style="margin-top:6px"><button class="mini" style="${SMALL}" data-m="${k}">−</button><b>${i.qty}</b><button class="mini" style="${SMALL}" data-p="${k}">+</button><button class="mini" style="${SMALL}" data-s="${k}">Cut price</button><span class="grow"></span><b>${N(lineAmt(i))}</b></div></div>`).join('') || '<div class="li mute">Nothing in the cart yet</div>';
    const tot = st.cart.reduce((a, i) => a + lineAmt(i), 0); go.textContent = st.cart.length ? 'Checkout · ' + N(tot) : 'Checkout'; go.disabled = !st.cart.length;
    el.querySelectorAll('[data-x]').forEach((b) => { b.onclick = () => { st.cart.splice(+b.dataset.x, 1); drawCart(); }; });
    el.querySelectorAll('[data-m]').forEach((b) => { b.onclick = () => { const i = st.cart[+b.dataset.m]; if (--i.qty <= 0) st.cart.splice(+b.dataset.m, 1); drawCart(); }; });
    el.querySelectorAll('[data-p]').forEach((b) => { b.onclick = () => { const i = st.cart[+b.dataset.p]; if (i.qty >= i.sellable) return toast('Only ' + i.sellable + ' of ' + i.name + ' available'); i.qty++; drawCart(); }; });
    el.querySelectorAll('[data-s]').forEach((b) => { b.onclick = async () => { const i = st.cart[+b.dataset.s], v = await ask('Price cut — ' + i.name, 'Naira taken off each unit (0 for none)', i.slash / 100);
      if (v === null) return; const k = money(v); if (k < 0 || k >= i.price) return toast('The cut must be less than the price (' + N(i.price) + ')'); i.slash = k; drawCart(); }; });
  }

  // ----- checkout: discount, prescription, split payments, credit -----
  async function checkout() {
    if (!st.cart.length) return toast('Add something to sell first');
    let adminId, custs, batches;
    try { adminId = await getAdmin(); [custs, batches] = await Promise.all([rpc('credit_customers', {}), Promise.all(st.cart.map((i) => rpc('product_batches', { p_product: i.productId, p_today: today() })))]); } catch (e) { return toast(fail(e)); }
    const items = st.cart.map((i, k) => ({ productId: i.productId, name: i.name, price: i.price, rx: i.rx, qty: i.qty, slash: i.slash,
      batches: batches[k].map((b) => ({ batchId: b.batchId, remaining: Number(b.remaining), expiry: b.expiry, cost: Number(b.cost) })) }));
    const subtotal = st.cart.reduce((a, i) => a + i.qty * i.price, 0), slashTotal = st.cart.reduce((a, i) => a + i.qty * i.slash, 0), needRx = st.cart.some((i) => i.rx);
    const bg = overlay(`<h2 style="margin:0 0 10px;font-size:19px">Checkout</h2>
      <div class="list">${st.cart.map((i) => `<div class="li"><span>${esc(i.name)}<br><small class="mute">${i.qty} × ${N(i.price - i.slash)}</small></span><b>${N(lineAmt(i))}</b></div>`).join('')}</div>
      <p id="co_sum" style="margin:12px 2px"></p>
      <label class="lb">Discount on the whole sale (₦, optional)</label><input id="co_disc" type="number" inputmode="decimal" placeholder="0">
      ${needRx ? '<label class="lb">Prescription — who prescribed it, or the reference</label><input id="co_rx" autocomplete="off" placeholder="Required for prescription-only drugs">' : ''}
      <label class="lb">Paid now (₦)</label><div class="row"><input id="co_cash" type="number" inputmode="decimal" placeholder="Cash"><input id="co_tr" type="number" inputmode="decimal" placeholder="Transfer"><input id="co_pos" type="number" inputmode="decimal" placeholder="POS"></div>
      <label class="lb">On credit (optional)</label><select id="co_cu"><option value="">— no credit —</option>${custs.map((c) => `<option value="${esc(c.id)}">${esc(c.name)} — can still take ${N(c.available)}</option>`).join('')}</select>
      <input id="co_cr" type="number" inputmode="decimal" placeholder="Amount on credit (₦)">
      <p id="co_left" class="mute" style="margin:0 2px 8px"></p><p class="err" id="co_e"></p>
      <button class="primary" id="co_ok">Complete sale</button><button class="primary" id="co_x" style="${GREY};margin-top:8px">Back to cart</button>`);
    const $$ = (s) => bg.querySelector(s), err = (m) => { $$('#co_e').textContent = m || ''; }, memo = {}; let touched = false, total = 0;
    const ids = ['#co_cash', '#co_tr', '#co_pos'];
    const refresh = () => { total = Math.max(0, subtotal - slashTotal - money($$('#co_disc').value));
      $$('#co_sum').innerHTML = `Total to pay <b style="font-size:20px">${N(total)}</b>${slashTotal ? `<br><small class="mute">includes price cuts of ${N(slashTotal)}</small>` : ''}`;
      if (!touched) { $$('#co_cash').value = total ? total / 100 : ''; $$('#co_tr').value = ''; $$('#co_pos').value = ''; $$('#co_cr').value = ''; }
      const covered = ids.reduce((a, s) => a + money($$(s).value), 0) + ($$('#co_cu').value ? money($$('#co_cr').value) : 0), left = total - covered;
      $$('#co_left').textContent = left === 0 ? '✓ Payments cover the total' : left > 0 ? 'Still to cover: ' + N(left) : 'Over by ' + N(-left); };
    $$('#co_disc').oninput = () => { touched = false; refresh(); };
    [...ids, '#co_cr'].forEach((s) => { $$(s).oninput = () => { touched = true; refresh(); }; }); $$('#co_cu').onchange = () => { touched = true; refresh(); };
    refresh(); $$('#co_x').onclick = () => bg.remove();
    $$('#co_ok').onclick = async (ev) => { const ok = ev.target; ok.disabled = true; err('');
      try { const payments = [['cash', '#co_cash'], ['transfer', '#co_tr'], ['pos', '#co_pos']].map((p) => ({ method: p[0], amount: money($$(p[1]).value) })).filter((p) => p.amount > 0);
        const cuId = $$('#co_cu').value, credit = cuId ? money($$('#co_cr').value) : 0, customer = custs.find((c) => c.id === cuId) || null, discount = money($$('#co_disc').value), rx = needRx ? $$('#co_rx').value.trim() : '';
        const k = JSON.stringify({ payments, credit, cuId, discount, rx });
        if (memo.k !== k) { memo.seq = (Number(localStorage.getItem('sseq')) || 0) + 1; memo.r = POS_OPS.sell({ dev, adminId, seq: memo.seq, items, payments, discount, credit, customer, rx }); memo.k = k; }   // a retry re-sends the same rows
        await pushRecs(memo.r.records);
        localStorage.setItem('sseq', String(Math.max(Number(localStorage.getItem('sseq')) || 0, memo.seq)));
        st.cart = []; bg.remove(); drawCart(); search(); load(); receiptSheet(memo.r.summary);
      } catch (e) { err(fail(e)); ok.disabled = false; } };
  }

  // ----- the receipt: on screen, shareable -----
  async function shopInfo() {
    const fallback = { name: (C && C.name) || 'Jelvia Health and Beauty Limited', address: '', phone: '', rc: '', footer: 'Thank you for your patronage!' };
    try { const rows = (await rget('tbl=eq.settings&select=data&limit=50')).map((x) => x.data).filter((r) => !r.deleted_at), g = (k) => (rows.find((r) => r.key === k) || {}).value;
      return { name: g('shop_name') || fallback.name, address: g('shop_address') || '', phone: g('shop_phone') || '', rc: g('shop_rc') || '', footer: g('receipt_footer') === undefined ? fallback.footer : g('receipt_footer') }; } catch (e) { return fallback; }
  }
  async function receiptSheet(s) {
    const text = POS_OPS.receiptText(await shopInfo(), s);
    const bg = overlay(`<h2 style="margin:0 0 10px;font-size:19px">Sale complete ✓</h2><pre id="rc_t" style="white-space:pre-wrap;word-break:break-word;font:13px/1.45 ui-monospace,Menlo,monospace;background:var(--bg);padding:12px;border-radius:12px;margin:0 0 12px">${esc(text)}</pre>
      ${navigator.share ? '<button class="primary" id="rc_sh">Share receipt</button>' : ''}<button class="primary" id="rc_cp" style="${GREY};margin-top:8px">Copy receipt</button><button class="primary" id="rc_ok" style="${GREY};margin-top:8px">Done</button>`);
    const sh = bg.querySelector('#rc_sh'); if (sh) sh.onclick = async () => { try { await navigator.share({ title: 'Receipt ' + s.receiptNo, text }); } catch (e) { /* closed without sharing */ } };
    bg.querySelector('#rc_cp').onclick = async () => { try { await navigator.clipboard.writeText(text); toast('Receipt copied'); } catch (e) { toast('Could not copy — press and hold the text to copy it'); } };
    bg.querySelector('#rc_ok').onclick = () => bg.remove();
  }

  // ----- void a sale (owner) -----
  root.voidSheet = async function () {
    let list; try { list = await rpc('recent_sales', { p_from: Date.now() - 3 * 864e5 }); } catch (e) { return toast(fail(e)); }
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Void a sale</h2><p class="mute" style="margin:0 0 12px">Sales from the last 3 days. A voided sale puts its goods back in stock and cancels any credit.</p>
      <input id="vd_q" placeholder="Receipt number" autocomplete="off" autocapitalize="characters"><div class="list" id="vd_l"></div><button class="primary" id="vd_x" style="${GREY};margin-top:12px">Close</button>`);
    const $$ = (s) => bg.querySelector(s);
    const draw = () => { const q = $$('#vd_q').value.trim().toLowerCase(), rows = list.filter((x) => x.receiptNo.toLowerCase().includes(q));
      $$('#vd_l').innerHTML = rows.map((x) => `<div class="li" data-id="${esc(x.saleId)}" style="cursor:pointer"><span>${esc(x.receiptNo)}<br><small class="mute">${when(x.at)} · ${esc(x.cashier)}</small></span><b>${N(x.total)}</b></div>`).join('') || '<div class="li mute">No sales found</div>';
      $$('#vd_l').querySelectorAll('[data-id]').forEach((el) => { el.onclick = () => { bg.remove(); voidDetail(el.dataset.id); }; }); };
    $$('#vd_q').oninput = draw; draw(); $$('#vd_x').onclick = () => bg.remove();
  };
  async function voidDetail(saleId) {
    let vs, adminId; try { adminId = await getAdmin(); vs = await rpc('voidable_sale', { p_sale: saleId }); } catch (e) { return toast(fail(e)); }
    if (!vs) return toast('That sale has not reached the cloud yet');
    if (vs.sale.status === 'voided') return toast('That sale is already voided');
    if (vs.hasRefunds) return toast('This sale has returns, so it cannot be voided');
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Void ${esc(vs.sale.receipt_no)}</h2><p class="mute" style="margin:0 0 12px">${when(vs.sale.created_at)} · total ${N(vs.sale.total)}</p>
      <label class="lb">Reason</label><input id="vd_why" autocomplete="off" placeholder="Why is this sale being voided?"><p class="err" id="vd_e"></p>
      <button class="primary" id="vd_ok" style="background:var(--bad)">Void this sale</button><button class="primary" id="vd_c" style="${GREY};margin-top:8px">Cancel</button>`);
    const $$ = (s) => bg.querySelector(s), memo = {}; $$('#vd_c').onclick = () => bg.remove();
    $$('#vd_ok').onclick = async (ev) => { const ok = ev.target; ok.disabled = true; $$('#vd_e').textContent = '';
      try { const reason = $$('#vd_why').value.trim(); if (memo.k !== reason) { memo.r = POS_OPS.voidSale({ dev, adminId, ...vs, reason }); memo.k = reason; }
        if (!confirm('Void ' + vs.sale.receipt_no + ' (' + N(vs.sale.total) + ')? Its goods go back in stock.')) { ok.disabled = false; return; }
        await pushRecs(memo.r.records); bg.remove(); toast('Voided ✓ — reaches the shop computer when it next goes online'); load();
      } catch (e) { $$('#vd_e').textContent = fail(e); ok.disabled = false; } };
  }
})(typeof window !== 'undefined' ? window : globalThis);