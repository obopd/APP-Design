'use strict';

const STORAGE_KEY = 'habits.v1';
const EMOJIS = ['💧', '🏃', '📚', '🧘', '🥗', '😴', '💪', '✍️', '🎸', '🧹', '💊', '🌿'];

// State shape: { habits: [{ id, name, emoji, done: { 'YYYY-MM-DD': true } }] }
let state = load();
let editingId = null;
let selectedEmoji = EMOJIS[0];

const $ = (id) => document.getElementById(id);
const list = $('habit-list');
const dialog = $('habit-dialog');
const nameInput = $('habit-name');
const emojiGrid = $('emoji-grid');

function load() {
  try {
    const data = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (data && Array.isArray(data.habits)) return data;
  } catch (_) { /* fall through to empty state */ }
  return { habits: [] };
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

// Local-date key, so "today" follows the phone's timezone rather than UTC.
function dayKey(date) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function daysAgo(n) {
  const d = new Date();
  d.setDate(d.getDate() - n);
  return d;
}

// Consecutive completed days ending today, or ending yesterday if today
// isn't checked yet (so the streak doesn't look broken first thing in the morning).
function streak(habit) {
  const start = habit.done[dayKey(daysAgo(0))] ? 0 : 1;
  let count = 0;
  while (habit.done[dayKey(daysAgo(start + count))]) count++;
  return count;
}

function render() {
  const today = dayKey(new Date());
  $('today-label').textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  });

  const doneCount = state.habits.filter((h) => h.done[today]).length;
  $('progress').textContent = state.habits.length ? `${doneCount}/${state.habits.length} done` : '';
  $('empty').hidden = state.habits.length > 0;

  list.replaceChildren(...state.habits.map((habit) => {
    const li = document.createElement('li');
    li.className = 'habit';

    const icon = document.createElement('span');
    icon.className = 'habit-icon';
    icon.textContent = habit.emoji;

    const main = document.createElement('div');
    main.className = 'habit-main';

    const name = document.createElement('button');
    name.className = 'habit-name';
    name.textContent = habit.name;
    name.setAttribute('aria-label', `Edit ${habit.name}`);
    name.addEventListener('click', () => openDialog(habit));

    const meta = document.createElement('div');
    meta.className = 'habit-meta';

    const week = document.createElement('div');
    week.className = 'week';
    week.setAttribute('aria-hidden', 'true');
    for (let i = 6; i >= 0; i--) {
      const dot = document.createElement('span');
      if (habit.done[dayKey(daysAgo(i))]) dot.className = 'on';
      week.append(dot);
    }

    const s = streak(habit);
    const streakEl = document.createElement('span');
    streakEl.className = 'streak';
    streakEl.textContent = s ? `🔥 ${s} day${s === 1 ? '' : 's'}` : 'No streak';

    meta.append(week, streakEl);
    main.append(name, meta);

    const check = document.createElement('button');
    check.className = 'check';
    check.textContent = '✓';
    check.setAttribute('aria-pressed', String(!!habit.done[today]));
    check.setAttribute('aria-label', `Mark ${habit.name} done today`);
    check.addEventListener('click', () => toggleToday(habit.id));

    li.append(icon, main, check);
    return li;
  }));
}

function toggleToday(id) {
  const habit = state.habits.find((h) => h.id === id);
  const today = dayKey(new Date());
  if (habit.done[today]) delete habit.done[today];
  else habit.done[today] = true;
  if (navigator.vibrate) navigator.vibrate(10);
  save();
  render();
}

function renderEmojiGrid() {
  emojiGrid.replaceChildren(...EMOJIS.map((emoji) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = emoji;
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(emoji === selectedEmoji));
    b.addEventListener('click', () => { selectedEmoji = emoji; renderEmojiGrid(); });
    return b;
  }));
}

function openDialog(habit = null) {
  editingId = habit ? habit.id : null;
  selectedEmoji = habit ? habit.emoji : EMOJIS[0];
  nameInput.value = habit ? habit.name : '';
  $('dialog-title').textContent = habit ? 'Edit habit' : 'New habit';
  $('delete-btn').hidden = !habit;
  renderEmojiGrid();
  dialog.showModal();
  nameInput.focus();
}

$('add-btn').addEventListener('click', () => openDialog());
$('cancel-btn').addEventListener('click', () => dialog.close());

$('delete-btn').addEventListener('click', () => {
  const habit = state.habits.find((h) => h.id === editingId);
  if (!habit || !confirm(`Delete "${habit.name}" and its history?`)) return;
  state.habits = state.habits.filter((h) => h.id !== editingId);
  save();
  dialog.close();
  render();
});

$('habit-form').addEventListener('submit', () => {
  const name = nameInput.value.trim();
  if (!name) return;
  if (editingId) {
    Object.assign(state.habits.find((h) => h.id === editingId), { name, emoji: selectedEmoji });
  } else {
    const id = crypto.randomUUID ? crypto.randomUUID() : String(Date.now());
    state.habits.push({ id, name, emoji: selectedEmoji, done: {} });
  }
  save();
  render();
});

// Re-render when the app comes back to the foreground, in case the day changed.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') render();
});

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js');
}

render();
