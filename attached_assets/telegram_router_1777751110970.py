import base64
import datetime as dt_module
import os
import tempfile
import traceback
import urllib.parse

import requests
from apscheduler.schedulers.background import BackgroundScheduler
from fastapi import APIRouter, Request
from groq import Groq
from pydantic import BaseModel

from database import SessionLocal, Workout
from src.handlers.bio_handler import handle_bio_callback, processar_json_bio
from src.handlers.oracle_handler import (
    analisar_e_reajustar_contingencia,
    classificar_intencao_com_ia,
    extrair_dados_imagem_com_ia,
    extrair_dados_treino_com_ia,
)
from src.handlers.workout_handler import concluir_treino_por_texto, handle_workout_callback
from services.fisiologia_core import km_saida_inteira
from services.visual_service import gerar_grafico_bio_15dias

router = APIRouter()
nutricao_scheduler = BackgroundScheduler()
nutricao_scheduler.start()

ESTADO_SISTEMA = {"inicio_corrida": None, "t_largada": None}


def enviar_mensagem_telegram(chat_id: int, texto: str, reply_markup: dict = None):
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        return
    url = f"https://api.telegram.org/bot{token}/sendMessage"
    payload = {"chat_id": chat_id, "text": texto, "parse_mode": "Markdown", "disable_web_page_preview": True}
    if reply_markup:
        payload["reply_markup"] = reply_markup
    requests.post(url, json=payload)


def enviar_foto_telegram(chat_id: int, foto_buffer, legenda: str = ""):
    token = os.getenv("TELEGRAM_BOT_TOKEN")
    if not token:
        return
    url = f"https://api.telegram.org/bot{token}/sendPhoto"
    files = {"photo": ("grafico.png", foto_buffer, "image/png")}
    requests.post(url, data={"chat_id": chat_id, "caption": legenda, "parse_mode": "Markdown"}, files=files)


def disparar_alerta_gel(chat_id: int):
    enviar_mensagem_telegram(chat_id, "⚡ *ALERTA TÁTICO: HORA DO GEL!* ⚡")


def programar_alarmes_nutricao_largada(chat_id: int):
    """
    Apos LARGADA: alertas Telegram em T+30min e T+1h (protocolo Galaxy Watch / Health Connect via app).
    """
    agora = dt_module.datetime.now()
    plano = [
        (30, "T+30min: agua + sodio (checkpoint nutricao)."),
        (60, "T+1h: gel ~30g ou isotonico / digestao."),
    ]

    def _job_factory(cid: int, texto: str):
        def _run():
            enviar_mensagem_telegram(cid, f"*Nutricao activa* {texto}")

        return _run

    for off, msg in plano:
        jid = f"nut_larg_{off}_{chat_id}"
        try:
            nutricao_scheduler.remove_job(jid)
        except Exception:
            pass
        nutricao_scheduler.add_job(
            _job_factory(chat_id, msg),
            "date",
            run_date=agora + dt_module.timedelta(minutes=off),
            id=jid,
            replace_existing=True,
        )


def enviar_menu_interativo(chat_id: int, saudacao: str):
    teclado = {
        "inline_keyboard": [
            [{"text": "🎯 Missões de Hoje", "callback_data": "cmd_missao"}, {"text": "🔥 Energia", "callback_data": "cmd_energia"}],
            [{"text": "⚖️ Bioimpedância", "callback_data": "cmd_bio"}, {"text": "🌤️ Clima", "callback_data": "cmd_clima"}],
            [{"text": "👟 Status da Frota", "callback_data": "cmd_frota"}, {"text": "🎧 DJ Oráculo", "callback_data": "cmd_dj"}],
            [{"text": "🚀 LARGADA", "callback_data": "cmd_largada"}, {"text": "🏁 CHEGADA", "callback_data": "cmd_chegada"}],
            [{"text": "🏃 Iniciar (legado)", "callback_data": "cmd_iniciar"}, {"text": "📝 Concluir treino", "callback_data": "cmd_concluir"}],
            [{"text": "🎙️ Como usar a Voz / Visão", "callback_data": "cmd_oraculo"}],
        ]
    }
    enviar_mensagem_telegram(chat_id, saudacao, reply_markup=teclado)


