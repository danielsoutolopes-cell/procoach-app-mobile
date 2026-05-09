import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, gt, sql } from "@workspace/db";
import { db } from "@workspace/db";
import {
  authSessionsTable,
  athletesTable,
  stravaTokensTable,
  workoutEntriesTable,
} from "@workspace/db/schema";

const router: IRouter = Router();

const MONO_DEVICE_ID = "mono";

const CLIENT_ID     = process.env.STRAVA_CLIENT_ID;
const CLIENT_SECRET = process.env.STRAVA_CLIENT_SECRET;

let workoutShoeColsReady = false;
async function ensureWorkoutShoeColumns(): Promise<void> {
  if (workoutShoeColsReady) return;
  // These columns are added by the procoach routes as well, but Strava sync can run independently.
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_workout_entries
      ADD COLUMN IF NOT EXISTS shoe_id INTEGER REFERENCES procoach_shoes(id) ON DELETE SET NULL
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_workout_entries
      ADD COLUMN IF NOT EXISTS source VARCHAR(16) NOT NULL DEFAULT 'manual'
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_workout_entries
      ADD COLUMN IF NOT EXISTS external_id BIGINT
  `);
  workoutShoeColsReady = true;
}

function isConfigured(): boolean {
  return Boolean(CLIENT_ID && CLIENT_SECRET);
}

function cleanEnvUrl(val: string | undefined): string {
  const v = String(val ?? "").trim();
  if (!v) return "";
  return v.replace(/^['"`]+/, "").replace(/['"`]+$/, "").trim();
}

function getRedirectUri(req: Request): string {
  const explicit = cleanEnvUrl(process.env.STRAVA_REDIRECT_URI);
  if (explicit) return explicit;
  const domains = process.env.REPLIT_DOMAINS ?? "";
  const primary = domains.split(",")[0]?.trim();
  if (primary) return `https://${primary}/api/strava/callback`;
  const host  = req.headers["x-forwarded-host"] ?? req.headers.host ?? "localhost";
  const proto = req.headers["x-forwarded-proto"] ?? "https";
  return `${proto}://${host}/api/strava/callback`;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────

async function getAthleteFromToken(token: string) {
  const now = new Date();
  const sessions = await db
    .select()
    .from(authSessionsTable)
    .where(and(eq(authSessionsTable.token, token), gt(authSessionsTable.expiresAt, now)))
    .limit(1);
  if (!sessions[0]) return null;
  const athletes = await db
    .select()
    .from(athletesTable)
    .where(eq(athletesTable.id, sessions[0].athleteId))
    .limit(1);
  return athletes[0] ?? null;
}

async function getAthleteByDeviceId(deviceId: string) {
  const rows = await db
    .select()
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId))
    .limit(1);
  if (rows[0]) return rows[0];
  if (deviceId !== MONO_DEVICE_ID) return null;

  const defaultRaceDate = new Date(Date.now() + 16 * 7 * 24 * 60 * 60 * 1000).toISOString();
  const created = await db
    .insert(athletesTable)
    .values({ deviceId: MONO_DEVICE_ID, targetRaceDate: defaultRaceDate })
    .returning();
  return created[0] ?? null;
}

// ─── Token refresh ────────────────────────────────────────────────────────────

async function refreshStravaToken(
  stored: typeof stravaTokensTable.$inferSelect
): Promise<typeof stravaTokensTable.$inferSelect> {
  if (stored.expiresAt > new Date()) return stored;
  const res = await fetch("https://www.strava.com/oauth/token", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      grant_type:    "refresh_token",
      refresh_token: stored.refreshToken,
    }),
  });
  if (!res.ok) throw new Error(`Strava token refresh failed: ${res.status}`);
  const data = await res.json() as {
    access_token: string; refresh_token: string; expires_at: number;
  };
  const updated = await db
    .update(stravaTokensTable)
    .set({ accessToken: data.access_token, refreshToken: data.refresh_token, expiresAt: new Date(data.expires_at * 1000) })
    .where(eq(stravaTokensTable.id, stored.id))
    .returning();
  return updated[0]!;
}

// ─── Strava activity sync helper ──────────────────────────────────────────────

