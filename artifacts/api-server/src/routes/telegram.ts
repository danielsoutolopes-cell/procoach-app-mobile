import { Router, type IRouter, type Request, type Response } from "express";
import { eq, desc, sql } from "@workspace/db";
import { db } from "@workspace/db";
import { athletesTable, workoutEntriesTable, weeklyStatsTable } from "@workspace/db/schema";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router: IRouter = Router();

// ─── In-memory session state (single-user bot) ───────────────────────────────
interface BotSession {
  state:
    | "idle"
    | "waiting_rpe"
    | "waiting_pain"
    | "waiting_bio_weight"
    | "waiting_bio_fat"
    | "waiting_telemetry_json";
  largadaAt?: Date;
  rpe?: number;
  sessionDistanceKm?: number;
}
const SESSION: BotSession = { state: "idle" };

// ─── São Paulo / Rua Maracá coords ───────────────────────────────────────────
const HOME_LAT = -23.6087;
const HOME_LON = -46.6676;

// ─── 16-week phase matrix ─────────────────────────────────────────────────────
const PHASES = [
  { name: "Base",       weeks: [1, 2, 3, 4],   paceTarget: "6:30 min/km", kmTarget: 30 },
  { name: "Construção", weeks: [5, 6, 7, 8],   paceTarget: "6:00 min/km", kmTarget: 40 },
  { name: "Pico",       weeks: [9, 10, 11, 12], paceTarget: "5:30 min/km", kmTarget: 50 },
  { name: "Polimento",  weeks: [13, 14, 15, 16], paceTarget: "5:45 min/km", kmTarget: 25 },
];

function getPhase(week: number) {
  return PHASES.find(p => p.weeks.includes(week)) ?? PHASES[0];
}

// ─── Utilities ────────────────────────────────────────────────────────────────
function roundKm(val: number): number {
  return Math.round(val);
}

function fmtDuration(ms: number): string {
  const totalMin = Math.floor(ms / 60000);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return h > 0 ? `${h}h${m.toString().padStart(2, "0")}min` : `${m}min`;
}

function getSaoPauloDayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

function normalizeEntryDate(raw: string): string {
  if (typeof raw !== "string") return getSaoPauloDayKey();
  const t = raw.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(t)) return t;
  const parsed = new Date(t);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return getSaoPauloDayKey();
}

function asNumberOrNull(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = typeof val === "number" ? val : Number(String(val).replace(",", ".").trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

async function sendTelegram(chatId: string | number, text: string, replyMarkup?: object): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    parse_mode: "Markdown",
    disable_web_page_preview: true,
  };
  if (replyMarkup) body.reply_markup = replyMarkup;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function answerCallback(callbackQueryId: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  await fetch(`https://api.telegram.org/bot${token}/answerCallbackQuery`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ callback_query_id: callbackQueryId }),
  });
}

async function sendPhoto(chatId: string | number, imageUrl: string, caption: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) return;
  // Fetch image bytes from the chart URL
  const imgRes = await fetch(imageUrl);
  if (!imgRes.ok) {
    await sendTelegram(chatId, caption + "\n\n⚠️ Gráfico temporariamente indisponível.");
    return;
  }
  const imgBuffer = Buffer.from(await imgRes.arrayBuffer());

  // Build multipart/form-data manually
  const boundary = "----ProCoachBoundary" + Date.now();
  const fieldParts = [
    `--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${caption}`,
    `--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nMarkdown`,
    `--${boundary}\r\nContent-Disposition: form-data; name="photo"; filename="historico.png"\r\nContent-Type: image/png\r\n\r\n`,
  ];
  const closing = `\r\n--${boundary}--\r\n`;

  const fieldBuffer = Buffer.from(fieldParts.join("\r\n") + "\r\n");
  const closingBuffer = Buffer.from(closing);
  const body = Buffer.concat([fieldBuffer, imgBuffer, closingBuffer]);

  await fetch(`https://api.telegram.org/bot${token}/sendPhoto`, {
    method: "POST",
    headers: {
      "Content-Type": `multipart/form-data; boundary=${boundary}`,
      "Content-Length": String(body.length),
    },
    body,
  });
}

// ─── Weather via Open-Meteo (free, no auth) ───────────────────────────────────
async function getWeather(): Promise<string> {
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${HOME_LAT}&longitude=${HOME_LON}&current=temperature_2m,weathercode,windspeed_10m,precipitation&timezone=America%2FSao_Paulo`;
    const r = await fetch(url);
    if (!r.ok) return "🌡️ Clima indisponível";
    const data = await r.json() as {
      current: { temperature_2m: number; weathercode: number; windspeed_10m: number; precipitation: number };
    };
    const { temperature_2m, weathercode, windspeed_10m, precipitation } = data.current;
    const emoji = weathercode === 0 ? "☀️" : weathercode <= 3 ? "⛅" : weathercode <= 67 ? "🌧️" : "⛈️";
    const chuva = precipitation > 0 ? ` | 💧 ${precipitation}mm` : "";
    return `${emoji} *${Math.round(temperature_2m)}°C* | 💨 ${Math.round(windspeed_10m)}km/h${chuva}`;
  } catch {
    return "🌡️ Clima indisponível";
  }
}

// ─── Get first/primary athlete from DB ───────────────────────────────────────
async function getPrimaryAthlete() {
  const rows = await db.select().from(athletesTable).orderBy(desc(athletesTable.updatedAt)).limit(1);
  return rows[0] ?? null;
}

let biometricsTableReady = false;
async function ensureBiometricsTable(): Promise<void> {
  if (biometricsTableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS procoach_biometrics (
      id SERIAL PRIMARY KEY,
      athlete_id INTEGER NOT NULL REFERENCES procoach_athletes(id) ON DELETE CASCADE,
      weight_kg NUMERIC(6,2),
      body_fat_pct NUMERIC(5,2),
      recorded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  biometricsTableReady = true;
}

let bioimpedanceTableReady = false;
async function ensureBioimpedanceTable(): Promise<void> {
  if (bioimpedanceTableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS procoach_bioimpedance (
      athlete_id INTEGER NOT NULL REFERENCES procoach_athletes(id) ON DELETE CASCADE,
      entry_date VARCHAR(32) NOT NULL,
      weight_kg NUMERIC(6,2),
      body_fat_pct NUMERIC(5,2),
      muscle_mass_kg NUMERIC(6,2),
      body_water_pct NUMERIC(5,2),
      visceral_fat NUMERIC(5,2),
      metabolic_age INTEGER,
      tmb_kcal INTEGER,
      protein_pct NUMERIC(5,2),
      bone_mass_kg NUMERIC(5,2),
      health_notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (athlete_id, entry_date)
    )
  `);
  await db.execute(sql`ALTER TABLE IF EXISTS procoach_bioimpedance ADD COLUMN IF NOT EXISTS health_notes TEXT`);
  bioimpedanceTableReady = true;
}

