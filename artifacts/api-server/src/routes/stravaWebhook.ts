import { Router, Request, Response } from 'express';
import { db, eq, and } from '@workspace/db';
import { workoutEntriesTable, weeklyStatsTable, athletesTable } from '@workspace/db/schema';
import { getOrCreateMonoAthleteId } from './migrations';
import { GoogleGenerativeAI } from '@google/generative-ai';
import admin from 'firebase-admin';

// Inicializa o Firebase Admin SDK
if (!admin.apps?.length) {
  try {
    // Tenta inicializar com variáveis de ambiente explícitas (Ideal para Render, VPS, etc.)
    if (process.env.FIREBASE_PROJECT_ID && process.env.FIREBASE_CLIENT_EMAIL && process.env.FIREBASE_PRIVATE_KEY) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID,
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          // O replace garante que as quebras de linha (\n) fiquem corretas ao ler do .env
          privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        }),
      });
    } else {
      // Fallback para o padrão (requer GOOGLE_APPLICATION_CREDENTIALS)
      admin.initializeApp({
        credential: admin.credential.applicationDefault(),
      });
    }
  } catch (error) {
    console.error('Firebase Admin init falhou:', error);
  }
}

export const stravaWebhookRouter = Router();

// O token que você vai usar ao se inscrever na API do Strava.
// Adicione isso ao seu arquivo .env no api-server
const VERIFY_TOKEN = process.env.STRAVA_VERIFY_TOKEN || 'STRAVA_COACH_PRO_TOKEN';

/**
 * 1. Endpoint de Validação do Webhook (GET)
 * Exigido pelo Strava para confirmar a assinatura do webhook.
 */
stravaWebhookRouter.get('/webhook/strava', (req: Request, res: Response) => {
  const mode = req.query['hub.mode'];
  const token = req.query['hub.verify_token'];
  const challenge = req.query['hub.challenge'];

  if (mode && token) {
    // Verifica se o modo e o token correspondem aos nossos
    if (mode === 'subscribe' && token === VERIFY_TOKEN) {
      console.log('STRAVA WEBHOOK_VERIFIED');
      res.json({ 'hub.challenge': challenge });
    } else {
      // Responde com '403 Forbidden' se os tokens não baterem
      res.sendStatus(403);
    }
  } else {
    res.sendStatus(400);
  }
});

/**
 * 2. Endpoint de Recebimento de Eventos (POST)
 * Onde o Strava vai enviar as atualizações das atividades dos atletas.
 */
stravaWebhookRouter.post('/webhook/strava', (req: Request, res: Response) => {
  console.log('🚀 Evento do Strava recebido:', req.body.object_type, req.body.aspect_type);
  
  // O Strava exige que você responda com 200 OK IMEDIATAMENTE (em até 2s).
  // Processe a requisição de forma assíncrona abaixo desta linha (ou use filas/workers).
  res.status(200).send('EVENT_RECEIVED');
  
  const { object_type, aspect_type, object_id, owner_id, updates } = req.body;
  
  if (object_type === 'activity' && aspect_type === 'create') {
    // Processa a atividade em segundo plano (para não bloquear a resposta rápida do Strava)
    void processStravaActivity(owner_id, object_id).catch(err => {
      console.error('Erro ao processar atividade:', err);
    });
  }
});

const TYPE_MAP: Record<string, string> = {
  Run: "corrida", TrailRun: "corrida", VirtualRun: "corrida",
  Ride: "bike", VirtualRide: "bike", EBikeRide: "bike",
  Yoga: "regenerativo", Walk: "regenerativo", Hike: "regenerativo",
  WeightTraining: "forca", Workout: "forca", Crossfit: "forca",
};

async function sendTelegram(text: string): Promise<void> {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  if (!token || !chatId) return;
  await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ chat_id: chatId, text, parse_mode: "Markdown", disable_web_page_preview: true }),
  });
}

