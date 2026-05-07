from __future__ import annotations

import io
import datetime as dt_module
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.utils import ImageReader
from reportlab.platypus import Image as RLImage
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

from services.fisiologia_core import km_saida_inteira


def gerar_relatorio_pdf(treinos, data_inicio: str, data_fim: str):
    """
    Recebe uma lista de treinos e datas, e devolve um arquivo PDF em formato de bytes.
    """
    buffer = io.BytesIO()

    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=30, leftMargin=30, topMargin=40, bottomMargin=30)
    elements = []
    styles = getSampleStyleSheet()

    estilo_titulo = ParagraphStyle(
        name="Titulo",
        fontSize=20,
        alignment=1,
        spaceAfter=10,
        textColor=colors.HexColor("#1e3a8a"),
        fontName="Helvetica-Bold",
    )

    estilo_subtitulo = ParagraphStyle(
        name="Subtitulo",
        fontSize=12,
        alignment=1,
        spaceAfter=30,
        textColor=colors.HexColor("#4b5563"),
    )

    elements.append(Paragraph("PROCOACH OS - RELATORIO DE PERFORMANCE", estilo_titulo))
    elements.append(Paragraph(f"Periodo Analisado: {data_inicio} ate {data_fim}", estilo_subtitulo))

    dados_tabela = [["Data", "Missao", "Planeado", "Executado (km int)", "Pace", "Esforco (RPE)"]]

    for t in treinos:
        data_formatada = t.date.strftime("%d/%m")
        dist_planeada = f"{t.distance_km}km" if t.distance_km else "-"
        dist_real = f"{km_saida_inteira(t.actual_distance_km or 0)}km" if t.actual_distance_km else "Pendente"
        pace_real = t.actual_pace if t.actual_pace else "-"
        rpe_real = str(t.actual_rpe) if t.actual_rpe else "-"

        dados_tabela.append(
            [
                data_formatada,
                t.workout_type,
                dist_planeada,
                dist_real,
                pace_real,
                rpe_real,
            ]
        )

    table = Table(dados_tabela, colWidths=[50, 150, 60, 90, 60, 90])

    estilo_tabela = TableStyle(
        [
            ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a8a")),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
            ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
            ("BOTTOMPADDING", (0, 0), (-1, 0), 10),
            ("TOPPADDING", (0, 0), (-1, 0), 10),
            ("ALIGN", (0, 0), (-1, 0), "CENTER"),
            ("ALIGN", (0, 1), (-1, -1), "CENTER"),
            ("FONTNAME", (0, 1), (-1, -1), "Helvetica"),
            ("GRID", (0, 0), (-1, -1), 0.5, colors.HexColor("#d1d5db")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.white]),
        ]
    )

    table.setStyle(estilo_tabela)
    elements.append(table)

    elements.append(Spacer(1, 40))
    estilo_rodape = ParagraphStyle(name="Rodape", fontSize=10, alignment=1, textColor=colors.gray)
    elements.append(Paragraph("Gerado automaticamente pela Inteligencia Artificial do ProCoach OS.", estilo_rodape))

    doc.build(elements)
    buffer.seek(0)

    return buffer


def _grafico_volume_png_bytes(db) -> io.BytesIO | None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt
        from sqlalchemy import func

        from database import Workout
    except Exception:
        return None

    hoje = dt_module.date.today()
    xs = []
    ys = []
    for i in range(6, -1, -1):
        d = hoje - dt_module.timedelta(days=i)
        xs.append(d.strftime("%d/%m"))
        vol = (
            db.query(func.sum(Workout.actual_distance_km))
            .filter(Workout.date == d, Workout.status == "Concluído")
            .scalar()
        )
        ys.append(float(vol or 0))

    fig, ax = plt.subplots(figsize=(6, 2.2))
    ax.bar(xs, ys, color="#1e3a8a")
    ax.set_ylabel("km")
    ax.set_title("Volume diario (ultimos 7 dias)")
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120)
    plt.close(fig)
    buf.seek(0)
    return buf


def _grafico_balanco_energetico_semanal_png_bytes(db) -> io.BytesIO | None:
    try:
        import matplotlib

        matplotlib.use("Agg")
        import matplotlib.pyplot as plt

        from services.analysis_service import serie_balanco_energetico_semanal
    except Exception:
        return None

    serie = serie_balanco_energetico_semanal(db, semanas=6)
    if not serie:
        return None
    labels = [s["semana_inicio"][5:10] for s in serie]
    kcals = [s["kcal_treinos_strava"] for s in serie]
    tmb_ref = serie[-1].get("tmb_x7_kcal_referencia_balanca")

    fig, ax = plt.subplots(figsize=(6.5, 2.7))
    x = range(len(serie))
    ax.bar(x, kcals, color="#2563eb", label="Kcal treinos (Strava)")
    if tmb_ref and tmb_ref > 0:
        ax.axhline(
            y=tmb_ref,
            color="#dc2626",
            linestyle="--",
            linewidth=1.4,
            label=f"TMBx7 ref. balanca ({tmb_ref:.0f} kcal/sem)",
        )
    ax.set_xticks(list(x))
    ax.set_xticklabels(labels, rotation=32, ha="right", fontsize=8)
    ax.set_ylabel("kcal / semana")
    ax.set_title("Balanco energetico semanal (treinos vs TMB biometria)")
    ax.legend(loc="upper left", fontsize=7)
    fig.tight_layout()
    buf = io.BytesIO()
    fig.savefig(buf, format="png", dpi=120)
    plt.close(fig)
    buf.seek(0)
    return buf


