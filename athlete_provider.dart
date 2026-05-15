import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/athlete/services/athlete_service.dart';
import 'package:procoach_os/shared/models/athlete.dart';

/// O AsyncNotifierProvider substitui o Context + useEffect do React Native.
/// Ele gerencia automaticamente a transição de Loading -> Data (ou Error).
final athleteProvider = AsyncNotifierProvider<AthleteNotifier, Athlete>(() {
  return AthleteNotifier();
});

class AthleteNotifier extends AsyncNotifier<Athlete> {
  @override
  FutureOr<Athlete> build() async {
    // O `ref.watch` cria uma ligação reativa com o nosso serviço.
    final athleteService = ref.watch(athleteServiceProvider);
    
    // Faz a chamada à API e retorna o Atleta. 
    // O Riverpod coloca o estado como AsyncLoading() automaticamente enquanto aguarda!
    return await athleteService.getAthleteProfile();
  }

  /// Exemplo Prático: Atualizar o estoque de géis (UX "Visual-First, Input-Light")
  /// Usamos o padrão de "Atualização Otimista" para o app parecer instantâneo.
  Future<void> updateGelInventory(int newAmount) async {
    final previousState = state; // Guarda o estado atual para possível Rollback
    final currentAthlete = state.value;
    
    if (currentAthlete == null) return;

    // 1. Atualização Otimista: Atualiza a UI imediatamente antes de ir à API
    state = AsyncData(
      Athlete(
        id: currentAthlete.id,
        name: currentAthlete.name,
        gelInventory: newAmount,
        races: currentAthlete.races,
      ),
    );

    try {
      // 2. Chamada real à API usando o serviço
      final athleteService = ref.read(athleteServiceProvider);
      await athleteService.updateGelInventory(newAmount);
    } catch (error, stackTrace) {
      // 3. Rollback: Se a internet falhar, desfazemos a alteração na UI silenciosamente
      state = previousState;
    }
  }
}