import { useEffect, useState } from "react";
import { CHAPTER_ID } from "@pa/contracts";
import { Home } from "./pages/Home.js";
import { Onboarding, ONBOARDING_SMART_DEFAULTS } from "./pages/Onboarding.js";
import { Play } from "./pages/Play.js";
import { AppErrorBoundary } from "./AppErrorBoundary.js";
import { getSession, apiStatus, pullSave, saveOnboardingPreferences } from "./api.js";
import { getSave, listProfiles, putSave, upsertProfile, type LocalProfile } from "./db.js";

type View =
  | { name: "home" }
  | { name: "onboarding"; profile: LocalProfile; returnTo: "home" | "play" }
  | { name: "play"; profile: LocalProfile };

export function App() {
  const [view, setView] = useState<View>({ name: "home" });
  const [profiles, setProfiles] = useState<LocalProfile[]>([]);
  const [apiUp, setApiUp] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleName, setGoogleName] = useState<string | null>(null);
  const [activeGoogleProfileId, setActiveGoogleProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [startupError, setStartupError] = useState<string | null>(null);

  async function refreshData(): Promise<LocalProfile | null> {
    const status = await apiStatus();
    const up = status.up;
    const localProfiles = await listProfiles();
    let signedInProfile: LocalProfile | null = null;
    setApiUp(up);
    setGoogleReady(status.google);
    if (up) {
      const s = await getSession();
      if (s?.authenticated && s.profile) {
        const existing = localProfiles.find((p) => p.profileId === s.profile!.profileId);
        const remoteSave = await pullSave(s.profile.profileId);
        const localSave = existing ? await getSave(s.profile.profileId) : undefined;
        const useRemoteSave = Boolean(remoteSave && (!localSave || remoteSave.revision >= localSave.revision));
        const variationRootSeedHex =
          (useRemoteSave
            ? remoteSave?.variationRootSeedHex
            : localSave
              ? existing?.variationRootSeedHex
              : undefined) ??
          remoteSave?.variationRootSeedHex ??
          existing?.variationRootSeedHex ??
          s.profile.variationRootSeedHex;
        if (!variationRootSeedHex || !/^[0-9a-f]{64}$/.test(variationRootSeedHex)) {
          throw new Error("The API profile response is out of date.");
        }
        // The selected save and seed are one deterministic unit. A newer cloud
        // save must never be replayed using a stale device profile's seed.
        const mirrored: LocalProfile = {
          ...existing,
          profileId: s.profile.profileId,
          accountId: s.profile.accountId,
          displayName: s.profile.displayName,
          variationRootSeedHex,
          source: "GOOGLE",
          createdAt: s.profile.createdAt,
          cloudRevision: remoteSave?.revision ?? existing?.cloudRevision ?? 0,
          onboarding: existing?.onboarding ?? s.profile.onboarding ?? undefined,
        };
        await upsertProfile(mirrored);
        if (existing?.onboarding && !s.profile.onboarding) {
          void saveOnboardingPreferences(mirrored.profileId, existing.onboarding);
        }
        if (remoteSave && useRemoteSave) {
          await putSave({
            profileId: remoteSave.profileId,
            chapterId: remoteSave.chapterId,
            packageId: remoteSave.packageId,
            flowVersion: remoteSave.flowVersion,
            committedEvents: remoteSave.committedEvents,
            revision: remoteSave.revision,
            status: remoteSave.status,
            updatedAt: remoteSave.updatedAt,
            presenterSpatial: remoteSave.presenterSpatial,
          });
        }
        signedInProfile = mirrored;
        setGoogleName(s.profile.displayName);
        setActiveGoogleProfileId(s.profile.profileId);
      } else {
        setGoogleName(null);
        setActiveGoogleProfileId(null);
      }
    } else {
      setGoogleName(null);
      setActiveGoogleProfileId(null);
    }
    const refreshedProfiles = await listProfiles();
    // Local test profiles remain available offline. Google profiles are only
    // exposed while their owning session is active on this device.
    setProfiles(
      refreshedProfiles.filter(
        (profile) => profile.source === "LOCAL" || profile.profileId === signedInProfile?.profileId,
      ),
    );
    return signedInProfile;
  }

  async function refresh(): Promise<LocalProfile | null> {
    setStartupError(null);
    try {
      return await refreshData();
    } catch (cause) {
      console.error("Could not load profiles", cause);
      setApiUp(false);
      setGoogleName(null);
      setActiveGoogleProfileId(null);
      const localProfiles = await listProfiles().catch(() => []);
      setProfiles(localProfiles.filter((profile) => profile.source === "LOCAL"));
      setStartupError("The account service changed while this page was open. Restart the API, then retry.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  // First play starts in-world in seconds (design1 kill list): a profile
  // without saved preferences gets smart defaults applied and goes straight
  // to Play. The full interview remains reachable from the pause menu
  // ("Interface & accessibility") and preserves the same saved contract.
  async function enterPlay(profile: LocalProfile): Promise<void> {
    if (profile.onboarding) {
      setView({ name: "play", profile });
      return;
    }
    const onboarding = {
      ...ONBOARDING_SMART_DEFAULTS,
      completedAt: new Date().toISOString(),
    };
    const withDefaults: LocalProfile = { ...profile, onboarding };
    await upsertProfile(withDefaults);
    if (withDefaults.source === "GOOGLE") {
      void saveOnboardingPreferences(withDefaults.profileId, onboarding);
    }
    setProfiles((current) =>
      current.map((item) =>
        item.profileId === withDefaults.profileId ? withDefaults : item,
      ),
    );
    setView({ name: "play", profile: withDefaults });
  }

  useEffect(() => {
    const url = new URL(window.location.href);
    const enterGame = url.searchParams.get("auth") === "success";
    if (enterGame) {
      url.searchParams.delete("auth");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    void refresh().then((profile) => {
      if (enterGame && profile) void enterPlay(profile);
    });
  }, []);

  const viewProfile = view.name === "home" ? null : view.profile;
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("pa-high-contrast", Boolean(viewProfile?.onboarding?.highContrast));
    root.classList.toggle("pa-reduced-motion", Boolean(viewProfile?.onboarding?.reducedMotion));
    root.dataset.readingSpeed = viewProfile?.onboarding?.readingSpeed ?? "STANDARD";
    return () => {
      root.classList.remove("pa-high-contrast", "pa-reduced-motion");
      delete root.dataset.readingSpeed;
    };
  }, [viewProfile?.profileId, viewProfile?.onboarding]);

  if (loading) {
    return <div className="center"><div className="card"><h1>Project Archive</h1><p className="sub">Loading…</p></div></div>;
  }

  if (startupError) {
    return (
      <div className="center">
        <div className="card">
          <div className="archive-kicker">ARCHIVE // CONNECTION INTERRUPTED</div>
          <h1>Profile sync needs a retry</h1>
          <p className="sub">{startupError}</p>
          <button className="btn-primary" onClick={() => { setLoading(true); void refresh(); }}>Retry connection</button>
          <button className="btn-ghost" style={{ width: "100%", marginTop: 8 }} onClick={() => setStartupError(null)}>
            Continue with local profiles
          </button>
        </div>
      </div>
    );
  }

  if (view.name === "play") {
    return (
      <AppErrorBoundary
        onReset={() => { void refresh(); setView({ name: "home" }); }}
      >
        <Play
          profile={view.profile}
          chapterId={CHAPTER_ID}
          apiUp={apiUp}
          onEditPreferences={(profile) => setView({ name: "onboarding", profile, returnTo: "play" })}
          onExit={() => { void refresh(); setView({ name: "home" }); }}
        />
      </AppErrorBoundary>
    );
  }

  if (view.name === "onboarding") {
    return (
      <Onboarding
        profile={view.profile}
        onCancel={() => setView(view.returnTo === "play" ? { name: "play", profile: view.profile } : { name: "home" })}
        onComplete={(profile) => {
          setProfiles((current) => current.map((item) => item.profileId === profile.profileId ? profile : item));
          setView({ name: "play", profile });
        }}
      />
    );
  }

  return (
    <Home
      profiles={profiles}
      apiUp={apiUp}
      googleReady={googleReady}
      googleName={googleName}
      onPlay={(p) => {
        if (p.source === "GOOGLE" && p.profileId !== activeGoogleProfileId) return;
        void enterPlay(p);
      }}
      onChanged={() => refresh().then(() => undefined)}
    />
  );
}
