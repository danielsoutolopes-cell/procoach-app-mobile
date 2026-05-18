import { Router, type IRouter, type Request, type Response } from "express";
import { sql } from "@workspace/db";
import { db } from "@workspace/db";
import multer from "multer";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { ensureBioimpedanceTable, getOrCreateMonoAthleteId } from "./migrations";
import { asNumberOrNull, normalizeEntryDate } from "./procoach-utils";

const router: IRouter = Router();

const pdfUpload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
});

router.post(
  "/procoach/me/bioimpedance/upload",
  pdfUpload.single("file"),
  async (req: Request, res: Response) => {
    try {
      await ensureBioimpedanceTable();
      const athleteId = await getOrCreateMonoAthleteId();

      const file = (req as any).file as { buffer: Buffer; originalname?: string; } | undefined;
      if (!file?.buffer) {
        res.status(400).json({ error: "Arquivo PDF é obrigatório (field: file)" });
        return;
      }

      const base64Data = file.buffer.toString("base64");
      const apiKey = (process.env.GEMINI_API_KEY || "").replace(/^['"`]+|['"`]+$/g, "").trim();
      const modelName = (process.env.GEMINI_MODEL || "gemini-pro").replace(/^['"`]+|['"`]+$/g, "").trim();
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: modelName });

      const prompt = `Você é um especialista em nutrição. Analise o PDF de bioimpedância e extraia as seguintes métricas num JSON válido:
{ "date": "YYYY-MM-DD", "weight_kg": numero, "body_fat_pct": numero, "muscle_mass_kg": numero, "body_water_pct": numero, "visceral_fat": numero, "metabolic_age": numero, "tmb_kcal": numero, "protein_pct": numero, "bone_mass_kg": numero }
Se alguma métrica não existir, retorne null. Responda apenas com o JSON bruto.`;

      const result = await model.generateContent([ prompt, { inlineData: { data: base64Data, mimeType: "application/pdf" } } ]);
      const rawText = result.response.text();
      const cleaned = rawText.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
      const data = JSON.parse(cleaned);
      const entryDate = normalizeEntryDate(data.date || "");

      await db.execute(sql`
        INSERT INTO procoach_bioimpedance (athlete_id, entry_date, weight_kg, body_fat_pct, muscle_mass_kg, body_water_pct, visceral_fat, metabolic_age, tmb_kcal, protein_pct, bone_mass_kg, created_at, updated_at)
        VALUES (${athleteId}, ${entryDate}, ${data.weight_kg ?? null}, ${data.body_fat_pct ?? null}, ${data.muscle_mass_kg ?? null}, ${data.body_water_pct ?? null}, ${data.visceral_fat ?? null}, ${data.metabolic_age ?? null}, ${data.tmb_kcal ?? null}, ${data.protein_pct ?? null}, ${data.bone_mass_kg ?? null}, NOW(), NOW())
        ON CONFLICT (athlete_id, entry_date) DO UPDATE SET weight_kg = EXCLUDED.weight_kg, body_fat_pct = EXCLUDED.body_fat_pct, muscle_mass_kg = EXCLUDED.muscle_mass_kg, body_water_pct = EXCLUDED.body_water_pct, visceral_fat = EXCLUDED.visceral_fat, metabolic_age = EXCLUDED.metabolic_age, tmb_kcal = EXCLUDED.tmb_kcal, protein_pct = EXCLUDED.protein_pct, bone_mass_kg = EXCLUDED.bone_mass_kg, updated_at = NOW()
      `);
      res.json({ success: true, message: "Upload concluído e bioimpedância salva.", data });
    } catch (err: any) {
      console.error("[API] Erro ao processar PDF com IA:", err);
      res.status(500).json({ error: err?.message || "Internal Server Error" });
    }
  }
);

router.post("/procoach/me/bioimpedance", async (req: Request, res: Response) => {
  await ensureBioimpedanceTable();
  const athleteId = await getOrCreateMonoAthleteId();

  const body = req.body as Record<string, unknown>;
  const entryDate = normalizeEntryDate(String(body.date ?? body.entryDate ?? ""));
  const weightKg = asNumberOrNull(body.weight ?? body.weight_kg);
  const bodyFatPct = asNumberOrNull(body.body_fat ?? body.body_fat_pct);
  const muscleMassKg = asNumberOrNull(body.muscle_mass ?? body.muscle_mass_kg);
  const bodyWaterPct = asNumberOrNull(body.body_water ?? body.body_water_pct);
  const visceralFat = asNumberOrNull(body.visceral_fat);
  const metabolicAge = asNumberOrNull(body.metabolic_age) ? Math.max(0, Math.round(asNumberOrNull(body.metabolic_age)!)) : null;
  const tmbKcal = asNumberOrNull(body.tmb ?? body.tmb_kcal) ? Math.max(0, Math.round(asNumberOrNull(body.tmb ?? body.tmb_kcal)!)) : null;
  const proteinPct = asNumberOrNull(body.protein ?? body.protein_pct);
  const boneMassKg = asNumberOrNull(body.bone_mass ?? body.bone_mass_kg);
  const healthNotes = typeof body.health_notes === "string" ? body.health_notes : typeof body.notes === "string" ? body.notes : null;

  const rows = await db.execute(sql`
    INSERT INTO procoach_bioimpedance (athlete_id, entry_date, weight_kg, body_fat_pct, muscle_mass_kg, body_water_pct, visceral_fat, metabolic_age, tmb_kcal, protein_pct, bone_mass_kg, health_notes, created_at, updated_at)
    VALUES (${athleteId}, ${entryDate}, ${weightKg}, ${bodyFatPct}, ${muscleMassKg}, ${bodyWaterPct}, ${visceralFat}, ${metabolicAge}, ${tmbKcal}, ${proteinPct}, ${boneMassKg}, ${healthNotes}, NOW(), NOW())
    ON CONFLICT (athlete_id, entry_date) DO UPDATE SET
      weight_kg = EXCLUDED.weight_kg, body_fat_pct = EXCLUDED.body_fat_pct, muscle_mass_kg = EXCLUDED.muscle_mass_kg, body_water_pct = EXCLUDED.body_water_pct,
      visceral_fat = EXCLUDED.visceral_fat, metabolic_age = EXCLUDED.metabolic_age, tmb_kcal = EXCLUDED.tmb_kcal, protein_pct = EXCLUDED.protein_pct,
      bone_mass_kg = EXCLUDED.bone_mass_kg, health_notes = EXCLUDED.health_notes, updated_at = NOW()
    RETURNING entry_date, weight_kg, body_fat_pct, muscle_mass_kg, body_water_pct, visceral_fat, metabolic_age, tmb_kcal, protein_pct, bone_mass_kg, health_notes, updated_at
  `) as { rows: Array<Record<string, unknown>> };

  res.json({ entry: rows.rows[0] ?? null });
});

router.get("/procoach/me/bioimpedance", async (req: Request, res: Response) => {
  const limitParam = Math.max(1, Math.min(90, Number(req.query.limit) || 30));
  await ensureBioimpedanceTable();
  const athleteId = await getOrCreateMonoAthleteId();

  const rows = await db.execute(sql`
    SELECT entry_date, weight_kg, body_fat_pct, muscle_mass_kg, body_water_pct, visceral_fat, metabolic_age, tmb_kcal, protein_pct, bone_mass_kg, health_notes, updated_at
    FROM procoach_bioimpedance
    WHERE athlete_id = ${athleteId}
    ORDER BY entry_date DESC
    LIMIT ${limitParam}
  `) as { rows: Array<Record<string, unknown>> };

  res.json({ entries: rows.rows });
});

export default router;