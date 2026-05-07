from fastapi import APIRouter, HTTPException, Query
from services.maps_service import calcular_tempo_viagem

router = APIRouter()

@router.get("/osrm/sondar")
def sondar_rota_osrm(destino: str = Query(..., description="Endereço de destino da prova")):
    """
    Consulta o Open Source Routing Machine (OSRM) para calcular o tempo real de viagem
    da base (HOME_ADDRESS) até ao destino.
    """
    try:
        # Chama a função brilhante que você criou no maps_service.py
        minutos = calcular_tempo_viagem(destino)
        
        return {
            "status": "success", 
            "tempo_estimado_minutos": minutos,
            "mensagem": f"Rota OSRM calculada: {minutos} min."
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))