async function generateWithGemini(prompt: string): Promise<string> {
  const apiKey = (process.env.GEMINI_API_KEY || "").replace(/^['"`]+|['"`]+$/g, "").trim();
  if (!apiKey) return "IA não configurada.";

  try {
    const genAI = new GoogleGenerativeAI(apiKey);
    const modelName = (process.env.GEMINI_MODEL || "gemini-pro").replace(/^['"`]+|['"`]+$/g, "").trim();
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    return result.response.text();
  } catch (err: any) {
    console.error("Erro detalhado da API da IA (Gemini):", err?.response?.data || err?.message || err);
    return "Excelente treino! (Erro ao contatar a IA).";
  }
}

/**
 * Função auxiliar para enviar notificação Push via Firebase (FCM).
 */
async function sendFirebasePushNotification(fcmToken: string, title: string, body: string) {
  if (!fcmToken) return;
  try {
    await admin.messaging().send({
      token: fcmToken,
      notification: { title, body }
    });
  } catch (err) {
    console.error('Erro ao enviar notificação Push do Firebase:', err);
  }
}

/**
 * Função assíncrona para buscar os detalhes do treino e processar no Coach Pro.
 */
async function processStravaActivity(athleteId: number, activityId: number) {
  console.log(`Buscando dados da atividade ${activityId} (Monousuário)...`);
  
  try {
    // 1. Gera um access_token novo na hora usando o refresh_token fixo do .env
    // Isso garante que a requisição nunca falhe por token expirado!
    const tokenResponse = await fetch('https://www.strava.com/oauth/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_id: process.env.STRAVA_CLIENT_ID,
        client_secret: process.env.STRAVA_CLIENT_SECRET,
        refresh_token: process.env.STRAVA_REFRESH_TOKEN,
        grant_type: 'refresh_token'
      })
    });

    const tokenData = await tokenResponse.json() as any;
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      throw new Error('Falha ao gerar o token do Strava. Verifique as credenciais no .env');
    }

    // 2. Busca os detalhes métricos da corrida/pedalada na API do Strava
    const activityResponse = await fetch(`https://www.strava.com/api/v3/activities/${activityId}`, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    const activityData = await activityResponse.json() as any;

    const distKm = Math.round(activityData.distance / 1000);
    const durMin = Math.round((activityData.moving_time || activityData.elapsed_time) / 60);
    const procoachType = TYPE_MAP[activityData.sport_type] ?? TYPE_MAP[activityData.type] ?? "corrida";

    console.log('✅ Dados da atividade baixados com sucesso!');
    console.log(`- Nome: ${activityData.name}`);
    console.log(`- Distância: ${distKm} km`);
    console.log(`- Tempo em movimento: ${durMin} min`);

    // 3. Descobrir a semana de treino do Atleta
    const athleteIdDb = await getOrCreateMonoAthleteId();
    const athleteRows = await db.select().from(athletesTable).where(eq(athletesTable.id, athleteIdDb)).limit(1);
    const athlete = athleteRows[0];

    if (athlete) {
      const actDate = new Date(activityData.start_date_local);
      const actDateStr = actDate.toISOString().slice(0, 10);
      const raceDateMs = new Date(athlete.targetRaceDate).getTime();
      
      // A periodização do app é de 16 semanas. Calculamos de trás pra frente a partir da data da prova!
      const planStart = new Date(raceDateMs - 16 * 7 * 24 * 60 * 60 * 1000);
      const msPerWeek = 7 * 24 * 60 * 60 * 1000;
      const weekNum = Math.max(1, Math.min(16, Math.ceil((actDate.getTime() - planStart.getTime()) / msPerWeek)));

      // Verifica se já foi salvo (usando o ID externo da atividade do Strava) para evitar treinos duplicados
      const existing = await db
        .select({ id: workoutEntriesTable.id })
        .from(workoutEntriesTable)
        .where(eq(workoutEntriesTable.externalId, activityId as any))
        .limit(1);

      if (existing.length === 0) {
        // 3.1 Salva a atividade na tabela
        await db.insert(workoutEntriesTable).values({
          athleteId: athleteIdDb,
          entryDate: actDateStr,
          distanceKm: distKm,
          type: procoachType as any,
          durationMin: durMin,
          week: weekNum,
          source: 'strava',
          externalId: activityId as any,
          shoeId: null, // Força a pendência de atribuição do tênis no App
        });

        // 3.2 Soma os quilômetros na tabela de Estatísticas da Semana (se for corrida longa)
        if (procoachType === 'corrida' && distKm >= 3) {
          const weekStats = await db.select().from(weeklyStatsTable)
            .where(and(eq(weeklyStatsTable.athleteId, athleteIdDb), eq(weeklyStatsTable.week, weekNum))).limit(1);
          
          if (weekStats.length === 0) {
            await db.insert(weeklyStatsTable).values({ athleteId: athleteIdDb, week: weekNum, completedKm: distKm, sessionsCount: 1 });
          } else {
            await db.update(weeklyStatsTable).set({ completedKm: weekStats[0].completedKm + distKm, sessionsCount: weekStats[0].sessionsCount + 1, updatedAt: new Date() })
              .where(eq(weeklyStatsTable.id, weekStats[0].id));
          }
        }
        console.log('✅ Salvo no banco de dados Neon com sucesso!');

        // 3.3 Dispara a notificação Push caso seja uma corrida (exigência de tênis)
        if (procoachType === 'corrida' && athlete.expoPushToken) {
          // Mantemos a coluna expoPushToken no banco, mas salvamos o FCM Token do Flutter nela
          void sendFirebasePushNotification(
            athlete.expoPushToken,
            '🏃 Novo treino salvo!',
            `Seu treino "${activityData.name}" chegou do Strava. Qual tênis você usou hoje?`
          );
        }

        // 4. Análise com Gemini e envio pro Telegram
        const pace = distKm > 0 ? (durMin / distKm) : 0;
        const paceStr = pace > 0 ? `${Math.floor(pace)}:${Math.round((pace % 1) * 60).toString().padStart(2, '0')} /km` : '-';
        const hr = activityData.average_heartrate ? `${Math.round(activityData.average_heartrate)} bpm` : 'não medido';
        
        const prompt = `Você é um treinador de corrida de elite analisando um treino recém-concluído do seu atleta.
Treino: "${activityData.name}"
Distância: ${distKm} km
Duração: ${durMin} min
Pace médio: ${paceStr}
Frequência cardíaca média: ${hr}

Escreva uma mensagem curta (máx 3 frases) parabenizando o atleta, fazendo um elogio técnico ou observação com base no pace/frequência. Seja direto e encorajador. Mande em português. Responda apenas com a mensagem.`;

        const geminiAnalysis = await generateWithGemini(prompt);
        
        const telegramMsg = `🏃 *Novo treino no Strava!*\n\n*${activityData.name}*\n📏 ${distKm} km em ${durMin} min\n⏱ Pace: ${paceStr}\n❤️ FC: ${hr}\n\n🤖 *Coach Pro diz:*\n_"${geminiAnalysis}"_`;
        await sendTelegram(telegramMsg);
        console.log('🚀 Análise enviada pro Telegram!');
      } else {
        console.log('Atividade já existia no banco. Ignorado.');
      }
    }
  } catch (error) {
    console.error('Falha ao processar atividade monousuário:', error);
  }
}