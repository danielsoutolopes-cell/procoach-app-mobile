export interface WeatherData {
  temperature: number;
  feelsLike: number;
  humidity: number;
  windSpeed: number;
  precipitationProb: number;
  weatherCode: number;
  description: string;
  emoji: string;
  paceAdjustmentPercent: number;
  adjustedPaceMinKm: number;
  basePaceMinKm: number;
  available: boolean;
}

const WMO: Record<number, { description: string; emoji: string }> = {
  0:  { description: "Céu limpo",              emoji: "☀️" },
  1:  { description: "Predominantemente limpo", emoji: "🌤️" },
  2:  { description: "Parcialmente nublado",    emoji: "⛅" },
  3:  { description: "Nublado",                 emoji: "☁️" },
  45: { description: "Neblina",                 emoji: "🌫️" },
  48: { description: "Neblina gelada",          emoji: "🌫️" },
  51: { description: "Garoa leve",              emoji: "🌦️" },
  53: { description: "Garoa moderada",          emoji: "🌦️" },
  55: { description: "Garoa forte",             emoji: "🌦️" },
  61: { description: "Chuva leve",              emoji: "🌧️" },
  63: { description: "Chuva moderada",          emoji: "🌧️" },
  65: { description: "Chuva forte",             emoji: "🌧️" },
  80: { description: "Pancadas leves",          emoji: "🌦️" },
  81: { description: "Pancadas de chuva",       emoji: "🌧️" },
  82: { description: "Pancadas fortes",         emoji: "⛈️" },
  95: { description: "Tempestade",              emoji: "⛈️" },
  99: { description: "Tempestade com granizo",  emoji: "⛈️" },
};

function getWMO(code: number) {
  const key = Object.keys(WMO).map(Number).sort((a, b) => b - a).find((k) => code >= k);
  return WMO[key ?? 0] ?? { description: "Condições variáveis", emoji: "🌤️" };
}

// ─── Pace adjustment formula (science-based) ──────────────────────────────────
// Reference: Ely et al. (2007), Vihma (2010)
// Optimal temp: 10-15°C. Penalty grows with heat, humidity, and wind.
export function calcPaceAdjustmentPercent(
  temp: number,
  humidity: number,
  windSpeed: number,
  precipProb: number
): number {
  let adj = 0;

  // Temperature: optimal 10-15°C
  if (temp > 15) adj += (temp - 15) * 1.5;          // +1.5%/°C above 15°C
  else if (temp > 25) adj += (temp - 25) * 2.5;     // steeper above 25°C (already included)
  else if (temp < 5) adj += (5 - temp) * 0.5;       // cold: minor penalty

  // Humidity: above 65% starts to impact
  if (humidity > 65) adj += Math.floor((humidity - 65) / 5) * 0.6;

  // Feels-like correction: heat index
  if (temp > 20 && humidity > 60) adj += 0.5;

  // Wind: above 20 km/h is significant
  if (windSpeed > 20) adj += (windSpeed - 20) * 0.15;

  // Rain likely
  if (precipProb > 60) adj += 1.5;
  if (precipProb > 80) adj += 1.0;

  return Math.round(adj * 10) / 10;
}

export function applyPaceAdjustment(basePace: number, adjustmentPercent: number): number {
  return Math.round(basePace * (1 + adjustmentPercent / 100) * 100) / 100;
}

export function getWeatherTip(data: WeatherData): string {
  if (!data.available) return "";
  const tips: string[] = [];
  if (data.temperature > 25) tips.push("Calor intenso: aumente a hidratação (a cada 10min) e reduza o pace nos primeiros 10km.");
  else if (data.temperature > 20) tips.push("Temperatura elevada: hidrate-se a cada 15min e não saia no ritmo planejado.");
  if (data.humidity > 75) tips.push("Umidade alta: a percepção de esforço será maior. Confie nos batimentos, não no pace.");
  if (data.windSpeed > 25) tips.push("Vento forte: aproveite o vento a favor para manter ritmo e poupando energia na cabeça.");
  if (data.precipitationProb > 60) tips.push("Alta chance de chuva: use meias anti-bolha e aplique vaselina extra.");
  if (data.paceAdjustmentPercent === 0) tips.push("Condições ideais! Ótimo dia para correr forte.");
  return tips.join(" ");
}

const NULL_WEATHER: WeatherData = {
  temperature: 0, feelsLike: 0, humidity: 0, windSpeed: 0, precipitationProb: 0,
  weatherCode: 0, description: "", emoji: "—", paceAdjustmentPercent: 0,
  adjustedPaceMinKm: 0, basePaceMinKm: 0, available: false,
};