let planTableReady = false;
async function ensurePlanTable(): Promise<void> {
  if (planTableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS procoach_plan_sessions (
      athlete_id INTEGER NOT NULL REFERENCES procoach_athletes(id) ON DELETE CASCADE,
      session_date VARCHAR(32) NOT NULL,
      day_name VARCHAR(32),
      activity VARCHAR(120) NOT NULL,
      pace_target VARCHAR(32),
      treadmill_speed VARCHAR(32),
      rest_interval VARCHAR(32),
      structure TEXT,
      planned_km INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (athlete_id, session_date)
    )
  `);
  await db.execute(sql`ALTER TABLE IF EXISTS procoach_plan_sessions ADD COLUMN IF NOT EXISTS planned_km INTEGER NOT NULL DEFAULT 0`);
  planTableReady = true;
}

// ─── Gemini AI intent classification ────────────────────────────────────────────
async function classifyIntent(text: string): Promise<string> {
  const key = (process.env.GEMINI_API_KEY || "").replace(/^['"`]+|['"`]+$/g, "").trim();
  if (!key) return "UNKNOWN";

  try {
    const genAI = new GoogleGenerativeAI(key);
    const modelName = (process.env.GEMINI_MODEL || "gemini-pro").replace(/^['"`]+|['"`]+$/g, "").trim();
    const model = genAI.getGenerativeModel({ model: modelName });
    const prompt = `Classifica a mensagem do utilizador em UMA dessas categorias: MENU | CONSULTA | FIM | LARGADA | CHEGADA | BIOMETRIA | TELEMETRIA | PLANOHOJE | COMPLIANCE | UNKNOWN. Responde APENAS com a categoria em maiúsculas, sem explicação.\n\nMensagem do usuário: "${text}"`;
    const result = await model.generateContent(prompt);
    return result.response.text().trim().toUpperCase();
  } catch (err) {
    console.error("Erro ao classificar intent no Gemini:", err);
    return "UNKNOWN";
  }
}

// ─── Radar Articular check ─────────────────────────────────────────────────────
function radarArticular(rpe: number, pain: number, distKm: number): string | null {
  const disproportionate = rpe >= 9 || (rpe >= 8 && distKm <= 5);
  if (pain > 4 || (pain > 2 && disproportionate)) {
    return `🚨 *RADAR ARTICULAR — MODO PROTEÇÃO ATIVADO*\n\n` +
      `Dor: ${pain}/5 | RPE: ${rpe}/10\n\n` +
      `O sistema detetou sobrecarga. O próximo treino de impacto foi substituído por:\n\n` +
      `🚴 *Bike Indolor* ou 😴 *Descanso Total*\n\n` +
      `_Diretriz de Longevidade: recuperação > performance._`;
  }
  if (pain > 2 || disproportionate) {
    return `⚠️ *RADAR ARTICULAR — ATENÇÃO*\n\n` +
      `Dor: ${pain}/5 | RPE: ${rpe}/10\n\n` +
      `Amanhã: 🔄 *Regenerativo* em vez de treino de impacto.\n` +
      `_Monitora a evolução. Prevenção é longevidade._`;
  }
  return null;
}

// ─── Historico — 7-day km chart via QuickChart.io ────────────────────────────
async function handleHistorico(chatId: string | number) {
  const athlete = await getPrimaryAthlete();
  if (!athlete) {
    await sendTelegram(chatId, "⚠️ Nenhum atleta no sistema. Abre o app ProCoach primeiro.");
    return;
  }

  // Build last-7-days date array in São Paulo timezone
  const today = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const days: { date: string; label: string }[] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const isoDate = d.toISOString().slice(0, 10);
    const label = d.toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", timeZone: "America/Sao_Paulo" });
    days.push({ date: isoDate, label });
  }

  // Query DB for completed km per day in the last 7 days
  const rows = await db.execute(
    sql`SELECT entry_date, SUM(distance_km) AS total_km
        FROM procoach_workout_entries
        WHERE athlete_id = ${athlete.id}
          AND entry_date >= ${days[0].date}
          AND entry_date <= ${days[6].date}
        GROUP BY entry_date`
  ) as { rows: Array<{ entry_date: string; total_km: string }> };

  const kmByDate = new Map<string, number>();
  for (const row of rows.rows) {
    kmByDate.set(row.entry_date, Math.round(Number(row.total_km)));
  }

  const labels = days.map(d => d.label.replace(".", ""));
  const data = days.map(d => kmByDate.get(d.date) ?? 0);
  const totalKm = data.reduce((a, b) => a + b, 0);

  // Get weekly phase target
  const phase = getPhase(athlete.currentWeek);
  const target = phase.kmTarget;

  // Build Chart.js config for QuickChart.io
  const chartConfig = {
    type: "bar",
    data: {
      labels,
      datasets: [
        {
          label: "km",
          data,
          backgroundColor: data.map(v =>
            v === 0 ? "rgba(80,80,80,0.5)" : v >= Math.round(target / 5) ? "#FF5F00" : "#FF5F0099"
          ),
          borderColor: "#FF5F00",
          borderWidth: 1,
          borderRadius: 6,
        },
      ],
    },
    options: {
      plugins: {
        legend: { display: false },
        title: {
          display: true,
          text: `ProCoach OS — Últimos 7 Dias | ${totalKm}km / ${target}km alvo`,
          color: "#FFFFFF",
          font: { size: 14, weight: "bold" },
        },
      },
      scales: {
        x: { ticks: { color: "#CCCCCC" }, grid: { color: "#333333" } },
        y: {
          ticks: { color: "#CCCCCC", stepSize: 5 },
          grid: { color: "#333333" },
          min: 0,
          suggestedMax: Math.max(target / 5 + 2, Math.max(...data) + 3),
        },
      },
      layout: { padding: 10 },
    },
  };

  const encoded = encodeURIComponent(JSON.stringify(chartConfig));
  const chartUrl = `https://quickchart.io/chart?c=${encoded}&width=700&height=380&backgroundColor=%230A0A0A&version=4`;

  // Build text summary alongside the chart
  const progressBar = buildProgressBar(totalKm, target);
  const phase_ = getPhase(athlete.currentWeek);
  const caption =
    `📊 *HISTÓRICO — ÚLTIMOS 7 DIAS*\n\n` +
    `Fase: *${phase_.name}* | Semana *${athlete.currentWeek}*/16\n` +
    `Volume: *${totalKm}km* de *${target}km* alvo\n` +
    `${progressBar} *${Math.round((totalKm / target) * 100)}%*\n\n` +
    days.map(d => {
      const km = kmByDate.get(d.date) ?? 0;
      const bar = km > 0 ? "▓".repeat(Math.min(km, 10)) + ` ${km}km` : "— descanso";
      return `${d.label.replace(".", "")}: ${bar}`;
    }).join("\n");

  await sendPhoto(chatId, chartUrl, caption);
}

// ─── Interactive menu ─────────────────────────────────────────────────────────
async function sendMenu(chatId: string | number, intro: string) {
  const keyboard = {
    inline_keyboard: [
      [
        { text: "🚀 LARGADA", callback_data: "cmd_largada" },
        { text: "🏁 CHEGADA", callback_data: "cmd_chegada" },
      ],
      [
        { text: "📋 Plano de Hoje", callback_data: "cmd_plano_hoje" },
        { text: "📅 /plano", callback_data: "cmd_plano" },
      ],
      [
        { text: "📈 Compliance", callback_data: "cmd_compliance" },
        { text: "⚖️ Biometria", callback_data: "cmd_bio" },
      ],
      [
        { text: "🎯 Treino de Hoje", callback_data: "cmd_missao" },
        { text: "🌤️ Clima", callback_data: "cmd_clima" },
      ],
      [
        { text: "📊 Histórico 7 dias", callback_data: "cmd_historico" },
      ],
      [
        { text: "🚀 Nova Telemetria", callback_data: "cmd_telemetria" },
      ],
    ],
  };
  await sendTelegram(chatId, intro, keyboard);
}

// ─── RPE keyboard ────────────────────────────────────────────────────────────
function rpeKeyboard() {
  return {
    inline_keyboard: [
      [1, 2, 3, 4, 5].map(n => ({ text: `${n}`, callback_data: `rpe_${n}` })),
      [6, 7, 8, 9, 10].map(n => ({ text: `${n}`, callback_data: `rpe_${n}` })),
    ],
  };
}

// ─── Pain keyboard ───────────────────────────────────────────────────────────
function painKeyboard() {
  return {
    inline_keyboard: [
      [0, 1, 2, 3, 4, 5].map(n => ({ text: `${n}`, callback_data: `pain_${n}` })),
    ],
  };
}

// ─── Handlers ────────────────────────────────────────────────────────────────
async function handleLargada(chatId: string | number) {
  SESSION.state = "idle";
  SESSION.largadaAt = new Date();

  const [weather, athlete] = await Promise.all([getWeather(), getPrimaryAthlete()]);

  let paceMsg = "Pace alvo: consulte seu plano";
  let workoutMsg = "";
  if (athlete) {
    const phase = getPhase(athlete.currentWeek);
    paceMsg = `🎯 Pace alvo: *${phase.paceTarget}*`;

    const today = getSaoPauloDayKey();
    const todayWorkouts = await db
      .select()
      .from(workoutEntriesTable)
      .where(
        sql`${workoutEntriesTable.athleteId} = ${athlete.id} AND ${workoutEntriesTable.entryDate} = ${today}`
      )
      .limit(3);

    if (todayWorkouts.length > 0) {
      const w = todayWorkouts[0];
      workoutMsg = `\n🏃 *Sessão:* ${w.type.toUpperCase()} — *${roundKm(w.distanceKm)}km*`;
    }
  }

  const now = SESSION.largadaAt.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });

  await sendTelegram(chatId,
    `🚀 *LARGADA REGISTADA* — ${now}\n\n` +
    `${weather}\n` +
    `${workoutMsg}\n\n` +
    `${paceMsg}\n\n` +
    `_Foco total. Respira. Execute o plano._\n\n` +
    `Ao terminar, pressiona *🏁 CHEGADA*.`
  );
}

