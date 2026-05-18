import { eq, sql } from "@workspace/db";
import { db } from "@workspace/db";
import PDFDocument from "pdfkit";
import { athletesTable } from "@workspace/db/schema";
import { ensureWorkoutFeedbackTable } from "./migrations";

export function mapOpenWeatherToWMO(id: number): number {
  if (id === 800) return 0;
  if (id === 801 || id === 802) return 2;
  if (id === 803 || id === 804) return 3;
  if (id >= 200 && id < 300) return 95;
  if (id >= 300 && id < 400) return 51;
  if (id >= 500 && id < 600) return 63;
  if (id >= 600 && id < 700) return 71;
  if (id >= 700 && id < 800) return 45;
  return 0;
}

export function roundKm(val: number): number {
  return Math.round(val);
}

export function normalizeEntryDate(raw: string): string {
  if (typeof raw !== "string") return new Date().toISOString().slice(0, 10);
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  const parsed = new Date(raw);
  if (!Number.isNaN(parsed.getTime())) return parsed.toISOString().slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

export function getSaoPauloDayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export function getSaoPauloTomorrowKey(): string {
  const d = new Date();
  const spDate = new Date(d.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  spDate.setDate(spDate.getDate() + 1);
  const yyyy = spDate.getFullYear();
  const mm = String(spDate.getMonth() + 1).padStart(2, "0");
  const dd = String(spDate.getDate()).padStart(2, "0");
  return `${yyyy}-${mm}-${dd}`;
}

export function computeRacePointers(races: any[], macrocycleRaceId?: string | null) {
  if (!Array.isArray(races)) return { nextRace: null, nextP1: null, anchor: null };
  const today = getSaoPauloDayKey();
  const valid = races.filter((r) => r.data && r.data >= today && r.status !== "cancelada");
  valid.sort((a, b) => a.data.localeCompare(b.data));

  const nextRace = valid[0] ?? null;
  const nextP1 = valid.find((r) => r.tipo_tatico === "P1") ?? null;
  
  let anchor = macrocycleRaceId ? valid.find((r) => String(r.id) === String(macrocycleRaceId)) ?? null : null;

  if (!anchor) {
    anchor = nextP1;
  }

  return { nextRace, nextP1, anchor };
}

export function asNumberOrNull(val: unknown): number | null {
  if (val === null || val === undefined || val === "") return null;
  const n = typeof val === "number" ? val : Number(String(val).replace(",", ".").trim());
  if (!Number.isFinite(n)) return null;
  return n;
}

export async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      chat_id: chatId,
      text,
      parse_mode: "Markdown",
      disable_web_page_preview: true,
    }),
  });
}

export async function getRainProbability(dateISO: string, lat = -23.6087, lon = -46.6676): Promise<number> {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return 0;
  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const r = await fetch(url);
    if (!r.ok) return 0;
    const data = await r.json() as any;
    let pop = 0;
    for (const item of data.list || []) {
      if (item.dt_txt.startsWith(dateISO)) {
        pop = Math.max(pop, item.pop);
      }
    }
    return Math.round(pop * 100);
  } catch {
    return 0;
  }
}

export async function getRaceWeatherStr(dateISO: string, lat = -23.6087, lon = -46.6676): Promise<string> {
  try {
    const apiKey = process.env.OPENWEATHER_API_KEY;
    if (!apiKey) return "";

    const todayISO = getSaoPauloDayKey();
    
    if (!dateISO || dateISO === todayISO) {
      const url = `https://api.openweathermap.org/data/2.5/weather?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=pt_br`;
      const r = await fetch(url);
      if (!r.ok) return "";
      const data = await r.json() as any;
      const temp = Math.round(data.main?.temp ?? 0);
      const desc = data.weather?.[0]?.description ?? "";
      const descCap = desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : "";
      const wmo = mapOpenWeatherToWMO(data.weather?.[0]?.id || 800);
      const emoji = wmo === 0 ? "☀️" : wmo <= 3 ? "⛅" : wmo <= 67 ? "🌧️" : "⛈️";
      return `${emoji} ${temp}°C ${descCap}`;
    }

    const forecastUrl = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric&lang=pt_br`;
    const fRes = await fetch(forecastUrl);
    if (fRes.ok) {
      const fData = await fRes.json() as any;
      const dayForecasts = (fData.list || []).filter((item: any) => item.dt_txt.startsWith(dateISO));
      if (dayForecasts.length > 0) {
        const targetForecast = dayForecasts.find((item: any) => item.dt_txt.includes("09:00:00")) || dayForecasts[0];
        const temp = Math.round(targetForecast.main?.temp ?? 0);
        const desc = targetForecast.weather?.[0]?.description ?? "";
        const descCap = desc ? desc.charAt(0).toUpperCase() + desc.slice(1) : "";
        const wmo = mapOpenWeatherToWMO(targetForecast.weather?.[0]?.id || 800);
        const emoji = wmo === 0 ? "☀️" : wmo <= 3 ? "⛅" : wmo <= 67 ? "🌧️" : "⛈️";
        return `${emoji} ${temp}°C ${descCap}`;
      }
    }

    const histUrl = `https://archive-api.open-meteo.com/v1/archive?latitude=${lat}&longitude=${lon}&start_date=${dateISO}&end_date=${dateISO}&daily=temperature_2m_mean,weathercode&timezone=America%2FSao_Paulo`;
    const hRes = await fetch(histUrl);
    if (!hRes.ok) return "";
    const hData = await hRes.json() as any;
    if (hData.daily && hData.daily.time && hData.daily.time.length > 0) {
      const temp = Math.round(hData.daily.temperature_2m_mean[0] ?? 0);
      const code = hData.daily.weathercode[0] ?? 0;
      const emoji = code === 0 ? "☀️" : code <= 3 ? "⛅" : code <= 67 ? "🌧️" : "⛈️";
      return `${emoji} ${temp}°C`;
    }

    return "";
  } catch (err) {
    console.error("Erro ao buscar clima para a prova:", err);
    return "";
  }
}

export async function upsertWorkoutFeedback(payload: {
  athleteId: number;
  entryDate: string;
  rpe?: number;
  painLevel?: number;
  notes?: string;
}): Promise<void> {
  await ensureWorkoutFeedbackTable();
  const rpeVal = payload.rpe === undefined ? null : Math.max(1, Math.min(10, Math.round(payload.rpe)));
  const painVal = payload.painLevel === undefined ? null : Math.max(0, Math.min(5, Math.round(payload.painLevel)));
  const notes = payload.notes ? String(payload.notes).slice(0, 2000) : null;
  if (rpeVal === null && painVal === null && notes === null) return;
  await db.execute(sql`
    INSERT INTO procoach_workout_feedback (athlete_id, entry_date, rpe, pain_level, notes, created_at, updated_at)
    VALUES (${payload.athleteId}, ${payload.entryDate}, ${rpeVal}, ${painVal}, ${notes}, NOW(), NOW())
    ON CONFLICT (athlete_id, entry_date)
    DO UPDATE SET
      rpe = COALESCE(EXCLUDED.rpe, procoach_workout_feedback.rpe),
      pain_level = COALESCE(EXCLUDED.pain_level, procoach_workout_feedback.pain_level),
      notes = COALESCE(EXCLUDED.notes, procoach_workout_feedback.notes),
      updated_at = NOW()
  `);

  if (painVal !== null) {
    // Atualiza o nível de dor no perfil do atleta para integrar com o Radar Articular
    await db.update(athletesTable)
      .set({ painLevel: painVal, updatedAt: new Date() })
      .where(eq(athletesTable.id, payload.athleteId));
  }
}