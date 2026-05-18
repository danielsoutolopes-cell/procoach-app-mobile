import { Router, type IRouter, type Request, type Response } from "express";
import { eq, sql } from "@workspace/db";
import { db } from "@workspace/db";
import PDFDocument from "pdfkit";
import { athletesTable } from "@workspace/db/schema";
import { ensurePlanTable, getOrCreateMonoAthleteId } from "./migrations";
import { getSaoPauloDayKey, getSaoPauloTomorrowKey, sendTelegram } from "./procoach-utils";

const router: IRouter = Router();

function isoDateOnly(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function mondayOf(date: Date): Date {
  const day = date.getDay();
  const diff = day === 0 ? 6 : day - 1;
  const monday = new Date(date);
  monday.setHours(0, 0, 0, 0);
  monday.setDate(monday.getDate() - diff);
  return monday;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function buildWeeklyPdfBuffer(params: {
  athleteName: string;
  weekStartISO: string;
  weekEndISO: string;
  plannedSessions: Array<any>;
  workouts: Array<any>;
}): Promise<Buffer> {
  return await new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 48 });
    const chunks: Buffer[] = [];
    doc.on("data", (c) => chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    doc.fontSize(18).text("Relatório Semanal — ProCoach OS", { align: "left" });
    doc.moveDown(0.25);
    doc.fontSize(11).fillColor("#444").text(`${params.athleteName} · ${params.weekStartISO} → ${params.weekEndISO}`);
    doc.fillColor("#000").moveDown(1);

    doc.fontSize(13).text("Plano (planejado)", { underline: true }).moveDown(0.5);
    if (params.plannedSessions.length === 0) {
      doc.fontSize(11).fillColor("#444").text("Nenhum treino planejado para esta semana.").fillColor("#000");
    } else {
      for (const s of params.plannedSessions) {
        doc.fontSize(11).text(`${s.session_date}${s.day_name ? ` (${s.day_name})` : ""} · ${s.activity}`);
        const rightParts = [s.planned_km > 0 && `${s.planned_km} km`, s.pace_target && `pace ${s.pace_target}`, s.treadmill_speed && `esteira ${s.treadmill_speed}`, s.rest_interval && `rep ${s.rest_interval}`].filter(Boolean);
        if (rightParts.length > 0) doc.fillColor("#444").text(rightParts.join(" · ")).fillColor("#000");
        if (s.structure) doc.fillColor("#444").text(s.structure).fillColor("#000");
        doc.moveDown(0.5);
      }
    }

    doc.moveDown(0.5).fontSize(13).text("Execução (concluído)", { underline: true }).moveDown(0.5);
    if (params.workouts.length === 0) {
      doc.fontSize(11).fillColor("#444").text("Nenhum treino concluído registrado nesta semana.").fillColor("#000");
    } else {
      for (const w of params.workouts) {
        doc.fontSize(11).text(`${w.entry_date} · ${w.type} · ${w.distance_km} km · ${w.duration_min} min`);
      }
    }
    doc.end();
  });
}

async function sendTelegramDocument(params: { filename: string; fileBytes: Buffer; caption?: string; }): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;

  const boundary = "----ProCoachBoundary" + Date.now();
  const parts: string[] = [`--${boundary}\r\nContent-Disposition: form-data; name="chat_id"\r\n\r\n${chatId}`];
  if (params.caption) {
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="caption"\r\n\r\n${params.caption}`);
    parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="parse_mode"\r\n\r\nMarkdown`);
  }
  parts.push(`--${boundary}\r\nContent-Disposition: form-data; name="document"; filename="${params.filename}"\r\nContent-Type: application/pdf\r\n\r\n`);
  
  const body = Buffer.concat([Buffer.from(parts.join("\r\n") + "\r\n"), params.fileBytes, Buffer.from(`\r\n--${boundary}--\r\n`)]);

  await fetch(`https://api.telegram.org/bot${token}/sendDocument`, { method: "POST", headers: { "Content-Type": `multipart/form-data; boundary=${boundary}` }, body });
}

