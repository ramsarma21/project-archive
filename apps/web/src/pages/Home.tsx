import { useState } from "react";
import { createLocalProfile, deleteAllLocalProfiles, type LocalProfile } from "../db.js";
import { googleLoginUrl, logout } from "../api.js";
import { beginGoogleSignIn, openPlayerTwoTab } from "../devSession.js";

export function Home(props: {
  profiles: LocalProfile[];
  apiUp: boolean;
  googleReady: boolean;
  googleName: string | null;
  /** THIS tab's resolved identity, so a tester can see which account it is playing. */
  activeProfile: { displayName: string; source: LocalProfile["source"] } | null;
  onPlay: (p: LocalProfile) => void;
  onOpenHub: () => void;
  onChanged: () => Promise<void> | void;
}) {
  const { profiles, apiUp, googleReady, googleName, activeProfile } = props;
  const [name, setName] = useState("");

  async function addLocal() {
    const label = name.trim() || `Runner ${profiles.length + 1}`;
    await createLocalProfile(label);
    setName("");
    await props.onChanged();
  }

  async function clearLocalProfiles() {
    const count = profiles.filter((profile) => profile.source === "LOCAL").length;
    if (count === 0) return;
    if (!window.confirm(`Delete ${count} local test profile${count === 1 ? "" : "s"} and their saves?`)) return;
    await deleteAllLocalProfiles();
    await props.onChanged();
  }

  return (
    <div className="center">
      <div className="card" style={{ maxWidth: 560 }}>
        <div className="topbar">
          <div>
            <h1>Project Archive</h1>
            <p className="sub">Boston, 14 August 1765 — Day 1 (text slice)</p>
          </div>
          <span className="badge">{apiUp ? "server online" : "offline / local only"}</span>
        </div>

        <div className="panel-title">Sign in</div>
        {googleName ? (
          <div className="row">
            <div className="grow small">Signed in with Google as <strong>{googleName}</strong></div>
            <button className="btn-ghost" onClick={async () => { await logout(); await props.onChanged(); }}>Log out</button>
          </div>
        ) : (
          <button
            className="btn-primary"
            disabled={!apiUp || !googleReady}
            onClick={() => { beginGoogleSignIn(googleLoginUrl()); }}
            title={googleReady ? "" : "Configure Google credentials in .env"}
          >
            Sign in with Google
          </button>
        )}
        {apiUp && !googleReady && <p className="small muted" style={{ marginTop: 8 }}>Server is online, but Google credentials aren't set yet. You can test locally below.</p>}
        {!apiUp && <p className="small muted" style={{ marginTop: 8 }}>Server offline. You can still test locally below.</p>}

        <div className="panel-title">Profiles</div>
        {profiles.length === 0 && <p className="small muted">No profiles yet. Create a local one to start playing.</p>}
        {profiles.map((p) => (
          <ProfileRow key={p.profileId} profile={p} onPlay={() => props.onPlay(p)} />
        ))}

        <div className="panel-title">Hub</div>
        <button
          className="btn-ghost archive-manual-button"
          style={{ width: "100%" }}
          onClick={props.onOpenHub}
        >
          Open the System hub
        </button>
        <p className="small muted" style={{ marginTop: 6 }}>
          Placeholder state, no profile or server needed.
        </p>

        <div className="panel-title row">
          <span className="grow">New local profile (for testing)</span>
          {profiles.some((profile) => profile.source === "LOCAL") && (
            <button className="btn-danger-small" onClick={() => void clearLocalProfiles()}>
              Delete local profiles
            </button>
          )}
        </div>
        <div className="row">
          <input className="grow" type="text" placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
          <button onClick={addLocal}>Create</button>
        </div>

        {import.meta.env.DEV && (
          <>
            <div className="panel-title">Two-player testing</div>
            <div className="obj" style={{ marginBottom: 8 }}>
              <div className="row">
                <span className={`dot ${activeProfile?.source === "GOOGLE" ? "gold" : activeProfile ? "blue" : ""}`} />
                <div>
                  <div className="small">
                    This tab:{" "}
                    <strong>{activeProfile ? activeProfile.displayName : "not signed in"}</strong>
                  </div>
                  <div className="small muted">
                    {activeProfile
                      ? activeProfile.source === "GOOGLE"
                        ? "Google account · tab-scoped"
                        : "local profile · tab-scoped"
                      : "pick or create a profile below, or sign in with Google"}
                  </div>
                </div>
              </div>
            </div>
            <button
              className="btn-ghost"
              style={{ width: "100%" }}
              onClick={openPlayerTwoTab}
            >
              Open Player 2 tab
            </button>
            <p className="small muted" style={{ marginTop: 6 }}>
              Opens this app in a fresh tab with NO inherited identity. In the new tab,
              sign in with a different Google account or pick a local profile — each tab
              keeps its own tab-scoped identity, so this tab is unaffected. Two Google
              accounts, or one Google and one local, can now host and join each other
              without hitting "your own lobby". Use this action (not Duplicate Tab) so
              the second tab starts clean.
            </p>
          </>
        )}
      </div>
    </div>
  );
}

function ProfileRow(props: { profile: LocalProfile; onPlay: () => void }) {
  const { profile } = props;
  return (
    <div className="obj" style={{ justifyContent: "space-between" }}>
      <div className="row">
        <span className={`dot ${profile.source === "GOOGLE" ? "gold" : "blue"}`} />
        <div>
          <div>{profile.displayName}</div>
          <div className="small muted">{profile.source === "GOOGLE" ? "Google account" : "local"} · seed {profile.variationRootSeedHex.slice(0, 8)}…</div>
        </div>
      </div>
      <div className="row">
        <button onClick={props.onPlay}>Play</button>
      </div>
    </div>
  );
}
