// Settings modal — configure which LLM provider the editor's authoring
// assist uses (Ollama / Anthropic / OpenAI), the model per provider, and
// the Ollama URL. API keys are NOT entered here: the backend reads them
// from ANTHROPIC_API_KEY / OPENAI_API_KEY, and this panel only shows
// whether each is detected.

import { useEffect, useState } from "react";
import { api, type Settings, type Provider } from "./api";

interface SettingsModalProps {
  onClose: () => void;
  /** Called after a successful save so the header indicator refreshes. */
  onSaved: () => void;
}

const PROVIDERS: { id: Provider; label: string; note: string }[] = [
  { id: "ollama", label: "Ollama (local)", note: "Free, offline. No API key." },
  { id: "anthropic", label: "Anthropic (Claude)", note: "Needs ANTHROPIC_API_KEY in the environment." },
  { id: "openai", label: "OpenAI (GPT)", note: "Needs OPENAI_API_KEY in the environment." },
];

export function SettingsModal({ onClose, onSaved }: SettingsModalProps) {
  const [s, setS] = useState<Settings | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    api.getSettings().then(setS).catch((e) => setError((e as Error).message));
  }, []);

  function patch(next: Partial<Settings>) {
    setS((cur) => (cur ? { ...cur, ...next } : cur));
  }

  async function save() {
    if (!s) return;
    setSaving(true);
    setError("");
    try {
      await api.putSettings({
        provider: s.provider,
        ollama: s.ollama,
        anthropic: s.anthropic,
        openai: s.openai,
      });
      onSaved();
      onClose();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="author-modal-backdrop" onClick={onClose}>
      <div className="author-modal" onClick={(e) => e.stopPropagation()}>
        <div className="author-modal-head">
          <span>AI provider settings</span>
          <button type="button" className="author-mini-btn" onClick={onClose}>✕</button>
        </div>

        {!s ? (
          <div className="author-modal-body"><p>Loading…</p></div>
        ) : (
          <div className="author-modal-body">
            <fieldset className="author-fieldset">
              <legend>Provider</legend>
              {PROVIDERS.map((p) => {
                const detected =
                  p.id === "ollama" ? true : s.keys[p.id as "anthropic" | "openai"];
                return (
                  <label key={p.id} className="author-radio">
                    <input
                      type="radio"
                      name="provider"
                      checked={s.provider === p.id}
                      onChange={() => patch({ provider: p.id })}
                    />
                    <span className="author-radio-label">
                      {p.label}
                      {p.id !== "ollama" && (
                        <span className={`author-key ${detected ? "is-ok" : "is-bad"}`}>
                          {detected ? "key detected" : "no key"}
                        </span>
                      )}
                    </span>
                    <span className="author-radio-note">{p.note}</span>
                  </label>
                );
              })}
            </fieldset>

            {s.provider === "ollama" && (
              <fieldset className="author-fieldset">
                <legend>Ollama</legend>
                <label className="author-field">
                  <span>URL</span>
                  <input
                    className="author-input"
                    value={s.ollama.url}
                    onChange={(e) => patch({ ollama: { ...s.ollama, url: e.target.value } })}
                  />
                </label>
                <label className="author-field">
                  <span>Model</span>
                  {s.ollamaModels.length ? (
                    <select
                      className="author-input"
                      value={s.ollama.model}
                      onChange={(e) => patch({ ollama: { ...s.ollama, model: e.target.value } })}
                    >
                      {!s.ollamaModels.includes(s.ollama.model) && (
                        <option value={s.ollama.model}>{s.ollama.model} (not pulled)</option>
                      )}
                      {s.ollamaModels.map((m) => <option key={m} value={m}>{m}</option>)}
                    </select>
                  ) : (
                    <input
                      className="author-input"
                      value={s.ollama.model}
                      onChange={(e) => patch({ ollama: { ...s.ollama, model: e.target.value } })}
                    />
                  )}
                </label>
              </fieldset>
            )}

            {s.provider === "anthropic" && (
              <fieldset className="author-fieldset">
                <legend>Anthropic</legend>
                <label className="author-field">
                  <span>Model</span>
                  <input
                    className="author-input"
                    value={s.anthropic.model}
                    onChange={(e) => patch({ anthropic: { model: e.target.value } })}
                  />
                </label>
                {!s.keys.anthropic && (
                  <p className="author-hint">Set <code>ANTHROPIC_API_KEY</code> in your environment, then restart the API.</p>
                )}
              </fieldset>
            )}

            {s.provider === "openai" && (
              <fieldset className="author-fieldset">
                <legend>OpenAI</legend>
                <label className="author-field">
                  <span>Model</span>
                  <input
                    className="author-input"
                    value={s.openai.model}
                    onChange={(e) => patch({ openai: { model: e.target.value } })}
                  />
                </label>
                {!s.keys.openai && (
                  <p className="author-hint">Set <code>OPENAI_API_KEY</code> in your environment, then restart the API.</p>
                )}
              </fieldset>
            )}

            {error && <p className="author-error">{error}</p>}
          </div>
        )}

        <div className="author-modal-foot">
          <button type="button" className="author-tool" onClick={onClose}>Cancel</button>
          <button type="button" className="author-save" onClick={save} disabled={!s || saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
