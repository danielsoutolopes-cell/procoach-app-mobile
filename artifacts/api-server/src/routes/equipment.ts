import { Router, type Request, type Response } from "express";
import { db, eq, and, sql } from "@workspace/db";
import { shoesTable, workoutEntriesTable } from "@workspace/db/schema";
import { getOrCreateMonoAthleteId } from "./migrations.js"; 

export const equipmentRouter = Router();

// 1. GET /athletes/me/shoes (Buscar Tênis)
equipmentRouter.get("/athletes/me/shoes", async (req: Request, res: Response) => {
  try {
    const athleteId = await getOrCreateMonoAthleteId();

    const rows = await db.execute(sql`
      SELECT
        s.id,
        s.nickname,
        s.brand,
        s.model,
        s.initial_km,
        s.target_km,
        s.retired_at,
        (s.initial_km + COALESCE(SUM(w.distance_km), 0))::real AS km_total
      FROM procoach_shoes s
      LEFT JOIN procoach_workout_entries w
        ON w.athlete_id = s.athlete_id AND w.shoe_id = s.id
      WHERE s.athlete_id = ${athleteId}
      GROUP BY s.id
      ORDER BY s.retired_at DESC NULLS LAST, s.id DESC
    `) as { rows: Array<any> };

    const formattedShoes = rows.rows.map(shoe => ({
      id: shoe.id.toString(),
      nickname: shoe.nickname,
      brandModel: [shoe.brand, shoe.model].filter(Boolean).join(" ") || null,
      initialKm: Number(shoe.initial_km) || 0,
      currentKm: Number(shoe.km_total) || 0,
      targetKm: Number(shoe.target_km) || 500,
      isActive: shoe.retired_at === null,
    }));

    res.status(200).json(formattedShoes);
  } catch (error) {
    console.error("Erro ao buscar tênis:", error);
    res.status(500).json({ error: "Falha ao buscar equipamentos." });
  }
});

// 2. POST /athletes/me/shoes (Criar tênis)
equipmentRouter.post("/athletes/me/shoes", async (req: Request, res: Response) => {
  try {
    const athleteId = await getOrCreateMonoAthleteId();
    const { nickname, brand, model, initialKm = 0, targetKm = 500 } = req.body;

    const [newShoe] = await db.insert(shoesTable).values({
      athleteId, nickname, brand, model, initialKm, targetKm,
    }).returning();

    res.status(201).json({
      id: newShoe.id.toString(),
      nickname: newShoe.nickname,
      brandModel: [newShoe.brand, newShoe.model].filter(Boolean).join(" ") || null,
      initialKm: newShoe.initialKm,
      currentKm: newShoe.initialKm,
      targetKm: newShoe.targetKm,
      isActive: newShoe.retiredAt === null,
    });
  } catch (error) {
    console.error("Erro ao cadastrar tênis:", error);
    res.status(500).json({ error: "Falha ao salvar equipamento." });
  }
});

// 3. PATCH /athletes/me/shoes/:id/retire (Aposentar tênis)
equipmentRouter.patch("/athletes/me/shoes/:id/retire", async (req: Request, res: Response) => {
  try {
    const athleteId = await getOrCreateMonoAthleteId();
    const shoeId = parseInt(String(req.params.id), 10);

    await db.update(shoesTable)
      .set({ retiredAt: new Date(), updatedAt: new Date() })
      .where(and(eq(shoesTable.id, shoeId), eq(shoesTable.athleteId, athleteId)) as any);

    res.status(200).json({ message: "Equipamento arquivado com sucesso!" });
  } catch (error) {
    res.status(500).json({ error: "Falha ao processar o arquivamento." });
  }
});

// 4. POST /athletes/me/workouts/:id/debrief (Atualizar KM do tênis no pós-treino)
equipmentRouter.post("/athletes/me/workouts/:id/debrief", async (req: Request, res: Response) => {
  try {
    const athleteId = await getOrCreateMonoAthleteId();
    const workoutId = parseInt(String(req.params.id), 10);
    const { shoe_id } = req.body;

    if (shoe_id) {
      await db.update(workoutEntriesTable)
        .set({ shoeId: parseInt(String(shoe_id), 10) })
        .where(and(eq(workoutEntriesTable.id, workoutId), eq(workoutEntriesTable.athleteId, athleteId)) as any);
    }

    res.status(200).json({ message: "Debrief salvo e KM atualizado!" });
  } catch (error) {
    res.status(500).json({ error: "Falha ao registrar debrief." });
  }
});