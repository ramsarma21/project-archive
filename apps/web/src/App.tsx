import { useEffect, useRef, useState } from "react";
import { Home } from "./pages/Home.js";
import { Hub } from "./pages/hub/Hub.js";
import { GameIntro } from "./pages/intro/GameIntro.js";
import {
  effectiveReducedMotion,
  osPrefersReducedMotion,
  standardizedPreferences,
} from "./pages/preferences.js";
import { AppErrorBoundary } from "./AppErrorBoundary.js";
import { PvpScreen } from "./pvp/index.js";
import { establishLocalSession, getSession, apiStatus, saveOnboardingPreferences } from "./api.js";
import { listProfiles, upsertProfile, type LocalProfile } from "./db.js";
import { googleSignInUi, mirroredProfileSource } from "./sessionIdentity.js";

// The pre-game calibration interview is deleted (design1 kill list, product
// decision): profile -> straight into the hub with standardized preferences.
// The hub is the game's only entry point; missions, duels and the capstone are
// all deployed from it.
type View =
  | { name: "home" }
  // The game-open intake cutscene, between entering play and the hub. It plays
  // every launch (no persistence), carries the entering profile so the hub it
  // hands off to is the same one, and can be skipped.
  | { name: "intro"; profile: LocalProfile | null }
  | { name: "hub"; profile: LocalProfile | null }
  // The duelling ground, reached from the hub. It carries the hub's profile so
  // leaving PvP returns to the same hub the player opened it from, with their
  // display preferences intact. PvP holds its own authentication and lobby, so
  // this view mounts the screen and nothing else — no simulation lives here.
  | { name: "pvp"; profile: LocalProfile | null };

/**
 * `?hub=1` opens the hub directly on the fresh-runner state. The hub is a
 * presentation surface with no runtime session, so it must not sit behind the
 * profile list or the account service — this is read synchronously so review
 * never waits on (or is blocked by) an API that is not running.
 */
function hubBypassRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("hub") === "1";
  } catch {
    return false;
  }
}

/**
 * `?intro=1` opens the intake cutscene directly, then hands to the hub — a
 * review/capture bypass, API-down-safe exactly like `?hub=1`. `?hub=1` itself
 * DELIBERATELY SKIPS the intro: its whole purpose is to land on the hub for
 * review without waiting on the cutscene, so the two bypasses stay distinct — one
 * reviews the hub, one reviews the intro. The real play path (Home → Play →
 * beginPlay → enterPlay) always runs the intro before the hub.
 */
function introBypassRequested(): boolean {
  try {
    return new URLSearchParams(window.location.search).get("intro") === "1";
  } catch {
    return false;
  }
}

