// Run: node phone/test-refund.js   (no install needed)
const assert = require('assert'), R = require('./refund.js');
let pass = 0, failN = 0;
const t = (name, f) => { try { f(); pass++; console.log('  ok   ' + name); } catch (e) { failN++; console.log('  FAIL ' + name + '\n       ' + e.message); } };
const throws = (f, re) => assert.throws(f, (e) => re.test(e.message), 'expected error ' + re);

const NOW = Date.parse('2026-10-09T12:00:00Z'), HOUR = 36e5, TODAY = '2026-10-09';
// A sale of 3 × A (₦1,000) and 1 × B (₦500) with a ₦200 price slash: items worth 350000 kobo, customer paid 330000.
const mk = (over = {}, rows) => ({ sale: { id: 'S1', receiptNo: 'SHOP-00012', at: NOW - 2 * HOUR, total: 330000, status: 'completed', customerId: null, customer: null, ...(over.sale || {}) },
  refunded: over.refunded || 0, maxDebt: over.maxDebt || 0,
  rows: rows || [{ saleItemId: 'I1', productId: 'PA', name: 'Drug A', batchId: 'B1', expiry: '2027-05-01', qty: 3, unitPrice: 100000, costPrice: 60000, returned: 0 },
                 { saleItemId: 'I2', productId: 'PB', name: 'Cream B', batchId: 'B2', expiry: '2027-08-01', qty: 1, unitPrice: 50000, costPrice: 30000, returned: 0 }] });
const call = (sale, items, extra = {}) => R.refund({ dev: 'PHONE-T1', adminId: 'ADMIN', sale, items, reason: 'Wrong item', payments: [], seq: 7, now: NOW, today: TODAY, ...extra });
const by = (res, tbl) => res.records.filter((r) => r.tbl === tbl).map((r) => r.data);

console.log('Pricing and rows');
t('one unit of a discounted line is worth its share of what was paid', () => {
  const q = R.refundQuote({ sale: mk(), items: [{ saleItemId: 'I1', qty: 1, restock: true }], now: NOW, today: TODAY });
  assert.strictEqual(q.amount, Math.round(100000 * 330000 / 350000)); assert.strictEqual(q.amount, 94286); assert.strictEqual(q.toPay, 94286);
});
t('refund builds every row the computer expects, with matching ids', () => {
  const res = call(mk(), [{ saleItemId: 'I1', qty: 1, restock: true }], { payments: [{ method: 'cash', amount: 94286 }] });
  const [rf] = by(res, 'refunds'), [ri] = by(res, 'refund_items'), [se] = by(res, 'stock_entries'), [pay] = by(res, 'refund_payments');
  assert.strictEqual(rf.refund_no, 'PHONE-T1-R00007'); assert.strictEqual(rf.amount, 94286); assert.strictEqual(rf.approved_by, 'ADMIN'); assert.strictEqual(rf.cashier_id, 'ADMIN');
  assert.strictEqual(ri.refund_id, rf.id); assert.strictEqual(ri.restock, 1); assert.strictEqual(ri.cost_price, 60000);
  assert.strictEqual(se.qty_change, 1); assert.strictEqual(se.reason, 'returned'); assert.strictEqual(se.ref_id, rf.id); assert.strictEqual(se.batch_id, 'B1');
  assert.strictEqual(pay.amount, 94286); assert.strictEqual(by(res, 'customer_ledger').length, 0);
  assert.strictEqual(by(res, 'activity_log')[0].action, 'phone.refund.create');
  assert.strictEqual(new Set(res.records.map((r) => r.id)).size, res.records.length, 'ids are unique');
  for (const r of res.records) { assert.strictEqual(r.device_id, 'PHONE-T1'); assert.strictEqual(r.data.id, r.id); assert.strictEqual(r.data.deleted_at, null); }
});
t('damaged goods: returned then written off, so the shelf count stays right and the loss is recorded', () => {
  const res = call(mk(), [{ saleItemId: 'I1', qty: 2, restock: false }], { payments: [{ method: 'transfer', amount: 188571 }] });
  const se = by(res, 'stock_entries');
  assert.deepStrictEqual(se.map((s) => [s.reason, s.qty_change]), [['returned', 2], ['damaged', -2]]); assert.strictEqual(se.reduce((a, s) => a + s.qty_change, 0), 0);
  assert.strictEqual(by(res, 'refund_items')[0].restock, 0);
});
t('refunding the rest of a sale in two steps adds up to exactly what was paid', () => {
  const first = call(mk(), [{ saleItemId: 'I1', qty: 1, restock: true }], { payments: [{ method: 'cash', amount: 94286 }] });
  const sale2 = mk({ refunded: 94286 }); sale2.rows[0].returned = 1;
  const second = call(sale2, [{ saleItemId: 'I1', qty: 2, restock: true }, { saleItemId: 'I2', qty: 1, restock: true }], { payments: [{ method: 'cash', amount: 235714 }], seq: 8 });
  assert.strictEqual(by(first, 'refunds')[0].amount + by(second, 'refunds')[0].amount, 330000);
});
t('the last return takes the rounding (3 lines of ₦1.00 on a ₦1.00 sale)', () => {
  const rows = ['X', 'Y', 'Z'].map((n, i) => ({ saleItemId: 'I' + i, productId: n, name: n, batchId: null, expiry: null, qty: 1, unitPrice: 100, costPrice: 0, returned: 0 }));
  const res = call(mk({ sale: { total: 100 } }, rows), rows.map((r) => ({ saleItemId: r.saleItemId, qty: 1, restock: true })), { payments: [{ method: 'cash', amount: 100 }] });
  assert.deepStrictEqual(by(res, 'refund_items').map((r) => r.amount), [33, 33, 34]); assert.strictEqual(by(res, 'refunds')[0].amount, 100);
  assert.strictEqual(by(res, 'stock_entries')[0].batch_id, null);
});
t('money balances: refund = sum of line amounts = payouts + debt cancelled', () => {
  const sale = mk({ maxDebt: 50000, sale: { customerId: 'C1', customer: 'Mrs Ade' } });
  const res = call(sale, [{ saleItemId: 'I1', qty: 2, restock: true }, { saleItemId: 'I2', qty: 1, restock: false }], { payments: [{ method: 'cash', amount: 100000 }, { method: 'pos', amount: 85714 }].filter((p) => p.amount > 0) });
  const amount = by(res, 'refunds')[0].amount, lines = by(res, 'refund_items').reduce((a, r) => a + r.amount, 0), pays = by(res, 'refund_payments').reduce((a, p) => a + p.amount, 0), debt = -by(res, 'customer_ledger').reduce((a, l) => a + l.amount, 0);
  assert.strictEqual(amount, lines); assert.strictEqual(amount, pays + debt);
});