async function handleChegada(chatId: string | number) {
  if (!SESSION.largadaAt) {
    await sendTelegram(chatId, "⚠️ Nenhuma largada registada. Pressiona *🚀 LARGADA* primeiro.");
    return;
  }
  const duration = fmtDuration(Date.now() - SESSION.largadaAt.getTime());
  SESSION.state = "waiting_rpe";
  await sendTelegram(chatId,
    `🏁 *CHEGADA!* Duração: *${duration}*\n\n` +
    `Qual foi o teu *RPE* (Percepção de Esforço)?\n` +
    `_1 = Muito fácil · 10 = Máximo absoluto_`,
    rpeKeyboard()
  );
}

async function handleRpeSelected(chatId: string | number, rpe: number) {
  SESSION.rpe = rpe;
  SESSION.state = "waiting_pain";
  const emoji = rpe <= 3 ? "😊" : rpe <= 6 ? "😤" : rpe <= 8 ? "😰" : "🔥";
  await sendTelegram(chatId,
    `${emoji} RPE *${rpe}/10* registado.\n\n` +
    `Agora: *Dor articular?*\n` +
    `_0 = Sem dor · 5 = Dor intensa_`,
    painKeyboard()
  );
}

async function handlePainSelected(chatId: string | number, pain: number) {
  SESSION.state = "idle";
  const rpe = SESSION.rpe ?? 5;
  const distKm = SESSION.sessionDistanceKm ?? 0;

  const athlete = await getPrimaryAthlete();
  if (athlete) {
    const today = getSaoPauloDayKey();
    const week = athlete.currentWeek;

    const existing = await db
      .select()
      .from(workoutEntriesTable)
      .where(sql`${workoutEntriesTable.athleteId} = ${athlete.id} AND ${workoutEntriesTable.entryDate} = ${today}`)
      .limit(1);

    if (existing.length === 0) {
      // Save workout entry
      await db.insert(workoutEntriesTable).values({
        athleteId: athlete.id,
        entryDate: today,
        distanceKm: roundKm(distKm > 0 ? distKm : 8),
        type: "corrida",
        durationMin: SESSION.largadaAt ? Math.round((Date.now() - SESSION.largadaAt.getTime()) / 60000) : 0,
        week,
        injuryAlert: pain > 2 ? `Dor: ${pain}/5 RPE: ${rpe}/10` : null,
      });
    }

    // Update weekly stats
    const existingWeek = await db
      .select()
      .from(weeklyStatsTable)
      .where(sql`${weeklyStatsTable.athleteId} = ${athlete.id} AND ${weeklyStatsTable.week} = ${week}`)
      .limit(1);

    const addKm = roundKm(distKm > 0 ? distKm : 8);
    if (existingWeek.length > 0) {
      await db.update(weeklyStatsTable)
        .set({
          completedKm: existingWeek[0].completedKm + addKm,
          sessionsCount: existingWeek[0].sessionsCount + 1,
          updatedAt: new Date(),
        })
        .where(eq(weeklyStatsTable.id, existingWeek[0].id));
    } else {
      await db.insert(weeklyStatsTable).values({
        athleteId: athlete.id,
        week,
        completedKm: addKm,
        sessionsCount: 1,
      });
    }

    // Update athlete HRV / pain
    await db.update(athletesTable)
      .set({ painLevel: pain, updatedAt: new Date() })
      .where(eq(athletesTable.id, athlete.id));
  }

  // Build summary
  const phase = athlete ? getPhase(athlete.currentWeek) : PHASES[0];
  let summary = `✅ *Sessão concluída!*\n\n` +
    `⚡ RPE: *${rpe}/10*\n` +
    `🦵 Dor articular: *${pain}/5*\n` +
    `📊 Fase: *${phase.name}* (Semana ${athlete?.currentWeek ?? "—"})\n\n`;

  const radarMsg = radarArticular(rpe, pain, distKm);
  if (radarMsg) {
    await sendTelegram(chatId, summary + "_Dados guardados._");
    await sendTelegram(chatId, radarMsg);
  } else {
    summary += `🎯 Recuperação: hidrata, alimenta e descansa.\n_Ótimo trabalho, CEO!_ 💪`;
    await sendTelegram(chatId, summary);
  }

  SESSION.largadaAt = undefined;
  SESSION.rpe = undefined;
  SESSION.sessionDistanceKm = undefined;
}

