# -*- coding: utf-8 -*-
"""Modulo auxiliar para integracao do Cerebro Balistico ao Telegram Router"""

import re
from typing import Dict, Optional

def extrair_parametros_tiros(details: str) -> Optional[Dict]:
    """Extrai parametros de um treino de tiros (ex: '8x800m com 2min de pausa')."""
    if not details:
        return None
    
    details_lower = details.lower()
    pattern_tiros = r'(\d+)x(\d+)m'
    match_tiros = re.search(pattern_tiros, details_lower)
    
    if not match_tiros:
        return None
    
    qtd_tiros = int(match_tiros.group(1))
    dist_tiro_m = int(match_tiros.group(2))
    pausa_segundos = 120
    
    pattern_min = r'(\d+)\s*min(?:uto)?s?'
    match_min = re.search(pattern_min, details_lower)
    if match_min:
        pausa_segundos = int(match_min.group(1)) * 60
    
    pattern_seg = r'(\d+)\s*seg(?:undo)?s?'
    match_seg = re.search(pattern_seg, details_lower)
    if match_seg:
        pausa_segundos = int(match_seg.group(1))
    
    return {
        "qtd_tiros": qtd_tiros,
        "dist_tiro_m": dist_tiro_m,
        "pausa_segundos": pausa_segundos
    }


def gerar_cola_esteira(relatorio: Dict) -> str:
    """Gera a cola (template) para fim de treino de esteira."""
    if relatorio["validacao"] != "Ok" or not relatorio["distancia_total_km"]:
        return "COLA: FIM DE TREINO (ESTEIRA)\nFim de Treino.\nDistancia: ___ km\nTempo: ___ min\nRPE: ___/10\nRelato: ________"
    
    bd = relatorio["breakdown"]
    dt = relatorio["detalhes_tiros"]
    dist_total = relatorio["distancia_total_km"]
    
    tipo_pausa = dt.get("pausa_tipo", "?")
    cola = (
        "COLA: FIM DE TREINO (ESTEIRA)\n"
        "Fim de Treino.\n"
        f"Distancia: {dist_total} km (Cerebro Balistico: {dt['qtd_tiros']}x{dt['dist_por_tiro_m']}m {tipo_pausa})\n"
        "Tempo: ___ min\nRPE: ___/10\nRelato: ________"
    )
    return cola


def calcular_distancia_treino_inteligente(workout_details: str, aq_km: float = 1.5, dq_km: float = 1.0):
    """Calcula distancia usando o Cerebro Balistico."""
    from services.strategy_service import gerar_relatorio_tiros, TreadmillBrainError
    
    try:
        params = extrair_parametros_tiros(workout_details)
        if not params:
            return None, "Nao consegui extrair parametros do treino"
        
        relatorio = gerar_relatorio_tiros(
            aq_km=aq_km,
            qtd_tiros=params["qtd_tiros"],
            dist_tiro_m=params["dist_tiro_m"],
            pausa_segundos=params["pausa_segundos"],
            dq_km=dq_km
        )
        
        if relatorio["validacao"] != "Ok":
            return None, f"Erro: {relatorio['validacao']}"
        
        return relatorio["distancia_total_km"], relatorio
    
    except TreadmillBrainError as e:
        return None, f"Erro Balistico: {str(e)}"
    except Exception as e:
        return None, f"Erro: {str(e)}"


def gerar_mensagem_cola_completa(workout_type: str, workout_details: str) -> str:
    """Gera a mensagem completa da cola para o usuario."""
    if "Tiros" in workout_type or "Intervalado" in workout_type:
        dist, resultado = calcular_distancia_treino_inteligente(workout_details)
        if dist is not None and isinstance(resultado, dict):
            return gerar_cola_esteira(resultado)
    
    elif "Bike" in workout_type or "Ciclismo" in workout_type:
        return "COLA: FIM DE TREINO (BIKE)\nFim de Treino.\nDistancia: ___ km\nTempo: ___ min\nRPE: ___/10\nRelato: ________"
    
    return "COLA: FIM DE TREINO\nFim de Treino.\nDistancia: ___ km\nTempo: ___ min\nRPE: ___/10\nRelato: ________"
