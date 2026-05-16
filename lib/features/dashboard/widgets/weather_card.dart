import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/dashboard/providers/weather_provider.dart';

class WeatherCard extends ConsumerWidget {
  final DateTime? targetDate;

  const WeatherCard({super.key, this.targetDate});

  String _getWeatherEmoji(int? code, int? isDay) {
    if (code == null) return '☁️';
    if (code == 0) return isDay == 1 ? '☀️' : '🌙';
    if (code == 1 || code == 2 || code == 3) return isDay == 1 ? '⛅' : '☁️';
    if (code >= 45 && code <= 48) return '🌫️';
    if (code >= 51 && code <= 67) return '🌧️';
    if (code >= 71 && code <= 77) return '❄️';
    if (code >= 80 && code <= 82) return '🌧️';
    if (code >= 85 && code <= 86) return '❄️';
    if (code >= 95) return '⛈️';
    return '☁️';
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // O novo provider usa o GPS, então não passamos mais o targetDate aqui
    final weatherAsync = ref.watch(weatherProvider);
    
    final title = targetDate != null ? 'PREVISÃO PARA O TREINO' : 'PREVISÃO DE HOJE';

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1.2),
          ),
          const SizedBox(height: 16),
          weatherAsync.when(
            loading: () => const Center(child: CircularProgressIndicator(color: Colors.deepOrangeAccent)),
            error: (error, _) => const Text(
              'Não foi possível carregar a previsão.',
              style: TextStyle(color: Colors.redAccent),
            ),
            data: (weather) {
              if (weather == null) {
                return const Text('Sem dados de clima', style: TextStyle(color: Colors.white54));
              }

              final emoji = _getWeatherEmoji(weather['weathercode'] as int?, weather['is_day'] as int?);
              final temp = weather['temperature']?.toString() ?? '--';
              final rainProb = weather['rainProbability']?.toString() ?? '0';
              final wind = weather['windspeed']?.toString() ?? '--';

              return Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _buildWeatherItem(emoji, '$temp°C', 'Temp'),
                  _buildWeatherItem('💧', '$rainProb%', 'Chuva'),
                  _buildWeatherItem('💨', '$wind km/h', 'Vento'),
                ],
              );
            },
          ),
        ],
      ),
    );
  }

  Widget _buildWeatherItem(String emoji, String value, String label) {
    return Column(
      children: [
        Text(emoji, style: const TextStyle(fontSize: 24)),
        const SizedBox(height: 8),
        Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}