const TYPE_MAP: Record<string, string> = {
  Run: "corrida", TrailRun: "corrida", VirtualRun: "corrida",
  Ride: "bike", VirtualRide: "bike", EBikeRide: "bike",
  Yoga: "regenerativo", Walk: "regenerativo", Hike: "regenerativo",
  WeightTraining: "forca", Workout: "forca", Crossfit: "forca",
};

async function syncActivitiesForAthlete(
  athleteId: number,
  raceDate: string,
  accessToken: string
): Promise<number> {
  await ensureWorkoutShoeColumns();
  const activitiesRes = await fetch(
    "https://www.strava.com/api/v3/athlete/activities?per_page=60",
    { headers: { Authorization: `Bearer ${accessToken}` } }
  );
  if (!activitiesRes.ok) throw new Error(`Strava fetch failed: ${activitiesRes.status}`);

  const activities = await activitiesRes.json() as Array<{
    id: number; type: string; sport_type: string; start_date_local: string;
    distance: number; moving_time: number; elapsed_time: number;
  }>;

  const raceDateMs   = new Date(raceDate).getTime();
  const planStart    = new Date(raceDateMs - 16 * 7 * 24 * 60 * 60 * 1000);
  const msPerWeek    = 7 * 24 * 60 * 60 * 1000;
  let imported = 0;

  for (const act of activities) {
    const procoachType = TYPE_MAP[act.sport_type] ?? TYPE_MAP[act.type];
    if (!procoachType) continue;

    const actDate    = new Date(act.start_date_local);
    const actDateStr = actDate.toISOString().slice(0, 10);
    const weekNum    = Math.max(1, Math.min(16, Math.ceil((actDate.getTime() - planStart.getTime()) / msPerWeek)));
    const distKm     = Math.round(act.distance / 1000);
    const durMin     = Math.round((act.moving_time || act.elapsed_time) / 60);

    const existing = await db
      .select({ id: workoutEntriesTable.id })
      .from(workoutEntriesTable)
      .where(and(eq(workoutEntriesTable.athleteId, athleteId), eq(workoutEntriesTable.entryDate, actDateStr)))
      .limit(1);
    if (existing.length > 0) continue;

    await db.insert(workoutEntriesTable).values({
      athleteId, entryDate: actDateStr, distanceKm: distKm,
      type: procoachType as "corrida" | "bike" | "regenerativo" | "forca" | "folga",
      durationMin: durMin, week: weekNum,
      shoeId: null,
      source: "strava",
      externalId: act.id,
    });
    imported++;
  }
  return imported;
}

// ─── Session-based routes (legacy) ────────────────────────────────────────────

router.get("/strava/connect", async (req: Request, res: Response) => {
  if (!isConfigured()) { res.status(503).json({ error: "Strava não configurado no servidor" }); return; }
  const { token } = req.query as { token?: string };
  if (!token) { res.status(400).json({ error: "token obrigatório" }); return; }
  const athlete = await getAthleteFromToken(token);
  if (!athlete) { res.status(401).json({ error: "Sessão inválida" }); return; }

  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", CLIENT_ID!);
  url.searchParams.set("redirect_uri", getRedirectUri(req));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", "activity:read_all");
  url.searchParams.set("state", token);
  res.redirect(url.toString());
});

// ─── DeviceId-based routes (mobile app, no auth session) ─────────────────────

router.get("/strava/configured", (_req: Request, res: Response) => {
  res.json({ configured: isConfigured() });
});

router.get("/strava/diagnostics", async (req: Request, res: Response) => {
  const configured = isConfigured();
  const redirectUri = getRedirectUri(req);
  const athlete = await getAthleteByDeviceId(MONO_DEVICE_ID);
  const connectedRow = athlete
    ? await db.select().from(stravaTokensTable).where(eq(stravaTokensTable.athleteId, athlete.id)).limit(1)
    : [];
  const connected = Boolean(connectedRow[0]);
  res.json({
    configured,
    connected,
    redirectUri,
    lastSyncAt: connectedRow[0]?.lastSyncAt?.toISOString() ?? null,
  });
});

