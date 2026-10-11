/**
 * AiSettings — the "bring your own model" panel.
 *
 * The user enters an Endpoint URL + API key, the app stores them in this
 * browser, fetches the provider's model list through the relay, and lets the
 * user pick one — or type a custom model id the list doesn't include.
 */
import { useEffect, useState } from "react";
import {
  getRelayConfig,
  setRelayConfig,
  listModels,
  type AiConfig,
} from "../lib/aiClient";

interface Props {
  /** Called with a short status line to drop into the chat log. */
  onStatus: (text: string) => void;
  onClose: () => void;
}

export function AiSettings({ onStatus, onClose }: Props) {
  const [endpoint, setEndpoint] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [model, setModel] = useState("");
  const [models, setModels] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [modelError, setModelError] = useState("");
  const [relayError, setRelayError] = useState("");
  const [hasKey, setHasKey] = useState(false);
  const [clearKey, setClearKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Load the persisted config on open. The key itself never comes back —
  // only whether one is stored — so the field shows a placeholder instead.
  useEffect(() => {
    let alive = true;
    getRelayConfig()
      .then((c: AiConfig) => {
        if (!alive) return;
        setEndpoint(c.endpoint);
        setModel(c.model);
        setHasKey(c.hasKey);
        setRelayError("");
        if (c.endpoint) {
          setLoadingModels(true);
          void listModels().then((list) => {
            if (alive) setModels(c.model && !list.includes(c.model) ? [c.model, ...list] : list);
          }).catch((e) => {
            if (alive) setModelError(e instanceof Error ? e.message : String(e));
          }).finally(() => {
            if (alive) setLoadingModels(false);
          });
        }
      })
      .catch((e) => {
        if (alive) {
          setRelayError(e instanceof Error ? e.message : String(e));
        }
      });
    return () => {
      alive = false;
    };
  }, []);

  // Fetch the model dropdown whenever the endpoint or key changes and the
  // user hasn't typed a custom id.
  const refreshModels = async () => {
    if (!endpoint.trim()) {
      setModels([]);
      setModelError("");
      return;
    }
    setLoadingModels(true);
    setModelError("");
    try {
      const list = await listModels();
      setModels(model && !list.includes(model) ? [model, ...list] : list);
    } catch (e) {
      setModels([]);
      setModelError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingModels(false);
    }
  };

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const c = await setRelayConfig({
        endpoint: endpoint.trim(),
        // An empty string clears a stored key; leaving the field untouched
        // (placeholder shown) preserves it.
        apiKey: clearKey ? "" : apiKey === "" && hasKey ? undefined : apiKey,
        model: model.trim(),
      });
      setHasKey(c.hasKey);
      setSaved(true);
      setRelayError("");
      if (apiKey || clearKey) setApiKey("");
      setClearKey(false);
      onStatus(
        `AI endpoint saved: ${c.endpoint || "(none)"}` +
          (c.model ? ` · model: ${c.model}` : "") +
          (c.hasKey ? " · key stored" : ""),
      );
      if (c.endpoint) void refreshModels();
    } catch (e) {
      setRelayError(e instanceof Error ? e.message : String(e));
      onStatus(`Couldn't save the AI settings: ${e instanceof Error ? e.message : e}`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="ai-settings">
      <div className="ai-settings-head">
        <span className="ai-settings-title">AI model</span>
        <button className="ai-settings-close" onClick={onClose} aria-label="Close">
          ✕
        </button>
      </div>

      <label className="ai-settings-label" htmlFor="ai-endpoint">
        Endpoint URL
      </label>
      <input
        id="ai-endpoint"
        className="ai-settings-input"
        spellCheck={false}
        placeholder="https://api.openai.com/v1"
        value={endpoint}
        onChange={(e) => setEndpoint(e.target.value)}
        onBlur={() => {
          if (hasKey) void refreshModels();
        }}
      />
      <div className="ai-settings-hint">
        Any OpenAI-compatible server: OpenAI, Groq, OpenRouter, LM Studio, Ollama…
      </div>

      <label className="ai-settings-label" htmlFor="ai-key">
        API key
      </label>
      {hasKey && (
        <button
          type="button"
          className="ai-key-clear"
          aria-pressed={clearKey}
          onClick={() => {
            setClearKey((value) => !value);
            setApiKey("");
          }}
        >
          {clearKey ? "Keep saved key" : "Remove saved key"}
        </button>
      )}
      <input
        id="ai-key"
        className="ai-settings-input"
        type="password"
        spellCheck={false}
        placeholder={clearKey ? "Saved key will be removed" : hasKey ? "•••• stored — type to replace" : "sk-…"}
        value={apiKey}
        onChange={(e) => {
          setApiKey(e.target.value);
          if (e.target.value) setClearKey(false);
        }}
      />
      <div className="ai-settings-hint">
        {hasKey
        ? "Saved locally for this app. Leave it blank to keep it, or remove it and save to clear it."
          : "Saved locally for this app and sent only through the relay to the endpoint you choose."}
      </div>

      <label className="ai-settings-label" htmlFor="ai-model">
        Model
      </label>
      {loadingModels ? (
        <div className="ai-settings-hint">Loading model list…</div>
      ) : (
        <select
          id="ai-model"
          className="ai-settings-input ai-model-select"
          value={models.includes(model) ? model : "__custom__"}
          onChange={(e) => {
            if (e.target.value === "__custom__") setModel("");
            else setModel(e.target.value);
          }}
        >
          <option value="__custom__">
            {model ? `Custom: ${model}` : "— pick a model —"}
          </option>
          {models.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>
      )}
      {modelError && (
        <div className="ai-settings-hint ai-settings-err">
          Couldn't list models: {modelError}
        </div>
      )}
      {relayError && (
        <div className="ai-settings-hint ai-settings-err" role="status">
          {relayError}
        </div>
      )}

      <label className="ai-settings-label" htmlFor="ai-model-custom">
        Custom model id
      </label>
      <input
        id="ai-model-custom"
        className="ai-settings-input"
        spellCheck={false}
        placeholder="e.g. gpt-4o-mini, llama-3.3-70b-versatile, qwen2.5-coder"
        value={model}
        onChange={(e) => setModel(e.target.value)}
      />
      <div className="ai-settings-hint">
        Type any id the endpoint accepts — overrides the dropdown.
      </div>

      <div className="ai-settings-row">
        <button
          className="ai-settings-save"
          onClick={save}
          disabled={saving || (!endpoint.trim() && !model.trim() && apiKey === "" && !clearKey)}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="ai-settings-ok">✓ saved</span>}
      </div>
    </div>
  );
}
