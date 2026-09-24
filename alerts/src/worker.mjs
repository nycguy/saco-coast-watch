// Saco Coast Watch: safe first deployment to verify Cloudflare configuration.
// Public signup, email delivery, Web Push, and scheduled alerts remain OFF until tested.
// This file is self-contained so it can be pasted into the Cloudflare dashboard editor.

const EXPECTED_TABLES = [
  "subscribers",
  "push_subscriptions",
  "tokens",
  "alert_state",
  "request_limits",
];
const REQUIRED_SETTINGS = [
  "DB",
  "PUBLIC_SITE",
  "ALLOWED_ORIGIN",
  "WORKER_PUBLIC_URL",
  "FROM_EMAIL",
  "SUPPORT_EMAIL",
  "RESEND_API_KEY",
  "TURNSTILE_SITE_KEY",
  "TURNSTILE_SECRET",
  "TOKEN_SECRET",
];

function respond(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    },
  });
}

async function health(env) {
  // Check for the presence of settings, never return the values of secrets.
  const missingSettings = REQUIRED_SETTINGS.filter((key) => !env[key]);
  let tables = [];
  let databaseConnected = false;
  let databaseError = null;

  try {
    if (env.DB) {
      const result = await env.DB.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table'"
      ).all();
      tables = (result.results || []).map((row) => row.name);
      databaseConnected = true;
    }
  } catch (_) {
    databaseError = "Could not query the D1 database";
  }

  const missingTables = EXPECTED_TABLES.filter((name) => !tables.includes(name));
  const configurationReady =
    missingSettings.length === 0 &&
    databaseConnected &&
    missingTables.length === 0 &&
    typeof env.TOKEN_SECRET === "string" &&
    env.TOKEN_SECRET.length >= 32;

  return respond({
    service: "saco-coastal-alerts",
    phase: "staging",
    configurationReady,
    databaseConnected,
    missingSettings,
    missingTables,
    databaseError,
    publicSignupEnabled: false,
    emailsEnabled: false,
    webPushEnabled: false,
    scheduledAlertsEnabled: false,
  });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") {
      return health(env);
    }
    if (request.method === "GET" && url.pathname === "/") {
      return respond({
        service: "Saco Coast Watch Alerts",
        status: "Staging: notification delivery not yet enabled",
        health: "/health",
      });
    }
    return respond(
      { error: "Alerts are not accepting requests during setup." },
      503
    );
  },
  async scheduled(_event, _env, _ctx) {
    // Intentional no-op until alert logic and Web Push are deployed and tested.
  },
};
