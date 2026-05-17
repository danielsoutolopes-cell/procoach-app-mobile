import { Router, type Request, type Response } from 'express';
import { db, eq, sql } from '@workspace/db';
import { athletesTable } from '@workspace/db/schema';
import multer from 'multer';
import fs from 'fs';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { getOrCreateMonoAthleteId } from './migrations';

export const athletesRouter = Router();

function mapOpenWeatherToWMO(id: number): number {
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

async function getWeatherForDate(dateISO: string, lat = -23.6087, lon = -46.6676) {
  const apiKey = process.env.OPENWEATHER_API_KEY;
  if (!apiKey) return null;
  try {
    const url = `https://api.openweathermap.org/data/2.5/forecast?lat=${lat}&lon=${lon}&appid=${apiKey}&units=metric`;
    const r = await fetch(url);
    if (!r.ok) return null;
    const data = await r.json() as any;
    
    let min = 999;
    let max = -999;
    let pop = 0;
    let weathercode = 0;
    let found = false;

    for (const item of data.list || []) {
      const itemDate = item.dt_txt.split(' ')[0];
      if (itemDate === dateISO) {
        found = true;
        min = Math.min(min, item.main.temp_min);
        max = Math.max(max, item.main.temp_max);
        pop = Math.max(pop, item.pop);
        weathercode = item.weather[0].id;
      }
    }
    
    if (found) {
      return {
        rain_probability: Math.round(pop * 100),
        min: Math.round(min),
        max: Math.round(max),
        weathercode: mapOpenWeatherToWMO(weathercode)
      };
    }
    return null;
  } catch {
    return null;
  }
}

// Configura o multer para salvar temporariamente os uploads na pasta 'uploads/'
const upload = multer({ dest: 'uploads/' });

// 1. GET /profile - Busca o perfil e estoque de géis do Atleta
athletesRouter.get(['/me/profile', '/:deviceId/profile'], async (req: Request, res: Response) => {
  try {
    const id = await getOrCreateMonoAthleteId();
    const rows = await db.select().from(athletesTable).where(eq(athletesTable.id, id)).limit(1);
    const athlete = rows[0];
    
    if (!athlete) {
      res.status(404).json({ error: 'Athlete not found' });
      return;
    }

    // MOCK: Injetando uma Prova Âncora para daqui a 2 dias para ativar o "Modo Race Day"
    const nextRace = new Date();
    nextRace.setDate(nextRace.getDate() + 2);

    res.json({
      id: athlete.id.toString(),
      name: athlete.name || 'CEO',
      // O campo gelInventory pode não estar mapeado formalmente no schema yet, 
      // usamos um fallback seguro caso não exista.
      gel_inventory: (athlete as any).gelInventory ?? 10, 
      races: [{
        id: '1',
        name: 'Meia Maratona (Alvo)',
        date: nextRace.toISOString(),
        type: 'p1',
        is_anchor: true
      }],
    });
  } catch (err) {
    console.error('[API] Erro ao buscar perfil:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 10. POST /race-strategy - Gera a Estratégia de Prova com Gemini
athletesRouter.post(['/me/race-strategy', '/:deviceId/race-strategy'], async (req: Request, res: Response) => {
  try {
    const { raceName } = req.body;
    const apiKey = (process.env.GEMINI_API_KEY || "").replace(/^['"`]+|['"`]+$/g, "").trim();
    const modelName = (process.env.GEMINI_MODEL || "gemini-1.5-flash-latest").replace(/^['"`]+|['"`]+$/g, "").trim();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel(
      { model: modelName },
      { apiVersion: "v1beta" }
    );

    const prompt = `Você é um treinador de corrida de elite. Seu atleta vai correr a prova "${raceName}" muito em breve.
Crie uma estratégia de prova curta e tática.
Inclua 3 bullet points práticos (Ex: pacing, hidratação, mentalidade).
Seja direto, inspirador e não use formatação markdown excessiva além dos bullets.`;

    const result = await model.generateContent(prompt);
    res.json({ strategy: result.response.text() });
  } catch (err) {
    console.error('[API] Erro na IA de Race Strategy:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 2. PATCH /gels - Atualiza o estoque de géis (Atualização Otimista)
athletesRouter.patch(['/me/gels', '/:deviceId/gels'], async (req: Request, res: Response) => {
  try {
    const id = await getOrCreateMonoAthleteId();
    const { gel_inventory } = req.body;
    
    // Usamos raw SQL para injetar direto na coluna correta no Postgres
    await db.execute(sql`UPDATE procoach_athletes SET gel_inventory = ${gel_inventory} WHERE id = ${id}`);
    res.json({ success: true, gel_inventory });
  } catch (err) {
    console.error('[API] Erro ao atualizar géis:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 3. GET /shoes - Retorna a Rotação de Tênis
athletesRouter.get(['/me/shoes', '/:deviceId/shoes'], async (req: Request, res: Response) => {
  try {
    const id = await getOrCreateMonoAthleteId();
    const rows = await db.execute(sql`
      SELECT id, nickname, brand, initial_km, target_km, is_active
      FROM procoach_shoes
      WHERE athlete_id = ${id} AND is_active = true
      ORDER BY created_at DESC
    `) as { rows: any[] };
    
    res.json(rows.rows.map(r => ({ ...r, id: r.id.toString() })));
  } catch (err) {
    console.error('[API] Erro ao buscar tênis:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 4. GET /workouts/today - Lê da tabela plan_sessions a missão do dia
athletesRouter.get(['/me/workouts/today', '/:deviceId/workouts/today'], async (req: Request, res: Response) => {
  try {
    const id = await getOrCreateMonoAthleteId();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    
    const rows = await db.execute(sql`
      SELECT session_date, activity, pace_target, treadmill_speed, structure, planned_km
      FROM procoach_plan_sessions
      WHERE athlete_id = ${id} AND session_date = ${today}
      LIMIT 1
    `) as { rows: any[] };
    
    const s = rows.rows[0];
    if (!s) {
      res.status(404).json(null); // Retorna 404 (Descanso)
      return;
    }

    const lat = req.query.lat ? Number(req.query.lat) : -23.6087;
    const lon = req.query.lon ? Number(req.query.lon) : -46.6676;
    const weather = await getWeatherForDate(s.session_date, lat, lon);
    const rainProb = weather?.rain_probability ?? 0;
    const suggestTreadmill = rainProb > 70;

    res.json({
      id: s.session_date,
      date: s.session_date,
      activity: s.activity,
      pace_alvo: s.pace_target,
      treadmill_speed: s.treadmill_speed,
      suggest_treadmill: suggestTreadmill,
      rain_probability: rainProb,
      weather_min: weather?.min,
      weather_max: weather?.max,
      weather_code: weather?.weathercode,
      distancia_km: s.planned_km,
      estrutura: s.structure,
      status: 'open',
      shoe_id: null
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 5. GET /bioimpedance/latest - Busca o último registro de biometria lançado
athletesRouter.get(['/me/bioimpedance/latest', '/:deviceId/bioimpedance/latest'], async (req: Request, res: Response) => {
  try {
    const id = await getOrCreateMonoAthleteId();
    const rows = await db.execute(sql`
      SELECT weight_kg, body_fat_pct, muscle_mass_kg
      FROM procoach_bioimpedance
      WHERE athlete_id = ${id}
      ORDER BY entry_date DESC
      LIMIT 2
    `) as { rows: any[] };
    
    const b = rows.rows[0];
    if (!b) {
      res.status(404).json(null);
      return;
    }

    const previous = rows.rows[1];
    let body_fat_diff = null;
    let weight_diff = null;
    let muscle_mass_diff = null;
    
    if (previous) {
      if (b.body_fat_pct !== null && previous.body_fat_pct !== null) {
        body_fat_diff = Number((Number(b.body_fat_pct) - Number(previous.body_fat_pct)).toFixed(2));
      }
      if (b.weight_kg !== null && previous.weight_kg !== null) {
        weight_diff = Number((Number(b.weight_kg) - Number(previous.weight_kg)).toFixed(2));
      }
      if (b.muscle_mass_kg !== null && previous.muscle_mass_kg !== null) {
        muscle_mass_diff = Number((Number(b.muscle_mass_kg) - Number(previous.muscle_mass_kg)).toFixed(2));
      }
    }

    res.json({
      weight_kg: Number(b.weight_kg),
      body_fat_pct: Number(b.body_fat_pct),
      muscle_mass_kg: Number(b.muscle_mass_kg),
      body_fat_diff: body_fat_diff,
      weight_diff: weight_diff,
      muscle_mass_diff: muscle_mass_diff
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 6. POST /bioimpedance/upload - Recebe o PDF vindo do Flutter
athletesRouter.post(['/me/bioimpedance/upload', '/:deviceId/bioimpedance/upload'], upload.single('file'), async (req: Request, res: Response) => {
  try {
    const id = await getOrCreateMonoAthleteId();
    if (!req.file) {
      res.status(400).json({ error: 'No file uploaded' });
      return;
    }

    console.log(`📄 Recebido PDF do atleta ${id}: ${req.file.originalname}`);
    
    const fileBytes = fs.readFileSync(req.file.path);
    const base64Data = fileBytes.toString('base64');

    const apiKey = (process.env.GEMINI_API_KEY || "").replace(/^['"`]+|['"`]+$/g, "").trim();
    const modelName = (process.env.GEMINI_MODEL || "gemini-1.5-flash-latest").replace(/^['"`]+|['"`]+$/g, "").trim();
    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel(
      { model: modelName },
      { apiVersion: "v1beta" }
    );

    const prompt = `Você é um especialista em nutrição e leitura de exames.
Analise o PDF de bioimpedância em anexo e extraia exatamente as seguintes métricas num JSON válido:
{
  "date": "YYYY-MM-DD",
  "weight_kg": numero,
  "body_fat_pct": numero,
  "muscle_mass_kg": numero,
  "body_water_pct": numero,
  "visceral_fat": numero,
  "metabolic_age": numero,
  "tmb_kcal": numero,
  "protein_pct": numero,
  "bone_mass_kg": numero
}
Caso alguma métrica não exista no documento, retorne null no valor. Responda apenas com o JSON bruto, sem marcação markdown ou blocos de código.`;

    const result = await model.generateContent([
      prompt,
      {
        inlineData: {
          data: base64Data,
          mimeType: 'application/pdf'
        }
      }
    ]);

    // Apaga o PDF temporário após enviar ao Gemini
    try { fs.unlinkSync(req.file.path); } catch {}

    const rawText = result.response.text();
    const cleaned = rawText.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
    const data = JSON.parse(cleaned);

    const entryDate = data.date || new Date().toISOString().slice(0, 10);

    await db.execute(sql`
      INSERT INTO procoach_bioimpedance
        (athlete_id, entry_date, weight_kg, body_fat_pct, muscle_mass_kg, body_water_pct, visceral_fat, metabolic_age, tmb_kcal, protein_pct, bone_mass_kg, created_at, updated_at)
      VALUES
        (${id}, ${entryDate}, ${data.weight_kg ?? null}, ${data.body_fat_pct ?? null}, ${data.muscle_mass_kg ?? null}, ${data.body_water_pct ?? null}, ${data.visceral_fat ?? null}, ${data.metabolic_age ?? null}, ${data.tmb_kcal ?? null}, ${data.protein_pct ?? null}, ${data.bone_mass_kg ?? null}, NOW(), NOW())
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
        updated_at = NOW()
    `);
    
    res.json({ success: true, message: 'Upload concluído e bioimpedância salva.', data });
  } catch (err) {
    console.error('[API] Erro ao processar PDF com IA:', err);
    if (req.file?.path) {
      try { fs.unlinkSync(req.file.path); } catch {}
    }
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 7. GET /compliance/week - Retorna os dados da semana atual para o gráfico (Segunda a Domingo)
athletesRouter.get(['/me/compliance/week', '/:deviceId/compliance/week'], async (req: Request, res: Response) => {
  try {
    const id = await getOrCreateMonoAthleteId();

    // Retorna para a segunda-feira atual (fuso horário SP)
    const nowSp = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
    const day = nowSp.getDay();
    const diff = day === 0 ? 6 : day - 1; 
    const monday = new Date(nowSp);
    monday.setDate(nowSp.getDate() - diff);

    // Gera o array com os 7 dias da semana (ex: ['2026-05-11', ..., '2026-05-17'])
    const days = Array.from({ length: 7 }).map((_, i) => {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      return d.toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
    });

    const from = days[0];
    const to = days[6];

    const planned = await db.execute(sql`
      SELECT session_date, COALESCE(SUM(planned_km), 0)::int AS planned_km
      FROM procoach_plan_sessions
      WHERE athlete_id = ${id} AND session_date >= ${from} AND session_date <= ${to}
      GROUP BY session_date
    `) as { rows: Array<{ session_date: string; planned_km: number }> };

    const completed = await db.execute(sql`
      SELECT entry_date, COALESCE(SUM(distance_km), 0)::int AS completed_km
      FROM procoach_workout_entries
      WHERE athlete_id = ${id} AND entry_date >= ${from} AND entry_date <= ${to}
      GROUP BY entry_date
    `) as { rows: Array<{ entry_date: string; completed_km: number }> };

    const plannedMap = new Map(planned.rows.map(r => [r.session_date, Number(r.planned_km)]));
    const completedMap = new Map(completed.rows.map(r => [r.entry_date, Number(r.completed_km)]));

    // Estrutura pronta para o Flutter (fl_chart) desenhar as 7 barras
    const result = days.map((date, index) => ({
      dayIndex: index,
      date: date,
      plannedKm: plannedMap.get(date) ?? 0,
      completedKm: completedMap.get(date) ?? 0
    }));

    res.json(result);
  } catch (err) {
    console.error('[API] Erro ao buscar compliance:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 8. GET /workouts/next - Retorna o próximo treino planejado (amanhã em diante)
athletesRouter.get(['/me/workouts/next', '/:deviceId/workouts/next'], async (req: Request, res: Response) => {
  try {
    const id = await getOrCreateMonoAthleteId();
    const today = new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });

    const rows = await db.execute(sql`
      SELECT session_date, activity, pace_target, treadmill_speed, structure, planned_km
      FROM procoach_plan_sessions
      WHERE athlete_id = ${id} AND session_date > ${today}
      ORDER BY session_date ASC
      LIMIT 1
    `) as { rows: any[] };

    const s = rows.rows[0];
    if (!s) {
      res.status(404).json(null);
      return;
    }

    const lat = req.query.lat ? Number(req.query.lat) : -23.6087;
    const lon = req.query.lon ? Number(req.query.lon) : -46.6676;
    const weather = await getWeatherForDate(s.session_date, lat, lon);
    const rainProb = weather?.rain_probability ?? 0;
    const suggestTreadmill = rainProb > 70;

    res.json({
      id: s.session_date,
      date: s.session_date,
      activity: s.activity,
      pace_alvo: s.pace_target,
      treadmill_speed: s.treadmill_speed,
      suggest_treadmill: suggestTreadmill,
      rain_probability: rainProb,
      weather_min: weather?.min,
      weather_max: weather?.max,
      weather_code: weather?.weathercode,
      distancia_km: s.planned_km,
      estrutura: s.structure,
      status: 'open',
      shoe_id: null
    });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 9. POST /workouts/feedback - Recebe RPE e Dor (Debrief)
athletesRouter.post(['/me/workouts/feedback', '/:deviceId/workouts/feedback'], async (req: Request, res: Response) => {
  try {
    const id = await getOrCreateMonoAthleteId();
    const { rpe, painLevel } = req.body;
    // Salva a dor articular na telemetria do Atleta (Radar Articular)
    await db.execute(sql`UPDATE procoach_athletes SET pain_level = ${painLevel} WHERE id = ${id}`);
    res.json({ success: true, message: 'Feedback salvo com sucesso' });
  } catch (err) {
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 11. PATCH /push-token - Salva o token do Firebase (FCM) no banco
athletesRouter.patch(['/me/push-token', '/:deviceId/push-token'], async (req: Request, res: Response) => {
  try {
    const id = await getOrCreateMonoAthleteId();
    const { token } = req.body;
    
    if (!token) {
      res.status(400).json({ error: 'Token is required' });
      return;
    }

    // Atualiza a coluna existente (reaproveitando expo_push_token para armazenar o do Firebase)
    await db.execute(sql`UPDATE procoach_athletes SET expo_push_token = ${token} WHERE id = ${id}`);
    
    res.json({ success: true, message: 'FCM Token salvo com sucesso' });
  } catch (err) {
    console.error('[API] Erro ao salvar FCM Token:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 12. GET /strength-routines - Busca as fichas de força (A/B/C)
athletesRouter.get(['/me/strength-routines', '/:deviceId/strength-routines'], async (req: Request, res: Response) => {
  try {
    const id = await getOrCreateMonoAthleteId();
    const rows = await db.execute(sql`
      SELECT routine_type, name, exercises
      FROM procoach_strength_routines
      WHERE athlete_id = ${id}
      ORDER BY routine_type ASC
    `) as { rows: any[] };
    
    res.json(rows.rows);
  } catch (err) {
    console.error('[API] Erro ao buscar fichas de força:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 13. POST /strength-routine - Salva ou atualiza uma ficha (A, B ou C)
athletesRouter.post(['/me/strength-routine', '/:deviceId/strength-routine'], async (req: Request, res: Response) => {
  try {
    const id = await getOrCreateMonoAthleteId();
    const { routineType, name, exercises } = req.body;

    if (!routineType || !name || !exercises) {
      res.status(400).json({ error: 'Faltam campos obrigatórios (routineType, name, exercises)' });
      return;
    }

    await db.execute(sql`
      INSERT INTO procoach_strength_routines (athlete_id, routine_type, name, exercises, updated_at)
      VALUES (${id}, ${routineType}, ${name}, ${JSON.stringify(exercises)}::jsonb, NOW())
      ON CONFLICT (athlete_id, routine_type)
      DO UPDATE SET
        name = EXCLUDED.name,
        exercises = EXCLUDED.exercises,
        updated_at = NOW()
    `);
    
    res.json({ success: true, message: 'Ficha salva com sucesso!' });
  } catch (err) {
    console.error('[API] Erro ao salvar ficha de força:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// 14. GET /plan-sessions - Busca todos os treinos planejados
athletesRouter.get(['/me/plan-sessions', '/:deviceId/plan-sessions'], async (req: Request, res: Response) => {
  try {
    const id = await getOrCreateMonoAthleteId();
    const rows = await db.execute(sql`
      SELECT session_date, activity, pace_target, structure, planned_km
      FROM procoach_plan_sessions
      WHERE athlete_id = ${id}
      ORDER BY session_date ASC
    `) as { rows: any[] };
    
    res.json(rows.rows);
  } catch (err) {
    console.error('[API] Erro ao buscar matriz de treinos:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});