@router.post("/webhook")
async def telegram_webhook(request: Request):
    try:
        data = await request.json()
        if "callback_query" in data:
            callback_id = data["callback_query"]["id"]
            chat_id = data["callback_query"]["message"]["chat"]["id"]
            comando = data["callback_query"]["data"]
            token = os.getenv("TELEGRAM_BOT_TOKEN")
            requests.post(f"https://api.telegram.org/bot{token}/answerCallbackQuery", json={"callback_query_id": callback_id})
            db = SessionLocal()
            try:
                if comando == "cmd_bio":
                    handle_bio_callback(db, chat_id, enviar_mensagem_telegram)
                else:
                    handle_workout_callback(
                        comando=comando,
                        db=db,
                        chat_id=chat_id,
                        enviar_mensagem_telegram=enviar_mensagem_telegram,
                        estado_sistema=ESTADO_SISTEMA,
                        nutricao_scheduler=nutricao_scheduler,
                        disparar_alerta_gel=disparar_alerta_gel,
                        programar_nutricao_pos_largada=programar_alarmes_nutricao_largada,
                    )
            finally:
                db.close()
            return {"status": "ok"}

        if "message" not in data:
            return {"status": "ok"}
        chat_id = data["message"]["chat"]["id"]
        mensagem_texto = ""

        if "voice" in data["message"]:
            enviar_mensagem_telegram(chat_id, "🎙️ A decodificar áudio...")
            try:
                token = os.getenv("TELEGRAM_BOT_TOKEN")
                file_id = data["message"]["voice"]["file_id"]
                file_info = requests.get(f"https://api.telegram.org/bot{token}/getFile?file_id={file_id}").json()
                file_path = file_info["result"]["file_path"]
                audio_data = requests.get(f"https://api.telegram.org/file/bot{token}/{file_path}").content
                with tempfile.NamedTemporaryFile(delete=False, suffix=".ogg") as temp_audio:
                    temp_audio.write(audio_data)
                    temp_path = temp_audio.name
                client = Groq(api_key=os.getenv("GROQ_API_KEY"))
                with open(temp_path, "rb") as f:
                    transcricao = client.audio.transcriptions.create(file=("audio.ogg", f.read()), model="whisper-large-v3", response_format="text", language="pt")
                os.remove(temp_path)
                mensagem_texto = transcricao
            except Exception:
                enviar_mensagem_telegram(chat_id, "❌ Falha ao processar áudio.")
                return {"status": "ok"}
        elif "photo" in data["message"]:
            try:
                token = os.getenv("TELEGRAM_BOT_TOKEN")
                file_id = data["message"]["photo"][-1]["file_id"]
                file_info = requests.get(f"https://api.telegram.org/bot{token}/getFile?file_id={file_id}").json()
                file_path = file_info["result"]["file_path"]
                image_bytes = requests.get(f"https://api.telegram.org/file/bot{token}/{file_path}").content
                base64_image = base64.b64encode(image_bytes).decode("utf-8")
                dados_imagem = extrair_dados_imagem_com_ia(base64_image)
                if not dados_imagem:
                    enviar_mensagem_telegram(chat_id, "❌ Interferência visual.")
                    return {"status": "ok"}
                dk = dados_imagem.get("distancia_km", 0)
                mensagem_texto = (
                    f"Terminei o treino. Fiz {km_saida_inteira(float(dk))} km em "
                    f"{dados_imagem.get('tempo_minutos', 0)} min."
                )
            except Exception:
                enviar_mensagem_telegram(chat_id, "❌ Falha no processamento da imagem.")
                return {"status": "ok"}
        elif "text" in data["message"]:
            mensagem_texto = data["message"]["text"]
            if processar_json_bio(mensagem_texto, SessionLocal, chat_id, enviar_mensagem_telegram):
                return {"status": "ok"}
        else:
            return {"status": "ok"}

        if mensagem_texto.startswith("/"):
            db = SessionLocal()
            try:
                comando_limpo = mensagem_texto.split("@")[0].lower()
                if comando_limpo in {"/start", "/menu"}:
                    hora_atual = dt_module.datetime.now().hour
                    saudacao = "🌅 *Bom dia, CEO!*" if hora_atual < 12 else "☀️ *Boa tarde, CEO!*" if hora_atual < 18 else "🌙 *Boa noite, CEO!*"
                    enviar_menu_interativo(chat_id, f"{saudacao} ProCoach OS ativo.")
                elif comando_limpo == "/status_bio":
                    foto = gerar_grafico_bio_15dias(db)
                    if foto:
                        enviar_foto_telegram(chat_id, foto, "📈 *Evolução: Peso vs Gordura*")
            finally:
                db.close()
            return {"status": "ok"}

        intencao = classificar_intencao_com_ia(mensagem_texto)
        if intencao == "MENU":
            hora_atual = dt_module.datetime.now().hour
            saudacao = "🌅 *Bom dia, CEO!*" if hora_atual < 12 else "☀️ *Boa tarde, CEO!*" if hora_atual < 18 else "🌙 *Boa noite, CEO!*"
            enviar_menu_interativo(chat_id, f"{saudacao} Painel de Controle operacional.")
        elif intencao == "CONSULTA":
            db = SessionLocal()
            try:
                treinos_hoje = db.query(Workout).filter(Workout.date == dt_module.date.today()).all()
                if treinos_hoje:
                    msg = "🎯 *Missões de Hoje:*\n"
                    for t in treinos_hoje:
                        raw = t.planned_distance_km if t.planned_distance_km else (t.distance_km or 0)
                        dist = km_saida_inteira(float(raw))
                        msg += f"\n🔹 *{t.workout_type}* ({dist}km)\n📝 {t.details}\n"
                    enviar_mensagem_telegram(chat_id, msg)
                else:
                    enviar_mensagem_telegram(chat_id, "📭 Dia de descanso.")
            finally:
                db.close()
        elif intencao == "FIM":
            db = SessionLocal()
            try:
                enviar_mensagem_telegram(chat_id, "🧠 Oráculo processando telemetria...")
                msg_final = concluir_treino_por_texto(
                    db=db,
                    mensagem_texto=mensagem_texto,
                    estado_sistema=ESTADO_SISTEMA,
                    nutricao_scheduler=nutricao_scheduler,
                    enviar_mensagem_telegram=enviar_mensagem_telegram,
                    extrair_dados_treino_com_ia=extrair_dados_treino_com_ia,
                    chat_id=chat_id,
                )
                enviar_mensagem_telegram(chat_id, msg_final)
            finally:
                db.close()
        else:
            db = SessionLocal()
            try:
                contingencia = analisar_e_reajustar_contingencia(db, mensagem_texto)
            finally:
                db.close()
            if contingencia:
                enviar_mensagem_telegram(chat_id, contingencia["texto"])
            else:
                enviar_mensagem_telegram(chat_id, "🧠 Mensagem recebida, CEO. Use /menu.")

        return {"status": "ok"}
    except Exception:
        print("[ERRO] Falha no webhook Telegram / Oraculo")
        print(traceback.format_exc())
        return {"status": "ok"}


class MemeRequest(BaseModel):
    prompt: str
    titulo: str


@router.post("/enviar_meme")
def disparar_meme_app(req: MemeRequest):
    chat_id = os.getenv("TELEGRAM_CHAT_ID")
    if not chat_id:
        return {"status": "erro", "msg": "Chat ID não configurado"}
    enviar_mensagem_telegram(int(chat_id), f"🎨 *A IA está a pintar a sua conquista:* _{req.titulo}_")
    prompt_codificado = urllib.parse.quote(req.prompt)
    url_imagem = f"https://image.pollinations.ai/prompt/{prompt_codificado}?width=1024&height=1024&nologo=true"
    try:
        resposta = requests.get(url_imagem)
        if resposta.status_code == 200:
            enviar_foto_telegram(int(chat_id), resposta.content, f"🏆 *CONQUISTA DESBLOQUEADA:*\n{req.titulo}")
            return {"status": "sucesso"}
    except Exception:
        pass
    return {"status": "erro"}
