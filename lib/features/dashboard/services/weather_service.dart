import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/core/network/dio_client.dart';

final weatherServiceProvider = Provider<WeatherService>((ref) {
  // Agora usamos o dioProvider para conectar ao backend Neon/Node.js
  return WeatherService(ref.watch(dioProvider));
});

class WeatherInfo {
  final int temperature;
  final int precipitation;
  final int windspeed;
  final String emoji;

  WeatherInfo(this.temperature, this.precipitation, this.windspeed, this.emoji);

  factory WeatherInfo.fromJson(Map<String, dynamic> json) {
    return WeatherInfo(
      json['temperature'] ?? 0,
      json['precipitation'] ?? 0,
      json['windspeed'] ?? 0,
      json['emoji'] ?? '☀️',
    );
  }
}

class WeatherService {
  final Dio _dio;

  WeatherService(this._dio);

  Future<WeatherInfo> getCurrentWeather({DateTime? targetDate}) async {
    try {
      final queryParams = <String, dynamic>{};
      
      if (targetDate != null) {
        queryParams['date'] = targetDate.toIso8601String().split('T')[0];
      }

      // Chama o seu backend Node.js, usando o baseUrl padrão (ex: /api/procoach)
      final response = await _dio.get(
        '/weather', 
        queryParameters: queryParams.isNotEmpty ? queryParams : null,
      );

      return WeatherInfo.fromJson(response.data);
    } catch (e) {
      throw Exception('Erro ao buscar previsão do tempo: $e');
    }
  }
}