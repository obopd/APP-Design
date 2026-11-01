// Two phones on one account edit offline, then sync: changes are merged, not overwritten.
const { browser, phone, inApp, check, wait, done } = require('./helpers');

(async () => {
  const b = await browser();
  const summary = (p) => inApp(p, (s) => s.state.todos.map((t) => `${t.title}${t.done ? '✓' : ''}`).sort().join(', '));
  const sync = (p) => inApp(p, (s, c) => c.syncNow());

  const A = await phone(b, 'a@x');
  await inApp(A, (s) => { ['T1', 'T2', 'T3'].forEach((t, i) => s.state.todos.push({ id: `t${i}`, title: t, date: '2026-11-01', repeat: 'none', done: false })); s.save(); });
  await sync(A);
  const B = await phone(b, 'a@x');
  check('second phone gets the planner', await summary(B) === 'T1, T2, T3');

  await A.ctx.setOffline(true); await B.ctx.setOffline(true);
  await inApp(A, (s) => { s.state.todos.push({ id: 'x', title: 'X from A', date: '2026-11-01', repeat: 'none' }); s.state.todos.find((t) => t.id === 't0').done = true; s.save(); });
  await wait(30);
  await inApp(B, (s) => { s.state.todos.push({ id: 'y', title: 'Y from B', date: '2026-11-01', repeat: 'none' }); s.state.todos.find((t) => t.id === 't1').title = 'T2 renamed'; s.state.todos = s.state.todos.filter((t) => t.id !== 't2'); s.save(); });
  await A.ctx.setOffline(false); await wait(200); await sync(A);
  await B.ctx.setOffline(false); await wait(200); await sync(B); await sync(A);
  const want = 'T1✓, T2 renamed, X from A, Y from B';
  check('edits from both phones merge', await summary(A) === want && await summary(B) === want, await summary(A));

  await A.ctx.setOffline(true); await B.ctx.setOffline(true);
  await inApp(A, (s) => { s.state.todos.find((t) => t.id === 'x').title = 'X older'; s.save(); });
  await wait(50);
  await inApp(B, (s) => { s.state.todos.find((t) => t.id === 'x').title = 'X newer'; s.save(); });
  await A.ctx.setOffline(false); await B.ctx.setOffline(false); await wait(200);
  await Promise.all([sync(A), sync(B)]);
  await sync(A); await sync(B);
  check('same field on both: newer wins everywhere', (await summary(A)).includes('X newer') && (await summary(B)).includes('X newer'));

  await inApp(A, (s) => s.replaceAll({ todos: [{ id: 'r', title: 'Restored', date: '2026-11-01', repeat: 'none' }], events: [] }));
  await wait(1700); await sync(A); await sync(B);
  check('a restored backup replaces everything', await summary(A) === 'Restored' && await summary(B) === 'Restored');
  // A deletion must stick even though the account's copy (jsonb) has its keys reordered.
  await inApp(A, (s) => { s.state.todos.push({ title: 'Delete me', repeat: 'none', id: 'del', date: '2026-11-02', notes: '' }); s.save(); });
  await wait(1700); await sync(A); await sync(B);
  await inApp(B, (s) => { s.state.todos.find((t) => t.id === 'r').title = 'Restored (edited on B)'; s.save(); });
  await wait(1700); await sync(B);
  await inApp(A, (s) => { s.state.todos = s.state.todos.filter((t) => t.id !== 'del'); s.save(); });
  await wait(1700); await sync(A); await sync(B); await sync(A);
  const gone = async (p) => !(await inApp(p, (s) => s.state.todos.some((t) => t.id === 'del')));
  check('a deletion sticks after the other phone edited something else', await gone(A) && await gone(B));
  check('…and that other edit is kept', (await summary(A)).includes('edited on B'));
  check('no page errors', !A.errors.length && !B.errors.length, [...A.errors, ...B.errors].join('; '));
  await done(b);
})();
