// Staff on the owner's phone: add a cashier, reset a password, remove someone who has left. Mirrors addCashier(), resetUser() and deactivateUser()
// in src/services/admin.js and auth.js. A password is never stored: only a salted scrypt hash, in exactly the form the shop computer checks at sign-in.
// Removing a person switches them off (they can no longer sign in) and keeps their past sales, like the computer. Builders do not touch the network.
(function (root) {
  const uid = () => (root.crypto && root.crypto.randomUUID ? root.crypto.randomUUID() : require('crypto').randomUUID());
  const base = (c) => ({ created_at: c.now, updated_at: c.now, deleted_at: null, device_id: c.dev, synced_at: null });
  const rec = (tbl, data, c) => ({ tbl, id: data.id, data, device_id: c.dev, updated_at: data.updated_at });
  const log = (c, action, tbl, recordId, detail) => rec('activity_log', { id: uid(), ...base(c), user_id: c.adminId, action: 'phone.' + action, tbl, record_id: recordId, detail: detail ? JSON.stringify(detail) : null }, c);
  const ctx = (o) => { if (!o.adminId) throw new Error('Admin only'); return { dev: o.dev, adminId: o.adminId, now: o.now || Date.now() }; };
  const subtle = () => { const s = root.crypto && root.crypto.subtle; if (!s) throw new Error('This phone cannot protect passwords here — open the page over https'); return s; };

  // ----- scrypt (RFC 7914) so the phone can make the same password hash the computer's Node `crypto.scryptSync` makes -----
  if (new Uint8Array(new Uint32Array([1]).buffer)[0] !== 1) throw new Error('Unsupported device');
  const R = (a, b) => (a << b) | (a >>> (32 - b));
  function salsa8(B) {
    const x = new Uint32Array(B);
    for (let i = 0; i < 8; i += 2) {
      x[4] ^= R(x[0] + x[12], 7); x[8] ^= R(x[4] + x[0], 9); x[12] ^= R(x[8] + x[4], 13); x[0] ^= R(x[12] + x[8], 18);
      x[9] ^= R(x[5] + x[1], 7); x[13] ^= R(x[9] + x[5], 9); x[1] ^= R(x[13] + x[9], 13); x[5] ^= R(x[1] + x[13], 18);
      x[14] ^= R(x[10] + x[6], 7); x[2] ^= R(x[14] + x[10], 9); x[6] ^= R(x[2] + x[14], 13); x[10] ^= R(x[6] + x[2], 18);
      x[3] ^= R(x[15] + x[11], 7); x[7] ^= R(x[3] + x[15], 9); x[11] ^= R(x[7] + x[3], 13); x[15] ^= R(x[11] + x[7], 18);
      x[1] ^= R(x[0] + x[3], 7); x[2] ^= R(x[1] + x[0], 9); x[3] ^= R(x[2] + x[1], 13); x[0] ^= R(x[3] + x[2], 18);
      x[6] ^= R(x[5] + x[4], 7); x[7] ^= R(x[6] + x[5], 9); x[4] ^= R(x[7] + x[6], 13); x[5] ^= R(x[4] + x[7], 18);
      x[11] ^= R(x[10] + x[9], 7); x[8] ^= R(x[11] + x[10], 9); x[9] ^= R(x[8] + x[11], 13); x[10] ^= R(x[9] + x[8], 18);
      x[12] ^= R(x[15] + x[14], 7); x[13] ^= R(x[12] + x[15], 9); x[14] ^= R(x[13] + x[12], 13); x[15] ^= R(x[14] + x[13], 18);
    }
    for (let i = 0; i < 16; i++) B[i] += x[i];
  }
  function blockMix(B, r, Y) {
    const X = B.slice((2 * r - 1) * 16, (2 * r - 1) * 16 + 16);
    for (let i = 0; i < 2 * r; i++) { for (let k = 0; k < 16; k++) X[k] ^= B[i * 16 + k]; salsa8(X); Y.set(X, ((i & 1) ? r + (i >> 1) : i >> 1) * 16); }
  }
  function roMix(B, N, r) {
    const w = 32 * r, V = new Uint32Array(w * N); let X = B, Y = new Uint32Array(w);
    for (let i = 0; i < N; i++) { V.set(X, i * w); blockMix(X, r, Y); const t = X; X = Y; Y = t; }
    for (let i = 0; i < N; i++) { const j = X[(2 * r - 1) * 16] & (N - 1); for (let k = 0; k < w; k++) X[k] ^= V[j * w + k]; blockMix(X, r, Y); const t = X; X = Y; Y = t; }
    return X;
  }
  async function pbkdf2(pw, salt, bytes) { const s = subtle(), key = await s.importKey('raw', pw, 'PBKDF2', false, ['deriveBits']); return new Uint8Array(await s.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations: 1 }, key, bytes * 8)); }
  async function scryptKey(pw, salt, N = 16384, r = 8, p = 1, len = 32) {     // pw, salt: Uint8Array
    const B = await pbkdf2(pw, salt, p * 128 * r);
    for (let i = 0; i < p; i++) { const part = new Uint32Array(B.buffer, i * 128 * r, 32 * r), out = roMix(part.slice(), N, r); new Uint8Array(B.buffer, i * 128 * r, 128 * r).set(new Uint8Array(out.buffer)); }
    return pbkdf2(pw, B, len);
  }
  const hex = (u8) => [...u8].map((b) => b.toString(16).padStart(2, '0')).join('');
  async function hashPassword(pw) {               // 'salt:hash' — the salt is 32 hex characters used as text, exactly like the computer's hash()
    const salt = hex(root.crypto.getRandomValues(new Uint8Array(16))), enc = new TextEncoder();
    return salt + ':' + hex(await scryptKey(enc.encode(pw), enc.encode(salt)));
  }

  // ----- the rules -----
  const staffList = (rows) => rows.filter((u) => !u.deleted_at && u.active === 1).map((u) => ({ id: u.id, username: u.username, fullName: u.full_name, role: u.role }))
    .sort((a, b) => (a.role < b.role ? -1 : a.role > b.role ? 1 : a.username < b.username ? -1 : a.username > b.username ? 1 : 0));
  // o: { dev, adminId, rows (every user row, including switched-off ones: a username is never reused), username, password, fullName }
  async function createCashier(o) {
    const c = ctx(o), username = (o.username || '').trim();
    if (!username || (o.password || '').length < 6) throw new Error('Username and a password of 6+ characters are required');
    if ((o.rows || []).some((u) => String(u.username).toLowerCase() === username.toLowerCase())) throw new Error('That username is already used');
    const row = { id: uid(), ...base(c), username, password_hash: await hashPassword(o.password), full_name: (o.fullName || '').trim() || null, role: 'cashier', active: 1, must_change_password: 0 };
    return { records: [rec('users', row, c), log(c, 'user.create', 'users', row.id, { username, role: 'cashier' })], summary: { username } };
  }
  // o: { dev, adminId, user (the person's current row), temp }. They must choose their own password at the next sign-in.
  async function resetPassword(o) {
    const c = ctx(o); if ((o.temp || '').length < 6) throw new Error('Temporary password needs 6+ characters');
    if (!o.user || !o.user.id) throw new Error('User not found');
    const row = { ...o.user, password_hash: await hashPassword(o.temp), must_change_password: 1, updated_at: Math.max(c.now, (o.user.updated_at || 0) + 1) };
    return { records: [rec('users', row, c), log(c, 'user.reset_password', 'users', row.id, null)], summary: { username: row.username } };
  }
  // o: { dev, adminId, user (current row), rows (every user row) }. The person can no longer sign in; their past sales stay.
  function deactivateUser(o) {
    const c = ctx(o), u = o.user;
    if (u && u.id === c.adminId) throw new Error('You cannot deactivate yourself');
    if (!u || u.active !== 1) throw new Error('User not found');
    if (u.role === 'admin' && (o.rows || []).filter((x) => x.role === 'admin' && x.active === 1 && x.id !== u.id).length < 1) throw new Error('There must always be one active admin');
    const row = { ...u, active: 0, updated_at: Math.max(c.now, (u.updated_at || 0) + 1) };
    return { records: [rec('users', row, c), log(c, 'user.deactivate', 'users', row.id, null)], summary: { username: row.username } };
  }
  const api = { staffList, createCashier, resetPassword, deactivateUser, hashPassword, scryptKey };
  for (const k of Object.keys(api)) if (root.POS_OPS && k in root.POS_OPS) throw new Error('POS_OPS name clash: ' + k + ' is already defined by another phone file');
  root.POS_OPS = Object.assign(root.POS_OPS || {}, api);
  if (typeof module !== 'undefined') module.exports = api;

  // ---------- screens (browser only) ----------
  if (typeof document === 'undefined') return;
  const fail = (e) => (e.message === 'auth' ? 'Please sign in again' : e.message);
  const overlay = (html) => { const bg = document.createElement('div'); bg.className = 'sheetbg'; bg.innerHTML = '<div class="sheet">' + html + '</div>'; document.body.appendChild(bg); return bg; };
  const GREY = 'background:#e8efee;color:var(--ink)', NOAUTO = 'autocomplete="off" autocapitalize="none" autocorrect="off" spellcheck="false"';
  const userRows = async () => (await rget('tbl=eq.users&select=data&limit=300')).map((x) => x.data);
  root.staffSheet = async function () {
    let rows; try { rows = await userRows(); } catch (e) { return toast(fail(e)); }
    const list = POS_OPS.staffList(rows);
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Staff</h2><p class="mute" style="margin:0 0 12px">People who can sign in on the shop computer.</p><button class="primary" id="st_new">＋ Add a cashier</button>
      <div class="list" style="margin-top:10px">${list.map((u) => `<div class="li" data-id="${esc(u.id)}" style="cursor:pointer"><span>${esc(u.fullName || u.username)}<br><small class="mute">${esc(u.username)}</small></span><span class="badge${u.role === 'admin' ? '' : ' low'}">${u.role === 'admin' ? 'Owner / admin' : 'Cashier'}</span></div>`).join('') || '<div class="li mute">No staff found</div>'}</div>
      <button class="primary" id="st_x" style="${GREY};margin-top:12px">Close</button>`);
    bg.querySelector('#st_x').onclick = () => bg.remove(); bg.querySelector('#st_new').onclick = () => { bg.remove(); addForm(); };
    bg.querySelectorAll('[data-id]').forEach((el) => { el.onclick = () => { bg.remove(); personSheet(list.find((u) => u.id === el.dataset.id)); }; });
  };
  function form(title, intro, fields, button, go, danger) {
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">${esc(title)}</h2><p class="mute" style="margin:0 0 12px">${intro}</p>${fields.map((f) => `<label class="lb">${esc(f.l)}</label><input id="f_${f.k}" type="text" ${NOAUTO} placeholder="${esc(f.ph || '')}">`).join('')}
      <p class="err" id="f_e"></p><p class="mute" id="f_w" style="display:none;margin:0 2px 8px">Working… this takes a few seconds.</p><button class="primary" id="f_ok"${danger ? ' style="background:var(--bad)"' : ''}>${esc(button)}</button><button class="primary" id="f_x" style="${GREY};margin-top:8px">Cancel</button>`);
    const $$ = (s) => bg.querySelector(s); $$('#f_x').onclick = () => { bg.remove(); staffSheet(); };
    $$('#f_ok').onclick = async (ev) => { const ok = ev.target; ok.disabled = true; $$('#f_e').textContent = ''; $$('#f_w').style.display = 'block';
      try { await go(Object.fromEntries(fields.map((f) => [f.k, $$('#f_' + f.k).value])), bg); } catch (e) { $$('#f_e').textContent = fail(e); ok.disabled = false; $$('#f_w').style.display = 'none'; } };
    return bg;
  }
  function addForm() {
    const memo = {};
    form('Add a cashier', 'They sign in on the shop computer with this username and password. Write the password down for them: it is not shown again.',
      [{ k: 'username', l: 'Username (no spaces)' }, { k: 'full', l: 'Full name (optional)' }, { k: 'pw', l: 'Password (6 or more characters)' }], 'Add cashier',
      async (f, bg) => { const aid = await getAdmin(), rows = await userRows(), key = JSON.stringify(f);
        if (memo.k !== key) { memo.r = POS_OPS.createCashier({ dev, adminId: aid, rows, username: f.username, password: f.pw, fullName: f.full }); memo.k = key; }   // a retry re-sends the same record
        const r = await memo.r; await pushRecs(r.records); bg.remove(); toast('Added ✓ — can sign in once the shop computer syncs'); load(); });
  }
  function personSheet(u) {
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">${esc(u.fullName || u.username)}</h2><p class="mute" style="margin:0 0 14px">${esc(u.username)} · ${u.role === 'admin' ? 'owner / admin' : 'cashier'}</p>
      <button class="primary" data-a="rs">Reset password</button><button class="primary" data-a="rm" style="background:#fbe3e3;color:var(--bad);margin-top:8px">Remove — can no longer sign in</button><button class="primary" data-a="x" style="${GREY};margin-top:8px">Back to staff</button>`);
    bg.onclick = (e) => { const b = e.target.closest('button'); if (!b) return; bg.remove(); const a = b.dataset.a; if (a === 'rs') resetForm(u); if (a === 'rm') removeForm(u); if (a === 'x') staffSheet(); };
  }
  function resetForm(u) {
    const memo = {};
    form('Reset password — ' + (u.fullName || u.username), 'Choose a temporary password and tell it to them. They must choose their own the next time they sign in.' + (u.role === 'admin' ? ' <b>This is an owner / admin account on the shop computer.</b>' : ''),
      [{ k: 'temp', l: 'Temporary password (6 or more characters)' }], 'Reset password',
      async (f, bg) => { const aid = await getAdmin(), row = (await userRows()).find((x) => x.id === u.id), key = JSON.stringify(f);
        if (!row) throw new Error('User not found'); if (memo.k !== key) { memo.r = POS_OPS.resetPassword({ dev, adminId: aid, user: row, temp: f.temp }); memo.k = key; }
        const r = await memo.r; await pushRecs(r.records); bg.remove(); toast('Password reset ✓ — takes effect once the shop computer syncs'); load(); });
  }
  async function removeForm(u) {
    if (!confirm('Remove ' + (u.fullName || u.username) + '?\n\nThey can no longer sign in. Their past sales stay in the records, and their username cannot be used again.')) return;
    try { const aid = await getAdmin(), rows = await userRows(), row = rows.find((x) => x.id === u.id), r = POS_OPS.deactivateUser({ dev, adminId: aid, user: row, rows });
      await pushRecs(r.records); toast('Removed ✓ — takes effect once the shop computer syncs'); load(); } catch (e) { toast(fail(e)); }
  }
})(typeof window !== 'undefined' ? window : globalThis);
