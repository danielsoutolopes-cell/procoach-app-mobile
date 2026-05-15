import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/shared/models/race.dart';
import 'package:procoach_os/features/dashboard/providers/race_strategy_provider.dart';
import 'package:procoach_os/shared/widgets/procoach_button.dart';

class RaceDayCard extends ConsumerWidget {
  final Race race;
  final int daysToRace;

  const RaceDayCard({super.key, required this.race, required this.daysToRace});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final strategyAsync = ref.watch(raceStrategyProvider);

    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        gradient: const LinearGradient(
          colors: [Color(0xFF8B0000), Color(0xFF4A0000)], // Foco/Sangue
          begin: Alignment.topLeft,
          end: Alignment.bottomRight,
        ),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.redAccent.withOpacity(0.5)),
        boxShadow: [
          BoxShadow(
            color: Colors.redAccent.withOpacity(0.2),
            blurRadius: 10,
            spreadRadius: 2,
          )
        ]
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: [
              const Icon(Icons.flag, color: Colors.white, size: 28),
              const SizedBox(width: 8),
              const Text('MODO RACE DAY', style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold, letterSpacing: 1.5)),
              const Spacer(),
              Container(
                padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                decoration: BoxDecoration(color: Colors.white, borderRadius: BorderRadius.circular(8)),
                child: Text(daysToRace <= 0 ? 'É HOJE!' : 'FALTAM $daysToRace DIAS', style: const TextStyle(color: Colors.red, fontWeight: FontWeight.bold, fontSize: 12)),
              )
            ],
          ),
          const SizedBox(height: 16),
          Text(race.name.toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 22, fontWeight: FontWeight.w900)),
          const SizedBox(height: 24),
          const Text('✅ CHECKLIST DE LOGÍSTICA', style: TextStyle(color: Colors.white70, fontSize: 12, fontWeight: FontWeight.bold)),
          const SizedBox(height: 8),
          _buildChecklistItem('Carb-load focado (Refeições ricas em massas)'),
          _buildChecklistItem('Equipamento separado (Tênis oficial de placa)'),
          _buildChecklistItem('Géis conferidos e alarmes ajustados'),
          const SizedBox(height: 24),
          
          strategyAsync.when(
            data: (strategy) {
              if (strategy == null) {
                return ProCoachButton(
                  label: 'GERAR ESTRATÉGIA (IA)',
                  isPrimary: false,
                  onPressed: () => ref.read(raceStrategyProvider.notifier).generateStrategy(race.name),
                );
              }
              return Container(
                padding: const EdgeInsets.all(16),
                decoration: BoxDecoration(color: Colors.black45, borderRadius: BorderRadius.circular(12)),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    const Text('🧠 ESTRATÉGIA DO CÉREBRO', style: TextStyle(color: Colors.deepOrangeAccent, fontWeight: FontWeight.bold, fontSize: 12)),
                    const SizedBox(height: 8),
                    Text(strategy, style: const TextStyle(color: Colors.white, fontSize: 14, height: 1.5)),
                  ],
                ),
              );
            },
            loading: () => const Center(child: CircularProgressIndicator(color: Colors.white)),
            error: (e, _) => const Text('Erro ao contactar o Cérebro.', style: TextStyle(color: Colors.yellow)),
          )
        ],
      ),
    );
  }

  Widget _buildChecklistItem(String text) {
    return Padding(
      padding: const EdgeInsets.only(bottom: 6.0),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.check_circle, color: Colors.greenAccent, size: 16),
          const SizedBox(width: 8),
          Expanded(child: Text(text, style: const TextStyle(color: Colors.white, fontSize: 13))),
        ],
      ),
    );
  }
}