def _gemini_recomendacoes_nutricao(resumo: str, bloco_macros_quantificados: str = "") -> str:
    import os

    key = os.getenv("GEMINI_API_KEY") or os.getenv("GOOGLE_API_KEY")
    if not key:
        return "API Gemini nao configurada: recomendacoes nutricionais omitidas."
    try:
        from google import genai

        client = genai.Client(api_key=key)
        instr = (
            "Nutricionista desportivo (PT-PT). O motor ProCoach ja fixou gramas EXACTAS de proteina, "
            "hidratos e gordura para recuperacao pos-treino de domingo — confirme esses valores no texto, "
            "explique janela de ingestao (0-2h e 2-6h) e hidratacao; maximo 150 palavras.\n\n"
        )
        bloco = f"{instr}{bloco_macros_quantificados}\n\nContexto analitico:\n{resumo}"
        r = client.models.generate_content(
            model="gemini-2.5-flash",
            contents=bloco,
        )
        t = getattr(r, "text", None) or ""
        if not t.strip():
            for c in r.candidates or []:
                for p in c.content.parts:
                    if getattr(p, "text", None):
                        t += p.text
        t = t.strip()
        return t or "(sem texto devolvido)"
    except Exception as e:
        return f"Gemini indisponivel: {e}"


def gerar_diario_bordo_pdf(db) -> io.BytesIO:
    """Diario de Bordo — sintese Santo Graal (domingos) + treinos recentes + desacoplamento cardiaco."""
    from database import Workout
    from services.analysis_service import resumo_corridas_concluidas, ultimo_treino_domingo_com_strava
    from services.santo_graal_service import analisar_domingos

    analise = analisar_domingos(db)
    corridas = resumo_corridas_concluidas(db, dias=14)
    domingo_cal = ultimo_treino_domingo_com_strava(db)
    buffer = io.BytesIO()
    doc = SimpleDocTemplate(buffer, pagesize=A4, rightMargin=30, leftMargin=30, topMargin=40, bottomMargin=30)
    elements = []
    styles = getSampleStyleSheet()
    titulo = ParagraphStyle(
        name="DiarioTitulo",
        fontSize=18,
        alignment=1,
        spaceAfter=12,
        textColor=colors.HexColor("#0f172a"),
        fontName="Helvetica-Bold",
    )
    elements.append(Paragraph("DIARIO DE BORDO — SANTO GRAAL", titulo))
    elements.append(
        Paragraph(
            f"Emitido em {dt_module.datetime.now().strftime('%Y-%m-%d %H:%M UTC')} — ProCoach OS",
            styles["Normal"],
        )
    )
    elements.append(Spacer(1, 16))
    bloco = (
        f"<b>Analise de domingos</b><br/>"
        f"Amostras: {analise.get('amostras_domingo', 0)}<br/>"
        f"GAP medio (km): {analise.get('gap_medio_km')}<br/>"
        f"Fator termico pace: {analise.get('normalizacao_termica', {}).get('fator_pace')}<br/>"
        f"Desacoplamento HR/pace (medio): {analise.get('desacoplamento_hr_pace_medio')}<br/>"
        f"<i>{analise.get('interpretacao', '')}</i>"
    )
    elements.append(Paragraph(bloco, styles["Normal"]))
    elements.append(Spacer(1, 14))
    elements.append(
        Paragraph(
            "<b>Desacoplamento cardiaco (FC vs pace)</b><br/>"
            "Indice HR/pace elevado ao longo do tempo na mesma velocidade sugere drift cardiaco "
            "(menor eficiencia, fadiga, desidratacao ou calor).",
            styles["Normal"],
        )
    )
    dec_rows = [["Data", "FC bpm", "Pace min/km", "Indice HR/pace", "Nota"]]
    for c in corridas:
        d = c.get("desacoplamento")
        if d:
            nota = escape(str(d.get("nota", ""))[:120])
            dec_rows.append(
                [
                    c["date"],
                    str(d["hr_bpm"]),
                    str(d["pace_min_km"]),
                    str(d["indice_hr_por_pace"]),
                    nota,
                ]
            )
    if len(dec_rows) == 1:
        dec_rows.append(["—", "—", "—", "—", "Sem FC e pace registados no periodo."])
    tbl_dec = Table(dec_rows, colWidths=[52, 48, 58, 72, 220])
    tbl_dec.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0f766e")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.white]),
            ]
        )
    )
    elements.append(tbl_dec)

    elements.append(Spacer(1, 24))
    elements.append(Paragraph("<b>Ultimos treinos concluidos (14 dias)</b>", styles["Heading2"]))
    hoje = dt_module.date.today()
    recentes = (
        db.query(Workout)
        .filter(Workout.date >= hoje - dt_module.timedelta(days=14))
        .filter(Workout.status == "Concluído")
        .order_by(Workout.date.desc())
        .limit(12)
        .all()
    )
    linhas = [["Data", "Tipo", "km plan", "km real (int)", "Pace", "kcal", "kcal/km"]]
    for t in recentes:
        kc = getattr(t, "strava_calories", None)
        km_i = km_saida_inteira(t.actual_distance_km or 0.0)
        kkm = "-"
        if kc is not None and km_i > 0:
            kkm = str(round(float(kc) / km_i, 1))
        linhas.append(
            [
                t.date.strftime("%d/%m"),
                str(t.workout_type or ""),
                str(t.planned_distance_km or t.distance_km or "-"),
                f"{km_i}",
                str(t.actual_pace or "-"),
                str(int(kc)) if kc is not None else "-",
                kkm,
            ]
        )
    tbl = Table(linhas, colWidths=[42, 68, 42, 58, 48, 36, 44])
    tbl.setStyle(
        TableStyle(
            [
                ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#1e3a8a")),
                ("TEXTCOLOR", (0, 0), (-1, 0), colors.whitesmoke),
                ("FONTNAME", (0, 0), (-1, 0), "Helvetica-Bold"),
                ("FONTSIZE", (0, 0), (-1, -1), 8),
                ("GRID", (0, 0), (-1, -1), 0.25, colors.grey),
                ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.whitesmoke, colors.white]),
            ]
        )
    )
    elements.append(tbl)

    chart_png = _grafico_volume_png_bytes(db)
    if chart_png:
        elements.append(Spacer(1, 16))
        elements.append(Paragraph("<b>Grafico de volume (7 dias)</b>", styles["Heading2"]))
        elements.append(RLImage(ImageReader(chart_png), width=420, height=155))

    bal_png = _grafico_balanco_energetico_semanal_png_bytes(db)
    if bal_png:
        elements.append(Spacer(1, 16))
        elements.append(Paragraph("<b>Balanco energetico semanal (Strava vs TMB balanca)</b>", styles["Heading2"]))
        elements.append(RLImage(ImageReader(bal_png), width=420, height=175))

    bloco_macros = ""
    if domingo_cal:
        m = domingo_cal["macros"]
        cot = domingo_cal.get("cost_of_transport_kcal_kg_km")
        cot_txt = f"{cot}" if cot is not None else "n/d"
        elements.append(Spacer(1, 14))
        elements.append(
            Paragraph(
                "<b>Oraculo — gasto real domingo (Strava) e macronutrientes</b><br/>"
                f"Data: {domingo_cal['date']} | {domingo_cal['kcal']:.0f} kcal | "
                f"km int: {domingo_cal.get('km_inteiro', km_saida_inteira(domingo_cal.get('km') or 0))} | "
                f"CoT: {cot_txt} kcal/kg/km<br/>"
                f"<b>Proteina:</b> {m['protein_g']} g | <b>Hidratos:</b> {m['carbohydrate_g']} g | "
                f"<b>Gorduras:</b> {m['fat_g']} g",
                styles["Normal"],
            )
        )
        bloco_macros = (
            f"DOMINGO {domingo_cal['date']}: gasto {domingo_cal['kcal']:.0f} kcal Strava. "
            f"Proteina exacta {m['protein_g']} g, hidratos {m['carbohydrate_g']} g, gorduras {m['fat_g']} g. "
            f"Cost of transport {cot_txt} kcal/kg/km."
        )

    resumo_txt = (
        f"Domingos: {analise.get('amostras_domingo')} | GAP medio km: {analise.get('gap_medio_km')} | "
        f"Desacoplamento: {analise.get('desacoplamento_hr_pace_medio')} | "
        f"Amostras metabolicas: {len(corridas)}"
    )
    elements.append(Spacer(1, 18))
    elements.append(Paragraph("<b>Recomendacao nutricional (Oraculo + Gemini)</b>", styles["Heading2"]))
    nut = _gemini_recomendacoes_nutricao(resumo_txt + "\n" + str(corridas[:5]), bloco_macros)
    elements.append(Paragraph(escape(nut), styles["Normal"]))

    doc.build(elements)
    buffer.seek(0)
    return buffer