export function App() {
  const [view, setView] = useState<View>(() =>
    introBypassRequested()
      ? { name: "intro", profile: null }
      : hubBypassRequested()
        ? { name: "hub", profile: null }
        : { name: "home" },
  );
  const [profiles, setProfiles] = useState<LocalProfile[]>([]);
  const [apiUp, setApiUp] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleName, setGoogleName] = useState<string | null>(null);
  const [activeGoogleProfileId, setActiveGoogleProfileId] = useState<string | null>(null);
  // THIS TAB's resolved identity (via the per-tab dev header, when it holds one), so
  // the two-player testing UI can show which account/profile this tab is actually
  // playing as — the fix's visible proof that two tabs are distinct.
  const [activeProfile, setActiveProfile] = useState<{
    displayName: string;
    source: LocalProfile["source"];
  } | null>(null);
  const [loading, setLoading] = useState(() => !hubBypassRequested() && !introBypassRequested());
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
        // The device keeps whichever seed it already had; the account service is
        // only authoritative for a profile it has never seen here. Progression
        // itself syncs through apps/web/src/progression, not through this path.
        const variationRootSeedHex =
          existing?.variationRootSeedHex ?? s.profile.variationRootSeedHex;
        if (!variationRootSeedHex || !/^[0-9a-f]{64}$/.test(variationRootSeedHex)) {
          throw new Error("The API profile response is out of date.");
        }
        // Infer the source FIRST: a profile this device already knows keeps its
        // source, and only a never-seen one is a fresh Google sign-in.
        const source = mirroredProfileSource(existing);
        const mirrored: LocalProfile = {
          ...existing,
          profileId: s.profile.profileId,
          accountId: s.profile.accountId,
          displayName: s.profile.displayName,
          variationRootSeedHex,
          source,
          createdAt: s.profile.createdAt,
          onboarding: existing?.onboarding ?? s.profile.onboarding ?? undefined,
        };
        await upsertProfile(mirrored);
        if (existing?.onboarding && !s.profile.onboarding) {
          void saveOnboardingPreferences(mirrored.profileId, existing.onboarding);
        }
        signedInProfile = mirrored;
        // The Google sign-in UI is set ONLY for a GOOGLE session. A local-dev
        // session is authenticated too, but Home must not claim it signed in with
        // Google.
        const googleUi = googleSignInUi(source, {
          profileId: s.profile.profileId,
          displayName: s.profile.displayName,
        });
        setGoogleName(googleUi.googleName);
        setActiveGoogleProfileId(googleUi.activeGoogleProfileId);
        setActiveProfile({ displayName: s.profile.displayName, source });
      } else {
        setGoogleName(null);
        setActiveGoogleProfileId(null);
        setActiveProfile(null);
      }
    } else {
      setGoogleName(null);
      setActiveGoogleProfileId(null);
      setActiveProfile(null);
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
      setActiveProfile(null);
      const localProfiles = await listProfiles().catch(() => []);
      setProfiles(localProfiles.filter((profile) => profile.source === "LOCAL"));
      setStartupError("The account service changed while this page was open. Restart the API, then retry.");
      return null;
    } finally {
      setLoading(false);
    }
  }

  // Every play entry runs the intake cutscene, then the hub: a profile without
  // stored preferences receives the standardized defaults (calibrated: false) —
  // there is no upfront interview. Existing profiles with explicitly chosen
  // preferences keep them verbatim. Settings live in the pause surface. The
  // intro carries the profile through so the hub it opens is the same one.
  async function enterPlay(profile: LocalProfile): Promise<void> {
    if (profile.onboarding) {
      setView({ name: "intro", profile });
      return;
    }
    const onboarding = standardizedPreferences();
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
    setView({ name: "intro", profile: withDefaults });
  }

  // The one entry into play. A LOCAL profile must have a real server session
  // before it enters the hub: without one it is signed out, which is unranked,
  // unlimited, and grades every duel answer as a free magazine. Google already has
  // (or is completing) its own session, so it enters directly. If the account
  // service is down or the local session cannot be opened, we surface a clear error
  // and DO NOT drop the player into an unlimited practice run.
  async function beginPlay(profile: LocalProfile): Promise<void> {
    if (profile.source === "GOOGLE") {
      await enterPlay(profile);
      return;
    }
    if (!apiUp) {
      setStartupError(
        "This profile needs the account service to play, so the run is ranked and graded rather than an unlimited practice mission. Start the API and try again.",
      );
      return;
    }
    const established = await establishLocalSession({
      profileId: profile.profileId,
      displayName: profile.displayName,
      seedHex: profile.variationRootSeedHex,
    });
    if (!established.ok) {
      setStartupError(
        "Could not open a session for this local profile. Restart the API, then try again — a local run must be ranked, not unlimited.",
      );
      return;
    }
    await enterPlay(profile);
  }

  // True while the hub bypass has deferred startup, so leaving the hub knows it
  // still owes Home a profile load.
  const startupDeferred = useRef(hubBypassRequested() || introBypassRequested());

  useEffect(() => {
    const url = new URL(window.location.href);
    const enterGame = url.searchParams.get("auth") === "success";
    if (enterGame) {
      url.searchParams.delete("auth");
      window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
    }
    // The hub has no profile and no session. Skipping startup entirely keeps it
    // off the account service, so reviewing it with the API down produces no
    // failed requests and a clean console.
    if (startupDeferred.current) return;
    void refresh().then((profile) => {
      if (enterGame && profile) void enterPlay(profile);
    });
  }, []);

  const viewProfile = view.name === "home" ? null : view.profile;
  // Uncalibrated (standardized-default) profiles follow the OS
  // prefers-reduced-motion query LIVE; explicit choices always win.
  const [osReduced, setOsReduced] = useState(() => osPrefersReducedMotion());
  useEffect(() => {
    try {
      const query = window.matchMedia("(prefers-reduced-motion: reduce)");
      const onChange = () => setOsReduced(query.matches);
      query.addEventListener("change", onChange);
      return () => query.removeEventListener("change", onChange);
    } catch {
      return undefined;
    }
  }, []);
  useEffect(() => {
    const root = document.documentElement;
    root.classList.toggle("pa-high-contrast", Boolean(viewProfile?.onboarding?.highContrast));
    root.classList.toggle(
      "pa-reduced-motion",
      effectiveReducedMotion(viewProfile?.onboarding, osReduced),
    );
    root.dataset.readingSpeed = viewProfile?.onboarding?.readingSpeed ?? "STANDARD";
    return () => {
      root.classList.remove("pa-high-contrast", "pa-reduced-motion");
      delete root.dataset.readingSpeed;
    };
  }, [viewProfile?.profileId, viewProfile?.onboarding, osReduced]);

  // The intake cutscene, ahead of the loading/account gates for the same reason
  // the hub is: it needs no profile and no session, so nothing should hide it.
  // It plays every launch and hands off to the hub (Skip does the same).
  if (view.name === "intro") {
    return (
      <AppErrorBoundary onReset={() => setView({ name: "hub", profile: view.profile })}>
        <GameIntro
          reducedMotion={effectiveReducedMotion(view.profile?.onboarding, osReduced)}
          onDone={() => setView({ name: "hub", profile: view.profile })}
        />
      </AppErrorBoundary>
    );
  }

  // Ahead of the loading and account-service gates on purpose: the hub needs
  // neither a profile nor a session to render, so neither should be able to
  // hide it. A profile, when there is one, only supplies display preferences.
  if (view.name === "hub") {
    return (
      <AppErrorBoundary onReset={() => setView({ name: "home" })}>
        <Hub
          reducedMotion={osReduced}
          onEnterDuellingGround={() => setView({ name: "pvp", profile: view.profile })}
          onExit={() => {
            const url = new URL(window.location.href);
            if (url.searchParams.has("hub") || url.searchParams.has("intro")) {
              url.searchParams.delete("hub");
              url.searchParams.delete("intro");
              window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
            }
            if (startupDeferred.current) {
              startupDeferred.current = false;
              setLoading(true);
              void refresh();
            }
            setView({ name: "home" });
          }}
        />
      </AppErrorBoundary>
    );
  }

  // The duelling ground. PvP is server-authoritative — the screen owns its own
  // lobby, authentication and errors — so App only mounts it, hands it the
  // player's reduced-motion preference, and gives it a way back to the hub. There
  // is no client-side simulation here and none is started.
  if (view.name === "pvp") {
    return (
      <AppErrorBoundary onReset={() => setView({ name: "hub", profile: view.profile })}>
        <PvpScreen
          reducedMotion={effectiveReducedMotion(view.profile?.onboarding, osReduced)}
          onExit={() => setView({ name: "hub", profile: view.profile })}
        />
      </AppErrorBoundary>
    );
  }

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

  return (
    <Home
      profiles={profiles}
      apiUp={apiUp}
      googleReady={googleReady}
      googleName={googleName}
      activeProfile={activeProfile}
      onPlay={(p) => {
        if (p.source === "GOOGLE" && p.profileId !== activeGoogleProfileId) return;
        void beginPlay(p);
      }}
      onOpenHub={() => setView({ name: "hub", profile: null })}
      onChanged={() => refresh().then(() => undefined)}
    />
  );
}
