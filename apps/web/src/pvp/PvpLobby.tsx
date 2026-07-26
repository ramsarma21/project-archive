import { useState } from "react";
import { MATCH_CODE_LENGTH, refusalText } from "./refusals.js";
import { GOOGLE_SIGN_IN_URL, type PvpIdentity } from "./protocol.js";

// The two ways into a duel: make a code, or type one in.
//
// A queue exists in @pa/pvp and is deliberately not surfaced here. A ranked queue
// with a population of two is a coin flip on whether the button does anything, and
// the path that has to work tomorrow is one person reading a code off one window
// and typing it into another.

export interface PvpLobbyProps {
  readonly identity: PvpIdentity | null;
  readonly hosting: { readonly code: string; readonly handle: string } | null;
  readonly busy: boolean;
  readonly error: string | null;
  readonly offline: boolean;
  readonly onHost: () => void;
  readonly onJoin: (code: string) => void;
  readonly onCancel: () => void;
}

export function PvpLobby(props: PvpLobbyProps) {
  const [code, setCode] = useState("");

  // The second account arrives in a second browser profile with no session at all,
  // so this page has to be able to start a sign-in rather than only report that one
  // is missing. Google's callback lands on the app's home page, which is the one
  // rough edge in the two-window flow and is therefore spelled out rather than left
  // to be discovered.
  if (props.identity !== null && !props.identity.authenticated) {
    return (
      <div className="pvp-lobby">
        <div className="pvp-kicker">Archive // Duelling ground</div>
        <h1>This window is not signed in.</h1>
        <p>
          A duel is between two accounts, and each one needs its own browser session.
          Sign in here with the account this window should play as.
        </p>
        <div className="pvp-actions">
          <a className="pvp-btn pvp-btn-primary" href={GOOGLE_SIGN_IN_URL}>
            Sign in with Google
          </a>
        </div>
        <div className="pvp-note">
          Google sends you back to the Archive's home page rather than here, because
          that is where the app's sign-in normally ends. Once you land there, come back
          to this URL and the duelling ground will know who you are.
        </div>
      </div>
    );
  }

  if (props.hosting) {
    return (
      <div className="pvp-lobby">
        <div className="pvp-kicker">Archive // Duelling ground</div>
        <h1>Waiting for a challenger</h1>
        <p>Read this code into the other window. The duel starts the moment they join.</p>
        <div className="pvp-code">{props.hosting.code}</div>
        <div className="pvp-handle">You are {props.hosting.handle}</div>
        {props.offline && (
          <div className="pvp-error">
            The server is not answering. The code stays valid; this window will pick
            the match up as soon as it can reach the API again.
          </div>
        )}
        <div className="pvp-note">
          <b>Two windows, two accounts.</b> A duel needs two different profiles, and one
          browser keeps one set of cookies — so signing in twice in the same window just
          replaces the first account. Open the second window in a private/incognito
          window and sign in there with the other account. Joining your own lobby is
          refused on purpose.
        </div>
        <div className="pvp-actions">
          <button className="pvp-btn pvp-btn-danger" onClick={props.onCancel}>
            Cancel the lobby
          </button>
        </div>
      </div>
    );
  }

  const normalised = code.trim().toUpperCase();
  const joinable = normalised.length === MATCH_CODE_LENGTH;

  return (
    <div className="pvp-lobby">
      <div className="pvp-kicker">Archive // Duelling ground</div>
      <h1>Duel another runner</h1>
      <p>
        The same fight the missions end on, against a person. Each round asks one
        authored question; what you answer decides how much ammunition you carry into
        the exchange that follows. The duel runs until somebody is down.
      </p>
      {props.error && <div className="pvp-error">{refusalText(props.error)}</div>}
      <div className="pvp-actions">
        <button
          className="pvp-btn pvp-btn-primary"
          onClick={props.onHost}
          disabled={props.busy}
        >
          {props.busy ? "Opening…" : "Open a lobby"}
        </button>
      </div>
      <div className="pvp-actions">
        <input
          className="pvp-input"
          value={code}
          onChange={(event) => setCode(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && joinable) props.onJoin(normalised);
          }}
          placeholder="CODE"
          maxLength={MATCH_CODE_LENGTH + 2}
          spellCheck={false}
          aria-label="Match code"
        />
        <button
          className="pvp-btn"
          onClick={() => props.onJoin(normalised)}
          disabled={props.busy || !joinable}
        >
          Join by code
        </button>
      </div>
    </div>
  );
}
