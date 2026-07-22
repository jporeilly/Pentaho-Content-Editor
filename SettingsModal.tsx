// Settings modal — configure which LLM provider the editor's authoring
// assist uses (Ollama / Anthropic / OpenAI), the model per provider, and
// the Ollama URL. API keys are NOT entered here: the backend reads them
// from ANTHROPIC_API_KEY / OPENAI_API_KEY, and this panel only shows
// whether each is detected.

import { useEffect, useState } from "react";
import { api, type Settings, type Provider } from "./api";
import { Modal } from "./Modal";

type HwProfile = "auto" | "cpu" | "gpu";

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
  const [hw, setHw] = useState<HwProfile>("auto");
  const [suggestNote, setSuggestNote] = useState("");
  const [docsNote, setDocsNote] = useState("");

  useEffect(() => {
    api.getSettings().then(setS).catch((e) => setError((e as Error).message));
  }, []);

  function patch(next: Partial<Settings>) {
    setS((cur) => (cur ? { ...cur, ...next } : cur));
  }

  async function suggest() {
    if (!s) return;
    setSuggestNote("Checking hardware…");
    try {
      const r = await api.suggestModel(hw);
      if (r.model) {
        patch({ ollama: { ...s.ollama, model: r.model } });
        setSuggestNote(`${r.reason} → ${r.model}`);
      } else {
        setSuggestNote(r.reason);
      }
    } catch (e) {
      setSuggestNote((e as Error).message);
    }
  }

  async function testDocs() {
    if (!s) return;
    setDocsNote("Testing…");
    try {
      const r = await api.docsTest(s.docs.url);
      setDocsNote(r.ok ? `✓ Connected — ${r.count} hit(s), e.g. ${(r.sample || []).join(", ")}` : `✗ ${r.error}`);
    } catch (e) {
      setDocsNote(`✗ ${(e as Error).message}`);
    }
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
        docs: s.docs,
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
    <Modal
      title="AI provider settings"
      onClose={onClose}
      footer={
        <>
          <button type="button" className="author-tool" onClick={onClose}>Cancel</button>
          <button type="button" className="author-save" onClick={save} disabled={!s || saving}>
            {saving ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      {!s ? (
        <p>Loading…</p>
      ) : (
        <>
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
                <label className="author-field">
                  <span>
                    Hardware
                    <span className={`author-key ${s.gpu ? "is-ok" : "is-bad"}`} style={{ marginLeft: 8 }}>
                      {s.gpu ? "GPU detected" : "no GPU detected"}
                    </span>
                  </span>
                  <div style={{ display: "flex", gap: 8 }}>
                    <select
                      className="author-input"
                      value={hw}
                      onChange={(e) => setHw(e.target.value as HwProfile)}
                      style={{ flex: "0 0 auto" }}
                    >
                      <option value="auto">Auto-detect</option>
                      <option value="cpu">Force CPU (small model)</option>
                      <option value="gpu">Force GPU (larger model)</option>
                    </select>
                    <button type="button" className="author-tool" onClick={suggest}>Suggest model</button>
                  </div>
                </label>
                {suggestNote && <p className="author-hint">{suggestNote}</p>}
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

            <fieldset className="author-fieldset">
              <legend>Pentaho docs grounding</legend>
              <label className="author-radio" style={{ gridTemplateColumns: "auto 1fr" }}>
                <input
                  type="checkbox"
                  checked={s.docs.enabled}
                  onChange={(e) => patch({ docs: { ...s.docs, enabled: e.target.checked } })}
                />
                <span className="author-radio-label">Ground AI output in the Pentaho docs (GitBook MCP)</span>
                <span className="author-radio-note">When on, lab generation, import, and rewrite search the docs site and use the results as context.</span>
              </label>
              <label className="author-field">
                <span>Docs MCP endpoint</span>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    className="author-input"
                    style={{ flex: "1 1 auto" }}
                    value={s.docs.url}
                    onChange={(e) => patch({ docs: { ...s.docs, url: e.target.value } })}
                  />
                  <button type="button" className="author-tool" onClick={testDocs}>Test</button>
                </div>
              </label>
              {docsNote && <p className="author-hint">{docsNote}</p>}
            </fieldset>

            {error && <p className="author-error">{error}</p>}
        </>
      )}
    </Modal>
  );
}
