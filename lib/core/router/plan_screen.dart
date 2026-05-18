import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:collection/collection.dart';
import 'package:procoach_os/features/athlete/providers/athlete_provider.dart';
import 'package:procoach_os/shared/models/plan_provider.dart';
import 'package:procoach_os/shared/models/athlete.dart';
import 'package:procoach_os/shared/models/plan_session.dart';
import 'package:procoach_os/shared/widgets/async_value_widget.dart';
import 'package:go_router/go_router.dart';

/// Provider para controlar a visibilidade das semanas passadas no plano.
final _showPastWeeksProvider = StateProvider<bool>((ref) => false);

class PlanScreen extends ConsumerWidget {
  const PlanScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final athleteAsync = ref.watch(athleteProvider);
    final planAsync = ref.watch(fullPlanProvider);
    final showPastWeeks = ref.watch(_showPastWeeksProvider);

    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A),
      appBar: AppBar(
        title: const Text(
          'PLANO DE TREINOS',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, letterSpacing: 1.2),
        ),
        centerTitle: true,
        backgroundColor: const Color(0xFF0A0A0A),
        elevation: 0,
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(16.0, 0, 16.0, 8.0),
            child: Align(
              alignment: Alignment.centerLeft,
              child: TextButton.icon(
                onPressed: () => ref.read(_showPastWeeksProvider.notifier).update((state) => !state),
                icon: Icon(showPastWeeks ? Icons.visibility_off_outlined : Icons.history, size: 18, color: Colors.deepOrangeAccent),
                label: Text(
                  showPastWeeks ? 'Ocultar semanas passadas' : 'Ver semanas passadas',
                  style: const TextStyle(color: Colors.deepOrangeAccent),
                ),
              ),
            ),
          ),
          Expanded(
            child: AsyncValueWidget<Athlete>(
              value: athleteAsync,
              data: (athlete) {
                // --- 1. Calcular a semana atual (lógica reutilizada do Dashboard) ---
                final anchorRace = athlete.races.firstWhereOrNull((r) =>
                    (athlete.macrocycleRaceId != null && r.id == athlete.macrocycleRaceId) || r.isAnchor);

                int currentWeek = 1;
                if (anchorRace != null) {
                  final planStart = anchorRace.date.subtract(const Duration(days: 16 * 7));
                  final daysSinceStart = DateTime.now().difference(planStart).inDays;
                  currentWeek = (daysSinceStart ~/ 7) + 1;
                  currentWeek = currentWeek.clamp(1, 16);
                }

                return AsyncValueWidget<List<PlanSession>>(
                  value: planAsync,
                  data: (allSessions) {
                    // --- 2. Filtrar o plano para mostrar apenas da semana atual em diante (ou todas) ---
                    final sessionsToDisplay = showPastWeeks
                        ? allSessions
                        : allSessions.where((session) => session.week >= currentWeek).toList();

                    if (sessionsToDisplay.isEmpty) {
                      return const Center(
                        child: Text(
                          'Nenhum treino para exibir.',
                          style: TextStyle(color: Colors.grey, fontSize: 14),
                        ),
                      );
                    }

                    // --- 3. Agrupar os treinos por semana para renderizar a lista ---
                    final sessionsByWeek = groupBy(sessionsToDisplay, (PlanSession session) => session.week);

                    return ListView.builder(
                      padding: const EdgeInsets.fromLTRB(16, 0, 16, 80), // Padding extra no final para não colar na navbar
                      itemCount: sessionsByWeek.keys.length,
                      itemBuilder: (context, index) {
                        final weekNumber = sessionsByWeek.keys.elementAt(index);
                        final weekSessions = sessionsByWeek[weekNumber]!;
                        return _buildWeekCard(context, ref, weekNumber, weekSessions, currentWeek);
                      },
                    );
                  },
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildWeekCard(BuildContext context, WidgetRef ref, int weekNumber, List<PlanSession> sessions, int currentWeek) {
    final isCurrentWeek = weekNumber == currentWeek;
    final isPastWeek = weekNumber < currentWeek;

    return Container(
      margin: const EdgeInsets.only(bottom: 24),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(
          color: isCurrentWeek ? Colors.deepOrangeAccent : (isPastWeek ? Colors.white10.withOpacity(0.5) : Colors.white10),
          width: isCurrentWeek ? 1.5 : 1,
        ),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(
                'SEMANA $weekNumber',
                style: TextStyle(
                  color: isCurrentWeek ? Colors.deepOrangeAccent : (isPastWeek ? Colors.grey : Colors.white),
                  fontSize: 14,
                  fontWeight: FontWeight.bold,
                  letterSpacing: 1.2,
                ),
              ),
              if (isCurrentWeek)
                Container(
                  padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                  decoration: BoxDecoration(
                    color: Colors.deepOrangeAccent.withOpacity(0.2),
                    borderRadius: BorderRadius.circular(8),
                  ),
                  child: const Text(
                    'ATUAL',
                    style: TextStyle(color: Colors.deepOrangeAccent, fontSize: 10, fontWeight: FontWeight.bold),
                  ),
                )
            ],
          ),
          const Divider(height: 24, color: Colors.white10),
          ...sessions.map((session) => _buildSessionRow(context, ref, session)),
        ],
      ),
    );
  }

  Widget _buildSessionRow(BuildContext context, WidgetRef ref, PlanSession session) {
    return InkWell(
      onTap: () {
        // Define a sessão selecionada no provider global
        ref.read(selectedPlanSessionProvider.notifier).state = session;
        // Navega para a aba "Próximo"
        context.go('/next');
      },
      borderRadius: BorderRadius.circular(8),
      child: Padding(
        padding: const EdgeInsets.symmetric(vertical: 8.0),
        child: Row(
          children: [
            SizedBox(
                width: 40,
                child: Text(session.day,
                    style: const TextStyle(
                        color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold))),
            const SizedBox(width: 16),
            Expanded(
              child: Text(session.activity, style: const TextStyle(color: Colors.white, fontSize: 14)),
            ),
            if (session.km != null && session.km! > 0)
              Text('${session.km} km',
                  style: const TextStyle(
                      color: Colors.deepOrangeAccent,
                      fontSize: 12,
                      fontWeight: FontWeight.w500)),
          ],
        ),
      ),
    );
  }
}