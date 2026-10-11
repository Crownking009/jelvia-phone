// The owner's end-of-day close from her phone. Mirrors closeShift() in src/services/shifts.js: it counts cash, transfer and POS against what the
// system expects, keeps the record forever, and needs an explanation for any difference. Pure builder (no network) so Node can test it.
(function (root) {
  const METHODS = ['cash', 'transfer', 'pos'];
  const uid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : require('crypto').randomUUID());
  const base = (c) => ({ created_at: c.now, updated_at: c.now, deleted_at: null, device_id: c.dev, synced_at: null });
  const rec = (tbl, data, c) => ({ tbl, id: data.id, data, device_id: c.dev, updated_at: data.updated_at });
  const naira = (k) => '₦' + (k / 100).toLocaleString('en-NG');
  const when = (ms) => new Date(ms).toLocaleString('en-NG', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });

  // o: { dev, adminId, summary (from the cloud function shift_summary for the owner), counted: { cash, transfer, pos } in kobo, note }
  function closeDay(o) {
    if (!o.adminId) throw new Error('Owner account not found');
    const s = o.summary, counted = o.counted || {}, vals = {};
    if (!s || !s.methods) throw new Error('Could not read today’s totals');
    for (const m of METHODS) {
      const v = counted[m] === undefined ? NaN : counted[m];
      if (!Number.isInteger(v) || v < 0) throw new Error(`Enter the amount counted for ${m.toUpperCase()} (0 if none)`);
      vals[m] = v;
    }
    const diff = Object.fromEntries(METHODS.map((m) => [m, vals[m] - s.methods[m]])), note = (o.note || '').trim();
    if (METHODS.some((m) => diff[m] !== 0) && !note) throw new Error('There is a difference (short or over) — please write a short explanation');
    const c = { dev: o.dev, adminId: o.adminId, now: o.now || Date.now() };
    const row = { id: uid(), ...base(c), cashier_id: c.adminId, period_from: s.from || 0, period_to: s.to, sales_count: s.count,
      exp_cash: s.methods.cash, exp_transfer: s.methods.transfer, exp_pos: s.methods.pos, cnt_cash: vals.cash, cnt_transfer: vals.transfer, cnt_pos: vals.pos, note: note || null };
    const log = rec('activity_log', { id: uid(), ...base(c), user_id: c.adminId, action: 'phone.shift.close', tbl: 'shift_closes', record_id: row.id, detail: JSON.stringify({ difference: diff }) }, c);
    return { records: [rec('shift_closes', row, c), log], summary: { id: row.id, closedAt: s.to, from: s.from, count: s.count, total: s.total, credit: s.credit, repaid: s.repaid, refunded: s.refunded, expected: s.methods, counted: vals, difference: diff, note: note || null } };
  }
  const slip = (shop, r) => { const m = (k) => naira(k), L = [shop.name || '', '', 'END OF DAY CLOSE', when(r.closedAt), '', `Sales: ${r.count} · ${m(r.total)}`];
    if (r.credit) L.push('On credit: ' + m(r.credit)); if (r.repaid) L.push('Debts paid back: ' + m(r.repaid)); if (r.refunded) L.push('Refunds paid out: ' + m(r.refunded)); L.push('');
    for (const k of METHODS) { const d = r.difference[k]; L.push(`${k.toUpperCase()}: expected ${m(r.expected[k])}, counted ${m(r.counted[k])}${d ? (d < 0 ? ' — SHORT ' : ' — OVER ') + m(Math.abs(d)) : ' ✓'}`); }
    if (r.note) L.push('', 'Note: ' + r.note); return L.join('\n').trim(); };

  const api = { closeDay, closeSlip: slip };
  for (const k of Object.keys(api)) if (root.POS_OPS && k in root.POS_OPS) throw new Error('POS_OPS name clash: ' + k + ' is already defined by another phone file');
  root.POS_OPS = Object.assign(root.POS_OPS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;

  // ---------- screen (browser only) ----------
  if (typeof document === 'undefined') return;
  const fail = (e) => (e.message === 'auth' ? 'Please sign in again' : e.message);
  const kobo = (v) => (String(v).trim() === '' ? undefined : Math.round(parseFloat(v) * 100));
  const overlay = (html) => { const bg = document.createElement('div'); bg.className = 'sheetbg'; bg.innerHTML = '<div class="sheet">' + html + '</div>'; document.body.appendChild(bg); return bg; };
  const GREY = 'background:#e8efee;color:var(--ink)';

  root.endOfDaySheet = async function () {
    let adminId, s; const to = Date.now();
    try { adminId = await getAdmin(); s = await rpc('shift_summary', { p_user: adminId, p_to: to }); } catch (e) { return toast(fail(e)); }
    const ls = data && data.t && data.t.lastSync ? new Date(data.t.lastSync).getTime() : 0, stale = !ls || Date.now() - ls > 6 * 36e5;
    const row = (k) => `<div class="li"><span>${k.toUpperCase()}<br><small class="mute">expected ${N(s.methods[k])}</small></span><span style="width:46%"><input id="eo_${k}" type="number" inputmode="decimal" placeholder="Counted ₦" style="margin:0"><small id="eo_d_${k}" class="mute"></small></span></div>`;
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">End of day close</h2>
      <p class="mute" style="margin:0 0 10px">Your till since ${s.from ? new Date(s.from).toLocaleString('en-NG', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : 'your first sale'}. Count what you hold, then close.</p>
      ${stale ? '<div class="banner" style="margin:0 0 10px">The shop computer has not synced for a while. Sales made at the shop since then are not counted here yet — if you also take money there, close from the computer or wait for it to sync.</div>' : ''}
      <div class="cards" style="margin-bottom:10px">${[['Sales', s.count + ' · ' + N(s.total)], ['On credit', N(s.credit)], ['Debts paid back', N(s.repaid)], ['Refunds paid out', N(s.refunded)]].map((c) => `<div class="card"><small>${c[0]}</small><b style="font-size:16px">${c[1]}</b></div>`).join('')}</div>
      <div class="list">${METHODS.map(row).join('')}</div>
      <label class="lb" style="margin-top:12px">Explanation (needed if anything is short or over)</label><input id="eo_note" autocomplete="off">
      <p class="err" id="eo_e"></p><button class="primary" id="eo_ok">Close the day</button><button class="primary" id="eo_x" style="${GREY};margin-top:8px">Cancel</button>`);
    const $$ = (q) => bg.querySelector(q), memo = {};
    const refresh = () => METHODS.forEach((k) => { const v = kobo($$('#eo_' + k).value), d = v === undefined ? null : v - s.methods[k];
      $$('#eo_d_' + k).textContent = d === null ? '' : d === 0 ? '✓ matches' : (d < 0 ? 'short ' : 'over ') + N(Math.abs(d)); $$('#eo_d_' + k).style.color = d ? 'var(--bad)' : ''; });
    METHODS.forEach((k) => { $$('#eo_' + k).oninput = refresh; }); $$('#eo_x').onclick = () => bg.remove();
    $$('#eo_ok').onclick = async (ev) => { const ok = ev.target; ok.disabled = true; $$('#eo_e').textContent = '';
      try { const counted = Object.fromEntries(METHODS.map((k) => [k, kobo($$('#eo_' + k).value)])), note = $$('#eo_note').value, key = JSON.stringify({ counted, note });
        if (memo.k !== key) { memo.r = POS_OPS.closeDay({ dev, adminId, summary: s, counted, note }); memo.k = key; }   // a retry re-sends the same record
        if (!confirm('Close the day? The count is saved and cannot be changed afterwards.')) { ok.disabled = false; return; }
        await pushRecs(memo.r.records); bg.remove(); load(); closedSheet(memo.r.summary);
      } catch (e) { $$('#eo_e').textContent = fail(e); ok.disabled = false; } };
  };
  async function closedSheet(r) {
    let shop = { name: (C && C.name) || '' };
    try { const rows = (await rget('tbl=eq.settings&select=data&limit=50')).map((x) => x.data).filter((x) => !x.deleted_at), g = (k) => (rows.find((x) => x.key === k) || {}).value; shop = { name: g('shop_name') || shop.name }; } catch (e) { /* default name */ }
    const text = slip(shop, r), bg = overlay(`<h2 style="margin:0 0 10px;font-size:19px">Day closed ✓</h2><pre style="white-space:pre-wrap;word-break:break-word;font:13px/1.45 ui-monospace,Menlo,monospace;background:var(--bg);padding:12px;border-radius:12px;margin:0 0 12px">${esc(text)}</pre>
      ${navigator.share ? '<button class="primary" id="cd_sh">Share summary</button>' : ''}<button class="primary" id="cd_ok" style="${GREY};margin-top:8px">Done</button>`);
    const sh = bg.querySelector('#cd_sh'); if (sh) sh.onclick = async () => { try { await navigator.share({ title: 'End of day close', text }); } catch (e) { /* closed */ } };
    bg.querySelector('#cd_ok').onclick = () => bg.remove();
  }
})(typeof window !== 'undefined' ? window : globalThis);