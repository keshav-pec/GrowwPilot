// A very small "retrieval" step: find the help topic whose keywords best match the question,
// then answer it for the person asking. No AI model, no documents: just intent matching over KNOWLEDGE.
import { KNOWLEDGE, STARTER_QUESTIONS } from './help.knowledge.js';

// Words that don't tell us what the question is about
const STOP_WORDS = new Set(
  'a an the i me my im do does did how to is are was can could would should will please want need get there be am from at by so if then just some any it its this that with and or of in on for we our us one'.split(' ')
);

// Different words for the same thing, so "stylist", "barber" and "beautician" all mean "staff"
const SYNONYMS = {
  appointment: 'booking', book: 'booking', reservation: 'booking', rebook: 'booking',
  stylist: 'staff', barber: 'staff', beautician: 'staff', employee: 'staff', hairdresser: 'staff', worker: 'staff',
  client: 'customer', guest: 'customer',
  colour: 'color', cancelled: 'cancel', cancellation: 'cancel',
  inquiry: 'enquiry', enquire: 'enquiry',
  logout: 'log', signout: 'sign',
};

// "How do I book 2 appointments for Priya?" -> ['booking', '2', 'booking', 'priya'] (then de-duplicated)
export function toTokens(text) {
  return text
    .toLowerCase()
    .replace(/['’]/g, '') // "can't" -> "cant"
    .replace(/[^a-z0-9]+/g, ' ')
    .split(' ')
    .filter((w) => w && !STOP_WORDS.has(w))
    .map((w) => (w.length > 3 && w.endsWith('s') && !w.endsWith('ss') ? w.slice(0, -1) : w)) // plurals: "services" -> "service"
    .map((w) => SYNONYMS[w] ?? w);
}

// A keyword counts when ALL its words are in the question. It's worth 1 point per word,
// and a "*" keyword (a strong single word like "*checkout") is worth at least 2.
function scoreEntry(entry, questionWords) {
  let score = 0;
  let best = 0;
  for (const keyword of entry.keywords) {
    const strong = keyword.startsWith('*');
    const words = toTokens(strong ? keyword.slice(1) : keyword);
    if (words.length === 0 || !words.every((w) => questionWords.has(w))) continue;
    const points = strong ? Math.max(2, words.length) : words.length;
    score += points;
    best = Math.max(best, points);
  }
  return { score, best };
}

const MIN_SCORE = 2; // below this we're not confident enough to answer

const fill = (text, who) => text.replaceAll('{name}', who.name).replaceAll('{branch}', who.branch).replaceAll('{salon}', who.salon);

const DEFAULT_DENIED = 'That’s something your salon owner does, so I can’t walk you through it. Please ask them, or use the **Need help?** link to contact GrowwPilot support.';

// who: { audience: 'PRIMARY_OWNER' | 'BRANCH_OWNER' | 'FRONT_DESK', name, branch, salon }
export function answerQuestion(question, who) {
  const questionWords = new Set(toTokens(question));

  // Rank every topic: highest score first; on a tie, a specific topic beats a general one,
  // then the one with the strongest single keyword match
  const ranked = KNOWLEDGE.map((entry) => ({ entry, ...scoreEntry(entry, questionWords) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || Number(Boolean(a.entry.general)) - Number(Boolean(b.entry.general)) || b.best - a.best);
  const top = ranked[0];

  // Not sure: say so honestly and offer questions this person can ask
  if (!top || top.score < MIN_SCORE) {
    return {
      kind: 'fallback',
      topicId: null,
      topic: null,
      answer: fill('Sorry {name}, I’m not sure I understood that. Try asking in a few words, like “how do I cancel a booking?”, or pick one of these:', who),
      link: null,
      suggestions: STARTER_QUESTIONS[who.audience],
    };
  }

  const { entry } = top;
  const allowed = entry.audiences.includes(who.audience);
  const text = allowed ? (entry.for?.[who.audience] ?? entry.answer) : (entry.denied ?? DEFAULT_DENIED);

  return {
    kind: allowed ? 'answer' : 'not-allowed', // not-allowed = this person's role can't do it
    topicId: entry.id,
    topic: entry.title,
    answer: fill(text, who),
    link: allowed ? (entry.link ?? null) : null,
    suggestions: ['greeting', 'capabilities'].includes(entry.id) ? STARTER_QUESTIONS[who.audience] : [],
  };
}

// The first message when the chat opens
export function welcome(who) {
  return {
    kind: 'answer',
    topicId: null,
    topic: null,
    answer: fill('Hi {name}! I’m the GrowwPilot assistant. Ask me how to do anything in the app, and I’ll answer for your role. Here are a few ideas:', who),
    link: null,
    suggestions: STARTER_QUESTIONS[who.audience],
  };
}
