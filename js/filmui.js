// Film mode around the calendar: the logo that turns into a clapperboard (press and
// hold ~1s to switch), the project sheet (choose / create / invite / leave) and the
// project name shown above the month.
import { h, icon, ICONS } from './util.js';
import { ask, tell, askText, openLayer } from './ui.js';
import {
  filmOn, setFilm, filmStatus, projects, currentProject, chooseProject, createProject, renameProject,
  inviteCollaborators, removeCollaborator, leaveProject, membersOf, isOwner, nameOf, myId,
} from './film.js';
import { acceptedFriends, myHandle } from './social.js';
import { pickFriends, chooseHandle } from './people.js';
import { chatEnabled } from './chat.js';
import { playFilmSwitch } from './cinema.js';

const HOLD_MS = 900;
// Film mode's background style (styles.css "Film mode backgrounds"): glow | grade | darkroom | grain.
export const FILM_BACKGROUND = 'glow';
document.documentElement.dataset.filmbg = FILM_BACKGROUND;

/** Press and hold the logo to switch modes; a tap in film mode opens the projects. */
export function setupBrand(brand, onSwitched) {
  let timer = 0;
  let fired = false;
  let start = null;
  const cancel = () => { clearTimeout(timer); brand.classList.remove('pressing'); };
  brand.addEventListener('pointerdown', (e) => {
    fired = false;
    start = { x: e.clientX, y: e.clientY };
    brand.classList.add('pressing');
    timer = setTimeout(() => {
      fired = true;
      brand.classList.remove('pressing');
      if (!chatEnabled()) { tell('Sign in first', 'Film Production Mode needs your account.'); return; }
      const entering = !filmOn();
      playFilmSwitch(entering, () => { setFilm(entering); paintBrand(true); onSwitched(); }, entering ? currentProject()?.name : '');
    }, HOLD_MS);
  });
  brand.addEventListener('pointermove', (e) => { if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 10) cancel(); });
  ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => brand.addEventListener(t, cancel));
  brand.addEventListener('contextmenu', (e) => e.preventDefault());
  brand.addEventListener('click', () => {
    if (fired) { fired = false; return; }
    if (filmOn()) openProjects();
  });
  paintBrand(false);
}

/** Show the clapperboard (film) or the calendar logo; animate only when switching. */
export function paintBrand(animate) {
  const root = document.documentElement;
  if (!animate) {
    root.classList.add('film-instant');
    requestAnimationFrame(() => requestAnimationFrame(() => root.classList.remove('film-instant')));
  }
  root.classList.toggle('film', filmOn());
}

/* ---------- Project name above the month ---------- */

export function renderProjectChip(root) {
  const p = currentProject();
  root.replaceChildren(h('div', { class: 'film-chip-wrap' },
    h('button', { class: 'film-chip', onclick: openProjects },
      h('span', { class: 'film-chip-label' }, p ? p.name : filmStatus() === 'missing' ? 'Film mode isn’t set up' : 'New project'),
      icon(p ? ICONS.updown : ICONS.plus)),
    p && membersOf(p.id).length > 1 ? h('span', { class: 'film-chip-sub' }, `${membersOf(p.id).length} people`) : null));
  return 1;
}

/* ---------- Projects sheet ---------- */

