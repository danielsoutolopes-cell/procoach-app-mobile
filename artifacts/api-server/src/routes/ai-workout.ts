import { Router, type IRouter, type Request, type Response } from "express";
import { db } from "@workspace/db";
import { athletesTable, workoutEntriesTable } from "@workspace/db/schema";
import { eq, desc } from "@workspace/db";

const router: IRouter = Router();

const MONO_DEVICE_ID = "mono";

/** Injury prevention thresholds */
const HRV_THRESHOLD = 45;    // below this → recovery
const PAIN_THRESHOLD = 2;    // at or above this → recovery

/** Returns a recovery workout without calling AI */
function injuryWorkout(painLevel: number, hrv: number) {
  const isBike = painLevel >= 3;
  const isFolga = hrv < 35;

  if (isFolga) {
    return {
      type: "folga",
      distanceKm: 0,
      durationMin: 0,
      description: "VFC muito baixa — seu corpo pede descanso total. Priorize sono e hidratação hoje.",
      reasoning: `VFC de ${hrv}ms indica recuperação insuficiente. Folga obrigatória para evitar lesão.`,
      injuryAlert: "Folga Forçada",
    };
  }
  if (isBike) {
    return {
      type: "bike",
      distanceKm: 20,
      durationMin: 45,
      description: "Bike indolor em ritmo leve. Sem impacto articular — mantém o condicionamento enquanto você se recupera.",
      reasoning: `Dor ${painLevel}/5 indica lesão ativa. Substituído por bike sem impacto até dor = 0.`,
      injuryAlert: "Bike Indolor",
    };
  }
  return {
    type: "regenerativo",
    distanceKm: 0,
    durationMin: 40,
    description: "Treino regenerativo: caminhada leve, mobilidade e foam roller. Deixe o corpo se recuperar.",
    reasoning: hrv < HRV_THRESHOLD
      ? `VFC de ${hrv}ms abaixo de ${HRV_THRESHOLD}ms — sistema nervoso sobrecarregado. Regenerativo obrigatório.`
      : `Dor ${painLevel}/5 detectada. Substituído por treino regenerativo para prevenção de lesão.`,
    injuryAlert: "Treino Regenerativo",
  };
}

function fallbackWorkout(currentWeek: number) {
  const phase =
    currentWeek >= 13 ? "Polimento" : currentWeek >= 9 ? "Pico" : currentWeek >= 5 ? "Construção" : "Base";

  if (phase === "Polimento") {
    return {
      type: "regenerativo",
      distanceKm: 0,
      durationMin: 30,
      description: "Treino regenerativo leve: caminhada + mobilidade. Hoje é foco em recuperação e consistência.",
      reasoning: "IA indisponível no ambiente atual; aplicado plano de contingência da fase de Polimento.",
    };
  }

  if (phase === "Pico") {
    return {
      type: "corrida",
      distanceKm: 10,
      durationMin: 55,
      description: "Rodagem contínua em Z2 com final progressivo leve. Controle a respiração e mantenha a técnica.",
      reasoning: "IA indisponível no ambiente atual; aplicado plano de contingência da fase de Pico com foco em volume.",
    };
  }

  if (phase === "Construção") {
    return {
      type: "corrida",
      distanceKm: 8,
      durationMin: 50,
      description: "Rodagem Z2 confortável. Ritmo conversável, foco em eficiência e cadência constante.",
      reasoning: "IA indisponível no ambiente atual; aplicado plano de contingência da fase de Construção com foco aeróbico.",
    };
  }

  return {
    type: "corrida",
    distanceKm: 6,
    durationMin: 40,
    description: "Rodagem leve Z2. Sem intensidade: apenas base aeróbica e técnica relaxada.",
    reasoning: "IA indisponível no ambiente atual; aplicado plano de contingência da fase de Base.",
  };
}

function isGeminiConfigured(): boolean {
  return Boolean(process.env.GEMINI_API_KEY);
}