export async function fetchRaceWeather(
  address: string,
  raceDateISO: string,
  raceHour: number,
  basePaceMinKm: number
): Promise<WeatherData> {
  try {
    // 1. Geocode
    const geoRes = await fetch(
      `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(address)}&format=json&limit=1`,
      { headers: { "User-Agent": "PROCOACH-OS/1.0" } }
    );
    if (!geoRes.ok) return NULL_WEATHER;
    const geo = (await geoRes.json()) as Array<{ lat: string; lon: string }>;
    if (!geo[0]) return NULL_WEATHER;

    const lat = parseFloat(geo[0].lat);
    const lon = parseFloat(geo[0].lon);
    const date = raceDateISO.slice(0, 10);

    // 2. Forecast (Open-Meteo, free, no key)
    const wRes = await fetch(
      `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}` +
      `&hourly=temperature_2m,apparent_temperature,relativehumidity_2m,precipitation_probability,windspeed_10m,weathercode` +
      `&timezone=America%2FSao_Paulo&start_date=${date}&end_date=${date}`
    );
    if (!wRes.ok) return NULL_WEATHER;

    const wd = (await wRes.json()) as {
      hourly?: {
        temperature_2m: number[];
        apparent_temperature: number[];
        relativehumidity_2m: number[];
        precipitation_probability: number[];
        windspeed_10m: number[];
        weathercode: number[];
      };
      error?: boolean;
    };

    if (wd.error || !wd.hourly) return NULL_WEATHER;

    const h = Math.max(0, Math.min(23, raceHour));
    const temp        = wd.hourly.temperature_2m[h]            ?? 20;
    const feelsLike   = wd.hourly.apparent_temperature[h]       ?? temp;
    const humidity    = wd.hourly.relativehumidity_2m[h]        ?? 60;
    const windSpeed   = wd.hourly.windspeed_10m[h]              ?? 10;
    const precipProb  = wd.hourly.precipitation_probability[h]  ?? 0;
    const code        = wd.hourly.weathercode[h]                ?? 0;

    const wmo = getWMO(code);
    const paceAdj = calcPaceAdjustmentPercent(temp, humidity, windSpeed, precipProb);
    const adjustedPace = applyPaceAdjustment(basePaceMinKm, paceAdj);

    return {
      temperature:          Math.round(temp * 10) / 10,
      feelsLike:            Math.round(feelsLike * 10) / 10,
      humidity:             Math.round(humidity),
      windSpeed:            Math.round(windSpeed),
      precipitationProb:    Math.round(precipProb),
      weatherCode:          code,
      description:          wmo.description,
      emoji:                wmo.emoji,
      paceAdjustmentPercent: paceAdj,
      adjustedPaceMinKm:    adjustedPace,
      basePaceMinKm,
      available:            true,
    };
  } catch {
    return NULL_WEATHER;
  }
}

export function formatWeatherForPDF(w: WeatherData): string {
  if (!w.available) return "";
  const adjLabel = w.paceAdjustmentPercent > 0
    ? `+${w.paceAdjustmentPercent}% pace (~+${Math.round(w.paceAdjustmentPercent / 100 * w.basePaceMinKm * 60)}s/km)`
    : "Sem impacto no pace";

  return `
    <div style="background:#111;border:1px solid #1E1E1E;border-radius:10px;padding:16px;margin-bottom:16px;">
      <div style="font-size:9px;letter-spacing:3px;font-weight:800;color:#555;margin-bottom:10px;">PREVISÃO DO TEMPO — DIA DA PROVA</div>
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:12px;">
        <div style="font-size:36px;">${w.emoji}</div>
        <div>
          <div style="font-size:22px;font-weight:800;color:#FFF;">${w.temperature}°C</div>
          <div style="font-size:12px;color:#888;">${w.description} · Sensação ${w.feelsLike}°C</div>
        </div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin-bottom:12px;">
        ${[
          { label: "UMIDADE", value: `${w.humidity}%` },
          { label: "VENTO", value: `${w.windSpeed} km/h` },
          { label: "CHUVA", value: `${w.precipitationProb}%` },
        ].map((item) => `
          <div style="background:#0A0A0A;border-radius:8px;padding:8px;text-align:center;">
            <div style="font-size:14px;font-weight:800;color:#EEE;">${item.value}</div>
            <div style="font-size:8px;letter-spacing:2px;color:#555;margin-top:2px;">${item.label}</div>
          </div>`).join("")}
      </div>
      ${w.paceAdjustmentPercent > 0 ? `
      <div style="background:#1A0800;border:1px solid #FF5F0033;border-radius:8px;padding:10px;">
        <div style="font-size:10px;font-weight:800;color:#FF9800;letter-spacing:1px;margin-bottom:4px;">⚠️ IMPACTO NO DESEMPENHO</div>
        <div style="font-size:12px;color:#CCC;">${adjLabel}</div>
        <div style="font-size:10px;color:#888;margin-top:4px;">Pace ajustado recomendado: <strong style="color:#FF5F00;">${formatAdjPace(w.adjustedPaceMinKm)} min/km</strong></div>
      </div>` : `
      <div style="background:#0A1A0A;border:1px solid #4CAF5033;border-radius:8px;padding:8px;">
        <div style="font-size:11px;color:#4CAF50;">✅ Condições favoráveis — mantenha o pace planejado.</div>
      </div>`}
    </div>`;
}

function formatAdjPace(p: number): string {
  const min = Math.floor(p);
  const sec = Math.round((p - min) * 60);
  return `${min}:${String(sec).padStart(2, "0")}`;
}