export function openProjects() {
  if (filmStatus() === 'missing') { tell('Film mode isn’t set up yet', 'Run supabase/film.sql in Supabase first.'); return; }
  let layer;
  const close = () => layer.close();
  const run = (fn) => async () => { close(); try { await fn(); } catch (e) { tell('Couldn’t update the project', e.message); } };
  const cur = currentProject();
  const list = projects();
  const me = myId();
  const members = cur ? membersOf(cur.id) : [];
  layer = openLayer('ask', h('div', { class: 'ask-card film-card' },
    h('p', { class: 'ask-title display' }, 'Projects'),
    h('div', { class: 'friend-pick' },
      list.map((p) => h('button', {
        type: 'button', class: 'menu-item', role: 'radio', 'aria-checked': String(p.id === cur?.id),
        onclick: () => { close(); chooseProject(p.id); },
      }, h('span', { class: 'menu-check' }, p.id === cur?.id ? icon(ICONS.check) : null),
      h('span', { class: 'film-p-name' }, p.name),
      p.owner !== me ? h('span', { class: 'film-p-owner' }, nameOf(p.owner)) : null)),
      h('button', { type: 'button', class: 'menu-item new-group', onclick: run(newProject) },
        h('span', { class: 'menu-check' }, icon(ICONS.plus)), h('span', {}, 'New project'))),
    cur ? h('div', { class: 'film-members' },
      h('p', { class: 'ask-message' }, 'Collaborators can see and edit everything in this project.'),
      members.map((m) => h('div', { class: 'menu-item member-row' },
        h('span', { class: 'member-name' }, m.user_id === me ? `${nameOf(m.user_id)} (you)` : nameOf(m.user_id)),
        m.user_id === cur.owner ? h('span', { class: 'film-p-owner' }, 'owner') : null,
        isOwner(cur) && m.user_id !== me ? h('button', {
          class: 'icon-btn', 'aria-label': `Remove ${nameOf(m.user_id)}`,
          onclick: run(async () => {
            if (await ask({ title: `Remove ${nameOf(m.user_id)}?`, message: 'They lose access to this project and its chat.', ok: 'Remove', danger: true })) {
              await removeCollaborator(cur.id, m.user_id);
            }
          }),
        }, icon(ICONS.close)) : null))) : null,
    h('div', { class: 'info-actions' },
      cur && isOwner(cur) ? h('button', { type: 'button', class: 'pill', onclick: run(() => invite(cur, members)) }, 'Invite') : null,
      cur && isOwner(cur) ? h('button', { type: 'button', class: 'pill', onclick: run(async () => {
        const name = await askText({ title: 'Rename project', value: cur.name, ok: 'Save' });
        if (name) await renameProject(cur.id, name);
      }) }, 'Rename') : null,
      cur ? h('button', { type: 'button', class: 'pill danger-text', onclick: run(async () => {
        const owner = isOwner(cur);
        const ok = await ask(owner
          ? { title: `Delete “${cur.name}”?`, message: 'Its writing, to-dos, schedule and chat are deleted for everyone.', ok: 'Delete', danger: true }
          : { title: `Leave “${cur.name}”?`, message: 'You lose access to it and its chat.', ok: 'Leave', danger: true });
        if (ok) await leaveProject(cur.id);
      }) }, isOwner(cur) ? 'Delete' : 'Leave') : null),
    h('div', { class: 'ask-actions' },
      h('button', { type: 'button', class: 'ask-btn', autofocus: true, onclick: close }, 'Close'),
      h('button', { type: 'button', class: 'ask-btn', onclick: () => { close(); playFilmSwitch(false, () => { setFilm(false); paintBrand(true); }); } }, 'Exit film mode'))),
  { onBackdrop: close });
}

async function newProject() {
  const name = await askText({ title: 'New project', placeholder: 'Film title', ok: 'Create' });
  if (!name || !name.trim()) return;
  await createProject(name);
}

async function invite(p, members) {
  if (!myHandle()) { await chooseHandle(); return; }
  if (!acceptedFriends().length) { tell('No friends yet', 'Add friends in Settings → Friends first; collaborators are invited from your friends.'); return; }
  const ids = await pickFriends([], {
    title: 'Invite collaborators', message: 'They can see and edit the writing, to-dos and schedule, and join the project chat.',
    ok: 'Invite', exclude: members.map((m) => m.user_id),
  });
  if (ids?.length) {
    await inviteCollaborators(p.id, ids);
    tell('Invited', 'They’ll see the project after long-pressing the Planner logo.');
  }
}
