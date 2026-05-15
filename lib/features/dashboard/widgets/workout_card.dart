import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/shared/widgets/procoach_button.dart';
import 'package:procoach_os/features/dashboard/providers/workout_provider.dart';
import 'package:procoach_os/core/network/dio_client.dart';

class WorkoutCard extends ConsumerWidget {
  const WorkoutCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workoutAsync = ref.watch(workoutProvider);

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
          const Text(
            'TREINO DO DIA',
            style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1.2),
          ),
          const SizedBox(height: 16),
          const Row(
            children: [
              Icon(Icons.directions_run, color: Colors.deepOrangeAccent, size: 28),
              SizedBox(width: 12),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text('Corrida (Leve)', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                  SizedBox(height: 4),
                  Text('🎯 Pace: 6:00 min/km  •  📏 8km', style: TextStyle(color: Colors.grey, fontSize: 14)),
                ],
              ),
            ],
          ),
          const SizedBox(height: 24),
          // Componente partilhado que criámos na Fase 4!
          ProCoachButton(
            label: 'CONCLUIR TREINO',
            onPressed: () {
                      _showDebriefModal(context, ref);
            },
          ),
        ],
      ),
    );
  }

  void _showDebriefModal(BuildContext context, WidgetRef ref) {
    double rpe = 5;
    double pain = 0;
    
    showModalBottomSheet(
      context: context,
      backgroundColor: const Color(0xFF1A1A1A),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (context) {
        return StatefulBuilder(
          builder: (BuildContext context, StateSetter setState) {
            return Padding(
              padding: const EdgeInsets.all(24.0),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                children: [
                  const Text('DEBRIEF DO TREINO', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 24),
                  const Text('RPE (Esforço: 1 a 10)', style: TextStyle(color: Colors.grey)),
                  Slider(
                    value: rpe,
                    min: 1, max: 10, divisions: 9,
                    activeColor: Colors.deepOrangeAccent,
                    label: rpe.round().toString(),
                    onChanged: (val) => setState(() => rpe = val),
                  ),
                  const SizedBox(height: 16),
                  const Text('Dor Articular (0 a 5)', style: TextStyle(color: Colors.grey)),
                  Slider(
                    value: pain,
                    min: 0, max: 5, divisions: 5,
                    activeColor: Colors.redAccent,
                    label: pain.round().toString(),
                    onChanged: (val) => setState(() => pain = val),
                  ),
                  const SizedBox(height: 32),
                  ProCoachButton(
                    label: 'SALVAR E CONCLUIR',
                    onPressed: () async {
                      Navigator.pop(context); // Fecha o modal
                      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('A guardar telemetria...')));
                      try {
                        final dio = ref.read(dioProvider);
                        await dio.post('/athletes/me/workouts/feedback', data: {
                          'rpe': rpe.round(),
                          'painLevel': pain.round(),
                        });
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Excelente treino! Dados recebidos pelo Radar Articular.'), backgroundColor: Colors.green));
                        }
                      } catch (e) {
                        if (context.mounted) {
                          ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao salvar telemetria.'), backgroundColor: Colors.redAccent));
                        }
                      }
                    },
                  ),
                ],
              ),
            );
          },
        );
      },
    );
  }
}