router.get("/strava/connect-url", async (req: Request, res: Response) => {
  if (!isConfigured()) { res.status(503).json({ error: "Strava não configurado. Adicione STRAVA_CLIENT_ID e STRAVA_CLIENT_SECRET." }); return; }
  const { deviceId: raw } = req.query as { deviceId?: string };
  const deviceId = (raw ?? "").trim() || MONO_DEVICE_ID;
  const athlete = await getAthleteByDeviceId(deviceId);
  if (!athlete) { res.status(404).json({ error: "Atleta não encontrado. Abra o app primeiro." }); return; }

  const url = new URL("https://www.strava.com/oauth/authorize");
  url.searchParams.set("client_id", CLIENT_ID!);
  url.searchParams.set("redirect_uri", getRedirectUri(req));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("approval_prompt", "auto");
  url.searchParams.set("scope", "activity:read_all");
  url.searchParams.set("state", `dev:${deviceId}`);
  res.json({ url: url.toString() });
});

router.get("/strava/status-device", async (req: Request, res: Response) => {
  const { deviceId: raw } = req.query as { deviceId?: string };
  const deviceId = (raw ?? "").trim() || MONO_DEVICE_ID;
  const athlete = await getAthleteByDeviceId(deviceId);
  if (!athlete) { res.status(404).json({ error: "Atleta não encontrado" }); return; }

  const rows = await db.select().from(stravaTokensTable).where(eq(stravaTokensTable.athleteId, athlete.id)).limit(1);
  if (!rows[0]) { res.json({ connected: false, configured: isConfigured() }); return; }
  res.json({ connected: true, configured: isConfigured(), lastSyncAt: rows[0].lastSyncAt?.toISOString() ?? null });
});

router.post("/strava/sync-device", async (req: Request, res: Response) => {
  const { deviceId: raw, raceDate } = req.body as { deviceId?: string; raceDate?: string };
  const deviceId = (raw ?? "").trim() || MONO_DEVICE_ID;
  const athlete = await getAthleteByDeviceId(deviceId);
  if (!athlete) { res.status(404).json({ error: "Atleta não encontrado" }); return; }

  const rows = await db.select().from(stravaTokensTable).where(eq(stravaTokensTable.athleteId, athlete.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ error: "Strava não conectado" }); return; }

  const stored = await refreshStravaToken(rows[0]);
  const imported = await syncActivitiesForAthlete(
    athlete.id,
    raceDate ?? athlete.targetRaceDate,
    stored.accessToken
  );

  await db.update(stravaTokensTable).set({ lastSyncAt: new Date() }).where(eq(stravaTokensTable.athleteId, athlete.id));
  const pending = await db.execute(sql`
    SELECT id, entry_date, distance_km, duration_min
    FROM procoach_workout_entries
    WHERE athlete_id = ${athlete.id}
      AND source = 'strava'
      AND type = 'corrida'
      AND shoe_id IS NULL
    ORDER BY entry_date DESC
    LIMIT 20
  `) as { rows: Array<Record<string, unknown>> };
  res.json({ imported, synced: true, pendingShoe: pending.rows });
});

