import { Router, type IRouter, type Request, type Response } from "express";
import { GoogleGenerativeAI } from "@google/generative-ai";

const router: IRouter = Router();

// Inicializa o SDK do Gemini com a sua chave de API
const genAI = new GoogleGenerativeAI((process.env.GEMINI_API_KEY || "").replace(/^['"`]+|['"`]+$/g, "").trim());

router.post("/ai/race-strategy", async (req: Request, res: Response) => {
  try {
    const { race_name } = req.body as { race_name?: string };

    if (!race_name) {
      res.status(400).json({ error: "O nome da prova (race_name) é obrigatório." });
      return;
    }

    // Usa o modelo mais rápido e eficiente para tarefas de texto diretas.
    // Forçamos a apiVersion para 'v1' para resolver o erro 404 do endpoint v1beta.
    const modelName = (process.env.GEMINI_MODEL || "gemini-1.5-flash-latest").replace(/^['"`]+|['"`]+$/g, "").trim();
    const model = genAI.getGenerativeModel(
      { model: modelName },
      { apiVersion: "v1beta" }
    );
    
    const prompt = `Você é um treinador de corrida de elite do aplicativo ProCoach OS. Crie uma estratégia de prova direta, motivadora e em bullet points para a seguinte corrida: ${race_name}. Foco em pace, hidratação, nutrição e mentalidade. Mantenha curto e grosso (máximo de 4 tópicos breves).`;

    const result = await model.generateContent(prompt);
    const strategyText = result.response.text();

    res.json({ strategy: strategyText });
  } catch (error) {
    console.error("Erro ao gerar estratégia com Gemini:", error);
    res.status(500).json({ error: "Falha ao contactar o Cérebro (IA)." });
  }
});

export default router;
