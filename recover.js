// "Forgot password?" for the phone's own sign-in (the Supabase account), by emailed link. Separate from the computer's admin password and recovery code.
// 1) The sign-in screen asks Supabase to email a reset link. 2) The link opens this page with a one-time token in the address; the page shows a
// "choose a new password" screen, removes the token from the address bar straight away, and never stores it.
(function (root) {
  const parse = (str) => { const p = new URLSearchParams(String(str || '').replace(/^[#?]/, '')); return { type: p.get('type'), token: p.get('access_token'), error: p.get('error') || p.get('error_code'), desc: p.get('error_description') }; };
  const passwordProblem = (pw, again) => ((pw || '').length < 8 ? 'Use at least 8 characters' : pw !== again ? 'The two passwords do not match' : null);
  const friendly = (status, msg) => status === 429 ? 'Please wait a minute before asking for another email.'
    : status === 401 || status === 403 ? 'This link has expired or was already used. Ask for a new one.'
    : /different from the old/i.test(msg || '') ? 'Choose a password you have not used before.' : (msg || 'Something went wrong. Please try again.');
  const api = { parseAuthRedirect: parse, passwordProblem, authErrorText: friendly };
  if (typeof module !== 'undefined') module.exports = api;
  if (typeof document === 'undefined') return;

  const C = root.POS_CONFIG || {}, $$ = (id) => document.getElementById(id);
  const setupNeeded = () => !C.url || String(C.url).includes('YOUR-PROJECT');
  const overlay = (html) => { const bg = document.createElement('div'); bg.className = 'sheetbg'; bg.style.zIndex = 50; bg.innerHTML = '<div class="sheet">' + html + '</div>'; document.body.appendChild(bg); return bg; };
  const cleanAddress = () => { try { history.replaceState(null, '', location.pathname); } catch (e) { /* older browser: the token still is not stored */ } };

  // 1. Ask for the email
  const link = $$('lfg');
  if (link) link.onclick = async (ev) => {
    ev.preventDefault(); const out = $$('lerr'), email = ($$('em').value || '').trim(); out.style.color = '';
    if (setupNeeded()) { out.textContent = 'Setup needed: edit config.js with your Supabase URL and anon key.'; return; }
    if (!/^\S+@\S+\.\S+$/.test(email)) { out.textContent = 'Type your email address in the box above first.'; return; }
    link.style.pointerEvents = 'none'; out.textContent = 'Sending…';
    try {
      const r = await fetch(`${C.url}/auth/v1/recover?redirect_to=${encodeURIComponent(location.origin + location.pathname)}`, { method: 'POST', headers: { apikey: C.key, 'Content-Type': 'application/json' }, body: JSON.stringify({ email }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(friendly(r.status, j.msg || j.error_description || j.message)); }
      out.style.color = 'var(--brand2)'; out.textContent = 'If that email has an account, a reset link is on its way. Check your inbox and spam folder, then open the link on this phone.';
    } catch (e) { out.textContent = e.message === 'Failed to fetch' ? 'No internet connection. Try again when you are online.' : e.message; }
    setTimeout(() => { link.style.pointerEvents = ''; }, 5000);
  };

  // 2. The emailed link brings the owner back here
  const back = parse(location.hash), query = parse(location.search);
  if (back.type === 'recovery' && back.token) {
    const token = back.token; cleanAddress();     // the token lives only in this variable
    const bg = overlay(`<h2 style="margin:0 0 4px;font-size:19px">Choose a new password</h2><p class="mute" style="margin:0 0 12px">This is the password you use to sign in on this phone.</p>
      <label class="lb">New password (8 or more characters)</label><input id="rc_a" type="password" autocomplete="new-password" autocapitalize="none" autocorrect="off">
      <label class="lb">Type it again</label><input id="rc_b" type="password" autocomplete="new-password" autocapitalize="none" autocorrect="off"><p class="err" id="rc_e"></p>
      <button class="primary" id="rc_ok">Save new password</button>`);
    const $b = (s) => bg.querySelector(s);
    $b('#rc_ok').onclick = async (ev) => { const ok = ev.target, bad = passwordProblem($b('#rc_a').value, $b('#rc_b').value); $b('#rc_e').textContent = bad || ''; if (bad) return; ok.disabled = true;
      try { const r = await fetch(`${C.url}/auth/v1/user`, { method: 'PUT', headers: { apikey: C.key, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' }, body: JSON.stringify({ password: $b('#rc_a').value }) });
        const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(friendly(r.status, j.msg || j.error_description || j.message));
        if (j.email && $$('em')) $$('em').value = j.email;
        bg.querySelector('.sheet').innerHTML = '<h2 style="margin:0 0 8px;font-size:19px">Password changed ✓</h2><p class="mute" style="margin:0 0 14px">Sign in with your new password. If you use the Home Screen app, open it and sign in there.</p><button class="primary" id="rc_done">Go to sign in</button>';
        $b('#rc_done').onclick = () => { bg.remove(); if ($$('pw')) $$('pw').focus(); };
      } catch (e) { $b('#rc_e').textContent = e.message === 'Failed to fetch' ? 'No internet connection. Try again when you are online.' : e.message; ok.disabled = false; } };
  } else if (back.error || query.error) {
    const e = back.error ? back : query; cleanAddress();
    const bg = overlay(`<h2 style="margin:0 0 8px;font-size:19px">That link did not work</h2><p class="mute" style="margin:0 0 14px">${/expired|invalid|otp/i.test((e.error || '') + ' ' + (e.desc || '')) ? 'It has expired or was already used.' : 'Something went wrong.'} On the sign-in screen, tap “Forgot password?” to get a new one.</p><button class="primary" id="rc_x">Back to sign in</button>`);
    bg.querySelector('#rc_x').onclick = () => bg.remove();
  }
})(typeof window !== 'undefined' ? window : globalThis);