async function generateWithGemini(params: {
  systemPrompt: string;
  userPrompt: string;
}): Promise<string> {
  const apiKey = (process.env.GEMINI_API_KEY || "").replace(/^['"`]+|['"`]+$/g, "").trim();
  if (!apiKey) {
    throw new Error("GEMINI_API_KEY is not set");
  }

  const model = (process.env.GEMINI_MODEL || "gemini-1.5-flash-latest").replace(/^['"`]+|['"`]+$/g, "").trim();
  const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model,
  )}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const res = await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      contents: [
        {
          role: "user",
          parts: [{ text: `${params.systemPrompt}\n\n${params.userPrompt}` }],
        },
      ],
      generationConfig: {
        temperature: 0.2,
        maxOutputTokens: 512,
      },
    }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Gemini API error ${res.status}: ${text}`);
  }

  const json = (await res.json()) as {
    candidates?: Array<{
      content?: { parts?: Array<{ text?: string }> };
    }>;
  };

  const text = json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
  return text;
}

function defaultRaceDateISO(): string {
  return new Date(Date.now() + 16 * 7 * 24 * 60 * 60 * 1000).toISOString();
}

async function ensureAthlete(deviceId: string): Promise<number | null> {
  const rows = await db
    .select({ id: athletesTable.id })
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId))
    .limit(1);
  if (rows[0]) return rows[0].id;

  const [created] = await db
    .insert(athletesTable)
    .values({ deviceId, targetRaceDate: defaultRaceDateISO() })
    .returning();
  return created?.id ?? null;
}

router.post("/procoach/ai-workout", async (req: Request, res: Response) => {
  const { deviceId: rawDeviceId, currentWeek, hrv, painLevel, targetRaceDistanceKm, targetRaceDate } = req.body as {
    deviceId?: string;
    currentWeek: number;
    hrv: number;
    painLevel: number;
    targetRaceDistanceKm: number;
    targetRaceDate: string;
  };
  const deviceId = String(rawDeviceId ?? "").trim() || MONO_DEVICE_ID;

  // ── INJURY PREVENTION — hard rule, skip AI entirely ──────────────────────
  const needsRecovery = (painLevel ?? 0) >= PAIN_THRESHOLD || (hrv ?? 99) < HRV_THRESHOLD;
  if (needsRecovery) {
    const workout = injuryWorkout(painLevel ?? 0, hrv ?? 99);
    req.log.info({ painLevel, hrv, alert: workout.injuryAlert }, "Injury prevention override");
    res.json({ workout });
    return;
  }

  if (!isGeminiConfigured()) {
    const workout = fallbackWorkout(currentWeek);
    res.json({ workout });
    return;
  }

  // ── LOAD TRAINING HISTORY ─────────────────────────────────────────────────
  const athleteId = await ensureAthlete(deviceId);

  let recentHistory: { type: string; distanceKm: number; durationMin: number; week: number; entryDate: string }[] = [];

  if (athleteId) {
    const entries = await db
      .select({
        type: workoutEntriesTable.type,
        distanceKm: workoutEntriesTable.distanceKm,
        durationMin: workoutEntriesTable.durationMin,
        week: workoutEntriesTable.week,
        entryDate: workoutEntriesTable.entryDate,
      })
      .from(workoutEntriesTable)
      .where(eq(workoutEntriesTable.athleteId, athleteId))
      .orderBy(desc(workoutEntriesTable.createdAt))
      .limit(14);
    recentHistory = entries;
  }

  // ── BUILD PROMPTS ─────────────────────────────────────────────────────────
  const today = new Date();
  const dayOfWeekPT = ["Domingo", "Segunda", "Terça", "Quarta", "Quinta", "Sexta", "Sábado"][today.getDay()];

  const phaseMap: Record<number, string> = {
    1: "Base", 2: "Base", 3: "Base", 4: "Base (recuperação)",
    5: "Construção", 6: "Construção", 7: "Construção", 8: "Construção (recuperação/teste)",
    9: "Pico", 10: "Pico", 11: "Pico (máximo)", 12: "Pico (recuperação)",
    13: "Polimento", 14: "Polimento", 15: "Polimento (tapering)", 16: "SEMANA DA PROVA",
  };
  const phase = phaseMap[currentWeek] ?? "Base";

  const weekFocusMap: Record<number, string> = {
    1: "Adaptação aeróbica — volumes muito baixos, sem intensidade",
    2: "Rodagem contínua — consolide o ritmo Z2",
    3: "Volume base Z2 — maior rodagem da fase",
    4: "Recuperação ativa — volume reduzido, mobilidade",
    5: "Volume crescente — introduza dias mais longos",
    6: "Introdução de força — um dia de musculação por semana",
    7: "Progressivo longo — long run com últimos kms em Z3",
    8: "Recuperação e teste — fartlek ou teste de pace",
    9: "Máximo volume — semana mais longa do ciclo",
    10: "Velocidade + longão — intervalados + corrida longa",
    11: "Pico de intensidade — treinos de prova",
    12: "Recuperação pós-pico — reduza 20% do volume",
    13: "Tapering suave — 30% menos volume, mantenha ritmo",
    14: "Qualidade e ritmo de prova — treinos curtos e intensos",
    15: "Volume mínimo — preservar forma, descanse",
    16: "SEMANA DA PROVA — apenas mobilidade e aquecimento",
  };
  const weekFocus = weekFocusMap[currentWeek] ?? "";

  const raceDate = new Date(targetRaceDate);
  const daysToRace = Math.ceil((raceDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

  const historyText = recentHistory.length > 0
    ? recentHistory.map(e =>
        `- ${e.entryDate}: ${e.type} | ${e.distanceKm}km | ${e.durationMin}min | Semana ${e.week}`
      ).join("\n")
    : "Nenhum treino registrado ainda.";

  const systemPrompt = `Você é um treinador de corrida de elite especializado em periodização e prevenção de lesões.
Você gera o treino do dia seguindo uma matriz rigorosa de 16 semanas dividida em 4 blocos: Base (sem 1-4), Construção (sem 5-8), Pico (sem 9-12), Polimento (sem 13-16).
O calendário é gerado retroativamente a partir da data da prova (P1), com semana 16 = semana da prova.
Responda SOMENTE com um JSON válido, sem markdown, sem texto adicional.`;

  const userPrompt = `Gere o treino de hoje para este atleta:

DADOS DO ATLETA:
- Hoje: ${dayOfWeekPT}, ${today.toLocaleDateString("pt-BR")}
- Semana atual: ${currentWeek}/16 (${daysToRace} dias até a prova)
- Fase: ${phase}
- Foco desta semana: ${weekFocus}
- Prova alvo: ${targetRaceDistanceKm}km em ${raceDate.toLocaleDateString("pt-BR")}
- VFC (HRV): ${hrv}ms  [< 45 = sobrecarregado | 45-65 = atenção | > 65 = recuperado]
- Dor/desconforto: ${painLevel}/5  [0 = sem dor | ≥ 2 → bike/regenerativo obrigatório]

HISTÓRICO RECENTE (últimos treinos registrados):
${historyText}

REGRAS DA MATRIZ DE PERIODIZAÇÃO:
BLOCO 1 — BASE (sem 1-4):
  - Apenas aeróbico Z2 (60-70% FCmáx), sem nenhuma intensidade
  - Volumes baixos: ~30-40km/semana
  - Sem treinos de força ainda
  - Semana 4 = recuperação (30% menos volume)

BLOCO 2 — CONSTRUÇÃO (sem 5-8):
  - Volume cresce progressivamente (45-55km/semana)
  - Introduza 1 dia de musculação/semana (agachamento, terra, lunges)
  - Inclua 1 treino progressivo ou fartlek leve por semana
  - Semana 8 = recuperação + teste de pace

BLOCO 3 — PICO (sem 9-12):
  - Volume máximo (60-70km/semana)
  - Treinos de velocidade: intervalados, tempo runs, ritmo de prova
  - Long run obrigatório (≥ 28km para maratona)
  - Semana 12 = recuperação pós-pico (−20% volume)

BLOCO 4 — POLIMENTO (sem 13-16):
  - Volume reduz progressivamente: 42 → 35 → 25 → 0km
  - Qualidade > quantidade: pace de prova, corridas curtas e intensas
  - Semana 15: volume mínimo, foco em descanso
  - Semana 16: apenas mobilidade e aquecimento leve antes da prova

REGRAS GERAIS:
- Domingo e Quarta = descanso ativo ou folga (adapte ao histórico)
- Nunca coloque dois treinos intensos consecutivos
- O tipo do treino de hoje deve considerar o último treino registrado no histórico

Responda com este JSON exato (sem markdown):
{
  "type": "corrida" | "bike" | "regenerativo" | "forca" | "folga",
  "distanceKm": number,
  "durationMin": number,
  "description": "descrição motivacional e técnica do treino em português, 1-2 frases",
  "reasoning": "justificativa baseada na fase, semana, histórico e dados do atleta, 1 frase"
}`;

  try {
    const raw = await generateWithGemini({ systemPrompt, userPrompt });
    req.log.info({ raw }, "Gemini raw response");

    let parsed: Record<string, unknown> = {};
    try {
      parsed = JSON.parse(raw);
    } catch {
      const match = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      if (match?.[1]) {
        parsed = JSON.parse(match[1].trim());
      }
    }

    const validTypes = ["corrida", "bike", "regenerativo", "forca", "folga"];
    const workout = {
      type: validTypes.includes(parsed.type as string) ? parsed.type : "corrida",
      distanceKm: typeof parsed.distanceKm === "number" ? parsed.distanceKm : 8,
      durationMin: typeof parsed.durationMin === "number" ? parsed.durationMin : 45,
      description: typeof parsed.description === "string" ? parsed.description : "Treino do dia gerado pela IA.",
      reasoning: typeof parsed.reasoning === "string" ? parsed.reasoning : "",
    };

    res.json({ workout });
  } catch (err: any) {
    req.log.error({ err: err?.message }, "AI workout generation error");
    res.status(500).json({ error: "Falha ao gerar treino com IA" });
  }
});

// ─── POST-RACE RECOVERY BLOCK ────────────────────────────────────────────────

type RecoveryDayRaw = {
  dayOffset: number;
  type: string;
  distanceKm: number;
  durationMin: number;
  description: string;
};

function buildFallbackRecovery(totalDays: number): RecoveryDayRaw[] {
  const plans: Record<number, RecoveryDayRaw[]> = {
    3: [
      { dayOffset: 1, type: "folga",        distanceKm: 0, durationMin: 0,  description: "Descanso total. Hidratação intensa, gelo nas articulações e sono prolongado. Você deu o máximo — agora recupere." },
      { dayOffset: 2, type: "regenerativo", distanceKm: 0, durationMin: 25, description: "Caminhada suave 20-25 min. Mobilidade articular, foam roller nas pernas e panturrilhas." },
      { dayOffset: 3, type: "corrida",      distanceKm: 5, durationMin: 40, description: "Trote leve Z1 de 5km, frequência cardíaca máx 130bpm. Sinta o corpo voltar ao ritmo." },
    ],
    4: [
      { dayOffset: 1, type: "folga",        distanceKm: 0, durationMin: 0,  description: "Descanso total obrigatório. Gelo, compressão, hidratação e sono. Você entregou tudo na prova!" },
      { dayOffset: 2, type: "folga",        distanceKm: 0, durationMin: 0,  description: "Segundo dia de recuperação completa. Caminhada leve pelo bairro se sentir disposição." },
      { dayOffset: 3, type: "regenerativo", distanceKm: 0, durationMin: 30, description: "Caminhada suave 25-30 min + mobilidade. Escute o corpo e respeite o sinal de cada músculo." },
      { dayOffset: 4, type: "corrida",      distanceKm: 6, durationMin: 45, description: "Trote regenerativo Z1 de 6km. Pace livre, sem pressão de relógio. Curta o movimento!" },
    ],
    5: [
      { dayOffset: 1, type: "folga",        distanceKm: 0, durationMin: 0,  description: "Descanso total obrigatório. Gelo, compressão, banho frio e sono. Corpo em modo de reconstrução." },
      { dayOffset: 2, type: "folga",        distanceKm: 0, durationMin: 0,  description: "Segundo dia de folga total. Priorize sono de qualidade e alimentação rica em proteínas." },
      { dayOffset: 3, type: "regenerativo", distanceKm: 0, durationMin: 20, description: "Caminhada leve 15-20min. Primeiros passos da recuperação ativa — sem pressão alguma." },
      { dayOffset: 4, type: "regenerativo", distanceKm: 0, durationMin: 40, description: "Regenerativo 35-40min: mobilidade, foam roller e caminhada. Jamais force o ritmo." },
      { dayOffset: 5, type: "corrida",      distanceKm: 8, durationMin: 55, description: "Primeiro trote pós-prova: 8km em Z1-Z2. Celebre cada quilômetro — você voltou!" },
    ],
  };
  return plans[totalDays] ?? plans[3]!;
}

router.post("/procoach/post-race-recovery", async (req: Request, res: Response) => {
  const { deviceId: rawDeviceId, raceName, raceDistanceKm, finishDurationSec, currentWeek } = req.body as {
    deviceId?: string;
    raceName: string;
    raceDistanceKm: number;
    finishDurationSec: number;
    currentWeek: number;
  };
  const deviceId = String(rawDeviceId ?? "").trim() || MONO_DEVICE_ID;
  await ensureAthlete(deviceId);

  const totalDays = raceDistanceKm <= 10 ? 3 : raceDistanceKm <= 21.1 ? 4 : 5;
  const finishMin = Math.round((finishDurationSec ?? 0) / 60);
  const returnKm = totalDays === 3 ? "5km" : totalDays === 4 ? "6km" : "8km";

  const systemPrompt = `Você é fisioterapeuta esportivo especializado em recuperação pós-prova de corrida. Gere um bloco de recuperação progressivo de ${totalDays} dias. Responda SOMENTE com um array JSON válido, sem markdown, sem texto adicional.`;

  const userPrompt = `O atleta concluiu a prova "${raceName}" de ${raceDistanceKm}km em ${finishMin} minutos (Semana ${currentWeek ?? "?"}/16 do plano de 16 semanas).

Gere exatamente ${totalDays} dias de recuperação progressiva pós-prova.

DIRETRIZES OBRIGATÓRIAS:
- Dia 1: SEMPRE folga total (descanso, gelo, compressão, hidratação) — distanceKm = 0, durationMin = 0
- Dia 2: Caminhada suave OU repouso — distanceKm = 0, durationMin ≤ 20, sem corrida
${totalDays >= 4 ? "- Dia 3: Regenerativo leve (caminhada ou mobilidade) — sem corrida\n" : ""}${totalDays >= 5 ? "- Dia 4: Regenerativo suave 35-40min — sem corrida de impacto\n" : ""}- Último dia (Dia ${totalDays}): Trote leve Z1 de ${returnKm} — retorno à corrida
- Descrições em português, motivadoras e técnicas (1-2 frases cada)

Responda com exatamente este array JSON (${totalDays} objetos):
[{ "dayOffset": 1, "type": "folga"|"regenerativo"|"corrida", "distanceKm": 0, "durationMin": 0, "description": "..." }]`;

  try {
    if (!isGeminiConfigured()) {
      res.json({ totalDays, recoveryDays: buildFallbackRecovery(totalDays) });
      return;
    }

    const raw = await generateWithGemini({ systemPrompt, userPrompt });
    req.log.info({ raw }, "Post-race recovery Gemini response");

    let parsed: RecoveryDayRaw[] = [];
    try {
      const cleaned = raw.replace(/```(?:json)?\s*/g, "").replace(/```/g, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      parsed = [];
    }

    if (!Array.isArray(parsed) || parsed.length < totalDays) {
      parsed = buildFallbackRecovery(totalDays);
    }

    const validTypes = ["corrida", "bike", "regenerativo", "forca", "folga"];
    const recoveryDays = parsed.slice(0, totalDays).map((d, i) => ({
      dayOffset: typeof d.dayOffset === "number" ? d.dayOffset : i + 1,
      type: validTypes.includes(d.type) ? d.type : i === 0 ? "folga" : "regenerativo",
      distanceKm: typeof d.distanceKm === "number" ? Math.round(d.distanceKm) : 0,
      durationMin: typeof d.durationMin === "number" ? d.durationMin : 0,
      description: typeof d.description === "string" ? d.description : "Recuperação progressiva.",
    }));

    res.json({ totalDays, recoveryDays });
  } catch (err: any) {
    req.log.error({ err: err?.message }, "Post-race recovery generation error");
    res.json({ totalDays, recoveryDays: buildFallbackRecovery(totalDays) });
  }
});

export default router;