router.get("/procoach/me/compliance", async (req: Request, res: Response) => {
  const from = typeof req.query.from === "string" && req.query.from.trim() ? req.query.from.trim() : undefined;
  const to = typeof req.query.to === "string" && req.query.to.trim() ? req.query.to.trim() : getSaoPauloDayKey();
  const fromSafe = from ?? to;
  await ensurePlanTable();
  const athleteId = await getOrCreateMonoAthleteId();

  const planned = await db.execute(sql`
    SELECT COUNT(*)::int AS planned_sessions, COALESCE(SUM(planned_km), 0)::int AS planned_km
    FROM procoach_plan_sessions WHERE athlete_id = ${athleteId} AND session_date >= ${fromSafe} AND session_date <= ${to}
  `) as { rows: Array<{ planned_sessions: number; planned_km: number }> };

  const completed = await db.execute(sql`
    SELECT COUNT(*)::int AS completed_sessions, COALESCE(SUM(distance_km), 0)::int AS completed_km
    FROM procoach_workout_entries WHERE athlete_id = ${athleteId} AND entry_date >= ${fromSafe} AND entry_date <= ${to} AND type = 'corrida' AND distance_km >= 3
  `) as { rows: Array<{ completed_sessions: number; completed_km: number }> };

  res.json({
    from: fromSafe, to,
    plannedSessions: planned.rows[0]?.planned_sessions ?? 0, plannedKm: planned.rows[0]?.planned_km ?? 0,
    completedSessions: completed.rows[0]?.completed_sessions ?? 0, completedKm: completed.rows[0]?.completed_km ?? 0,
  });
});

router.get("/procoach/me/weekly-stats", async (_req: Request, res: Response) => {
  const athleteId = await getOrCreateMonoAthleteId();
  const rows = await db.execute(sql`
    SELECT week, COALESCE(SUM(distance_km), 0)::int AS completed_km
    FROM procoach_workout_entries WHERE athlete_id = ${athleteId} AND type = 'corrida' AND distance_km >= 3
    GROUP BY week
  `) as { rows: Array<{ week: number; completed_km: number }> };

  const weeklyCompleted: Record<number, number> = {};
  for (const r of rows.rows) { weeklyCompleted[Number(r.week)] = Number(r.completed_km) || 0; }
  res.json({ weeklyCompleted });
});

router.get(["/procoach/me/export", "/procoach/export"], async (_req: Request, res: Response) => {
  const athleteId = await getOrCreateMonoAthleteId();
  const athlete = await db.select().from(athletesTable).where(eq(athletesTable.id, athleteId) as any).limit(1);
  const planRows = await db.execute(sql`SELECT * FROM procoach_plan_sessions WHERE athlete_id = ${athleteId} ORDER BY session_date ASC`) as { rows: Array<any> };
  const workouts = await db.execute(sql`SELECT * FROM procoach_workout_entries WHERE athlete_id = ${athleteId} ORDER BY entry_date DESC LIMIT 365`) as { rows: Array<any> };
  const weekly = await db.execute(sql`SELECT week, COALESCE(SUM(distance_km), 0)::int AS completed_km FROM procoach_workout_entries WHERE athlete_id = ${athleteId} AND type = 'corrida' AND distance_km >= 3 GROUP BY week ORDER BY week ASC`) as { rows: Array<any> };
  res.json({ athlete: athlete[0] ?? null, planSessions: planRows.rows, workouts: workouts.rows, weeklyCompleted: weekly.rows });
});

router.get(["/procoach/me/weekly-report.pdf", "/procoach/weekly-report.pdf"], async (req: Request, res: Response) => {
  const athleteId = await getOrCreateMonoAthleteId();
  const weekStartRaw = typeof req.query.weekStart === "string" ? req.query.weekStart : "";
  const weekStartISO = /^\d{4}-\d{2}-\d{2}$/.test(weekStartRaw) ? weekStartRaw : isoDateOnly(mondayOf(new Date()));
  const weekEndISO = isoDateOnly(addDays(new Date(`${weekStartISO}T00:00:00`), 6));

  const athlete = await db.select().from(athletesTable).where(eq(athletesTable.id, athleteId) as any).limit(1);
  const planned = await db.execute(sql`SELECT * FROM procoach_plan_sessions WHERE athlete_id = ${athleteId} AND session_date >= ${weekStartISO} AND session_date <= ${weekEndISO} ORDER BY session_date ASC`) as { rows: Array<any> };
  const workouts = await db.execute(sql`SELECT * FROM procoach_workout_entries WHERE athlete_id = ${athleteId} AND entry_date >= ${weekStartISO} AND entry_date <= ${weekEndISO} ORDER BY entry_date ASC`) as { rows: Array<any> };

  const pdfBytes = await buildWeeklyPdfBuffer({
    athleteName: athlete[0]?.name ?? "Atleta", weekStartISO, weekEndISO,
    plannedSessions: planned.rows, workouts: workouts.rows,
  });

  res.setHeader("Content-Type", "application/pdf").setHeader("Content-Disposition", `inline; filename=\"weekly-report-${weekStartISO}.pdf\"`).send(pdfBytes);
});

