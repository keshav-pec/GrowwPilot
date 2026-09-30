import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowRight, BookOpen, MessageCircle, RotateCcw, Send, Sparkles, X } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { fetchWelcome, useAskAssistant } from '../api/help';

// The in-app help assistant: a round button at the bottom right that opens a chat.
// It feels like an AI chat (typing dots, answers that type themselves out), but the answers come
// from a fixed help knowledge base on the server, matched to the question and to your role.

const CHARS_PER_TICK = 3; // typing speed: 3 characters every 15 ms
const TICK_MS = 15;

// A short "thinking" pause, a bit longer for longer answers (so it feels natural)
const thinkingTime = (answer) => 500 + Math.min(answer.length * 4, 900);
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// ---------------------------------------------------------------------------
// Tiny formatter for the answers: lines, "1." / "-" lists, **bold** and *italic*.
// `visible` = how many characters to show, so formatting stays correct while it types.
// ---------------------------------------------------------------------------
function parseLine(line) {
  const list = line.match(/^(\d+\.|-)\s+(.*)$/);
  const text = list ? list[2] : line;
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*)/).filter(Boolean);
  const segments = parts.map((part) =>
    part.startsWith('**') ? { text: part.slice(2, -2), bold: true } : part.startsWith('*') ? { text: part.slice(1, -1), italic: true } : { text: part }
  );
  return { marker: list?.[1], segments };
}

function FormattedText({ text, visible }) {
  let left = visible;
  return text.split('\n').map((line, i) => {
    if (left <= 0) return null;
    const { marker, segments } = parseLine(line);
    const shown = segments.map((seg, j) => {
      const part = seg.text.slice(0, Math.max(left, 0));
      left -= seg.text.length;
      if (!part) return null;
      if (seg.bold) return <strong key={j}>{part}</strong>;
      if (seg.italic) return <em key={j}>{part}</em>;
      return <span key={j}>{part}</span>;
    });
    left -= 1; // the line break
    return (
      <p key={i} className={marker ? 'flex gap-1.5 pl-1' : 'mt-1 first:mt-0'}>
        {marker && <span className="shrink-0 text-muted">{marker === '-' ? '•' : marker}</span>}
        <span>{shown}</span>
      </p>
    );
  });
}

// Plain-text length (what the typing effect counts), without the ** and * markers
const plainLength = (text) => text.split('\n').reduce((sum, line) => sum + parseLine(line).segments.reduce((s, seg) => s + seg.text.length, 0) + 1, 0);

function TypingDots() {
  return (
    <div className="flex w-fit gap-1 rounded-2xl rounded-bl-sm bg-surface px-4 py-3" aria-label="Assistant is typing">
      {[0, 150, 300].map((delay) => (
        <span key={delay} className="h-2 w-2 animate-bounce rounded-full bg-muted" style={{ animationDelay: `${delay}ms` }} />
      ))}
    </div>
  );
}

