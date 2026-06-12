/**
 * k6 load test for the reference resource (ADR 0039 semantics on display):
 * each VU signs up + signs in once via the raw Better Auth routes
 * (`/api/auth/*` — k6's per-VU cookie jar carries the httpOnly session cookie
 * from then on), then iterates a read-heavy mix on `/v1/projects`:
 *
 *   - create (POST, Idempotency-Key per attempt)  → p95 < 400ms
 *   - keyset cursor walk (GET, up to 3 pages)     → p95 < 200ms
 *
 * Run with the external k6 binary (no npm dependency) — see README.md.
 * IMPORTANT: the API's default throttle tiers (100 req/min per user, 10
 * auth req/min per IP — ADR 0044) are sized for production abuse, not load
 * tests. Start the API with THROTTLE_LIMIT/AUTH_RATE_LIMIT_MAX raised (see
 * README.md) or every VU 429s within seconds and the checks threshold trips.
 */
import { check, fail, sleep } from "k6";
import http from "k6/http";

const BASE_URL = __ENV.BASE_URL || "http://localhost:4000";
const PASSWORD = "Loadtest-pass-123!";
const JSON_HEADERS = { "Content-Type": "application/json" };

export const options = {
  scenarios: {
    projects_mix: {
      executor: "constant-vus",
      vus: Number(__ENV.VUS || 10),
      duration: __ENV.DURATION || "30s",
    },
  },
  thresholds: {
    // Read path: keyset list (cursor walk) — cheap by construction (ADR 0039).
    "http_req_duration{op:list}": ["p(95)<200"],
    // Write path: create (validation + insert + outbox row + idempotency claim).
    "http_req_duration{op:create}": ["p(95)<400"],
    // Any non-2xx (throttle, auth, contract drift) fails the run loudly.
    checks: ["rate>0.99"],
  },
};

/** RFC-4122-shaped v4 uuid for the Idempotency-Key header (Math.random is fine here). */
function uuidv4() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Per-VU auth, once: sign up a unique user, then sign in (exercises both auth
 * routes per the scenario contract). Both responses Set-Cookie the session —
 * k6's default per-VU cookie jar attaches it to every later request.
 */
function signUpAndIn() {
  const email = `loadtest-${__VU}-${Date.now()}@example.com`;

  const signUp = http.post(
    `${BASE_URL}/api/auth/sign-up/email`,
    JSON.stringify({ name: `Loadtest VU ${__VU}`, email, password: PASSWORD }),
    { headers: JSON_HEADERS, tags: { op: "auth" } },
  );
  if (!check(signUp, { "signed up": (r) => r.status === 200 })) {
    fail(`sign-up failed (${signUp.status}): ${signUp.body}`);
  }

  const signIn = http.post(
    `${BASE_URL}/api/auth/sign-in/email`,
    JSON.stringify({ email, password: PASSWORD }),
    { headers: JSON_HEADERS, tags: { op: "auth" } },
  );
  if (!check(signIn, { "signed in": (r) => r.status === 200 })) {
    fail(`sign-in failed (${signIn.status}): ${signIn.body}`);
  }
}

let authenticated = false;

export default function () {
  if (!authenticated) {
    signUpAndIn();
    authenticated = true;
  }

  // Write: create a project (fresh Idempotency-Key per attempt — no replays).
  const create = http.post(
    `${BASE_URL}/v1/projects`,
    JSON.stringify({ name: `k6 project ${__VU}-${__ITER}` }),
    {
      headers: Object.assign({ "Idempotency-Key": uuidv4() }, JSON_HEADERS),
      tags: { op: "create" },
    },
  );
  check(create, { "created (201)": (r) => r.status === 201 });

  // Read: walk the keyset cursor (`{ items, nextCursor }` envelope), up to 3 pages.
  let cursor = null;
  for (let page = 0; page < 3; page++) {
    const url = `${BASE_URL}/v1/projects?limit=20${cursor ? `&cursor=${cursor}` : ""}`;
    const res = http.get(url, { tags: { op: "list" } });
    if (!check(res, { "listed (200)": (r) => r.status === 200 })) break;
    cursor = res.json("nextCursor");
    if (!cursor) break;
  }

  sleep(0.1);
}
