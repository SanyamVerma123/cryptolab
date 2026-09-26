/**
 * AiSettings — the "bring your own model" panel.
 *
 * The user enters an Endpoint URL + API key, the app persists them via the
 * local relay (which stores them in ai.config.json, never in the browser),
 * fetches the provider's model list for a dropdown, and lets the user pick one
 * — or type a custom model id the list doesn't include.
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
  const [hasKey, setHasKey] = useState(false);
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
      })
      .catch(() => {
        /* relay not up yet — the fields stay editable */
      });
    return () => {
      alive = false;
    };
  }, []);

  // Fetch the model dropdown whenever the endpoint or key changes and the
  // user hasn't typed a custom id.
  const refreshModels = async (ep: string, key: string) => {
    if (!ep.trim()) {
      setModels([]);
      setModelError("");
      return;
    }
    setLoadingModels(true);
    setModelError("");
    try {
      const list = await listModels();
      setModels(list);
      // If the stored model isn't in the list, keep it (custom id).
      if (model && !list.includes(model)) setModels((m) => [model, ...m]);
    } catch (e) {
      setModels([]);
      setModelError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoadingModels(false);
    }
  };

  // Auto-fetch once the config is loaded with an endpoint in place.
  useEffect(() => {
    if (endpoint && !models.length && !modelError) {
      void refreshModels(endpoint, apiKey);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endpoint]);

  const save = async () => {
    setSaving(true);
    setSaved(false);
    try {
      const c = await setRelayConfig({
        endpoint: endpoint.trim(),
        // An empty string clears a stored key; leaving the field untouched
        // (placeholder shown) preserves it.
        apiKey: apiKey === "" && hasKey ? undefined : apiKey,
        model: model.trim(),
      });
      setHasKey(c.hasKey);
      setSaved(true);
      onStatus(
        `AI endpoint saved: ${c.endpoint || "(none)"}` +
          (c.model ? ` · model: ${c.model}` : "") +
          (c.hasKey ? " · key stored" : ""),
      );
      if (c.endpoint) void refreshModels(c.endpoint, apiKey);
    } catch (e) {
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
        onBlur={() => refreshModels(endpoint, apiKey)}
      />
      <div className="ai-settings-hint">
        Any OpenAI-compatible server: OpenAI, Groq, OpenRouter, LM Studio, Ollama…
      </div>

      <label className="ai-settings-label" htmlFor="ai-key">
        API key
      </label>
      <input
        id="ai-key"
        className="ai-settings-input"
        type="password"
        spellCheck={false}
        placeholder={hasKey ? "•••• stored — type to replace" : "sk-…"}
        value={apiKey}
        onChange={(e) => setApiKey(e.target.value)}
      />
      <div className="ai-settings-hint">
        {hasKey
          ? "A key is stored on this machine only. Clear the field and save to remove it."
          : "Stored locally in ai.config.json — never in the browser, never sent anywhere but the endpoint."}
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
          disabled={saving || (!endpoint.trim() && !model.trim() && apiKey === "")}
        >
          {saving ? "Saving…" : "Save"}
        </button>
        {saved && <span className="ai-settings-ok">✓ saved</span>}
      </div>
    </div>
  );
}