async function handlePlano(chatId: string | number) {
  const athlete = await getPrimaryAthlete();
  if (!athlete) {
    await sendTelegram(chatId, "⚠️ Nenhum atleta encontrado. Abre o app ProCoach para sincronizar.");
    return;
  }
  const week = athlete.currentWeek;
  const phase = getPhase(week);
  const raceDate = athlete.targetRaceDate ? new Date(athlete.targetRaceDate) : null;
  const weeksLeft = raceDate ? Math.max(0, Math.ceil((raceDate.getTime() - Date.now()) / (7 * 24 * 60 * 60 * 1000))) : null;

  const weekStats = await db
    .select()
    .from(weeklyStatsTable)
    .where(sql`${weeklyStatsTable.athleteId} = ${athlete.id} AND ${weeklyStatsTable.week} = ${week}`)
    .limit(1);

  const doneKm = weekStats[0]?.completedKm ?? 0;
  const targetKm = phase.kmTarget;
  const progressBar = buildProgressBar(doneKm, targetKm);

  const msg =
    `📅 *PLANO — PROCOACH OS*\n\n` +
    `🏆 *Prova:* ${athlete.targetRaceName}\n` +
    `📏 *Distância:* ${athlete.targetRaceDistanceKm}km\n` +
    (weeksLeft !== null ? `⏳ *Semanas restantes:* ${weeksLeft}\n` : "") +
    `\n` +
    `📆 *Semana:* ${week}/16\n` +
    `🔥 *Fase:* ${phase.name.toUpperCase()}\n` +
    `🎯 *Pace alvo:* ${phase.paceTarget}\n` +
    `📊 *Volume alvo:* ${targetKm}km\n\n` +
    `*Progresso semanal:*\n` +
    `${progressBar} *${doneKm}/${targetKm}km*\n\n` +
    `❤️ *HRV:* ${athlete.hrv} bpm | 🦵 *Dor:* ${athlete.painLevel}/5`;

  await sendTelegram(chatId, msg);
}

