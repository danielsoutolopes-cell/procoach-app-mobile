import { db, sql, eq } from "@workspace/db";
import { athletesTable } from "@workspace/db/schema";

export const MONO_DEVICE_ID = "mono";

export function defaultRaceDateISO(): string {
  return new Date(Date.now() + 16 * 7 * 24 * 60 * 60 * 1000).toISOString();
}

let athletesRacesReady = false;
export async function ensureAthletesRacesColumn(): Promise<void> {
  if (athletesRacesReady) return;
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_athletes
      ADD COLUMN IF NOT EXISTS races JSONB NOT NULL DEFAULT '[]'::jsonb
  `);
  athletesRacesReady = true;
}

export async function getOrCreateMonoAthleteId(): Promise<number> {
  await ensureAthletesRacesColumn();
  const existing = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, MONO_DEVICE_ID) as any)
    .limit(1);

  if (existing[0]) return existing[0].id;

  const [created] = await db
    .insert(athletesTable)
    .values({
      deviceId: MONO_DEVICE_ID,
      targetRaceDate: defaultRaceDateISO(),
    })
    .returning();

  return created.id;
}

let gelTablesReady = false;
export async function ensureGelTables(): Promise<void> {
  if (gelTablesReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS procoach_gel_stock (
      athlete_id INTEGER PRIMARY KEY REFERENCES procoach_athletes(id) ON DELETE CASCADE,
      gels_in_stock INTEGER NOT NULL DEFAULT 0,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS procoach_gel_usage (
      id SERIAL PRIMARY KEY,
      athlete_id INTEGER NOT NULL REFERENCES procoach_athletes(id) ON DELETE CASCADE,
      entry_date VARCHAR(32) NOT NULL,
      context VARCHAR(64) NOT NULL,
      gels_used INTEGER NOT NULL DEFAULT 0,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  gelTablesReady = true;
}

let feedbackTableReady = false;
export async function ensureWorkoutFeedbackTable(): Promise<void> {
  if (feedbackTableReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS procoach_workout_feedback (
      athlete_id INTEGER NOT NULL REFERENCES procoach_athletes(id) ON DELETE CASCADE,
      entry_date VARCHAR(32) NOT NULL,
      rpe INTEGER,
      pain_level INTEGER,
      notes TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (athlete_id, entry_date)
    )
  `);
  feedbackTableReady = true;
}

let planTableReady = false;
export async function ensurePlanTable(): Promise<void> {
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
      details_json JSONB,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (athlete_id, session_date)
    )
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_plan_sessions
      ADD COLUMN IF NOT EXISTS planned_km INTEGER NOT NULL DEFAULT 0
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_plan_sessions
      ADD COLUMN IF NOT EXISTS details_json JSONB
  `);
  planTableReady = true;
}

let strengthTablesReady = false;
let strengthCatalogSeeded = false;
export async function ensureStrengthTables(): Promise<void> {
  if (strengthTablesReady) return;
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS procoach_strength_exercise_catalog (
      id SERIAL PRIMARY KEY,
      name VARCHAR(160) NOT NULL UNIQUE,
      aliases JSONB NOT NULL DEFAULT '[]'::jsonb,
      primary_muscles JSONB NOT NULL DEFAULT '[]'::jsonb,
      secondary_muscles JSONB NOT NULL DEFAULT '[]'::jsonb,
      equipment JSONB NOT NULL DEFAULT '[]'::jsonb,
      pattern VARCHAR(32),
      is_unilateral BOOLEAN NOT NULL DEFAULT false,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS procoach_strength_exercise_catalog_name_idx ON procoach_strength_exercise_catalog (lower(name))`);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS procoach_strength_templates (
      athlete_id INTEGER NOT NULL REFERENCES procoach_athletes(id) ON DELETE CASCADE,
      code VARCHAR(2) NOT NULL,
      name VARCHAR(80) NOT NULL DEFAULT '',
      notes TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (athlete_id, code)
    )
  `);

  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS procoach_strength_template_exercises (
      athlete_id INTEGER NOT NULL REFERENCES procoach_athletes(id) ON DELETE CASCADE,
      template_code VARCHAR(2) NOT NULL,
      order_index INTEGER NOT NULL,
      catalog_exercise_id INTEGER REFERENCES procoach_strength_exercise_catalog(id) ON DELETE SET NULL,
      exercise_name_override VARCHAR(160),
      sets INTEGER,
      reps VARCHAR(32),
      rest_sec INTEGER,
      rpe_target NUMERIC(4,1),
      load VARCHAR(32),
      tempo VARCHAR(16),
      notes TEXT,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (athlete_id, template_code, order_index)
    )
  `);
  await db.execute(sql`CREATE INDEX IF NOT EXISTS procoach_strength_template_exercises_tpl_idx ON procoach_strength_template_exercises (athlete_id, template_code)`);
  strengthTablesReady = true;
}

