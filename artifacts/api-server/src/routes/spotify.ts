import { Router, type IRouter, type Request, type Response } from "express";

const router: IRouter = Router();

// ─── Token cache ──────────────────────────────────────────────────────────────

let cachedToken: string | null = null;
let tokenExpiresAt = 0;

function cleanEnvValue(val: string | undefined): string {
  const v = String(val ?? "").trim();
  if (!v) return "";
  return v.replace(/^['"`]+/, "").replace(/['"`]+$/, "").trim();
}

async function getAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < tokenExpiresAt - 60_000) {
    return cachedToken;
  }
  const clientId = cleanEnvValue(process.env.SPOTIFY_CLIENT_ID);
  const clientSecret = cleanEnvValue(process.env.SPOTIFY_CLIENT_SECRET);
  if (!clientId || !clientSecret) {
    throw new Error("Spotify não configurado no servidor (SPOTIFY_CLIENT_ID/SECRET)");
  }
  const creds = Buffer.from(`${clientId}:${clientSecret}`).toString("base64");

  const res = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST",
    headers: {
      Authorization: `Basic ${creds}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: "grant_type=client_credentials",
  });
  const tokenText = await res.text().catch(() => "");
  if (!res.ok) throw new Error(`Spotify token error: ${res.status}: ${tokenText || "(no body)"}`);
  const data = JSON.parse(tokenText) as { access_token: string; expires_in: number };
  cachedToken    = data.access_token;
  tokenExpiresAt = Date.now() + data.expires_in * 1000;
  return cachedToken;
}

// ─── Workout → search config ──────────────────────────────────────────────────

interface PlaylistConfig {
  query: string;
  label: string;
}

const WORKOUT_PLAYLIST_CONFIG: Record<string, PlaylistConfig> = {
  tiros:        { query: "running intervals speed workout high intensity",  label: "Tiros & Velocidade"    },
  corrida:      { query: "running motivation long run jogging playlist",    label: "Corrida"               },
  regenerativo: { query: "easy run recovery chill running relaxed pace",    label: "Regenerativo"          },
  folga:        { query: "relaxing recovery rest day ambient chill",        label: "Descanso"              },
  prova:        { query: "race day marathon running pump motivation epic",   label: "Dia de Prova"          },
  forca:        { query: "gym workout strength training pump motivation",    label: "Força"                 },
  bike:         { query: "cycling indoor bike workout steady rhythm",        label: "Bike"                  },
};

const FALLBACK_CONFIG: PlaylistConfig = {
  query: "running workout motivacao brasil",
  label: "Treino",
};

// ─── Route ────────────────────────────────────────────────────────────────────

interface SpotifyPlaylistResult {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  tracksTotal: number;
  spotifyUrl: string;
  spotifyUri: string;
  owner: string;
}

router.get("/spotify/playlist-for-workout", async (req: Request, res: Response) => {
  const workoutType = (req.query.workoutType as string) ?? "corrida";
  const config = WORKOUT_PLAYLIST_CONFIG[workoutType] ?? FALLBACK_CONFIG;

  try {
    const token = await getAccessToken();

    // Search playlists — market=BR so results are relevant for Brazil
    const searchUrl = new URL("https://api.spotify.com/v1/search");
    searchUrl.searchParams.set("q", config.query);
    searchUrl.searchParams.set("type", "playlist");
    searchUrl.searchParams.set("market", "BR");
    searchUrl.searchParams.set("limit", "10");

    const searchRes = await fetch(searchUrl.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!searchRes.ok) {
      const t = await searchRes.text().catch(() => "");
      throw new Error(`Spotify search error: ${searchRes.status}: ${t || "(no body)"}`);
    }

    const searchData = (await searchRes.json()) as {
      playlists: {
        items: Array<{
          id: string;
          name: string;
          description: string;
          images: Array<{ url: string; width: number | null; height: number | null }>;
          tracks?: { total: number };
          external_urls: { spotify: string };
          uri: string;
          owner: { display_name: string };
          public: boolean | null;
        } | null>;
      };
    };

    // Filter out nulls — some playlists have no images in search results
    const candidates = searchData.playlists.items
      .filter((p): p is NonNullable<typeof p> => p !== null && p.images.length > 0);

    if (candidates.length === 0) {
      res.status(404).json({ error: "No playlists found" });
      return;
    }

    // Pick first good candidate
    const pick = candidates[0]!;
    const img = pick.images[0]!;

    const playlist: SpotifyPlaylistResult = {
      id:           pick.id,
      name:         pick.name,
      description:  pick.description?.replace(/<[^>]*>/g, "") ?? "",
      imageUrl:     img?.url ?? null,
      tracksTotal:  pick.tracks?.total ?? 0,
      spotifyUrl:   pick.external_urls.spotify,
      spotifyUri:   pick.uri,
      owner:        pick.owner.display_name,
    };

    req.log.info({ workoutType, playlistId: playlist.id }, "Spotify playlist fetched");
    res.json({ playlist, workoutLabel: config.label });
  } catch (err) {
    const msg = err instanceof Error ? err.message : "Spotify unavailable";
    req.log.error({ err: msg }, "Spotify playlist fetch failed");
    if (
      msg.includes("não configurado") ||
      msg.includes("invalid_client") ||
      msg.includes("Spotify token error: 400") ||
      msg.includes("Spotify token error: 401")
    ) {
      res.status(503).json({ error: msg });
      return;
    }
    res.status(502).json({ error: msg });
  }
});

export default router;