console.log('Credit customers');
t('a credit customer’s debt for the returned goods is cancelled first; only the rest is paid out', () => {
  const sale = mk({ maxDebt: 50000, sale: { customerId: 'C1', customer: 'Mrs Ade' } }), items = [{ saleItemId: 'I1', qty: 1, restock: true }];
  const res = call(sale, items, { payments: [{ method: 'cash', amount: 44286 }] });
  const [l] = by(res, 'customer_ledger'); assert.strictEqual(l.amount, -50000); assert.strictEqual(l.kind, 'adjustment'); assert.strictEqual(l.customer_id, 'C1'); assert.strictEqual(l.sale_id, 'S1'); assert.strictEqual(l.note, 'Refund PHONE-T1-R00007');
  throws(() => call(sale, items, { payments: [{ method: 'cash', amount: 94286 }] }), /must add up to ₦442\.86.*comes off what Mrs Ade owes/);
});
t('when the whole refund is cancelled debt, nothing is paid out', () => {
  const sale = mk({ maxDebt: 150000, sale: { customerId: 'C1', customer: 'Mrs Ade' } });
  const res = call(sale, [{ saleItemId: 'I1', qty: 1, restock: true }]);
  assert.strictEqual(by(res, 'refund_payments').length, 0); assert.strictEqual(by(res, 'customer_ledger')[0].amount, -94286);
  throws(() => call(sale, [{ saleItemId: 'I1', qty: 1, restock: true }], { payments: [{ method: 'cash', amount: 1 }] }), /must add up to ₦0/);
});

console.log('Money comes from');
t('a cashier’s till can be chosen as the source; the owner still approves', () => {
  const rf = by(call(mk(), [{ saleItemId: 'I1', qty: 1, restock: true }], { payments: [{ method: 'cash', amount: 94286 }], tillUserId: 'CASHIER9' }), 'refunds')[0];
  assert.strictEqual(rf.cashier_id, 'CASHIER9'); assert.strictEqual(rf.approved_by, 'ADMIN');
});

