import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/shared/models/plan_session.dart';

/// Em um app real, este serviço faria uma chamada de API para buscar o plano.
/// Para este exemplo, vamos simular a resposta com dados mocados.
final planServiceProvider = Provider((ref) => PlanService());

class PlanService {
  Future<List<PlanSession>> getFullPlan() async {
    // Simula uma chamada de rede
    await Future.delayed(const Duration(milliseconds: 800));

    // Gera um plano de 16 semanas para demonstração
    return List.generate(16 * 7, (index) {
      final week = (index ~/ 7) + 1;
      final dayIndex = index % 7;
      final days = ['SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SAB', 'DOM'];

      String activity;
      int? km;
      switch (dayIndex) {
        case 0: activity = 'Descanso'; break;
        case 1: activity = 'Corrida (Leve)'; km = 5; break;
        case 2: activity = 'Força A'; break;
        case 3: activity = 'Corrida (Intervalado)'; km = 8; break;
        case 4: activity = 'Força B'; break;
        case 5: activity = 'Longão'; km = 10 + week; break;
        case 6: activity = 'Regenerativo'; km = 3; break;
        default: activity = 'Descanso';
      }

      return PlanSession(
        week: week,
        day: days[dayIndex],
        activity: activity,
        km: km,
        details: activity != 'Descanso' ? 'Detalhes do treino da semana $week' : null,
      );
    });
  }
}

/// Provider que busca e armazena em cache a lista completa de treinos do plano.
final fullPlanProvider = FutureProvider<List<PlanSession>>((ref) {
  final service = ref.watch(planServiceProvider);
  return service.getFullPlan();
});

/// Provider para armazenar a sessão de treino que o usuário selecionou na tela de Plano.
final selectedPlanSessionProvider = StateProvider<PlanSession?>((ref) => null);