router.post(["/procoach/me/weekly-report/send", "/procoach/weekly-report/send"], async (req: Request, res: Response) => {
  if (process.env.CRON_SECRET && req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const weekStartRaw = typeof req.body?.weekStart === "string" ? req.body.weekStart : undefined;
  const weekStartISO = weekStartRaw && /^\d{4}-\d{2}-\d{2}$/.test(weekStartRaw) ? weekStartRaw : isoDateOnly(mondayOf(new Date()));
  const weekEndISO = isoDateOnly(addDays(new Date(`${weekStartISO}T00:00:00`), 6));

  const athleteId = await getOrCreateMonoAthleteId();
  const athlete = await db.select().from(athletesTable).where(eq(athletesTable.id, athleteId) as any).limit(1);
  const planned = await db.execute(sql`SELECT * FROM procoach_plan_sessions WHERE athlete_id = ${athleteId} AND session_date >= ${weekStartISO} AND session_date <= ${weekEndISO} ORDER BY session_date ASC`) as { rows: Array<any> };
  const workouts = await db.execute(sql`SELECT * FROM procoach_workout_entries WHERE athlete_id = ${athleteId} AND entry_date >= ${weekStartISO} AND entry_date <= ${weekEndISO} ORDER BY entry_date ASC`) as { rows: Array<any> };

  const pdfBytes = await buildWeeklyPdfBuffer({
    athleteName: athlete[0]?.name ?? "Atleta", weekStartISO, weekEndISO,
    plannedSessions: planned.rows, workouts: workouts.rows,
  });

  const filename = `weekly-report-${weekStartISO}.pdf`;
  await sendTelegramDocument({ filename, fileBytes: pdfBytes, caption: `📄 *Relatório semanal*\n${weekStartISO} → ${weekEndISO}` });

  res.json({ sent: true, weekStart: weekStartISO, weekEnd: weekEndISO });
});

router.post(["/procoach/me/daily-briefing/send", "/procoach/daily-briefing/send"], async (req: Request, res: Response) => {
  if (process.env.CRON_SECRET && req.headers["x-cron-secret"] !== process.env.CRON_SECRET) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }

  const athleteId = await getOrCreateMonoAthleteId();
  const tomorrowISO = getSaoPauloTomorrowKey();

  const rows = await db.execute(sql`
    SELECT session_date, activity, pace_target, structure, planned_km
    FROM procoach_plan_sessions WHERE athlete_id = ${athleteId} AND session_date = ${tomorrowISO} LIMIT 1
  `) as { rows: Array<any> };

  const session = rows.rows[0];
  if (!session) {
    await sendTelegram(`🌙 *Briefing Noturno* (${tomorrowISO})\n\nAmanhã é dia de *Descanso*. Aproveite para recuperar!`);
    res.json({ sent: true, date: tomorrowISO, session: null });
    return;
  }

  const msg = `🌙 *Briefing de Amanhã* (${tomorrowISO})\n\n` +
              `🏃 *Atividade:* ${session.activity}\n` +
              (session.planned_km ? `📏 *Volume:* ${session.planned_km} km\n` : "") +
              (session.pace_target ? `⏱️ *Pace Alvo:* ${session.pace_target}\n` : "") +
              (session.structure ? `📋 *Estrutura:* ${session.structure}\n` : "");

  await sendTelegram(msg);
  res.json({ sent: true, date: tomorrowISO, session });
});

export default router;