export type StrengthTemplateCode = "A" | "B" | "C";

type StrengthCatalogSeedItem = {
  name: string;
  aliases: string[];
  primaryMuscles: string[];
  secondaryMuscles: string[];
  equipment: string[];
  pattern: string;
  unilateral?: boolean;
};

const STRENGTH_CATALOG_SEED: StrengthCatalogSeedItem[] = [
  { name: "Agachamento livre", aliases: ["Agachamento com barra", "Back squat"], primaryMuscles: ["Quadríceps", "Glúteos"], secondaryMuscles: ["Core", "Adutores"], equipment: ["Barra"], pattern: "squat" },
  { name: "Agachamento frontal", aliases: ["Front squat"], primaryMuscles: ["Quadríceps"], secondaryMuscles: ["Core", "Glúteos"], equipment: ["Barra"], pattern: "squat" },
  { name: "Agachamento goblet", aliases: ["Goblet squat"], primaryMuscles: ["Quadríceps", "Glúteos"], secondaryMuscles: ["Core"], equipment: ["Halter", "Kettlebell"], pattern: "squat" },
  { name: "Leg press", aliases: ["Prensa 45", "Leg press 45"], primaryMuscles: ["Quadríceps", "Glúteos"], secondaryMuscles: ["Isquiotibiais"], equipment: ["Máquina"], pattern: "squat" },
  { name: "Hack squat", aliases: ["Agachamento hack"], primaryMuscles: ["Quadríceps"], secondaryMuscles: ["Glúteos"], equipment: ["Máquina"], pattern: "squat" },
  { name: "Afundo", aliases: ["Lunge", "Passada"], primaryMuscles: ["Quadríceps", "Glúteos"], secondaryMuscles: ["Core"], equipment: ["Peso corporal", "Halter", "Barra"], pattern: "lunge", unilateral: true },
  { name: "Afundo búlgaro", aliases: ["Bulgarian split squat"], primaryMuscles: ["Quadríceps", "Glúteos"], secondaryMuscles: ["Core"], equipment: ["Peso corporal", "Halter"], pattern: "lunge", unilateral: true },
  { name: "Step-up", aliases: ["Subida no banco"], primaryMuscles: ["Glúteos", "Quadríceps"], secondaryMuscles: ["Core"], equipment: ["Peso corporal", "Halter"], pattern: "lunge", unilateral: true },
  { name: "Cadeira extensora", aliases: ["Extensão de joelho"], primaryMuscles: ["Quadríceps"], secondaryMuscles: [], equipment: ["Máquina"], pattern: "isolation" },
  { name: "Cadeira flexora", aliases: ["Flexão de joelho"], primaryMuscles: ["Isquiotibiais"], secondaryMuscles: [], equipment: ["Máquina"], pattern: "isolation" },
  { name: "Stiff", aliases: ["Stiff com barra", "Romanian deadlift", "RDL"], primaryMuscles: ["Isquiotibiais", "Glúteos"], secondaryMuscles: ["Eretores da espinha", "Core"], equipment: ["Barra", "Halter"], pattern: "hinge" },
  { name: "Levantamento terra", aliases: ["Deadlift", "Terra"], primaryMuscles: ["Glúteos", "Isquiotibiais"], secondaryMuscles: ["Eretores da espinha", "Trapézio", "Core"], equipment: ["Barra"], pattern: "hinge" },
  { name: "Terra sumô", aliases: ["Sumo deadlift"], primaryMuscles: ["Glúteos", "Adutores"], secondaryMuscles: ["Quadríceps", "Core"], equipment: ["Barra"], pattern: "hinge" },
  { name: "Levantamento terra com trap bar", aliases: ["Trap bar deadlift"], primaryMuscles: ["Quadríceps", "Glúteos"], secondaryMuscles: ["Isquiotibiais", "Core"], equipment: ["Trap bar"], pattern: "hinge" },
  { name: "Hip thrust", aliases: ["Elevação pélvica", "Glute bridge com barra"], primaryMuscles: ["Glúteos"], secondaryMuscles: ["Isquiotibiais"], equipment: ["Barra", "Máquina"], pattern: "hinge" },
  { name: "Glute bridge", aliases: ["Ponte de glúteos"], primaryMuscles: ["Glúteos"], secondaryMuscles: ["Isquiotibiais", "Core"], equipment: ["Peso corporal", "Barra", "Halter"], pattern: "hinge" },
  { name: "Panturrilha em pé", aliases: ["Elevação de panturrilha", "Standing calf raise"], primaryMuscles: ["Panturrilha"], secondaryMuscles: [], equipment: ["Máquina", "Halter"], pattern: "isolation" },
  { name: "Panturrilha sentado", aliases: ["Seated calf raise"], primaryMuscles: ["Panturrilha"], secondaryMuscles: [], equipment: ["Máquina"], pattern: "isolation" },
  { name: "Supino reto", aliases: ["Bench press", "Supino com barra"], primaryMuscles: ["Peitoral"], secondaryMuscles: ["Tríceps", "Deltoide anterior"], equipment: ["Barra"], pattern: "push" },
  { name: "Supino inclinado", aliases: ["Incline bench press"], primaryMuscles: ["Peitoral"], secondaryMuscles: ["Tríceps", "Deltoide anterior"], equipment: ["Barra", "Halter"], pattern: "push" },
  { name: "Supino com halteres", aliases: ["Dumbbell bench press"], primaryMuscles: ["Peitoral"], secondaryMuscles: ["Tríceps", "Deltoide anterior"], equipment: ["Halter"], pattern: "push" },
  { name: "Crucifixo", aliases: ["Fly", "Crucifixo reto"], primaryMuscles: ["Peitoral"], secondaryMuscles: ["Deltoide anterior"], equipment: ["Halter", "Cabo", "Máquina"], pattern: "isolation" },
  { name: "Flexão de braço", aliases: ["Push-up"], primaryMuscles: ["Peitoral"], secondaryMuscles: ["Tríceps", "Core", "Deltoide anterior"], equipment: ["Peso corporal"], pattern: "push" },
  { name: "Mergulho nas paralelas", aliases: ["Dips"], primaryMuscles: ["Tríceps", "Peitoral"], secondaryMuscles: ["Deltoide anterior"], equipment: ["Peso corporal", "Paralelas"], pattern: "push" },
  { name: "Desenvolvimento militar", aliases: ["Overhead press", "Shoulder press com barra"], primaryMuscles: ["Deltoide"], secondaryMuscles: ["Tríceps", "Core"], equipment: ["Barra"], pattern: "push" },
  { name: "Desenvolvimento com halteres", aliases: ["Dumbbell shoulder press"], primaryMuscles: ["Deltoide"], secondaryMuscles: ["Tríceps"], equipment: ["Halter"], pattern: "push" },
  { name: "Elevação lateral", aliases: ["Lateral raise"], primaryMuscles: ["Deltoide lateral"], secondaryMuscles: [], equipment: ["Halter", "Cabo"], pattern: "isolation" },
  { name: "Elevação frontal", aliases: ["Front raise"], primaryMuscles: ["Deltoide anterior"], secondaryMuscles: [], equipment: ["Halter", "Cabo"], pattern: "isolation" },
  { name: "Remada curvada", aliases: ["Barbell row", "Remada com barra"], primaryMuscles: ["Dorsal", "Romboides"], secondaryMuscles: ["Bíceps", "Eretores da espinha"], equipment: ["Barra"], pattern: "pull" },
  { name: "Remada unilateral com halter", aliases: ["One-arm dumbbell row"], primaryMuscles: ["Dorsal"], secondaryMuscles: ["Bíceps", "Romboides"], equipment: ["Halter"], pattern: "pull", unilateral: true },
  { name: "Remada baixa", aliases: ["Seated cable row"], primaryMuscles: ["Dorsal", "Romboides"], secondaryMuscles: ["Bíceps"], equipment: ["Cabo"], pattern: "pull" },
  { name: "Puxada na frente", aliases: ["Lat pulldown"], primaryMuscles: ["Dorsal"], secondaryMuscles: ["Bíceps"], equipment: ["Cabo", "Máquina"], pattern: "pull" },
  { name: "Barra fixa", aliases: ["Pull-up", "Chin-up"], primaryMuscles: ["Dorsal"], secondaryMuscles: ["Bíceps", "Core"], equipment: ["Peso corporal"], pattern: "pull" },
  { name: "Face pull", aliases: ["Puxada rosto"], primaryMuscles: ["Deltoide posterior", "Romboides"], secondaryMuscles: ["Trapézio"], equipment: ["Cabo"], pattern: "pull" },
  { name: "Encolhimento", aliases: ["Shrug"], primaryMuscles: ["Trapézio"], secondaryMuscles: [], equipment: ["Halter", "Barra"], pattern: "pull" },
  { name: "Rosca direta", aliases: ["Biceps curl com barra"], primaryMuscles: ["Bíceps"], secondaryMuscles: ["Antebraço"], equipment: ["Barra"], pattern: "isolation" },
  { name: "Rosca alternada", aliases: ["Dumbbell curl"], primaryMuscles: ["Bíceps"], secondaryMuscles: ["Antebraço"], equipment: ["Halter"], pattern: "isolation", unilateral: true },
  { name: "Rosca martelo", aliases: ["Hammer curl"], primaryMuscles: ["Bíceps", "Braquial"], secondaryMuscles: ["Antebraço"], equipment: ["Halter"], pattern: "isolation", unilateral: true },
  { name: "Tríceps pulley", aliases: ["Triceps pushdown"], primaryMuscles: ["Tríceps"], secondaryMuscles: [], equipment: ["Cabo"], pattern: "isolation" },
  { name: "Tríceps testa", aliases: ["Skull crusher"], primaryMuscles: ["Tríceps"], secondaryMuscles: [], equipment: ["Barra", "Halter"], pattern: "isolation" },
  { name: "Extensão de tríceps acima da cabeça", aliases: ["Overhead triceps extension"], primaryMuscles: ["Tríceps"], secondaryMuscles: [], equipment: ["Halter", "Cabo"], pattern: "isolation" },
  { name: "Prancha", aliases: ["Plank"], primaryMuscles: ["Core"], secondaryMuscles: ["Glúteos"], equipment: ["Peso corporal"], pattern: "core" },
  { name: "Prancha lateral", aliases: ["Side plank"], primaryMuscles: ["Core"], secondaryMuscles: ["Glúteos"], equipment: ["Peso corporal"], pattern: "core", unilateral: true },
  { name: "Dead bug", aliases: ["Inseto morto"], primaryMuscles: ["Core"], secondaryMuscles: [], equipment: ["Peso corporal"], pattern: "core" },
  { name: "Bird dog", aliases: ["Cachorro de caça"], primaryMuscles: ["Core"], secondaryMuscles: ["Glúteos"], equipment: ["Peso corporal"], pattern: "core", unilateral: true },
  { name: "Abdominal crunch", aliases: ["Crunch"], primaryMuscles: ["Abdômen"], secondaryMuscles: [], equipment: ["Peso corporal", "Máquina"], pattern: "core" },
  { name: "Elevação de pernas", aliases: ["Leg raise"], primaryMuscles: ["Abdômen"], secondaryMuscles: ["Flexores do quadril"], equipment: ["Peso corporal"], pattern: "core" },
  { name: "Pallof press", aliases: ["Anti-rotação"], primaryMuscles: ["Core"], secondaryMuscles: [], equipment: ["Cabo", "Elástico"], pattern: "core", unilateral: true },
  { name: "Farmer walk", aliases: ["Caminhada do fazendeiro"], primaryMuscles: ["Core", "Trapézio"], secondaryMuscles: ["Antebraço", "Glúteos"], equipment: ["Halter", "Kettlebell"], pattern: "carry" },
  { name: "Levantamento terra romeno unilateral", aliases: ["Single-leg RDL"], primaryMuscles: ["Isquiotibiais", "Glúteos"], secondaryMuscles: ["Core"], equipment: ["Halter"], pattern: "hinge", unilateral: true },
  { name: "Cadeira abdutora", aliases: ["Abdução de quadril"], primaryMuscles: ["Glúteo médio"], secondaryMuscles: [], equipment: ["Máquina"], pattern: "isolation" },
  { name: "Cadeira adutora", aliases: ["Adução de quadril"], primaryMuscles: ["Adutores"], secondaryMuscles: [], equipment: ["Máquina"], pattern: "isolation" },
  { name: "Extensão de quadril no cabo", aliases: ["Glute kickback"], primaryMuscles: ["Glúteos"], secondaryMuscles: ["Core"], equipment: ["Cabo"], pattern: "isolation", unilateral: true },
  { name: "Elevação pélvica unilateral", aliases: ["Single-leg glute bridge"], primaryMuscles: ["Glúteos"], secondaryMuscles: ["Core"], equipment: ["Peso corporal"], pattern: "hinge", unilateral: true },
  { name: "Remada cavalinho", aliases: ["T-bar row"], primaryMuscles: ["Dorsal", "Romboides"], secondaryMuscles: ["Bíceps"], equipment: ["Máquina", "Barra"], pattern: "pull" },
  { name: "Pullover", aliases: ["Pullover no cabo", "Pullover com halter"], primaryMuscles: ["Dorsal"], secondaryMuscles: ["Peitoral"], equipment: ["Cabo", "Halter"], pattern: "pull" },
  { name: "Peck deck", aliases: ["Voador"], primaryMuscles: ["Peitoral"], secondaryMuscles: ["Deltoide anterior"], equipment: ["Máquina"], pattern: "isolation" },
  { name: "Crossover no cabo", aliases: ["Crossover"], primaryMuscles: ["Peitoral"], secondaryMuscles: ["Deltoide anterior"], equipment: ["Cabo"], pattern: "isolation" },
  { name: "Puxada alta (pegada supinada)", aliases: ["Chin-down", "Pulldown supinado"], primaryMuscles: ["Dorsal"], secondaryMuscles: ["Bíceps"], equipment: ["Cabo"], pattern: "pull" },
  { name: "Remada alta", aliases: ["Upright row"], primaryMuscles: ["Deltoide", "Trapézio"], secondaryMuscles: [], equipment: ["Barra", "Halter", "Cabo"], pattern: "pull" },
  { name: "Rosca Scott", aliases: ["Preacher curl"], primaryMuscles: ["Bíceps"], secondaryMuscles: [], equipment: ["Máquina", "Barra", "Halter"], pattern: "isolation" },
  { name: "Extensão lombar", aliases: ["Hiperextensão", "Back extension"], primaryMuscles: ["Eretores da espinha"], secondaryMuscles: ["Glúteos", "Isquiotibiais"], equipment: ["Banco romano", "Peso corporal"], pattern: "hinge" },
  { name: "Good morning", aliases: ["Bom dia"], primaryMuscles: ["Isquiotibiais", "Eretores da espinha"], secondaryMuscles: ["Glúteos"], equipment: ["Barra"], pattern: "hinge" },
  { name: "Puxada no pulley com triângulo", aliases: ["Pulldown pegada neutra"], primaryMuscles: ["Dorsal"], secondaryMuscles: ["Bíceps"], equipment: ["Cabo"], pattern: "pull" },
  { name: "Desenvolvimento Arnold", aliases: ["Arnold press"], primaryMuscles: ["Deltoide"], secondaryMuscles: ["Tríceps"], equipment: ["Halter"], pattern: "push" },
  { name: "Abdominal na polia", aliases: ["Cable crunch"], primaryMuscles: ["Abdômen"], secondaryMuscles: [], equipment: ["Cabo"], pattern: "core" },
  { name: "Russian twist", aliases: ["Torção russa"], primaryMuscles: ["Core"], secondaryMuscles: [], equipment: ["Peso corporal", "Halter"], pattern: "core" },
  { name: "Flexão nórdica", aliases: ["Nordic curl"], primaryMuscles: ["Isquiotibiais"], secondaryMuscles: ["Glúteos"], equipment: ["Peso corporal"], pattern: "hinge" },
  { name: "Mesa flexora", aliases: ["Flexora deitado"], primaryMuscles: ["Isquiotibiais"], secondaryMuscles: [], equipment: ["Máquina"], pattern: "isolation" },
  { name: "Agachamento no smith", aliases: ["Smith squat"], primaryMuscles: ["Quadríceps", "Glúteos"], secondaryMuscles: ["Core"], equipment: ["Smith"], pattern: "squat" },
  { name: "Supino no smith", aliases: ["Smith bench press"], primaryMuscles: ["Peitoral"], secondaryMuscles: ["Tríceps", "Deltoide anterior"], equipment: ["Smith"], pattern: "push" },
  { name: "Remada no smith", aliases: ["Smith row"], primaryMuscles: ["Dorsal"], secondaryMuscles: ["Bíceps"], equipment: ["Smith"], pattern: "pull" },
  { name: "Puxada na barra guiada", aliases: ["Pull-up assistido"], primaryMuscles: ["Dorsal"], secondaryMuscles: ["Bíceps"], equipment: ["Máquina"], pattern: "pull" },
  { name: "Flexão plantar no leg press", aliases: ["Panturrilha no leg press"], primaryMuscles: ["Panturrilha"], secondaryMuscles: [], equipment: ["Máquina"], pattern: "isolation" },
  { name: "Ab wheel", aliases: ["Roda abdominal"], primaryMuscles: ["Core"], secondaryMuscles: ["Lats"], equipment: ["Roda", "Peso corporal"], pattern: "core" },
  { name: "Pulldown reto", aliases: ["Straight-arm pulldown"], primaryMuscles: ["Dorsal"], secondaryMuscles: ["Tríceps"], equipment: ["Cabo"], pattern: "pull" },
  { name: "Pulldown unilateral", aliases: ["Puxada unilateral no cabo"], primaryMuscles: ["Dorsal"], secondaryMuscles: ["Bíceps"], equipment: ["Cabo"], pattern: "pull", unilateral: true },
  { name: "Remada no banco inclinado", aliases: ["Chest-supported row"], primaryMuscles: ["Dorsal", "Romboides"], secondaryMuscles: ["Bíceps"], equipment: ["Halter", "Máquina"], pattern: "pull" },
  { name: "Puxada alta na máquina", aliases: ["Puxada máquina"], primaryMuscles: ["Dorsal"], secondaryMuscles: ["Bíceps"], equipment: ["Máquina"], pattern: "pull" },
  { name: "Elevação de quadril no banco", aliases: ["Hip extension"], primaryMuscles: ["Glúteos"], secondaryMuscles: ["Isquiotibiais"], equipment: ["Banco", "Peso corporal"], pattern: "hinge" },
  { name: "Abdução com elástico", aliases: ["Mini band lateral walk"], primaryMuscles: ["Glúteo médio"], secondaryMuscles: [], equipment: ["Elástico"], pattern: "isolation" },
  { name: "Mobilidade de tornozelo", aliases: ["Ankle mobility"], primaryMuscles: ["Mobilidade"], secondaryMuscles: [], equipment: ["Peso corporal"], pattern: "mobility" },
  { name: "Mobilidade de quadril", aliases: ["Hip mobility"], primaryMuscles: ["Mobilidade"], secondaryMuscles: [], equipment: ["Peso corporal"], pattern: "mobility" },
];

