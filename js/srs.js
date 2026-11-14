// Study mode's scheduler: when each card comes back (spaced repetition), like Anki.
//
// Two schedulers, chosen per deck preset:
//   fsrs  FSRS-5: each card has a memory Stability (days until recall drops to 90%) and a
//         Difficulty (1–10); intervals aim at the preset's target retention.
//   sm2   Anki's older SM-2: an ease factor per card (starts at 250%).
// Both use Anki's learning / relearning steps (minutes) before a card reaches days.
//
// Pure functions: no DOM, no storage. Times are ms; a "day" starts at 4:00 local time,
// as in Anki, so a late-night session still counts for that day.

export const DAY_STARTS_AT = 4; // hours after midnight
const MIN = 60_000;
const DAY = 86_400_000;

// FSRS-5 default parameters.
export const FSRS_W = [0.40255, 1.18385, 3.173, 15.69105, 7.1949, 0.5345, 1.4604, 0.0046, 1.54575, 0.1192,
  1.01925, 1.9395, 0.11, 0.29605, 2.2698, 0.2315, 2.9898, 0.51655, 0.6621];
const DECAY = -0.5;
const FACTOR = 19 / 81;

export const DEFAULT_PRESET = {
  name: 'Default',
  newPerDay: 20,
  reviewsPerDay: 200,
  learnSteps: [1, 10],      // minutes
  relearnSteps: [10],       // minutes
  graduatingIvl: 1,         // days (SM-2)
  easyIvl: 4,               // days (SM-2)
  maxIvl: 36500,            // days
  scheduler: 'fsrs',        // 'fsrs' | 'sm2'
  retention: 0.9,           // FSRS target retention
  startEase: 2.5,           // SM-2
  easyBonus: 1.3,           // SM-2
  hardFactor: 1.2,          // SM-2
  lapseIvl: 0,              // SM-2: new interval after a lapse, as a share of the old one
  leechThreshold: 8,        // lapses before a card is a leech
  leechAction: 'suspend',   // 'suspend' | 'tag'
  burySiblings: true,       // other cards of the same note wait until tomorrow
  newOrder: 'added',        // 'added' | 'random'
};
export const withDefaults = (p) => ({ ...DEFAULT_PRESET, ...(p || {}) });

/* ---------- Days ---------- */

// Day number (local, starting at 4:00) of a time.
export function dayOf(ms) {
  const d = new Date(ms - DAY_STARTS_AT * 3600_000);
  return Math.floor(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}
// When a given day number starts (4:00 local).
export function dayStart(day) {
  const d = new Date(day * DAY);
  return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate(), DAY_STARTS_AT).getTime();
}
export const todayNum = (now = Date.now()) => dayOf(now);
export const endOfToday = (now = Date.now()) => dayStart(dayOf(now) + 1);

/* ---------- FSRS ---------- */

const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));
export const retrievability = (elapsedDays, S) => (1 + FACTOR * elapsedDays / S) ** DECAY;
const fsrsIvl = (S, r) => (S / FACTOR) * (r ** (1 / DECAY) - 1);
const initS = (w, g) => Math.max(w[g - 1], 0.1);
const initD = (w, g) => clamp(w[4] - Math.exp(w[5] * (g - 1)) + 1, 1, 10);
function nextD(w, D, g) {
  const damped = D + (-w[6] * (g - 3)) * (10 - D) / 9;
  return clamp(w[7] * initD(w, 4) + (1 - w[7]) * damped, 1, 10);
}
function recallS(w, D, S, R, g) {
  return S * (Math.exp(w[8]) * (11 - D) * S ** -w[9] * (Math.exp(w[10] * (1 - R)) - 1)
    * (g === 2 ? w[15] : 1) * (g === 4 ? w[16] : 1) + 1);
}
function forgetS(w, D, S, R) {
  const s = w[11] * D ** -w[12] * ((S + 1) ** w[13] - 1) * Math.exp(w[14] * (1 - R));
  return Math.min(s, S / Math.exp(w[17] * w[18]));
}
const shortS = (w, S, g) => S * Math.exp(w[17] * (g - 3 + w[18]));

