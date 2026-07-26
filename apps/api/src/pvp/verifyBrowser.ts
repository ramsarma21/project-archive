// Two signed-in duellists in one browser. `pnpm --filter @pa/api pvp:verify:browser`
//
// WHY THIS EXISTS. PvP needs two different accounts on one machine, and the only way
// into a session is Google OAuth: a consent screen, a real Google account, and a
// redirect. That is fine for a person with two accounts and impossible for anything
// automated, which left the renderer unverifiable end to end — the one part of PvP
// that can only be checked by looking at it.
//
// So this harness supplies the identity instead of the browser. It seeds two profiles
// and two sessions directly (exactly as pvp:verify:live already does), then puts a
// small relay in front of the dev server for each of them:
//
//   http://127.0.0.1:5199   is the host, always
//   http://127.0.0.1:5200   is the guest, always
//
// A request for /api or /v1 goes to the API with that port's session cookie attached;
// everything else goes to Vite untouched. The session is therefore a property of the
// PORT rather than of the browser's cookie jar, which means two ordinary tabs are two
// duellists and no private window is needed. Nothing about the app changes: the pages
// are the real pages, the routes are the real routes, the fight is simulated by the
// real authority, and every byte the renderer draws came over HTTP.
//
// IT IS A DEVELOPMENT TOOL AND IT REFUSES TO BE ANYTHING ELSE. It mints a session for
// a profile it created, which is precisely what an auth system exists to prevent, so it
// will not start under NODE_ENV=production and it binds to loopback only.
//
// The profiles it creates are DELIBERATELY NOT DELETED when it stops. Their standing
// rows are the evidence that a leaderboard survives a restart, and a harness that
// cleaned up after itself would erase the thing it was run to demonstrate. Pass
// `--reset` to drop them and start again.