export default function ChatAssistant() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const ask = useAskAssistant();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState([]); // { id, from: 'bot' | 'user', text, topic, link, suggestions, kind, visible }
  const [thinking, setThinking] = useState(false);
  const [input, setInput] = useState('');
  const listRef = useRef(null);
  const nextId = useRef(1);

  const typingMessage = messages.find((m) => m.from === 'bot' && m.visible < plainLength(m.text));
  const busy = thinking || Boolean(typingMessage);

  // Typing effect: reveal a few more characters of the newest bot message on every tick
  useEffect(() => {
    if (!typingMessage) return;
    const timer = setTimeout(() => {
      setMessages((all) => all.map((m) => (m.id === typingMessage.id ? { ...m, visible: m.visible + CHARS_PER_TICK } : m)));
    }, TICK_MS);
    return () => clearTimeout(timer);
  }, [typingMessage]);

  // Keep the newest message in view
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, thinking]);

  // Close with Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  // Show the bot "thinking" for a moment, then add its reply (which then types itself out)
  async function botReply(getReply) {
    setThinking(true);
    try {
      const started = Date.now();
      const reply = await getReply();
      await wait(Math.max(0, thinkingTime(reply.answer) - (Date.now() - started)));
      setMessages((all) => [...all, { id: nextId.current++, from: 'bot', visible: 0, ...reply, text: reply.answer }]);
    } catch (err) {
      setMessages((all) => [...all, { id: nextId.current++, from: 'bot', visible: 0, kind: 'error', text: `Sorry, I couldn’t answer just now (${err.message}). Please try again.` }]);
    } finally {
      setThinking(false);
    }
  }

  function openChat() {
    setOpen(true);
    if (messages.length === 0 && !thinking) botReply(fetchWelcome); // greet on first open
  }

  function send(text) {
    const question = text.trim();
    if (!question || busy) return;
    setInput('');
    setMessages((all) => [...all, { id: nextId.current++, from: 'user', text: question }]);
    botReply(() => ask.mutateAsync(question));
  }

  function startOver() {
    setMessages([]);
    botReply(fetchWelcome);
  }

  const lastBotId = [...messages].reverse().find((m) => m.from === 'bot')?.id;

  return (
    <div className="print:hidden">
      {open && (
        <section
          aria-label="GrowwPilot assistant"
          className="fixed bottom-24 right-4 z-50 flex h-[min(34rem,calc(100vh-8rem))] w-[min(24rem,calc(100vw-2rem))] flex-col overflow-hidden rounded-2xl border border-border bg-bg shadow-2xl sm:right-6"
        >
          {/* Header */}
          <div className="flex items-center gap-3 bg-brown px-4 py-3 text-white">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gold text-ink">
              <Sparkles size={16} />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">GrowwPilot Assistant</p>
              <p className="text-xs text-white/70">Answers for {user.role === 'FRONT_DESK' ? 'front desk' : user.allBranches ? 'the main owner' : 'branch owners'}</p>
            </div>
            <button onClick={startOver} disabled={busy} className="rounded p-1.5 text-white/80 hover:bg-white/10 disabled:opacity-40" aria-label="Start over" title="Start over">
              <RotateCcw size={16} />
            </button>
            <button onClick={() => setOpen(false)} className="rounded p-1.5 text-white/80 hover:bg-white/10" aria-label="Close assistant">
              <X size={18} />
            </button>
          </div>

          {/* Messages */}
          <div ref={listRef} className="flex flex-1 flex-col gap-3 overflow-y-auto px-4 py-4 text-sm" aria-live="polite">
            {messages.map((m) =>
              m.from === 'user' ? (
                <p key={m.id} className="max-w-[85%] self-end whitespace-pre-wrap rounded-2xl rounded-br-sm bg-gold px-3 py-2 text-ink">
                  {m.text}
                </p>
              ) : (
                <div key={m.id} className="flex max-w-[92%] flex-col gap-2">
                  <div className="rounded-2xl rounded-bl-sm bg-surface px-3 py-2 leading-relaxed text-ink">
                    <FormattedText text={m.text} visible={m.visible} />
                  </div>

                  {/* Only once the message has finished typing */}
                  {m.visible >= plainLength(m.text) && (
                    <>
                      {m.topic && (
                        <p className="flex items-center gap-1 pl-1 text-xs text-muted">
                          <BookOpen size={12} /> From help article: {m.topic}
                        </p>
                      )}
                      {m.link && (
                        <button onClick={() => navigate(m.link.to)} className="flex w-fit items-center gap-1 rounded-lg border border-border px-3 py-1.5 text-xs font-medium hover:bg-surface">
                          Open {m.link.label} <ArrowRight size={12} />
                        </button>
                      )}
                      {/* Suggestion chips (only under the latest reply) */}
                      {m.id === lastBotId && m.suggestions?.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {m.suggestions.map((s) => (
                            <button key={s} onClick={() => send(s)} disabled={busy} className="rounded-full border border-gold/60 px-3 py-1 text-left text-xs text-ink hover:bg-yellow-soft">
                              {s}
                            </button>
                          ))}
                        </div>
                      )}
                    </>
                  )}
                </div>
              )
            )}
            {thinking && <TypingDots />}
          </div>

          {/* Input */}
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send(input);
            }}
            className="flex items-center gap-2 border-t border-border p-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Ask how to do something…"
              maxLength={500}
              aria-label="Your question"
              className="min-w-0 flex-1 rounded-full border border-border px-4 py-2 text-sm outline-none focus:border-gold focus:ring-2 focus:ring-gold/30"
            />
            <button type="submit" disabled={busy || !input.trim()} className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-gold text-ink hover:bg-gold-dark disabled:opacity-40" aria-label="Send">
              <Send size={16} />
            </button>
          </form>
        </section>
      )}

      {/* The round button */}
      <button
        onClick={() => (open ? setOpen(false) : openChat())}
        className="fixed bottom-5 right-4 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-gold text-ink shadow-lg transition hover:scale-105 hover:bg-gold-dark sm:right-6"
        aria-label={open ? 'Close assistant' : 'Open help assistant'}
        title="Ask the GrowwPilot assistant"
      >
        {open ? <X size={24} /> : <MessageCircle size={24} />}
      </button>
    </div>
  );
}