// The memory state after answering `g` (1 Again … 4 Easy) at `now`.
export function nextMemory(card, g, now, w = FSRS_W) {
  if (card.S == null || card.D == null) return { S: initS(w, g), D: initD(w, g) };
  const elapsed = card.last ? dayOf(now) - dayOf(card.last) : 0;
  const D = nextD(w, card.D, g);
  if (elapsed <= 0) return { S: Math.max(0.01, shortS(w, card.S, g)), D };
  const R = retrievability(elapsed, card.S);
  return { S: Math.max(0.01, g === 1 ? forgetS(w, card.D, card.S, R) : recallS(w, card.D, card.S, R, g)), D };
}

/* ---------- Fuzz (same answer → same interval, so the button label matches) ---------- */

function seeded(str) {
  let h = 2166136261;
  for (let i = 0; i < str.length; i += 1) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
  return ((h >>> 0) % 10000) / 10000;
}
function fuzz(ivl, card, maxIvl) {
  if (ivl < 2.5) return Math.min(Math.round(ivl), maxIvl);
  const r = Math.round(ivl);
  let delta = 1;
  if (ivl >= 7) delta = Math.max(1, Math.round(ivl * (ivl < 20 ? 0.15 : 0.05)));
  const lo = Math.max(2, r - delta);
  const hi = r + delta;
  const v = lo + Math.floor(seeded(`${card.id}:${card.reps || 0}`) * (hi - lo + 1));
  return clamp(v, 1, maxIvl);
}

/* ---------- Answering ---------- */

/**
 * The card after answering `g` (1 Again, 2 Hard, 3 Good, 4 Easy) at `now`, plus the review
 * log entry. Doesn't change `card`.
 */
