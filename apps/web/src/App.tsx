import { useEffect, useRef, useState } from "react";
import { Home } from "./pages/Home.js";
import { Hub } from "./pages/hub/Hub.js";
import {
  effectiveReducedMotion,
  osPrefersReducedMotion,
  standardizedPreferences,
} from "./pages/preferences.js";
import { AppErrorBoundary } from "./AppErrorBoundary.js";
import { getSession, apiStatus, saveOnboardingPreferences } from "./api.js";
import { listProfiles, upsertProfile, type LocalProfile } from "./db.js";

// The pre-game calibration interview is deleted (design1 kill list, product
// decision): profile -> straight into the hub with standardized preferences.
// The hub is the game's only entry point; missions, duels and the capstone are
// all deployed from it.
type View =
  | { name: "home" }
  | { name: "hub"; profile: LocalProfile | null };

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

export function App() {
  const [view, setView] = useState<View>(() =>
    hubBypassRequested() ? { name: "hub", profile: null } : { name: "home" },
  );
  const [profiles, setProfiles] = useState<LocalProfile[]>([]);
  const [apiUp, setApiUp] = useState(false);
  const [googleReady, setGoogleReady] = useState(false);
  const [googleName, setGoogleName] = useState<string | null>(null);
  const [activeGoogleProfileId, setActiveGoogleProfileId] = useState<string | null>(null);
  const [loading, setLoading] = useState(() => !hubBypassRequested());
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
        const mirrored: LocalProfile = {
          ...existing,
          profileId: s.profile.profileId,
          accountId: s.profile.accountId,
          displayName: s.profile.displayName,
          variationRootSeedHex,
          source: "GOOGLE",
          createdAt: s.profile.createdAt,
          onboarding: existing?.onboarding ?? s.profile.onboarding ?? undefined,
        };
        await upsertProfile(mirrored);
        if (existing?.onboarding && !s.profile.onboarding) {
          void saveOnboardingPreferences(mirrored.profileId, existing.onboarding);
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

  // Every play entry goes straight to the hub: a profile without stored
  // preferences receives the standardized defaults (calibrated: false) —
  // there is no upfront interview. Existing profiles with explicitly chosen
  // preferences keep them verbatim. Settings live in the pause surface.
  async function enterPlay(profile: LocalProfile): Promise<void> {
    if (profile.onboarding) {
      setView({ name: "hub", profile });
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
    setView({ name: "hub", profile: withDefaults });
  }

  // True while the hub bypass has deferred startup, so leaving the hub knows it
  // still owes Home a profile load.
  const startupDeferred = useRef(hubBypassRequested());

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

  const viewProfile = view.name === "hub" ? view.profile : null;
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

  // Ahead of the loading and account-service gates on purpose: the hub needs
  // neither a profile nor a session to render, so neither should be able to
  // hide it. A profile, when there is one, only supplies display preferences.
  if (view.name === "hub") {
    return (
      <AppErrorBoundary onReset={() => setView({ name: "home" })}>
        <Hub
          reducedMotion={osReduced}
          onExit={() => {
            const url = new URL(window.location.href);
            if (url.searchParams.has("hub")) {
              url.searchParams.delete("hub");
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
      onPlay={(p) => {
        if (p.source === "GOOGLE" && p.profileId !== activeGoogleProfileId) return;
        void enterPlay(p);
      }}
      onOpenHub={() => setView({ name: "hub", profile: null })}
      onChanged={() => refresh().then(() => undefined)}
    />
  );
}