router.post("/strava/race-result", async (req: Request, res: Response) => {
  const { deviceId: raw, raceDate, distanceKm } = req.body as {
    deviceId?: string; raceDate?: string; distanceKm?: number;
  };
  const deviceId = (raw ?? "").trim() || MONO_DEVICE_ID;
  if (!raceDate) { res.status(400).json({ error: "raceDate é obrigatório" }); return; }

  const athlete = await getAthleteByDeviceId(deviceId);
  if (!athlete) { res.status(404).json({ error: "Atleta não encontrado" }); return; }

  const rows = await db.select().from(stravaTokensTable).where(eq(stravaTokensTable.athleteId, athlete.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ error: "Strava não conectado" }); return; }

  const stored = await refreshStravaToken(rows[0]);

  // Fetch activities around race date (±2 days window)
  const raceDt     = new Date(raceDate);
  const afterTs    = Math.floor(new Date(raceDt.getTime() - 2 * 86400000).getTime() / 1000);
  const beforeTs   = Math.floor(new Date(raceDt.getTime() + 2 * 86400000).getTime() / 1000);

  const actRes = await fetch(
    `https://www.strava.com/api/v3/athlete/activities?after=${afterTs}&before=${beforeTs}&per_page=20`,
    { headers: { Authorization: `Bearer ${stored.accessToken}` } }
  );
  if (!actRes.ok) { res.status(502).json({ error: "Falha ao buscar atividades do Strava" }); return; }

  const activities = await actRes.json() as Array<{
    id: number; name: string; sport_type: string; type: string;
    start_date_local: string; distance: number; moving_time: number;
    elapsed_time: number; average_heartrate?: number; average_cadence?: number;
    total_elevation_gain?: number; achievement_count?: number;
  }>;

  // Find running activity matching distance (within 15%)
  const runs = activities.filter((a) =>
    a.sport_type === "Run" || a.type === "Run" ||
    a.sport_type === "TrailRun" || a.sport_type === "VirtualRun"
  );

  let match = runs[0];
  if (distanceKm && runs.length > 0) {
    const tolerance = distanceKm * 0.15;
    match = runs.find((a) => Math.abs(a.distance / 1000 - distanceKm) <= tolerance) ?? runs[0];
  }

  if (!match) { res.json({ found: false }); return; }

  const actualDistKm  = Math.round(match.distance / 10) / 100;
  const actualTimeMin = Math.round(match.moving_time / 60);
  const avgPace       = actualDistKm > 0 ? Math.round((actualTimeMin / actualDistKm) * 100) / 100 : 0;

  res.json({
    found:             true,
    activityId:        match.id,
    activityName:      match.name,
    activityUrl:       `https://www.strava.com/activities/${match.id}`,
    startDateLocal:    match.start_date_local,
    actualDistKm,
    actualTimeMin,
    avgPaceMinKm:      avgPace,
    avgHeartRate:      match.average_heartrate ?? null,
    avgCadence:        match.average_cadence   ?? null,
    elevationGain:     match.total_elevation_gain ?? null,
    achievements:      match.achievement_count  ?? 0,
  });
});

router.post("/strava/disconnect-device", async (req: Request, res: Response) => {
  const { deviceId: raw } = req.body as { deviceId?: string };
  const deviceId = (raw ?? "").trim() || MONO_DEVICE_ID;
  const athlete = await getAthleteByDeviceId(deviceId);
  if (!athlete) { res.status(404).json({ error: "Atleta não encontrado" }); return; }
  await db.delete(stravaTokensTable).where(eq(stravaTokensTable.athleteId, athlete.id));
  res.json({ disconnected: true });
});

// ─── OAuth Callback (handles both session token and deviceId) ─────────────────

const closeHtml = (msg: string, ok: boolean) => `
<!DOCTYPE html><html lang="pt-BR">
<head><meta charset="utf-8"><title>PROCOACH OS</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body{background:#0A0A0A;color:#fff;font-family:system-ui;display:flex;align-items:center;
       justify-content:center;height:100vh;margin:0;flex-direction:column;gap:16px;text-align:center;padding:24px;}
  .icon{font-size:52px;}
  .msg{font-size:15px;color:${ok ? "#FF5F00" : "#f44336"};font-weight:800;letter-spacing:2px;}
  .sub{font-size:12px;color:#555;letter-spacing:1px;line-height:1.6;}
</style></head>
<body>
  <div class="icon">${ok ? "🏃" : "⚠️"}</div>
  <div class="msg">${msg}</div>
  <div class="sub">${ok ? "Volte ao PROCOACH OS e toque em<br><strong>\"Verificar conexão\"</strong> para confirmar." : "Tente novamente no app."}</div>
  <script>setTimeout(()=>window.close(),3000);</script>
</body></html>`;