function getSaoPauloWeekStartKey(): string {
  const nowSp = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const day = nowSp.getDay();
  const daysSinceMonday = (day + 6) % 7;
  const start = new Date(nowSp);
  start.setDate(nowSp.getDate() - daysSinceMonday);
  return start.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

async function handlePlanoHoje(chatId: string | number) {
  const athlete = await getPrimaryAthlete();
  if (!athlete) {
    await sendTelegram(chatId, "⚠️ Nenhum atleta encontrado. Abre o app ProCoach para sincronizar.");
    return;
  }
  await ensurePlanTable();
  const today = getSaoPauloDayKey();
  const rows = await db.execute(sql`
    SELECT session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km
    FROM procoach_plan_sessions
    WHERE athlete_id = ${athlete.id} AND session_date = ${today}
    LIMIT 1
  `) as { rows: Array<{
    session_date: string;
    day_name: string | null;
    activity: string;
    pace_target: string | null;
    treadmill_speed: string | null;
    rest_interval: string | null;
    structure: string | null;
    planned_km: number | string;
  }> };

  const s = rows.rows[0];
  if (!s) {
    await sendTelegram(chatId, `📋 *PLANO DE HOJE*\n\nHoje: *${today}*\n\nNenhum treino importado para hoje.`);
    return;
  }

  const msg =
    `📋 *PLANO DE HOJE*\n\n` +
    `📆 Data: *${s.session_date}*\n` +
    `🏃 Atividade: *${s.activity}*${Number(s.planned_km) > 0 ? ` · *${Number(s.planned_km)}km*` : ""}\n` +
    (s.pace_target ? `🎯 Pace: *${s.pace_target}*\n` : "") +
    (s.rest_interval ? `⏱️ Repouso: *${s.rest_interval}*\n` : "") +
    (s.treadmill_speed ? `🏃‍♂️ Esteira: *${s.treadmill_speed}*\n` : "") +
    (s.structure ? `\n🧩 *Estrutura:*\n${s.structure}\n` : "");

  await sendTelegram(chatId, msg);
}

async function handleCompliance(chatId: string | number) {
  const athlete = await getPrimaryAthlete();
  if (!athlete) {
    await sendTelegram(chatId, "⚠️ Nenhum atleta encontrado. Abre o app ProCoach para sincronizar.");
    return;
  }
  await ensurePlanTable();
  const from = getSaoPauloWeekStartKey();
  const to = getSaoPauloDayKey();

  const planned = await db.execute(sql`
    SELECT COUNT(*)::int AS planned_sessions, COALESCE(SUM(planned_km), 0)::int AS planned_km
    FROM procoach_plan_sessions
    WHERE athlete_id = ${athlete.id}
      AND session_date >= ${from}
      AND session_date <= ${to}
  `) as { rows: Array<{ planned_sessions: number; planned_km: number }> };

  const completed = await db.execute(sql`
    SELECT COUNT(*)::int AS completed_sessions, COALESCE(SUM(distance_km), 0)::int AS completed_km
    FROM procoach_workout_entries
    WHERE athlete_id = ${athlete.id}
      AND entry_date >= ${from}
      AND entry_date <= ${to}
  `) as { rows: Array<{ completed_sessions: number; completed_km: number }> };

  const ps = planned.rows[0]?.planned_sessions ?? 0;
  const pk = planned.rows[0]?.planned_km ?? 0;
  const cs = completed.rows[0]?.completed_sessions ?? 0;
  const ck = completed.rows[0]?.completed_km ?? 0;

  const sessPct = ps > 0 ? Math.round((cs / ps) * 100) : 0;
  const kmPct = pk > 0 ? Math.round((ck / pk) * 100) : 0;

  await sendTelegram(
    chatId,
    `📈 *COMPLIANCE DA SEMANA*\n\n` +
      `🗓️ ${from} → ${to}\n\n` +
      `📌 Sessões: *${cs}/${ps}*${ps > 0 ? ` (*${sessPct}%*)` : ""}\n` +
      `📏 Km: *${ck}km/${pk}km*${pk > 0 ? ` (*${kmPct}%*)` : ""}\n\n` +
      `_Consistência vence. Ajuste fino amanhã._`
  );
}

async function handleTelemetriaPrompt(chatId: string | number) {
  SESSION.state = "waiting_telemetry_json";
  await sendTelegram(
    chatId,
    `🚀 *NOVA TELEMETRIA — BIOIMPEDÂNCIA*\n\n` +
      `Envia o JSON completo (pode colar aqui).\n\n` +
      `Exemplo (cola igual):\n` +
      `{ "date": "2026-05-08", "weight": 75, "body_fat": 24.3, "muscle_mass": 54.1, "body_water": 54.1, "visceral_fat": 13.5, "metabolic_age": 43, "tmb": 1557, "protein": 17.6, "bone_mass": 3.09, "health_notes": "" }`
  );
}

async function handleTelemetriaJson(chatId: string | number, payload: Record<string, unknown>) {
  await ensureBioimpedanceTable();
  const athlete = await getPrimaryAthlete();
  if (!athlete) {
    await sendTelegram(chatId, "⚠️ Nenhum atleta encontrado. Abre o app ProCoach para sincronizar.");
    return;
  }

  const entryDate = normalizeEntryDate(String(payload.date ?? payload.entry_date ?? payload.entryDate ?? ""));
  const weightKg = asNumberOrNull(payload.weight ?? payload.weight_kg ?? payload.weightKg);
  const bodyFatPct = asNumberOrNull(payload.body_fat ?? payload.body_fat_pct ?? payload.bodyFat ?? payload.bodyFatPct);
  const muscleMassKg = asNumberOrNull(payload.muscle_mass ?? payload.muscle_mass_kg ?? payload.muscleMass ?? payload.muscleMassKg);
  const bodyWaterPct = asNumberOrNull(payload.body_water ?? payload.body_water_pct ?? payload.bodyWater ?? payload.bodyWaterPct);
  const visceralFat = asNumberOrNull(payload.visceral_fat ?? payload.visceralFat);
  const metabolicAgeRaw = asNumberOrNull(payload.metabolic_age ?? payload.metabolicAge);
  const tmbRaw = asNumberOrNull(payload.tmb ?? payload.tmb_kcal ?? payload.tmbKcal);
  const proteinPct = asNumberOrNull(payload.protein ?? payload.protein_pct ?? payload.proteinPct);
  const boneMassKg = asNumberOrNull(payload.bone_mass ?? payload.bone_mass_kg ?? payload.boneMass ?? payload.boneMassKg);
  const healthNotes = typeof payload.health_notes === "string" ? payload.health_notes : typeof payload.healthNotes === "string" ? payload.healthNotes : "";

  if (!entryDate) {
    await sendTelegram(chatId, "❌ JSON inválido: faltou `date` (ex.: 2026-05-08).");
    return;
  }
  if (weightKg !== null && (weightKg < 30 || weightKg > 250)) { await sendTelegram(chatId, "❌ Peso fora do intervalo."); return; }
  if (bodyFatPct !== null && (bodyFatPct < 0 || bodyFatPct > 70)) { await sendTelegram(chatId, "❌ Gordura fora do intervalo."); return; }

  const metabolicAge = metabolicAgeRaw === null ? null : Math.max(0, Math.round(metabolicAgeRaw));
  const tmbKcal = tmbRaw === null ? null : Math.max(0, Math.round(tmbRaw));

  await db.execute(sql`
    INSERT INTO procoach_bioimpedance
      (athlete_id, entry_date, weight_kg, body_fat_pct, muscle_mass_kg, body_water_pct, visceral_fat, metabolic_age, tmb_kcal, protein_pct, bone_mass_kg, health_notes, created_at, updated_at)
    VALUES
      (${athlete.id}, ${entryDate}, ${weightKg}, ${bodyFatPct}, ${muscleMassKg}, ${bodyWaterPct}, ${visceralFat}, ${metabolicAge}, ${tmbKcal}, ${proteinPct}, ${boneMassKg}, ${healthNotes}, NOW(), NOW())
    ON CONFLICT (athlete_id, entry_date)
    DO UPDATE SET
      weight_kg = EXCLUDED.weight_kg,
      body_fat_pct = EXCLUDED.body_fat_pct,
      muscle_mass_kg = EXCLUDED.muscle_mass_kg,
      body_water_pct = EXCLUDED.body_water_pct,
      visceral_fat = EXCLUDED.visceral_fat,
      metabolic_age = EXCLUDED.metabolic_age,
      tmb_kcal = EXCLUDED.tmb_kcal,
      protein_pct = EXCLUDED.protein_pct,
      bone_mass_kg = EXCLUDED.bone_mass_kg,
      health_notes = EXCLUDED.health_notes,
      updated_at = NOW()
  `);

  SESSION.state = "idle";
  await sendTelegram(
    chatId,
    `✅ *Telemetria salva no Neon*\n\n` +
      `📆 Data: *${entryDate}*\n` +
      `🏋️ Peso: *${weightKg ?? "—"}kg*\n` +
      `🔥 Gordura: *${bodyFatPct ?? "—"}%*\n` +
      (muscleMassKg !== null ? `💪 Músculo: *${muscleMassKg}kg*\n` : "") +
      (bodyWaterPct !== null ? `💧 Água: *${bodyWaterPct}%*\n` : "") +
      (visceralFat !== null ? `🧠 Visceral: *${visceralFat}*\n` : "") +
      (metabolicAge !== null ? `⏳ Idade metab.: *${metabolicAge}*\n` : "") +
      (tmbKcal !== null ? `🔥 TMB: *${tmbKcal} kcal*\n` : "")
  );
}

function buildProgressBar(done: number, total: number): string {
  const pct = total > 0 ? Math.min(1, done / total) : 0;
  const filled = Math.round(pct * 10);
  return "█".repeat(filled) + "░".repeat(10 - filled);
}

async function handleBioPrompt(chatId: string | number) {
  SESSION.state = "waiting_bio_weight";
  await sendTelegram(chatId,
    `⚖️ *Lançamento Biométrico*\n\n` +
    `Envia o teu *peso* em kg (ex: \`75.5\`):`
  );
}

async function handleBioWeight(chatId: string | number, text: string) {
  const weight = parseFloat(text.replace(",", "."));
  if (isNaN(weight) || weight < 30 || weight > 200) {
    await sendTelegram(chatId, "❌ Valor inválido. Envia o peso em kg (ex: `75.5`):");
    return;
  }
  SESSION.state = "waiting_bio_fat";
  // Store temporarily in session
  (SESSION as BotSession & { tempWeight?: number }).tempWeight = weight;
  await sendTelegram(chatId, `✅ Peso: *${weight}kg*\n\nAgora envia o *% de gordura corporal* (ex: \`18.5\`):`);
}

async function handleBioFat(chatId: string | number, text: string) {
  const fat = parseFloat(text.replace(",", "."));
  if (isNaN(fat) || fat < 3 || fat > 60) {
    await sendTelegram(chatId, "❌ Valor inválido. Envia o % de gordura (ex: `18.5`):");
    return;
  }

  const s = SESSION as BotSession & { tempWeight?: number };
  const weight = s.tempWeight ?? 0;
  SESSION.state = "idle";
  s.tempWeight = undefined;

  const athlete = await getPrimaryAthlete();
  if (!athlete) {
    await sendTelegram(chatId, "⚠️ Nenhum atleta encontrado. Sincroniza o app primeiro.");
    return;
  }

  await ensureBiometricsTable();
  await db.execute(
    sql`INSERT INTO procoach_biometrics (athlete_id, weight_kg, body_fat_pct, recorded_at)
        VALUES (${athlete.id}, ${weight}, ${fat}, NOW())`
  );

  const leanMass = Math.round(weight * (1 - fat / 100) * 10) / 10;
  const fatMass = Math.round(weight * (fat / 100) * 10) / 10;

  await sendTelegram(chatId,
    `⚖️ *Biometria Registada!*\n\n` +
    `🏋️ Peso: *${weight}kg*\n` +
    `🔥 Gordura: *${fat}%* (${fatMass}kg)\n` +
    `💪 Massa Magra: *${leanMass}kg*\n\n` +
    `_Dados enviados ao Neon. Mantém a consistência!_`
  );
}

async function handleMissao(chatId: string | number) {
  const athlete = await getPrimaryAthlete();
  if (!athlete) {
    await sendTelegram(chatId, "⚠️ Nenhum atleta no sistema.");
    return;
  }
  const today = getSaoPauloDayKey();
  const workouts = await db
    .select()
    .from(workoutEntriesTable)
    .where(sql`${workoutEntriesTable.athleteId} = ${athlete.id} AND ${workoutEntriesTable.entryDate} = ${today}`)
    .limit(5);

  if (workouts.length === 0) {
    const phase = getPhase(athlete.currentWeek);
    await sendTelegram(chatId,
      `🎯 *Missão de Hoje*\n\nFase *${phase.name}* — Semana ${athlete.currentWeek}\n` +
      `🏃 Treino sugerido: *${roundKm(phase.kmTarget / 5)}km* a ${phase.paceTarget}\n\n` +
      `_Abre o app para ver a matriz completa._`
    );
  } else {
    let msg = `🎯 *Missões de Hoje:*\n`;
    for (const w of workouts) {
      msg += `\n🔹 *${w.type.toUpperCase()}* — *${roundKm(w.distanceKm)}km*\n`;
    }
    await sendTelegram(chatId, msg);
  }
}

// ─── Webhook endpoint ─────────────────────────────────────────────────────────
router.post("/telegram/webhook", async (req: Request, res: Response) => {
  res.json({ ok: true }); // Respond immediately to Telegram

  try {
    const data = req.body as Record<string, unknown>;
    const chatId = process.env.TELEGRAM_CHAT_ID ?? "";

    // ── Callback query (inline keyboard button press) ──────────────────────
    if (data.callback_query) {
      const cb = data.callback_query as Record<string, unknown>;
      const cbId = cb.id as string;
      const cmd = cb.data as string;
      const msgChat = (cb.message as Record<string, unknown>)?.chat as Record<string, unknown>;
      const cid = String(msgChat?.id ?? chatId);

      await answerCallback(cbId);

      if (cmd === "cmd_largada") {
        await handleLargada(cid);
      } else if (cmd === "cmd_chegada") {
        await handleChegada(cid);
      } else if (cmd === "cmd_plano_hoje") {
        await handlePlanoHoje(cid);
      } else if (cmd === "cmd_plano") {
        await handlePlano(cid);
      } else if (cmd === "cmd_compliance") {
        await handleCompliance(cid);
      } else if (cmd === "cmd_bio") {
        await handleBioPrompt(cid);
      } else if (cmd === "cmd_telemetria") {
        await handleTelemetriaPrompt(cid);
      } else if (cmd === "cmd_missao") {
        await handleMissao(cid);
      } else if (cmd === "cmd_clima") {
        const weather = await getWeather();
        await sendTelegram(cid, `🌤️ *Clima — Planalto Paulista*\n\n${weather}`);
      } else if (cmd === "cmd_historico") {
        await handleHistorico(cid);
      } else if (cmd.startsWith("rpe_")) {
        const rpe = parseInt(cmd.split("_")[1]);
        if (SESSION.state === "waiting_rpe" && !isNaN(rpe)) {
          await handleRpeSelected(cid, rpe);
        }
      } else if (cmd.startsWith("pain_")) {
        const pain = parseInt(cmd.split("_")[1]);
        if (SESSION.state === "waiting_pain" && !isNaN(pain)) {
          await handlePainSelected(cid, pain);
        }
      }
      return;
    }

    // ── Text message ───────────────────────────────────────────────────────
    if (!data.message) return;
    const msg = data.message as Record<string, unknown>;
    const msgChatId = String((msg.chat as Record<string, unknown>)?.id ?? chatId);
    const text = (msg.text as string) ?? "";

    if (!text) return;

    // State machine: bio data collection
    if (SESSION.state === "waiting_bio_weight") {
      await handleBioWeight(msgChatId, text);
      return;
    }
    if (SESSION.state === "waiting_bio_fat") {
      await handleBioFat(msgChatId, text);
      return;
    }
    if (SESSION.state === "waiting_telemetry_json") {
      try {
        const parsed = JSON.parse(text) as Record<string, unknown>;
        await handleTelemetriaJson(msgChatId, parsed);
      } catch {
        await sendTelegram(msgChatId, "❌ Não consegui ler o JSON. Cola o JSON completo (começa com { e termina com }).");
      }
      return;
    }

    // Commands
    const cmd = text.split("@")[0].toLowerCase().trim();
    if (cmd === "/start" || cmd === "/menu") {
      const hour = new Date().toLocaleString("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" });
      const h = parseInt(hour);
      const saudacao = h < 12 ? "🌅 *Bom dia, CEO!*" : h < 18 ? "☀️ *Boa tarde, CEO!*" : "🌙 *Boa noite, CEO!*";
      await sendMenu(msgChatId, `${saudacao}\n\n🤖 *ProCoach OS* — Sistema Ativo.`);
      return;
    }
    if (cmd === "/plano") {
      await handlePlano(msgChatId);
      return;
    }
    if (cmd === "/hoje" || cmd === "/planohoje") {
      await handlePlanoHoje(msgChatId);
      return;
    }
    if (cmd === "/compliance") {
      await handleCompliance(msgChatId);
      return;
    }
    if (cmd === "/bio") {
      await handleBioPrompt(msgChatId);
      return;
    }
    if (cmd === "/telemetria") {
      await handleTelemetriaPrompt(msgChatId);
      return;
    }
    if (cmd === "/largada") {
      await handleLargada(msgChatId);
      return;
    }
    if (cmd === "/chegada") {
      await handleChegada(msgChatId);
      return;
    }
    if (cmd === "/clima") {
      const weather = await getWeather();
      await sendTelegram(msgChatId, `🌤️ *Clima — Planalto Paulista*\n\n${weather}`);
      return;
    }
    if (cmd === "/missao") {
      await handleMissao(msgChatId);
      return;
    }
    if (cmd === "/historico") {
      await handleHistorico(msgChatId);
      return;
    }

    // Paste JSON directly (without /telemetria)
    const trimmed = text.trim();
    if (trimmed.startsWith("{") && trimmed.includes("\"date\"")) {
      try {
        const parsed = JSON.parse(trimmed) as Record<string, unknown>;
        const hasBio =
          "weight" in parsed ||
          "body_fat" in parsed ||
          "muscle_mass" in parsed ||
          "body_water" in parsed ||
          "visceral_fat" in parsed;
        if (hasBio) {
          await handleTelemetriaJson(msgChatId, parsed);
          return;
        }
      } catch {}
    }

    // Parse bio shorthand: "bio peso=75 gordura=18"
    const bioMatch = text.match(/bio\s+peso[=:\s]+([\d,.]+)\s+gordura[=:\s]+([\d,.]+)/i);
    if (bioMatch) {
      const w = parseFloat(bioMatch[1].replace(",", "."));
      const f = parseFloat(bioMatch[2].replace(",", "."));
      if (!isNaN(w) && !isNaN(f)) {
        const athlete = await getPrimaryAthlete();
        if (athlete) {
          await ensureBiometricsTable();
          await db.execute(
            sql`INSERT INTO procoach_biometrics (athlete_id, weight_kg, body_fat_pct, recorded_at)
                VALUES (${athlete.id}, ${w}, ${f}, NOW())`
          );
          const leanMass = Math.round(w * (1 - f / 100) * 10) / 10;
          await sendTelegram(msgChatId,
            `⚖️ *Biometria Registada!*\n\n🏋️ *${w}kg* | 🔥 *${f}%* gordura | 💪 *${leanMass}kg* massa magra`
          );
        }
        return;
      }
    }

    // Groq intent classification for free text
    const intent = await classifyIntent(text);
    if (intent === "LARGADA") {
      await handleLargada(msgChatId);
    } else if (intent === "CHEGADA") {
      await handleChegada(msgChatId);
    } else if (intent === "CONSULTA" || intent === "MENU") {
      const hour = new Date().toLocaleString("pt-BR", { hour: "numeric", hour12: false, timeZone: "America/Sao_Paulo" });
      const h = parseInt(hour);
      const saudacao = h < 12 ? "🌅 *Bom dia, CEO!*" : h < 18 ? "☀️ *Boa tarde, CEO!*" : "🌙 *Boa noite, CEO!*";
      await sendMenu(msgChatId, `${saudacao}\n\n🤖 *ProCoach OS* — Sistema Ativo.`);
    } else if (intent === "BIOMETRIA") {
      await handleBioPrompt(msgChatId);
    } else if (intent === "TELEMETRIA") {
      await handleTelemetriaPrompt(msgChatId);
    } else if (intent === "PLANOHOJE") {
      await handlePlanoHoje(msgChatId);
    } else if (intent === "COMPLIANCE") {
      await handleCompliance(msgChatId);
    } else {
      await sendTelegram(msgChatId,
        `🧠 Mensagem recebida.\n\nUsa /menu para ver os comandos disponíveis.`
      );
    }
  } catch (err) {
    console.error("[Telegram webhook error]", err);
  }
});

