// Assistant chat panel — a multi-turn conversation with the configured
// LLM, docked on the right. Knows the current lab (passed as context) and
// can insert a reply into the editor at the caret.

import { useEffect, useRef, useState } from "react";
import { api, type Source } from "./api";

interface Msg {
  role: "user" | "assistant";
  content: string;
}

interface ChatPanelProps {
  onClose: () => void;
  /** Current lab body, woven into the system prompt for context. */
  context: string;
  /** Insert text (e.g. a code block) into the editor at the caret. */
  onInsert: (text: string) => void;
  /** Whether the active provider is reachable. */
  ready: boolean;
  /** False where there is no caret to insert at — the Welcome page is
   *  a form, not a textarea. The button is hidden rather than left to
   *  do nothing, which is exactly the failure this panel was guilty of
   *  when the Chat toggle rendered no panel at all on that page. */
  canInsert?: boolean;
}

export function ChatPanel({ onClose, context, onInsert, ready, canInsert = true }: ChatPanelProps) {
  const [messages, setMessages] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [sources, setSources] = useState<Source[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, busy]);

  async function send() {
    const text = input.trim();
    if (!text || busy) return;
    const next: Msg[] = [...messages, { role: "user", content: text }];
    setMessages(next);
    setInput("");
    setBusy(true);
    try {
      const { reply, sources: srcs } = await api.chat(next, context);
      setMessages([...next, { role: "assistant", content: reply }]);
      setSources(srcs ?? []);
    } catch (e) {
      setMessages([...next, { role: "assistant", content: `⚠ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  return (
    <aside className="author-chat">
      <div className="author-chat-head">
        <span>💬 Assistant</span>
        <div style={{ display: "flex", gap: 6 }}>
          {messages.length > 0 && (
            <button type="button" className="author-mini-btn" onClick={() => { setMessages([]); setSources([]); }}>Clear</button>
          )}
          <button type="button" className="author-mini-btn" onClick={onClose}>✕</button>
        </div>
      </div>

      <div className="author-chat-list" ref={listRef}>
        {messages.length === 0 && (
          <p className="author-hint" style={{ padding: 12 }}>
            Ask about Pentaho / PDI, or for help writing this lab. The assistant
            can see the lab you're editing.
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={`author-chat-msg is-${m.role}`}>
            <pre className="author-chat-text">{m.content}</pre>
            {m.role === "assistant" && !m.content.startsWith("⚠") && (
              <div className="author-chat-actions">
                {canInsert && (
                  <button type="button" className="author-mini-btn" onClick={() => onInsert(m.content + "\n\n")} title="Insert into the editor at the caret">Insert</button>
                )}
                <button type="button" className="author-mini-btn" onClick={() => navigator.clipboard?.writeText(m.content)} title="Copy">Copy</button>
              </div>
            )}
          </div>
        ))}
        {busy && <div className="author-chat-msg is-assistant"><pre className="author-chat-text">…thinking</pre></div>}
      </div>

      {sources.length > 0 && (
        <div className="author-chat-sources">
          📚 {sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noopener noreferrer" title={s.url}>{s.title}</a>
          ))}
        </div>
      )}

      <div className="author-chat-input">
        <textarea
          value={input}
          placeholder={ready ? "Ask the assistant… (Enter to send)" : "AI provider not ready — see Settings ⚙"}
          disabled={busy || !ready}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
        />
        <button type="button" className="author-save" onClick={send} disabled={busy || !ready || !input.trim()}>
          {busy ? "…" : "Send"}
        </button>
      </div>
    </aside>
  );
}
