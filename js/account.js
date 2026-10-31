// Account sheet: sign in / create account (email + password), forgot password,
// and setting a new password after a reset link.
import { h, icon, ICONS } from './util.js';
import { signIn, signUp, sendPasswordReset, setNewPassword } from './cloud.js';

const dialog = document.getElementById('account-sheet');

/** mode: 'signin' | 'signup' | 'new-password' */
export function openAccountSheet(mode = 'signin') {
  const isNewPw = mode === 'new-password';
  const email = h('input', {
    type: 'email', autocomplete: 'email', inputmode: 'email', autocapitalize: 'off', spellcheck: 'false',
    placeholder: 'Email', 'aria-label': 'Email', required: !isNewPw,
  });
  const password = h('input', {
    type: 'password', minlength: '6', placeholder: isNewPw ? 'New password' : 'Password', 'aria-label': 'Password',
    autocomplete: mode === 'signin' ? 'current-password' : 'new-password', required: true,
  });
  const message = h('p', { class: 'account-msg', role: 'status' });
  const submitBtn = h('button', { type: 'submit', class: 'icon-btn ok', 'aria-label': 'Continue' }, icon(ICONS.check));
  const close = () => dialog.close();
  const say = (text, kind = '') => { message.textContent = text; message.className = `account-msg ${kind}`; };

  const submit = async (ev) => {
    ev.preventDefault();
    if (!password.value || password.value.length < 6) { say('Password must be at least 6 characters.', 'error'); return; }
    if (!isNewPw && !email.value.trim()) { email.focus(); return; }
    submitBtn.disabled = true;
    say(isNewPw ? 'Saving…' : mode === 'signup' ? 'Creating account…' : 'Signing in…');
    try {
      if (isNewPw) {
        await setNewPassword(password.value);
        close();
      } else if (mode === 'signup') {
        const result = await signUp(email.value.trim(), password.value);
        if (result === 'confirm-email') say('Check your email and tap the confirmation link, then come back and sign in.', 'ok');
        else close();
      } else {
        await signIn(email.value.trim(), password.value);
        close();
      }
    } catch (e) {
      say(e.message || 'Something went wrong. Check your connection.', 'error');
    } finally {
      submitBtn.disabled = false;
    }
  };

  const forgot = async () => {
    if (!email.value.trim()) { say('Type your email first.', 'error'); email.focus(); return; }
    try {
      await sendPasswordReset(email.value.trim());
      say('Reset link sent. Open it on this phone to set a new password.', 'ok');
    } catch (e) {
      say(e.message, 'error');
    }
  };

  const modes = h('div', { class: 'segmented', role: 'radiogroup' },
    [['signin', 'Sign in'], ['signup', 'Create account']].map(([v, label]) => h('button', {
      type: 'button', role: 'radio', 'aria-checked': String(mode === v),
      onclick: () => { if (mode !== v) openAccountSheet(v); },
    }, label)));

  dialog.replaceChildren(h('form', { onsubmit: submit },
    h('div', { class: 'grabber' }),
    h('div', { class: 'sheet-head' },
      h('button', { type: 'button', class: 'icon-btn', 'aria-label': 'Cancel', onclick: close }, icon(ICONS.close)),
      h('span', { class: 'spacer' }),
      isNewPw ? h('h3', { class: 'display' }, 'New password') : modes,
      h('span', { class: 'spacer' }),
      submitBtn),
    isNewPw ? null : h('div', { class: 'title-row' }, email),
    h('div', { class: 'title-row' }, password),
    message,
    mode === 'signin' ? h('button', { type: 'button', class: 'link-btn', onclick: forgot }, 'Forgot password?') : null,
    isNewPw ? null : h('p', { class: 'set-note account-note' },
      mode === 'signup'
        ? 'Your planner is backed up to your account and syncs across devices.'
        : 'Sign in to back up and sync your planner.'),
  ));
  if (!dialog.open) dialog.showModal();
}

dialog.addEventListener('click', (e) => { if (e.target === dialog) dialog.close(); });
