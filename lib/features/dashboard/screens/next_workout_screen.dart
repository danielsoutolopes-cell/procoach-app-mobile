import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/dashboard/providers/next_workout_provider.dart';
import 'package:procoach_os/features/dashboard/widgets/weather_card.dart';

class NextWorkoutScreen extends ConsumerWidget {
  const NextWorkoutScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final nextAsync = ref.watch(nextWorkoutProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('PRÓXIMO TREINO', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, letterSpacing: 1.2)),
        centerTitle: true,
        backgroundColor: const Color(0xFF0A0A0A),
        elevation: 0,
      ),
      body: nextAsync.when(
        loading: () => const Center(child: CircularProgressIndicator()),
        error: (error, _) => const Center(child: Text('Erro ao buscar.', style: TextStyle(color: Colors.redAccent))),
        data: (workout) {
          if (workout == null) {
            return const Center(child: Text('Nenhum próximo treino agendado.', style: TextStyle(color: Colors.grey)));
          }
          return ListView(
            padding: const EdgeInsets.all(16.0),
            children: [
              Container(
                padding: const EdgeInsets.all(20),
                decoration: BoxDecoration(
                  color: const Color(0xFF1A1A1A),
                  borderRadius: BorderRadius.circular(16),
                  border: Border.all(color: Colors.white10),
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      'AGENDADO PARA: ${workout.date.toIso8601String().split('T')[0]}',
                      style: const TextStyle(color: Colors.deepOrangeAccent, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1.2),
                    ),
                    const SizedBox(height: 16),
                    Row(
                      children: [
                        Icon(workout.activity.toLowerCase().contains('bike') ? Icons.directions_bike : Icons.directions_run, color: Colors.white, size: 32),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(workout.activity, style: const TextStyle(fontSize: 20, fontWeight: FontWeight.bold, color: Colors.white)),
                              const SizedBox(height: 4),
                              Text('🎯 Pace: ${workout.targetPace ?? '-'}  •  📏 ${workout.distanceKm ?? 0}km', style: const TextStyle(color: Colors.grey)),
                            ],
                          ),
                        ),
                      ],
                    ),
                    if (workout.estrutura != null) ...[
                      const SizedBox(height: 20),
                      Container(
                        padding: const EdgeInsets.all(12),
                        decoration: BoxDecoration(color: Colors.grey[900], borderRadius: BorderRadius.circular(8)),
                        child: Text(workout.estrutura!, style: const TextStyle(color: Colors.white70)),
                      ),
                    ],
                  ],
                ),
              ),
              const SizedBox(height: 24),
              WeatherCard(targetDate: workout.date),
            ],
          );
        },
      ),
    );
  }
}