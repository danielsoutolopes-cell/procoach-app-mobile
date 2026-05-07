import os
import json
import spotipy
from spotipy.oauth2 import SpotifyOAuth
from spotipy.cache_handler import CacheHandler
from datetime import date

class EnvCacheHandler(CacheHandler):
    """Lê e salva o cache do Spotify a partir de variáveis de ambiente."""
    def get_cached_token(self):
        token_info_string = os.getenv("SPOTIFY_CACHE_JSON")
        if token_info_string:
            try:
                return json.loads(token_info_string)
            except ValueError:
                print("⚠️ Erro ao decodificar a variável SPOTIFY_CACHE_JSON.")
        return None

    def save_token_to_cache(self, token_info):
        novo_cache = json.dumps(token_info)
        print("🔄 NOVO TOKEN DO SPOTIFY GERADO. ATUALIZE A VARIÁVEL NO RENDER:")
        print(novo_cache)

def autenticar_spotify():
    """Autentica no Spotify usando o Cache do Render (Headless)."""
    client_id = os.getenv("SPOTIFY_CLIENT_ID")
    client_secret = os.getenv("SPOTIFY_CLIENT_SECRET")
    redirect_uri = os.getenv("SPOTIFY_REDIRECT_URI", "http://localhost:8888/callback")
    
    if not client_id or not client_secret:
        print("⚠️ Credenciais do Spotify não encontradas no .env")
        return None

    cache_handler = EnvCacheHandler()
    
    try:
        sp_oauth = SpotifyOAuth(
            client_id=client_id,
            client_secret=client_secret,
            redirect_uri=redirect_uri,
            scope="playlist-modify-public playlist-modify-private",
            cache_handler=cache_handler,
            open_browser=False # <- CRUCIAL para o Render
        )
        
        token_info = sp_oauth.validate_token(cache_handler.get_cached_token())
        
        if not token_info:
            print("❌ Falha crítica: Token do Spotify inválido ou ausente.")
            return None
            
        sp = spotipy.Spotify(auth=token_info['access_token'])
        return sp
        
    except Exception as e:
        print(f"❌ Erro de Autenticação no Spotify: {e}")
        return None

def obter_cliente_spotify():
    """Inicializa a conexão com a API do Spotify usando OAuth 2.0."""
    return autenticar_spotify()

def criar_playlist_tatica(vibe_nome: str, faixas_json: list) -> str:
    """
    Recebe a lista de faixas da IA, procura no Spotify e cria a playlist.
    Retorna o URL da playlist criada.
    """
    sp = obter_cliente_spotify()
    if not sp:
        return "Erro: Falha na conexão com o Spotify."

    try:
        # 1. Obter o seu ID de Usuário
        user_id = sp.current_user()["id"]
        
        # 2. Criar a Playlist Vazia
        nome_playlist = f"🛡️ ProCoach: {vibe_nome} ({date.today().strftime('%d/%m')})"
        desc = "Frequência Sonora Tática gerada por IA (ProCoach OS)."
        
        nova_playlist = sp.user_playlist_create(
            user=user_id, 
            name=nome_playlist, 
            public=False, 
            description=desc
        )
        playlist_id = nova_playlist["id"]
        playlist_url = nova_playlist["external_urls"]["spotify"]

        # 3. Buscar as Músicas e Injetar na Playlist
        track_uris = []
        for faixa in faixas_json:
            titulo = faixa.get("t", "")
            artista = faixa.get("a", "")
            query = f"track:{titulo} artist:{artista}"
            
            # Sonda o Spotify
            resultado = sp.search(q=query, type='track', limit=1)
            tracks = resultado['tracks']['items']
            
            if tracks:
                track_uris.append(tracks[0]['uri'])
            else:
                # Fallback: Se não achar com "track:" e "artist:", faz uma busca ampla
                resultado_amplo = sp.search(q=f"{titulo} {artista}", type='track', limit=1)
                tracks_amplo = resultado_amplo['tracks']['items']
                if tracks_amplo:
                    track_uris.append(tracks_amplo[0]['uri'])

        # 4. Injetar as URIs encontradas na Playlist
        if track_uris:
            sp.playlist_add_items(playlist_id, track_uris)
            return playlist_url
        else:
            return "Nenhuma das faixas foi encontrada no banco de dados do Spotify."

    except Exception as e:
        print(f"❌ Erro Crítico no Spotify Service: {e}")
        return "Erro ao construir a playlist."