router.get("/telegram/diagnostics", (_req: Request, res: Response) => {
  const publicBaseUrl =
    process.env.PUBLIC_BASE_URL ??
    process.env.RENDER_EXTERNAL_URL ??
    ((process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim()
      ? `https://${(process.env.REPLIT_DOMAINS ?? "").split(",")[0]!.trim()}`
      : null);
  const base = publicBaseUrl ? publicBaseUrl.replace(/\/+$/, "") : null;
  res.json({
    ok: true,
    publicBaseUrl: base,
    webhookUrl: base ? `${base}/api/telegram/webhook` : null,
    botTokenSet: Boolean(process.env.TELEGRAM_BOT_TOKEN),
    chatIdSet: Boolean(process.env.TELEGRAM_CHAT_ID),
    cronSecretSet: Boolean(process.env.TELEGRAM_CRON_SECRET),
    groqKeySet: Boolean(process.env.GROQ_API_KEY),
  });
});

// ─── Register webhook with Telegram ──────────────────────────────────────────
router.post("/telegram/setup-webhook", async (req: Request, res: Response) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) {
    res.status(500).json({ error: "TELEGRAM_BOT_TOKEN not set" });
    return;
  }
  const publicBaseUrl =
    process.env.PUBLIC_BASE_URL ??
    process.env.RENDER_EXTERNAL_URL ??
    ((process.env.REPLIT_DOMAINS ?? "").split(",")[0]?.trim()
      ? `https://${(process.env.REPLIT_DOMAINS ?? "").split(",")[0]!.trim()}`
      : undefined);

  if (!publicBaseUrl) {
    res.status(500).json({ error: "PUBLIC_BASE_URL (recommended) or RENDER_EXTERNAL_URL or REPLIT_DOMAINS not set" });
    return;
  }

  const base = publicBaseUrl.replace(/\/+$/, "");
  const webhookUrl = `${base}/api/telegram/webhook`;
  const r = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ url: webhookUrl, allowed_updates: ["message", "callback_query"] }),
  });
  const result = await r.json();
  res.json({ webhookUrl, result });
});