import "../config.js";
import { createServer, request as httpRequest, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import type { Socket } from "node:net";
import { query } from "../db.js";

if (process.env.NODE_ENV === "production") {
  console.error("pvp:verify:browser is a development harness and will not run in production");
  process.exit(1);
}

const API_HOST = "127.0.0.1";
const API_PORT = Number(process.env.API_PORT ?? 3001);
const VITE_HOST = "127.0.0.1";
const VITE_PORT = Number(process.env.VITE_PORT ?? 5173);
const WEB_ORIGIN = process.env.WEB_ORIGIN ?? "http://localhost:5173";

/** Display names are the harness's own handle on its profiles, so a rerun reuses them. */
const SEATS = [
  { label: "host", displayName: "pvp-browser-host", port: 5199 },
  { label: "guest", displayName: "pvp-browser-guest", port: 5200 },
] as const;

interface Seat {
  readonly label: string;
  readonly port: number;
  readonly profileId: string;
  readonly sessionId: string;
}

async function findProfile(displayName: string): Promise<{ id: string; account_id: string } | null> {
  const rows = await query<{ id: string; account_id: string }>(
    "select id, account_id from profiles where display_name=$1 limit 1",
    [displayName],
  );
  return rows.rows[0] ?? null;
}

async function seat(spec: (typeof SEATS)[number]): Promise<Seat> {
  const existing = await findProfile(spec.displayName);
  let profileId: string;
  let accountId: string;
  if (existing) {
    profileId = existing.id;
    accountId = existing.account_id;
  } else {
    const account = await query<{ id: string }>("insert into accounts default values returning id");
    accountId = account.rows[0]!.id;
    const profile = await query<{ id: string }>(
      `insert into profiles(account_id, display_name, variation_root_seed_hex)
       values ($1,$2,$3) returning id`,
      [accountId, spec.displayName, randomBytes(32).toString("hex")],
    );
    profileId = profile.rows[0]!.id;
  }
  // A fresh session each run, and the old ones revoked: a week-long cookie left behind
  // by a harness is a week-long cookie.
  await query("delete from access_sessions where profile_id=$1", [profileId]);
  const sessionId = randomBytes(32).toString("base64url");
  await query(
    `insert into access_sessions(id, profile_id, account_id, expires_at)
     values ($1,$2,$3, now() + interval '6 hours')`,
    [sessionId, profileId, accountId],
  );
  return { label: spec.label, port: spec.port, profileId, sessionId };
}

async function reset(): Promise<void> {
  for (const spec of SEATS) {
    const profile = await findProfile(spec.displayName);
    if (!profile) continue;
    await query("delete from profiles where id=$1", [profile.id]);
    await query("delete from accounts where id=$1", [profile.account_id]);
    console.log(`dropped ${spec.displayName} (${profile.id}) and its standing`);
  }
}

/** True for the paths the API owns. Everything else belongs to the dev server. */
function forApi(url: string): boolean {
  return url.startsWith("/api/") || url === "/api" || url.startsWith("/v1/") || url === "/v1";
}

/**
 * Headers that describe THIS hop and must not be forwarded to the next one.
 *
 * Passing `connection: keep-alive` through to a fresh upstream socket is what made
 * four concurrent module requests fail with a bad gateway while the same four
 * succeeded one at a time — a failure that looked like the dev server and was the
 * proxy.
 */
const HOP_BY_HOP = [
  "connection",
  "keep-alive",
  "proxy-authenticate",
  "proxy-authorization",
  "te",
  "trailer",
  "transfer-encoding",
  "upgrade",
];

function relay(seated: Seat): void {
  const server = createServer((incoming: IncomingMessage, reply: ServerResponse) => {
    const url = incoming.url ?? "/";
    const api = forApi(url);
    const headers: Record<string, string | string[]> = { ...incoming.headers } as Record<
      string,
      string | string[]
    >;
    delete headers.host;
    for (const header of HOP_BY_HOP) delete headers[header];
    if (api) {
      // The session is the port's, not the browser's. Whatever cookies the tab is
      // carrying are replaced rather than merged, so one browser profile can hold two
      // duellists without either leaking into the other.
      headers.cookie = `pa_session=${seated.sessionId}`;
      // The API's CSRF check compares Origin against WEB_ORIGIN, and the browser sends
      // the relay's own origin. Presented as the configured one, because that is what
      // this request would be if the cookie had arrived the ordinary way.
      headers.origin = WEB_ORIGIN;
      headers.host = `${API_HOST}:${API_PORT}`;
    } else {
      headers.host = `${VITE_HOST}:${VITE_PORT}`;
    }

    const outgoing = httpRequest(
      {
        host: api ? API_HOST : VITE_HOST,
        port: api ? API_PORT : VITE_PORT,
        method: incoming.method,
        path: url,
        headers,
        // One socket per request. The shared agent's pooling is not worth reasoning
        // about for a two-tab harness, and it is the other half of the concurrency
        // failure above.
        agent: false,
      },
      (response) => {
        reply.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(reply);
      },
    );
    outgoing.on("error", (cause) => {
      console.error(`[${seated.label}] ${incoming.method} ${url} -> ${cause.message}`);
      if (!reply.headersSent) reply.writeHead(502, { "content-type": "text/plain" });
      reply.end(`relay could not reach ${api ? "the API" : "vite"}: ${cause.message}`);
    });
    incoming.pipe(outgoing);
  });

  // Vite's HMR socket is deliberately NOT forwarded. The harness restarts the dev
  // server between changes anyway — the file watcher does not fire from a tool sandbox
  // — so a live-reload channel would only add a hand-rolled websocket proxy to debug.
  server.on("upgrade", (_incoming: IncomingMessage, socket: Socket) => {
    socket.destroy();
  });

  server.listen(seated.port, "127.0.0.1", () => {
    console.log(
      `  ${seated.label.padEnd(5)} http://127.0.0.1:${seated.port}/src/pvp/pvp.html   profile ${seated.profileId}`,
    );
  });
}

/**
 * Where the seated sessions are written, for a driver that does not want the relay.
 *
 * An automated run has a better way in than a proxy: Playwright can set an httpOnly
 * cookie directly, so it can point both contexts straight at the dev server and skip
 * this process entirely for everything except the seeding. A person cannot set an
 * httpOnly cookie by hand, which is what the relay is still for.
 */
const SEATS_FILE = "/tmp/pa-pvp-seats.json";

async function main(): Promise<void> {
  if (process.argv.includes("--reset")) {
    await reset();
    process.exit(0);
  }
  // Seeding without the relay, for a driver that sets the cookie itself. It exits
  // immediately: leaving this process supervised alongside a capture was how a run
  // came to fail halfway through, because a restart re-seats both players and
  // re-seating REVOKES the session the browser was already holding.
  const seatsOnly = process.argv.includes("--seats-only");
  console.log(seatsOnly ? "\nSeating two duellists:\n" : "\nTwo duellists, two ports, one browser:\n");
  const seated: Seat[] = [];
  for (const spec of SEATS) {
    const one = await seat(spec);
    seated.push(one);
    if (!seatsOnly) relay(one);
  }
  writeFileSync(SEATS_FILE, JSON.stringify(seated, null, 2));
  console.log(`\n  sessions written to ${SEATS_FILE}`);
  if (seatsOnly) {
    for (const one of seated) {
      console.log(`  ${one.label.padEnd(5)} profile ${one.profileId}`);
    }
    process.exit(0);
  }
  console.log(
    `\n  /api and /v1 go to the API on ${API_PORT} with that port's session attached.` +
      `\n  Everything else goes to vite on ${VITE_PORT}.` +
      `\n  Standing survives this harness stopping; pass --reset to drop the profiles.\n`,
  );
}

main().catch((cause) => {
  console.error(cause);
  process.exit(1);
});
