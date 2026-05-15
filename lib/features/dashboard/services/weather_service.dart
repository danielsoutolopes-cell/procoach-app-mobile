import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

final weatherServiceProvider = Provider<WeatherService>((ref) {
  // Usamos uma instância nova e limpa do Dio pois não precisamos do BaseUrl 
  // ou interceptors (Regra de Ouro) do backend Node.js para esta API pública.
  return WeatherService(Dio());
});

class WeatherInfo {
  final int temperature;
  final int precipitation;
  final int windspeed;
  final String emoji;

  WeatherInfo(this.temperature, this.precipitation, this.windspeed, this.emoji);
}

class WeatherService {
  final Dio _dio;

  WeatherService(this._dio);

  Future<WeatherInfo> getCurrentWeather() async {
    // Mesmas coordenadas configuradas no seu backend (Rua Maracá / São Paulo)
    const url = 'https://api.open-meteo.com/v1/forecast?latitude=-23.6087&longitude=-46.6676&current=temperature_2m,weathercode,windspeed_10m,precipitation&timezone=America%2FSao_Paulo';
    final response = await _dio.get(url);
    final current = response.data['current'];

    final temp = (current['temperature_2m'] as num).round();
    final precip = (current['precipitation'] as num).round();
    final wind = (current['windspeed_10m'] as num).round();
    final code = current['weathercode'] as int;

    // Lógica de classificação visual do clima
    String emoji = '☀️';
    if (code <= 3) emoji = '⛅';
    else if (code <= 67) emoji = '🌧️';
    else emoji = '⛈️';

    return WeatherInfo(temp, precip, wind, emoji);
  }
}