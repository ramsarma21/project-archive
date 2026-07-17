import { useEffect, useState } from "react";
import { CHAPTER_ID } from "@pa/contracts";
import { Home } from "./pages/Home.js";
import { Play } from "./pages/Play.js";
import { getSession, apiStatus } from "./api.js";
import { listProfiles, upsertProfile, type LocalProfile, randomSeedHex } from "./db.js";

type View = { name: "home" } | { name: "play"; profile: LocalProfile };

export function App() {
  const [view, setView] = useState<View>({ name: "home" });
  const [profiles, setProfiles] = useState<LocalProfile[]>([]);
  const [apiUp, setApiUp] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleName, setGoogleName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  async function refresh() {
    const status = await apiStatus();
    const up = status.up;
    setApiUp(up);
    setGoogleReady(status.google);
    if (up) {
      const s = await getSession();
      if (s?.authenticated && s.profile) {
        // mirror the Google-backed profile locally so it can play/resume
        const existing = (await listProfiles()).find((p) => p.profileId === s.profile!.profileId);
        const mirrored: LocalProfile = existing ?? {
          profileId: s.profile.profileId,
          accountId: s.profile.accountId,
          displayName: s.profile.displayName,
          variationRootSeedHex: randomSeedHex(),
          source: "GOOGLE",
          createdAt: s.profile.createdAt,
        };
        await upsertProfile(mirrored);
        setGoogleName(s.profile.displayName);
      } else {
        setGoogleName(null);
      }
    }
    setProfiles(await listProfiles());
    setLoading(false);
  }

  useEffect(() => {
    void refresh();
  }, []);

  if (loading) {
    return <div className="center"><div className="card"><h1>Project Archive</h1><p className="sub">Loading…</p></div></div>;
  }

  if (view.name === "play") {
    return <Play profile={view.profile} chapterId={CHAPTER_ID} apiUp={apiUp} onExit={() => { void refresh(); setView({ name: "home" }); }} />;
  }

  return (
    <Home
      profiles={profiles}
      apiUp={apiUp}
      googleReady={googleReady}
      googleName={googleName}
      onPlay={(p) => setView({ name: "play", profile: p })}
      onChanged={refresh}
    />
  );
}