export async function ensureStrengthCatalogSeed(): Promise<void> {
  await ensureStrengthTables();
  if (strengthCatalogSeeded) return;
  const count = await db.execute(sql`SELECT COUNT(*)::int AS n FROM procoach_strength_exercise_catalog`) as { rows: Array<{ n: number }> };
  const n = count.rows?.[0]?.n ?? 0;
  if (n > 0) {
    strengthCatalogSeeded = true;
    return;
  }
  for (const ex of STRENGTH_CATALOG_SEED) {
    await db.execute(sql`
      INSERT INTO procoach_strength_exercise_catalog
        (name, aliases, primary_muscles, secondary_muscles, equipment, pattern, is_unilateral, created_at, updated_at)
      VALUES
        (${ex.name}, ${JSON.stringify(ex.aliases)}::jsonb, ${JSON.stringify(ex.primaryMuscles)}::jsonb, ${JSON.stringify(ex.secondaryMuscles)}::jsonb, ${JSON.stringify(ex.equipment)}::jsonb, ${ex.pattern}, ${Boolean(ex.unilateral)}, NOW(), NOW())
      ON CONFLICT (name) DO NOTHING
    `);
  }
  strengthCatalogSeeded = true;
}

let shoesTablesReady = false;
export async function ensureShoesTables(): Promise<void> {
  if (shoesTablesReady) return;

  // 1) Shoes table
  await db.execute(sql`
    CREATE TABLE IF NOT EXISTS procoach_shoes (
      id SERIAL PRIMARY KEY,
      athlete_id INTEGER NOT NULL REFERENCES procoach_athletes(id) ON DELETE CASCADE,
      nickname VARCHAR(120) NOT NULL,
      brand VARCHAR(80),
      model VARCHAR(120),
      start_date VARCHAR(32),
      initial_km INTEGER NOT NULL DEFAULT 0,
      target_km INTEGER NOT NULL DEFAULT 500,
      retired_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  // 2) Workout entries columns (for shoes + origin)
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
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_workout_entries
      ADD COLUMN IF NOT EXISTS panel_distance_km NUMERIC(6,2)
  `);

  shoesTablesReady = true;
}

let bioimpedanceTableReady = false;
export async function ensureBioimpedanceTable(): Promise<void> {
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
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS muscle_mass_kg NUMERIC(6,2)
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS body_water_pct NUMERIC(5,2)
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS visceral_fat NUMERIC(5,2)
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS metabolic_age INTEGER
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS tmb_kcal INTEGER
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS protein_pct NUMERIC(5,2)
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS bone_mass_kg NUMERIC(5,2)
  `);
  await db.execute(sql`
    ALTER TABLE IF EXISTS procoach_bioimpedance
      ADD COLUMN IF NOT EXISTS health_notes TEXT
  `);
  bioimpedanceTableReady = true;
}