import { useEffect, useState } from "react";
import { createLocalProfile, getSave, type LocalProfile } from "../db.js";
import { googleLoginUrl, logout } from "../api.js";

export function Home(props: {
  profiles: LocalProfile[];
  apiUp: boolean;
  googleReady: boolean;
  googleName: string | null;
  onPlay: (p: LocalProfile) => void;
  onChanged: () => Promise<void> | void;
}) {
  const { profiles, apiUp, googleReady, googleName } = props;
  const [name, setName] = useState("");

  async function addLocal() {
    const label = name.trim() || `Runner ${profiles.length + 1}`;
    await createLocalProfile(label);
    setName("");
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
            onClick={() => { window.location.href = googleLoginUrl(); }}
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

        <div className="panel-title">New local profile (for testing)</div>
        <div className="row">
          <input className="grow" type="text" placeholder="Display name" value={name} onChange={(e) => setName(e.target.value)} />
          <button onClick={addLocal}>Create</button>
        </div>
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
        <ResumeBadge profileId={profile.profileId} />
        <button onClick={props.onPlay}>Play</button>
      </div>
    </div>
  );
}

function ResumeBadge(props: { profileId: string }) {
  const [label, setLabel] = useState<string>("");
  useEffect(() => {
    void getSave(props.profileId).then((s) => {
      if (!s) setLabel("new");
      else if (s.status === "COMPLETE") setLabel("complete");
      else setLabel(`resume · ${s.committedEvents.length} steps`);
    });
  }, [props.profileId]);
  return <span className="tag">{label}</span>;
}
