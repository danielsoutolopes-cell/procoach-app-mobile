import 'package:flutter/material.dart';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/dashboard/providers/workout_provider.dart';
import 'package:procoach_os/features/dashboard/widgets/debrief_dialog.dart';

class WorkoutCard extends ConsumerWidget {
  const WorkoutCard({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final workoutAsync = ref.watch(workoutProvider);
    final workout = workoutAsync.value;
    
    // Valida o estado atual do treino para mudar o botão!
    final isCompleted = workout?.status == 'concluido'; 
    
    // Lógica da Esteira Inteligente (Alerta de Chuva e Km/h)
    final isTreadmill = workout?.suggestTreadmill == true;
    final paceOrSpeed = isTreadmill && workout?.treadmillSpeed != null ? '🏃 Esteira: ${workout!.treadmillSpeed}' : '🎯 Pace: ${workout?.targetPace ?? "--:--"}';
    final rainWarning = isTreadmill ? '  •  🌧️ Chuva: ${workout?.rainProbability}%' : '';

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
          Row(
            children: [
              const Icon(Icons.directions_run, color: Colors.deepOrangeAccent, size: 28),
              const SizedBox(width: 12),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(workout?.activity.toUpperCase() ?? 'TREINO', style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                    const SizedBox(height: 4),
                    Text('$paceOrSpeed  •  📏 ${workout?.distanceKm ?? 0}km$rainWarning', style: const TextStyle(color: Colors.grey, fontSize: 14)),
                  ],
                ),
              ),
            ],
          ),
          
          // Segmentação Visual do Treino (Fase 1)
          if (workout?.estrutura != null && workout!.estrutura!.isNotEmpty) ...[
            const SizedBox(height: 16),
            Wrap(
              spacing: 8,
              runSpacing: 8,
              children: workout.estrutura!.split('+').map((segment) {
                final text = segment.trim();
                if (text.isEmpty) return const SizedBox.shrink();
                
                final isWarmup = text.toUpperCase().contains('AQ');
                final isCooldown = text.toUpperCase().contains('DQ');
                
                Color bgColor;
                Color textColor;
                Color borderColor;
                IconData segmentIcon;
                
                if (isWarmup) {
                  bgColor = Colors.blueAccent.withOpacity(0.15);
                  textColor = Colors.lightBlueAccent;
                  borderColor = Colors.blueAccent.withOpacity(0.5);
                  segmentIcon = Icons.arrow_upward_rounded;
                } else if (isCooldown) {
                  bgColor = Colors.teal.withOpacity(0.15);
                  textColor = Colors.tealAccent;
                  borderColor = Colors.teal.withOpacity(0.5);
                  segmentIcon = Icons.arrow_downward_rounded;
                } else {
                  bgColor = Colors.deepOrangeAccent.withOpacity(0.15);
                  textColor = Colors.deepOrangeAccent;
                  borderColor = Colors.deepOrangeAccent.withOpacity(0.5);
                  segmentIcon = Icons.local_fire_department_rounded;
                }

                return Container(
                  padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
                  decoration: BoxDecoration(color: bgColor, borderRadius: BorderRadius.circular(8), border: Border.all(color: borderColor)),
                  child: Row(
                    mainAxisSize: MainAxisSize.min,
                    children: [
                      Icon(segmentIcon, color: textColor, size: 14),
                      const SizedBox(width: 6),
                      Text(text, style: TextStyle(color: textColor, fontWeight: FontWeight.bold, fontSize: 13)),
                    ],
                  ),
                );
              }).toList(),
            ),
          ],
          
          const SizedBox(height: 24),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton(
              style: ElevatedButton.styleFrom(
                backgroundColor: isCompleted ? Colors.green : Colors.deepOrangeAccent,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 16),
                shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
              ),
              onPressed: isCompleted || workout == null
                  ? null // Botão desativado se já estiver concluído
                  : () async {
                      // Invoca o Dialog global que lida com Géis, Tênis e Telemetria
                      final debriefSaved = await showDialog<bool>(
                        context: context,
                        barrierDismissible: false,
                        builder: (ctx) => DebriefDialog(
                          workoutId: workout.id.toString(),
                          distanceKm: workout.activity.toLowerCase() == 'corrida' ? (workout.distanceKm ?? 0).toDouble() : 0.0,
                        ),
                      );
                      
                      if (debriefSaved == true) {
                        // Ao invalidar, o Riverpod atualiza o ecrã instantaneamente
                        // e o botão fica verde com "✅ TREINO CONCLUÍDO"!
                        ref.invalidate(workoutProvider); 
                      }
                    },
              child: Text(
                isCompleted ? '✅ TREINO CONCLUÍDO' : 'CONCLUIR TREINO',
                style: const TextStyle(fontWeight: FontWeight.bold, letterSpacing: 1.2),
              ),
            ),
          ),
        ],
      ),
    );
  }
}