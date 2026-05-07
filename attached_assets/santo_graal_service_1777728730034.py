"""
Motor de análise de domingos: GAP (planeado vs real), normalização térmica e desacoplamento HR/pace.
"""
from typing import Any, List

from sqlalchemy.orm import Session

from database import Workout
from services.analysis_service import calculate_weather_factor


def analisar_domingos(db: Session, temp_c: float = 24.0, humidity_pct: float = 55.0) -> dict[str, Any]:
    concl = db.query(Workout).filter(Workout.status == "Concluído").all()
    concl = [w for w in concl if w.date.weekday() == 6]

    gaps: List[float] = []
    decouplings: List[float] = []
    for w in concl:
        plan = float(w.planned_distance_km or w.distance_km or 0)
        real = float(w.actual_distance_km or 0)
        if plan > 0 and real > 0:
            gaps.append(real - plan)
        if w.actual_heartrate and w.actual_pace and real > 0:
            try:
                m, s = map(int, str(w.actual_pace).split(":"))
                pace_min_km = m + s / 60.0
                if pace_min_km > 0:
                    decouplings.append((w.actual_heartrate / pace_min_km) / real)
            except (ValueError, TypeError, ZeroDivisionError):
                pass

    fator_termico = calculate_weather_factor(temp_c, humidity_pct)

    return {
        "amostras_domingo": len(concl),
        "gap_medio_km": round(sum(gaps) / len(gaps), 3) if gaps else None,
        "normalizacao_termica": {
            "temp_c": temp_c,
            "humidity_pct": humidity_pct,
            "fator_pace": round(fator_termico, 3),
        },
        "desacoplamento_hr_pace_medio": round(sum(decouplings) / len(decouplings), 3) if decouplings else None,
        "interpretacao": (
            "GAP positivo: tendência a correr mais longe que o planeado ao domingo."
            if gaps and (sum(gaps) / len(gaps)) > 0.3
            else "Domingos alinhados ao plano, dentro da variância esperada."
        ),
    }