export function answer(card, g, presetIn, now = Date.now()) {
  const p = withDefaults(presetIn);
  const c = { ...card };
  const before = card.state || 'new';
  const fsrs = p.scheduler !== 'sm2';
  const mem = nextMemory(card, g, now);
  c.S = mem.S;
  c.D = mem.D;
  c.reps = (card.reps || 0) + 1;
  const today = dayOf(now);
  const elapsed = card.last ? today - dayOf(card.last) : 0;
  const steps = before === 'review' || before === 'relearn' ? p.relearnSteps : p.learnSteps;
  const toStep = (i, minutes) => { c.step = i; c.due = now + Math.round(minutes * MIN); };
  const toReview = (days) => {
    c.state = 'review';
    c.step = 0;
    c.ivl = clamp(Math.round(days), 1, p.maxIvl);
    c.due = dayStart(today + c.ivl);
  };
  // Days for Hard / Good / Easy from the review state, in order, each longer than the last.
  const reviewIvls = () => {
    if (fsrs) {
      const s = [2, 3, 4].map((x) => nextMemory(card, x, now).S);
      let [hard, good, easy] = s.map((S) => fuzz(fsrsIvl(S, p.retention), card, p.maxIvl));
      if (before === 'review') hard = Math.max(hard, 1);
      good = Math.max(good, hard + 1);
      easy = Math.max(easy, good + 1);
      return [hard, good, easy];
    }
    const ivl = card.ivl || 1;
    const ease = card.ease || p.startEase;
    const late = Math.max(0, elapsed - ivl);
    let hard = Math.max(ivl * p.hardFactor, ivl + 1);
    let good = Math.max((ivl + late / 2) * ease, hard + 1);
    let easy = Math.max((ivl + late) * ease * p.easyBonus, good + 1);
    [hard, good, easy] = [hard, good, easy].map((x) => fuzz(x, card, p.maxIvl));
    good = Math.max(good, hard + 1);
    easy = Math.max(easy, good + 1);
    return [hard, good, easy];
  };
  // The first interval when a card leaves (re)learning.
  const graduate = (easyGrad) => {
    if (fsrs) {
      const ivl = fuzz(Math.max(1, fsrsIvl(c.S, p.retention)), card, p.maxIvl);
      return easyGrad ? Math.max(ivl, (card.ivl || 0) + 1, 2) : Math.max(ivl, 1);
    }
    if (before === 'relearn') return Math.max(1, card.ivl || 1);
    return easyGrad ? p.easyIvl : p.graduatingIvl;
  };

  if (before === 'new' || before === 'learn' || before === 'relearn') {
    c.state = before === 'relearn' ? 'relearn' : 'learn';
    if (before === 'new') c.ease = p.startEase;
    const step = before === 'new' ? 0 : (card.step || 0);
    if (!steps.length) {
      if (g === 1) toStep(0, 1);
      else toReview(graduate(g === 4));
    } else if (g === 1) toStep(0, steps[0]);
    // Hard on the first step waits between the first two steps (or 1.5× a single step).
    else if (g === 2) toStep(step, step > 0 ? steps[step] : steps.length > 1 ? (steps[0] + steps[1]) / 2 : steps[0] * 1.5);
    else if (g === 3) {
      if (step + 1 < steps.length) toStep(step + 1, steps[step + 1]);
      else toReview(graduate(false));
    } else toReview(graduate(true));
  } else {
    // A review card.
    if (g === 1) {
      c.lapses = (card.lapses || 0) + 1;
      c.ease = Math.max(1.3, (card.ease || p.startEase) - 0.2);
      c.ivl = fsrs ? Math.max(1, Math.round(fsrsIvl(c.S, p.retention))) : Math.max(1, Math.round((card.ivl || 1) * p.lapseIvl));
      if (p.relearnSteps.length) { c.state = 'relearn'; toStep(0, p.relearnSteps[0]); } else toReview(c.ivl);
    } else {
      const [hard, good, easy] = reviewIvls();
      if (!fsrs) c.ease = Math.max(1.3, (card.ease || p.startEase) + (g === 2 ? -0.15 : g === 4 ? 0.15 : 0));
      toReview(g === 2 ? hard : g === 3 ? good : easy);
    }
  }
  c.last = now;
  // A card failed again and again is a leech: tagged, and suspended if the preset says so.
  let leech = false;
  if (g === 1 && before === 'review') {
    const t = p.leechThreshold;
    const n = c.lapses;
    if (t > 0 && n >= t && (n - t) % Math.max(1, Math.ceil(t / 2)) === 0) {
      leech = true;
      if (p.leechAction === 'suspend') c.suspended = true;
    }
  }
  const log = {
    card: card.id, at: now, rating: g, state: before, ivl: c.state === 'review' ? c.ivl : 0,
    lastIvl: card.ivl || 0, S: c.S, D: c.D, elapsed,
  };
  return { card: c, log, leech };
}

/** What each button would do: [{ rating, label }] for Again, Hard, Good, Easy. */
export function preview(card, preset, now = Date.now()) {
  return [1, 2, 3, 4].map((g) => {
    const { card: c } = answer(card, g, preset, now);
    return { rating: g, label: dueLabel(c.due - now, c.state === 'review' ? c.ivl : null) };
  });
}

// "1m", "10m", "1h", "3d", "1.2mo", "2y".
export function dueLabel(ms, days = null) {
  if (days != null) {
    if (days < 30) return `${days}d`;
    if (days < 365) return `${Math.round(days / 3) / 10}mo`;
    return `${Math.round(days / 36.5) / 10}y`;
  }
  const m = Math.max(1, Math.round(ms / MIN));
  if (m < 60) return `${m}m`;
  const hrs = Math.round(m / 6) / 10;
  if (hrs < 24) return `${hrs}h`;
  return `${Math.round(ms / DAY)}d`;
}

/** Back to a new card (Anki's "Forget"). */
export function forget(card) {
  const { S, D, ivl, ease, last, step, ...rest } = card;
  return { ...rest, state: 'new', due: 0, reps: 0, lapses: 0 };
}

/** Recall probability right now (FSRS), or null for a new card. */
export function currentR(card, now = Date.now()) {
  if (card.S == null || !card.last) return null;
  return retrievability(Math.max(0, dayOf(now) - dayOf(card.last)), card.S);
}
