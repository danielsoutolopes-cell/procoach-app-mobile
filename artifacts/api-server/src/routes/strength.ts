import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "@workspace/db";
import { db } from "@workspace/db";
import {
  StrengthTemplateCode,
  ensureStrengthTables,
  ensureStrengthCatalogSeed,
  getOrCreateMonoAthleteId,
} from "./migrations";

const router: IRouter = Router();

router.get("/procoach/me/strength/catalog", async (req: Request, res: Response) => {
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const limit = Math.max(1, Math.min(25, Number(req.query.limit) || 12));
  await ensureStrengthCatalogSeed();

  const like = q ? `%${q.toLowerCase()}%` : null;
  const rows = await db.execute(sql`
    SELECT id, name, primary_muscles, secondary_muscles, equipment, pattern, is_unilateral
    FROM procoach_strength_exercise_catalog
    WHERE (${like} IS NULL) OR lower(name) LIKE ${like} OR (aliases::text ILIKE ${`%${q}%`})
    ORDER BY name ASC
    LIMIT ${limit}
  `) as { rows: Array<Record<string, unknown>> };

  res.json({ items: rows.rows });
});

router.get("/procoach/me/strength/templates", async (_req: Request, res: Response) => {
  await ensureStrengthTables();
  const athleteId = await getOrCreateMonoAthleteId();

  const templatesRows = await db.execute(sql`
    SELECT code, name, notes FROM procoach_strength_templates
    WHERE athlete_id = ${athleteId} ORDER BY code ASC
  `) as { rows: Array<{ code: string; name: string; notes: string | null }> };

  const exRows = await db.execute(sql`
    SELECT e.template_code, e.order_index, e.catalog_exercise_id, COALESCE(NULLIF(e.exercise_name_override, ''), c.name) AS name,
      e.sets, e.reps, e.rest_sec, e.rpe_target, e.load, e.tempo, e.notes
    FROM procoach_strength_template_exercises e
    LEFT JOIN procoach_strength_exercise_catalog c ON c.id = e.catalog_exercise_id
    WHERE e.athlete_id = ${athleteId}
    ORDER BY e.template_code ASC, e.order_index ASC
  `) as { rows: Array<Record<string, unknown>> };

  const base = (code: StrengthTemplateCode) => ({ code, name: "", notes: null as string | null, exercises: [] as Array<Record<string, unknown>> });
  const templates: Record<StrengthTemplateCode, ReturnType<typeof base>> = { A: base("A"), B: base("B"), C: base("C") };
  
  for (const t of templatesRows.rows) {
    const code = String(t.code ?? "").toUpperCase() as StrengthTemplateCode;
    if (templates[code]) {
      templates[code] = { ...templates[code], name: t.name ?? "", notes: t.notes ?? null };
    }
  }
  for (const r of exRows.rows) {
    const code = String((r as any).template_code ?? "").toUpperCase() as StrengthTemplateCode;
    if (!templates[code]) continue;
    templates[code].exercises.push({
      catalogExerciseId: (r as any).catalog_exercise_id ?? null, name: (r as any).name ?? null,
      sets: (r as any).sets ?? null, reps: (r as any).reps ?? null, restSec: (r as any).rest_sec ?? null,
      rpeTarget: (r as any).rpe_target ?? null, load: (r as any).load ?? null, tempo: (r as any).tempo ?? null,
      notes: (r as any).notes ?? null,
    });
  }

  res.json({ templates });
});

router.put("/procoach/me/strength/templates/:code", async (req: Request, res: Response) => {
  await ensureStrengthTables();
  const athleteId = await getOrCreateMonoAthleteId();
  const code = String(req.params.code ?? "").toUpperCase().trim() as StrengthTemplateCode;
  if (!["A", "B", "C"].includes(code)) {
    res.status(400).json({ error: "invalid template code" });
    return;
  }

  const body = req.body as any;
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const notes = typeof body?.notes === "string" ? body.notes.trim() : null;
  const exercisesIn = Array.isArray(body?.exercises) ? body.exercises : [];

  await db.execute(sql`
    INSERT INTO procoach_strength_templates (athlete_id, code, name, notes, updated_at)
    VALUES (${athleteId}, ${code}, ${name}, ${notes}, NOW())
    ON CONFLICT (athlete_id, code) DO UPDATE SET
      name = EXCLUDED.name, notes = EXCLUDED.notes, updated_at = NOW()
  `);

  await db.execute(sql`
    DELETE FROM procoach_strength_template_exercises
    WHERE athlete_id = ${athleteId} AND template_code = ${code}
  `);

  for (let i = 0; i < Math.min(60, exercisesIn.length); i++) {
    const e = exercisesIn[i] ?? {};
    const catalogIdRaw = e.catalogExerciseId ?? e.catalog_exercise_id;
    const catalogId = (catalogIdRaw === undefined || catalogIdRaw === null || catalogIdRaw === "") ? null : Number(catalogIdRaw);
    const nameOverride = typeof e.name === "string" ? e.name.trim() : typeof e.exercise_name_override === "string" ? e.exercise_name_override.trim() : null;
    if (!catalogId && !nameOverride) continue;

    const sets = (e.sets === undefined || e.sets === null || e.sets === "") ? null : Math.max(0, Math.round(Number(e.sets)));
    const reps = (e.reps === undefined || e.reps === null || e.reps === "") ? null : String(e.reps).trim();
    const restSec = e.restSec ?? e.rest_sec;
    const rest = (restSec === undefined || restSec === null || restSec === "") ? null : Math.max(0, Math.round(Number(restSec)));
    const rpeTargetRaw = e.rpeTarget ?? e.rpe_target;
    const rpeTarget = (rpeTargetRaw === undefined || rpeTargetRaw === null || rpeTargetRaw === "") ? null : Number(rpeTargetRaw);
    const load = (e.load === undefined || e.load === null || e.load === "") ? null : String(e.load).trim();
    const tempo = (e.tempo === undefined || e.tempo === null || e.tempo === "") ? null : String(e.tempo).trim();
    const exNotes = (e.notes === undefined || e.notes === null || e.notes === "") ? null : String(e.notes).trim();

    await db.execute(sql`
      INSERT INTO procoach_strength_template_exercises
        (athlete_id, template_code, order_index, catalog_exercise_id, exercise_name_override, sets, reps, rest_sec, rpe_target, load, tempo, notes, updated_at)
      VALUES
        (${athleteId}, ${code}, ${i}, ${Number.isFinite(catalogId) ? catalogId : null}, ${nameOverride}, ${sets}, ${reps}, ${rest}, ${rpeTarget}, ${load}, ${tempo}, ${exNotes}, NOW())
      ON CONFLICT (athlete_id, template_code, order_index) DO UPDATE SET
        catalog_exercise_id = EXCLUDED.catalog_exercise_id, exercise_name_override = EXCLUDED.exercise_name_override, sets = EXCLUDED.sets,
        reps = EXCLUDED.reps, rest_sec = EXCLUDED.rest_sec, rpe_target = EXCLUDED.rpe_target, load = EXCLUDED.load,
        tempo = EXCLUDED.tempo, notes = EXCLUDED.notes, updated_at = NOW()
    `);
  }

  res.json({ ok: true, code });
});

export default router;