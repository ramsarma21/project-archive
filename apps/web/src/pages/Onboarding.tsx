import { useState } from "react";
import type { OnboardingPreferences } from "@pa/contracts";
import { saveOnboardingPreferences } from "../api.js";
import { upsertProfile, type LocalProfile } from "../db.js";

// Smart defaults (design1 kill list): first play starts in-world immediately
// with these; the full interview lives behind the pause menu's "Interface &
// accessibility" (this same component), preserving every saved-preference
// contract.
export const ONBOARDING_SMART_DEFAULTS: Omit<OnboardingPreferences, "completedAt"> = {
  version: 1,
  readingSpeed: "STANDARD",
  captions: true,
  audioDescription: false,
  inputMethod: "KEYBOARD_MOUSE",
  archiveAssistAutoOffer: true,
  highContrast: false,
  reducedMotion: false,
  chaseAssist: "STANDARD",
};
const DEFAULTS = ONBOARDING_SMART_DEFAULTS;

export function Onboarding(props: {
  profile: LocalProfile;
  onComplete: (profile: LocalProfile) => void;
  onCancel: () => void;
}) {
  const existing = props.profile.onboarding;
  const [step, setStep] = useState(0);
  const [preferences, setPreferences] = useState<Omit<OnboardingPreferences, "completedAt">>(
    existing ? { ...existing } : DEFAULTS,
  );
  const [saving, setSaving] = useState(false);

  function update<K extends keyof typeof preferences>(key: K, value: (typeof preferences)[K]) {
    setPreferences((current) => ({ ...current, [key]: value }));
  }

  async function finish() {
    setSaving(true);
    const onboarding: OnboardingPreferences = {
      ...preferences,
      completedAt: existing?.completedAt ?? new Date().toISOString(),
    };
    const profile = { ...props.profile, onboarding };
    await upsertProfile(profile);
    if (profile.source === "GOOGLE") {
      await saveOnboardingPreferences(profile.profileId, onboarding);
    }
    props.onComplete(profile);
  }

  return (
    <div
      className={`onboarding-shell${preferences.highContrast ? " is-high-contrast" : ""}${preferences.reducedMotion ? " is-reduced-motion" : ""}`}
    >
      <div className="archive-grid" aria-hidden="true" />
      <main className="calibration-panel" aria-labelledby="onboarding-title">
        <header className="calibration-header">
          <div>
            <div className="archive-kicker">ARCHIVE // FIELD AGENT CALIBRATION</div>
            <h1 id="onboarding-title">{existing ? "Update interface profile" : "Prepare your insertion"}</h1>
          </div>
          <div className="calibration-progress" aria-label={`Step ${step + 1} of 3`}>
            <span>0{step + 1}</span><i>/</i><span>03</span>
          </div>
        </header>

        {step === 0 && (
          <section className="calibration-step">
            <div className="archive-status">READING CHANNEL</div>
            <h2>Choose your reading pace.</h2>
            <p>The story always waits for your input. This setting tunes how long temporary Archive messages remain visible.</p>
            <div className="calibration-options three">
              <Choice
                selected={preferences.readingSpeed === "RELAXED"}
                label="Relaxed"
                detail="More time for every field record."
                onSelect={() => update("readingSpeed", "RELAXED")}
              />
              <Choice
                selected={preferences.readingSpeed === "STANDARD"}
                label="Standard"
                detail="Balanced pacing. Recommended."
                onSelect={() => update("readingSpeed", "STANDARD")}
              />
              <Choice
                selected={preferences.readingSpeed === "BRISK"}
                label="Brisk"
                detail="Shorter nonessential messages."
                onSelect={() => update("readingSpeed", "BRISK")}
              />
            </div>
          </section>
        )}

        {step === 1 && (
          <section className="calibration-step">
            <div className="archive-status">PERCEPTION CHANNELS</div>
            <h2>Set what the Archive presents.</h2>
            <p>These options can be changed any time from the pause menu.</p>
            <div className="toggle-list">
              <Toggle
                checked={preferences.captions}
                label="Captions"
                detail="Show spoken dialogue and important sound cues as text."
                onChange={(value) => update("captions", value)}
              />
              <Toggle
                checked={preferences.audioDescription}
                label="Audio description"
                detail="Add concise descriptions for important visual action."
                onChange={(value) => update("audioDescription", value)}
              />
              <Toggle
                checked={preferences.highContrast}
                label="High contrast"
                detail="Use solid panels and stronger borders."
                onChange={(value) => update("highContrast", value)}
              />
              <Toggle
                checked={preferences.reducedMotion}
                label="Reduced motion"
                detail="Remove interface flicker and nonessential movement."
                onChange={(value) => update("reducedMotion", value)}
              />
            </div>
          </section>
        )}

        {step === 2 && (
          <section className="calibration-step">
            <div className="archive-status">FIELD CONTROLS</div>
            <h2>Choose how you will move.</h2>
            <p>Every required action has a keyboard-accessible control. Pointer look is optional.</p>
            <div className="calibration-options two">
              <Choice
                selected={preferences.inputMethod === "KEYBOARD_MOUSE"}
                label="Keyboard + pointer"
                detail="WASD or arrows to move. Drag to look around."
                onSelect={() => update("inputMethod", "KEYBOARD_MOUSE")}
              />
              <Choice
                selected={preferences.inputMethod === "KEYBOARD_ONLY"}
                label="Keyboard only"
                detail="Move with keys and use focused action controls."
                onSelect={() => update("inputMethod", "KEYBOARD_ONLY")}
              />
            </div>
            <div className="assist-setting">
              <Toggle
                checked={preferences.archiveAssistAutoOffer}
                label="Allow Archive Assist offers"
                detail="If you pause on an objective, the Archive may offer a route hint. It never changes your score."
                onChange={(value) => update("archiveAssistAutoOffer", value)}
              />
            </div>
            <div className="assist-setting">
              <h3>Chase assistance</h3>
              <p>Assistance changes chase handling only. Required content and outcomes stay the same.</p>
              <div className="calibration-options two">
                {([
                  ["STANDARD", "Standard", "Full stamina and pursuit tuning."],
                  ["SLOW_PURSUER", "Slower pursuer", "More room to read corners and routes."],
                  ["AUTO_STAMINA", "Automatic stamina", "Sprint and traversal do not drain stamina."],
                  ["CONFIRM_RESOLVE", "Confirm outcome", "Pause before an escape or catch resolves."],
                ] as const).map(([value, label, detail]) => (
                  <Choice
                    key={value}
                    selected={(preferences.chaseAssist ?? "STANDARD") === value}
                    label={label}
                    detail={detail}
                    onSelect={() => update("chaseAssist", value)}
                  />
                ))}
              </div>
            </div>
          </section>
        )}

        <footer className="calibration-actions">
          <button className="btn-ghost" disabled={saving} onClick={step === 0 ? props.onCancel : () => setStep((s) => s - 1)}>
            {step === 0 ? "Back to profiles" : "Previous"}
          </button>
          <div className="calibration-note">No onboarding choice affects assessment or historical outcomes.</div>
          {step < 2 ? (
            <button className="archive-action" onClick={() => setStep((s) => s + 1)}>Continue calibration</button>
          ) : (
            <button className="archive-action" disabled={saving} onClick={() => void finish()}>
              {saving ? "Saving profile…" : existing ? "Apply settings" : "Begin synchronization"}
            </button>
          )}
        </footer>
      </main>
    </div>
  );
}

function Choice(props: { selected: boolean; label: string; detail: string; onSelect: () => void }) {
  return (
    <button
      type="button"
      className={`calibration-choice${props.selected ? " selected" : ""}`}
      aria-pressed={props.selected}
      onClick={props.onSelect}
    >
      <span className="choice-marker" aria-hidden="true">{props.selected ? "◆" : "◇"}</span>
      <strong>{props.label}</strong>
      <span>{props.detail}</span>
    </button>
  );
}

function Toggle(props: { checked: boolean; label: string; detail: string; onChange: (checked: boolean) => void }) {
  return (
    <label className="calibration-toggle">
      <span>
        <strong>{props.label}</strong>
        <small>{props.detail}</small>
      </span>
      <input type="checkbox" checked={props.checked} onChange={(event) => props.onChange(event.target.checked)} />
      <i aria-hidden="true"><b /></i>
    </label>
  );
}