console.log('Refusals');
const ok1 = [{ saleItemId: 'I1', qty: 1, restock: true }], pay1 = { payments: [{ method: 'cash', amount: 94286 }] };
t('only completed sales, inside 3 days', () => {
  throws(() => call(mk({ sale: { status: 'voided' } }), ok1, pay1), /voided/);
  throws(() => call(mk({ sale: { at: NOW - 3 * 864e5 - 1 } }), ok1, pay1), /within 3 days/);
  call(mk({ sale: { at: NOW - 3 * 864e5 } }), ok1, pay1);
});
t('cannot return more than was sold, or what was already returned', () => {
  throws(() => call(mk(), [{ saleItemId: 'I1', qty: 4, restock: true }], pay1), /Only 3 of Drug A/);
  const s = mk(); s.rows[0].returned = 2; throws(() => call(s, [{ saleItemId: 'I1', qty: 2, restock: true }], pay1), /Only 1 of Drug A/);
  throws(() => call(mk(), [{ saleItemId: 'NOPE', qty: 1, restock: true }], pay1), /not on this sale/);
  throws(() => call(mk(), [...ok1, ...ok1], pay1), /only be listed once/);
  throws(() => call(mk(), [{ saleItemId: 'I1', qty: 1.5, restock: true }], pay1), /whole number/);
  throws(() => call(mk(), [], pay1), /at least one item/);
});
t('stock or damaged must be chosen, and expired goods cannot go back to stock', () => {
  throws(() => call(mk(), [{ saleItemId: 'I1', qty: 1 }], pay1), /goes back to stock or is damaged/);
  const s = mk(); s.rows[0].expiry = '2026-10-08';
  throws(() => call(s, ok1, pay1), /expired batch/);
  call(s, [{ saleItemId: 'I1', qty: 1, restock: false }], pay1);
});
t('a reason is required; payouts must add up; methods must be real', () => {
  throws(() => call(mk(), ok1, { ...pay1, reason: '  ' }), /reason/);
  throws(() => call(mk(), ok1, { payments: [{ method: 'cash', amount: 94000 }] }), /must add up to ₦942\.86/);
  throws(() => call(mk(), ok1, { payments: [{ method: 'cheque', amount: 94286 }] }), /Cash, Transfer or POS/);
  throws(() => call(mk(), ok1, { payments: [{ method: 'cash', amount: 0 }, { method: 'pos', amount: 94286 }] }), /above zero/);
  throws(() => call(mk(), ok1, { ...pay1, adminId: null }), /Owner account/);
});
t('a refund can never exceed what the sale was worth', () => {
  throws(() => call(mk({ refunded: 300000 }), ok1, pay1), /more than the sale was worth/);
});

console.log('Fit with the computer’s tables (so the sync cannot silently drop a row)');
const NOT_NULL = { refunds: ['id', 'created_at', 'updated_at', 'refund_no', 'sale_id', 'amount'], refund_items: ['id', 'created_at', 'updated_at', 'refund_id', 'sale_item_id', 'product_id', 'qty', 'amount', 'cost_price', 'restock'],
  refund_payments: ['id', 'created_at', 'updated_at', 'refund_id', 'method', 'amount'], stock_entries: ['id', 'created_at', 'updated_at', 'product_id', 'qty_change', 'reason'],
  customer_ledger: ['id', 'created_at', 'updated_at', 'customer_id', 'kind', 'amount'], activity_log: ['id', 'created_at', 'updated_at', 'action'] };
const COLS = { refunds: 'id created_at updated_at deleted_at device_id synced_at refund_no sale_id request_id cashier_id approved_by amount reason', refund_items: 'id created_at updated_at deleted_at device_id synced_at refund_id sale_item_id product_id batch_id qty amount cost_price restock',
  refund_payments: 'id created_at updated_at deleted_at device_id synced_at refund_id method amount reference', stock_entries: 'id created_at updated_at deleted_at device_id synced_at product_id batch_id qty_change reason ref_id user_id',
  customer_ledger: 'id created_at updated_at deleted_at device_id synced_at customer_id kind amount method reference sale_id user_id note', activity_log: 'id created_at updated_at deleted_at device_id synced_at user_id action tbl record_id detail' };
t('every row has all required columns and no column the table lacks', () => {
  const sale = mk({ maxDebt: 50000, sale: { customerId: 'C1', customer: 'Mrs Ade' } });
  const res = call(sale, [{ saleItemId: 'I1', qty: 1, restock: false }, { saleItemId: 'I2', qty: 1, restock: true }], { payments: [{ method: 'cash', amount: 94286 + 47143 - 50000 }] });
  const seen = new Set();
  for (const r of res.records) { seen.add(r.tbl); const cols = COLS[r.tbl].split(' ');
    for (const k of Object.keys(r.data)) assert.ok(cols.includes(k), `${r.tbl} has no column ${k}`);
    for (const k of NOT_NULL[r.tbl]) assert.ok(r.data[k] !== undefined && r.data[k] !== null, `${r.tbl}.${k} is empty`); }
  assert.deepStrictEqual([...seen].sort(), Object.keys(COLS).sort());
});
t('stock_entries use reasons the computer allows', () => {
  const res = call(mk(), [{ saleItemId: 'I1', qty: 1, restock: false }], { payments: [{ method: 'cash', amount: 94286 }] });
  for (const s of by(res, 'stock_entries')) assert.ok(['received', 'sold', 'expired', 'damaged', 'correction', 'returned'].includes(s.reason));
});
console.log(`\n${pass} passed, ${failN} failed`); process.exit(failN ? 1 : 0);