router.post("/telegram/daily", async (req: Request, res: Response) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const secret = process.env.TELEGRAM_CRON_SECRET;
  const provided = String(req.headers["x-cron-secret"] ?? "");
  if (!token || !chatId) { res.status(500).json({ error: "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set" }); return; }
  if (!secret) { res.status(500).json({ error: "TELEGRAM_CRON_SECRET not set" }); return; }
  if (provided !== secret) { res.status(401).json({ error: "unauthorized" }); return; }

  res.json({ ok: true });
  try {
    const athlete = await getPrimaryAthlete();
    if (!athlete) {
      await sendTelegram(chatId, "⚠️ Nenhum atleta no sistema. Abre o app ProCoach primeiro.");
      return;
    }

    const [weather, weekStats] = await Promise.all([
      getWeather(),
      db
        .select()
        .from(weeklyStatsTable)
        .where(sql`${weeklyStatsTable.athleteId} = ${athlete.id} AND ${weeklyStatsTable.week} = ${athlete.currentWeek}`)
        .limit(1),
    ]);

    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    const workouts = await db
      .select()
      .from(workoutEntriesTable)
      .where(sql`${workoutEntriesTable.athleteId} = ${athlete.id} AND ${workoutEntriesTable.entryDate} = ${today}`)
      .limit(5);

    const phase = getPhase(athlete.currentWeek);
    const targetKm = phase.kmTarget;
    const doneKm = weekStats[0]?.completedKm ?? 0;
    const progressBar = buildProgressBar(doneKm, targetKm);

    const wLine =
      workouts.length > 0
        ? workouts.map((w: { type: string; distanceKm: number }) => `🔹 *${w.type.toUpperCase()}* — *${roundKm(w.distanceKm)}km*`).join("\n")
        : `🔹 *${roundKm(targetKm / 5)}km* — *${phase.paceTarget}* (sugestão)`;

    await sendTelegram(
      chatId,
      `☀️ *PROCOACH OS — BRIEFING DO DIA*\n\n` +
        `${weather}\n\n` +
        `📆 Hoje: *${today}* · Semana *${athlete.currentWeek}*/16 · Fase *${phase.name}*\n\n` +
        `🎯 *Missão do dia:*\n${wLine}\n\n` +
        `📊 *Progresso da semana:* ${progressBar} *${doneKm}/${targetKm}km*`
    );
  } catch (err) {
    console.error("[Telegram daily error]", err);
  }
});

