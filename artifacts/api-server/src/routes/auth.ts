import { Router, type IRouter, type Request, type Response } from "express";
import { eq, and, gt } from "@workspace/db";
import { db } from "@workspace/db";
import {
  athletesTable,
  otpCodesTable,
  authSessionsTable,
} from "@workspace/db/schema";

const router: IRouter = Router();

function generateOTP(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function generateToken(): string {
  const chars = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let token = "";
  for (let i = 0; i < 48; i++) {
    token += chars[Math.floor(Math.random() * chars.length)];
  }
  return token;
}

function normalizePhone(raw: string): string {
  const digits = raw.replace(/\D/g, "");
  if (digits.startsWith("55") && digits.length >= 12) return `+${digits}`;
  if (digits.startsWith("0")) return `+55${digits.slice(1)}`;
  if (digits.length === 11 || digits.length === 10) return `+55${digits}`;
  return `+${digits}`;
}

async function sendWhatsAppOTP(phone: string, code: string): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER;

  if (!accountSid || !authToken || !fromNumber) {
    throw new Error("Twilio credentials not configured");
  }

  const toWhatsApp = `whatsapp:${phone}`;
  const fromWhatsApp = fromNumber.startsWith("whatsapp:")
    ? fromNumber
    : `whatsapp:${fromNumber}`;

  const body = `🏃 PROCOACH OS V5.1\n\nSeu código de acesso: *${code}*\n\nVálido por 10 minutos. Não compartilhe.`;

  const params = new URLSearchParams({
    To: toWhatsApp,
    From: fromWhatsApp,
    Body: body,
  });

  const credentials = Buffer.from(`${accountSid}:${authToken}`).toString("base64");
  const url = `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`;

  const res = await fetch(url, {
    method: "POST",
    headers: {
      Authorization: `Basic ${credentials}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: params.toString(),
  });

  if (!res.ok) {
    const err = await res.text().catch(() => "");
    throw new Error(`Twilio API error ${res.status}: ${err}`);
  }
}

router.post("/auth/otp/send", async (req: Request, res: Response) => {
  const { phone } = req.body as { phone?: string };
  if (!phone) {
    res.status(400).json({ error: "phone é obrigatório" });
    return;
  }

  const normalizedPhone = normalizePhone(phone);
  const code = generateOTP();
  const expiresAt = new Date(Date.now() + 10 * 60 * 1000);

  await db.insert(otpCodesTable).values({
    phone: normalizedPhone,
    code,
    used: false,
    expiresAt,
  });

  try {
    await sendWhatsAppOTP(normalizedPhone, code);
    res.json({ sent: true, phone: normalizedPhone });
  } catch (err: any) {
    req.log.error({ err: err?.message }, "WhatsApp send error");
    res.status(500).json({
      error: "Falha ao enviar OTP via WhatsApp",
      detail: err?.message,
    });
  }
});

router.post("/auth/otp/verify", async (req: Request, res: Response) => {
  const { phone, code, deviceId } = req.body as {
    phone?: string;
    code?: string;
    deviceId?: string;
  };

  if (!phone || !code || !deviceId) {
    res.status(400).json({ error: "phone, code e deviceId são obrigatórios" });
    return;
  }

  const normalizedPhone = normalizePhone(phone);
  const now = new Date();

  const otpRows = await db
    .select()
    .from(otpCodesTable)
    .where(
      and(
        eq(otpCodesTable.phone, normalizedPhone),
        eq(otpCodesTable.code, code),
        eq(otpCodesTable.used, false),
        gt(otpCodesTable.expiresAt, now)
      )
    )
    .limit(1);

  if (otpRows.length === 0) {
    res.status(401).json({ error: "Código inválido ou expirado" });
    return;
  }

  await db
    .update(otpCodesTable)
    .set({ used: true })
    .where(eq(otpCodesTable.id, otpRows[0]!.id));

  const existing = await db
    .select()
    .from(athletesTable)
    .where(eq(athletesTable.deviceId, deviceId))
    .limit(1);

  let athlete;
  if (existing.length === 0) {
    const defaultRaceDate = new Date(
      Date.now() + 16 * 7 * 24 * 60 * 60 * 1000
    ).toISOString();
    const [created] = await db
      .insert(athletesTable)
      .values({
        deviceId,
        name: "Atleta",
        targetRaceName: "Maratona São Paulo",
        targetRaceDate: defaultRaceDate,
        targetRaceDistanceKm: 42,
        hrv: 68,
        painLevel: 0,
        currentWeek: 1,
      })
      .returning();
    athlete = created;
  } else {
    athlete = existing[0]!;
  }

  const token = generateToken();
  const sessionExpiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);

  await db.insert(authSessionsTable).values({
    athleteId: athlete!.id,
    phone: normalizedPhone,
    token,
    deviceId,
    expiresAt: sessionExpiresAt,
  });

  res.json({ token, athlete, expiresAt: sessionExpiresAt.toISOString() });
});

router.post("/auth/verify-token", async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token) {
    res.status(400).json({ error: "token é obrigatório" });
    return;
  }

  const now = new Date();
  const sessions = await db
    .select()
    .from(authSessionsTable)
    .where(
      and(
        eq(authSessionsTable.token, token),
        gt(authSessionsTable.expiresAt, now)
      )
    )
    .limit(1);

  if (sessions.length === 0) {
    res.status(401).json({ error: "Sessão inválida ou expirada" });
    return;
  }

  const athletes = await db
    .select()
    .from(athletesTable)
    .where(eq(athletesTable.id, sessions[0]!.athleteId))
    .limit(1);

  res.json({ valid: true, athlete: athletes[0] ?? null });
});

router.post("/auth/logout", async (req: Request, res: Response) => {
  const { token } = req.body as { token?: string };
  if (!token) {
    res.status(400).json({ error: "token é obrigatório" });
    return;
  }
  await db.delete(authSessionsTable).where(eq(authSessionsTable.token, token));
  res.json({ success: true });
});

export default router;