router.get("/strava/callback", async (req: Request, res: Response) => {
  const { code, state, error } = req.query as { code?: string; state?: string; error?: string };

  if (error || !code || !state) { res.send(closeHtml("ACESSO NEGADO", false)); return; }

  // Resolve athlete from state
  let athlete: typeof athletesTable.$inferSelect | null = null;
  if (state.startsWith("dev:")) {
    athlete = await getAthleteByDeviceId(state.slice(4));
  } else {
    athlete = await getAthleteFromToken(state);
  }
  if (!athlete) { res.send(closeHtml("SESSÃO INVÁLIDA", false)); return; }

  const tokenRes = await fetch("https://www.strava.com/oauth/token", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify({
      client_id:     CLIENT_ID,
      client_secret: CLIENT_SECRET,
      code,
      grant_type:    "authorization_code",
      redirect_uri:  getRedirectUri(req),
    }),
  });

  if (!tokenRes.ok) {
    req.log.error({ status: tokenRes.status }, "Strava token exchange failed");
    res.send(closeHtml("ERRO NA AUTENTICAÇÃO", false));
    return;
  }

  const tokenData = await tokenRes.json() as {
    access_token: string; refresh_token: string; expires_at: number;
    athlete: { id: number }; scope: string;
  };

  await db
    .insert(stravaTokensTable)
    .values({
      athleteId:       athlete.id,
      stravaAthleteId: tokenData.athlete.id,
      accessToken:     tokenData.access_token,
      refreshToken:    tokenData.refresh_token,
      expiresAt:       new Date(tokenData.expires_at * 1000),
      scope:           tokenData.scope,
    })
    .onConflictDoUpdate({
      target: stravaTokensTable.athleteId,
      set: {
        stravaAthleteId: tokenData.athlete.id,
        accessToken:     tokenData.access_token,
        refreshToken:    tokenData.refresh_token,
        expiresAt:       new Date(tokenData.expires_at * 1000),
        scope:           tokenData.scope,
      },
    });

  res.send(closeHtml("STRAVA CONECTADO!", true));
});

// ─── Legacy session-based routes ──────────────────────────────────────────────

router.get("/strava/status", async (req: Request, res: Response) => {
  const { token } = req.query as { token?: string };
  if (!token) { res.status(400).json({ error: "token obrigatório" }); return; }
  const athlete = await getAthleteFromToken(token);
  if (!athlete) { res.status(401).json({ error: "Sessão inválida" }); return; }

  const rows = await db.select().from(stravaTokensTable).where(eq(stravaTokensTable.athleteId, athlete.id)).limit(1);
  if (!rows[0]) { res.json({ connected: false }); return; }
  res.json({ connected: true, lastSyncAt: rows[0].lastSyncAt?.toISOString() ?? null, stravaAthleteId: rows[0].stravaAthleteId });
});

router.post("/strava/sync", async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token) { res.status(400).json({ error: "token obrigatório" }); return; }
  const athlete = await getAthleteFromToken(token);
  if (!athlete) { res.status(401).json({ error: "Sessão inválida" }); return; }

  const rows = await db.select().from(stravaTokensTable).where(eq(stravaTokensTable.athleteId, athlete.id)).limit(1);
  if (!rows[0]) { res.status(404).json({ error: "Strava não conectado" }); return; }

  const stored   = await refreshStravaToken(rows[0]);
  const imported = await syncActivitiesForAthlete(athlete.id, athlete.targetRaceDate, stored.accessToken);
  await db.update(stravaTokensTable).set({ lastSyncAt: new Date() }).where(eq(stravaTokensTable.athleteId, athlete.id));
  const pending = await db.execute(sql`
    SELECT id, entry_date, distance_km, duration_min
    FROM procoach_workout_entries
    WHERE athlete_id = ${athlete.id}
      AND source = 'strava'
      AND type = 'corrida'
      AND shoe_id IS NULL
    ORDER BY entry_date DESC
    LIMIT 20
  `) as { rows: Array<Record<string, unknown>> };
  res.json({ imported, total: imported, pendingShoe: pending.rows });
});

router.post("/strava/disconnect", async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token) { res.status(400).json({ error: "token obrigatório" }); return; }
  const athlete = await getAthleteFromToken(token);
  if (!athlete) { res.status(401).json({ error: "Sessão inválida" }); return; }
  await db.delete(stravaTokensTable).where(eq(stravaTokensTable.athleteId, athlete.id));
  res.json({ disconnected: true });
});

export default router;