async function getDailyForecastForDate(dateISO: string): Promise<string> {
  try {
    const url =
      `https://api.open-meteo.com/v1/forecast?latitude=${HOME_LAT}&longitude=${HOME_LON}` +
      `&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max,windspeed_10m_max,weathercode` +
      `&timezone=America%2FSao_Paulo`;
    const r = await fetch(url);
    if (!r.ok) return "🌡️ Previsão indisponível";
    const data = await r.json() as {
      daily?: {
        time: string[];
        temperature_2m_max: number[];
        temperature_2m_min: number[];
        precipitation_probability_max: number[];
        windspeed_10m_max: number[];
        weathercode: number[];
      };
    };
    const d = data.daily;
    if (!d?.time?.length) return "🌡️ Previsão indisponível";
    const idx = d.time.findIndex((t) => t === dateISO);
    if (idx < 0) return "🌡️ Previsão indisponível";
    const emoji = d.weathercode?.[idx] === 0 ? "☀️" : (d.weathercode?.[idx] ?? 0) <= 3 ? "⛅" : (d.weathercode?.[idx] ?? 0) <= 67 ? "🌧️" : "⛈️";
    const minC = Math.round(d.temperature_2m_min?.[idx] ?? 0);
    const maxC = Math.round(d.temperature_2m_max?.[idx] ?? 0);
    const rain = Math.round(d.precipitation_probability_max?.[idx] ?? 0);
    const wind = Math.round(d.windspeed_10m_max?.[idx] ?? 0);
    return `${emoji} *${minC}°–${maxC}°* | 💧 ${rain}% | 💨 ${wind}km/h`;
  } catch {
    return "🌡️ Previsão indisponível";
  }
}

router.post("/telegram/nightly", async (req: Request, res: Response) => {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const secret = process.env.TELEGRAM_CRON_SECRET;
  const provided = String(req.headers["x-cron-secret"] ?? "");
  if (!token || !chatId) { res.status(500).json({ error: "TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID not set" }); return; }
  if (!secret) { res.status(500).json({ error: "TELEGRAM_CRON_SECRET not set" }); return; }
  if (provided !== secret) { res.status(401).json({ error: "unauthorized" }); return; }

  res.json({ ok: true });
  void runNightlyBriefing();
});

export async function runNightlyBriefing(): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  try {
    const athlete = await getPrimaryAthlete();
    if (!athlete) {
      await sendTelegram(chatId, "⚠️ Nenhum atleta no sistema. Abre o app ProCoach primeiro.");
      return;
    }

    await ensurePlanTable();
    const today = getSaoPauloDayKey();
    const next = await db.execute(sql`
      SELECT session_date, day_name, activity, pace_target, treadmill_speed, rest_interval, structure, planned_km
      FROM procoach_plan_sessions
      WHERE athlete_id = ${athlete.id} AND session_date > ${today}
      ORDER BY session_date ASC
      LIMIT 1
    `) as { rows: Array<{
      session_date: string;
      day_name: string | null;
      activity: string;
      pace_target: string | null;
      treadmill_speed: string | null;
      rest_interval: string | null;
      structure: string | null;
      planned_km: number | string;
    }> };

    const s = next.rows[0];
    if (!s) {
      await sendTelegram(chatId, `🌙 *PROCOACH OS — BRIEFING 22H*\n\nNenhum próximo treino encontrado no plano. Importa o plano no app (Status).`);
      return;
    }

    const forecast = await getDailyForecastForDate(s.session_date);
    const km = Number(s.planned_km) > 0 ? ` · *${Number(s.planned_km)}km*` : "";
    const details =
      (s.pace_target ? `🎯 Pace: *${s.pace_target}*\n` : "") +
      (s.rest_interval ? `⏱️ Repouso: *${s.rest_interval}*\n` : "") +
      (s.treadmill_speed ? `🏃‍♂️ Esteira: *${s.treadmill_speed}*\n` : "") +
      (s.structure ? `\n🧩 *Estrutura:*\n${s.structure}\n` : "");

    await sendTelegram(
      chatId,
      `🌙 *PROCOACH OS — BRIEFING 22H*\n\n` +
        `📆 Amanhã (*${s.session_date}*):\n` +
        `🏃 *${s.activity}*${km}\n\n` +
        `🌤️ Clima: ${forecast}\n\n` +
        details +
        `_Dormir bem hoje = performance amanhã._`
    );
  } catch (err) {
    console.error("[Telegram nightly error]", err);
  }
}

export default router;
