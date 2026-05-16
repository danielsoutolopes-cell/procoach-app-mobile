import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/dashboard/providers/weather_provider.dart';

class WeatherCard extends ConsumerWidget {
  final DateTime? targetDate;

  const WeatherCard({super.key, this.targetDate});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Passando a data para o Provider! 
    // (Veja a Nota de Arquiteto abaixo sobre como atualizar o arquivo weather_provider.dart)
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
            style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1.2),
          ),
          const SizedBox(height: 16),
          weatherAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, _) => const Text(
              'Não foi possível carregar a previsão.',
              style: TextStyle(color: Colors.redAccent),
            ),
            data: (weather) {
              return Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _buildWeatherItem(weather.emoji, '${weather.temperature}°C', 'Temp'),
                  _buildWeatherItem('💧', '${weather.precipitation}%', 'Chuva'),
                  _buildWeatherItem('💨', '${weather.windspeed} km/h', 'Vento'),
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