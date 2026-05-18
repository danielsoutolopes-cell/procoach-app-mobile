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
    
    // Como o app é mono-usuário, podemos usar um ID fixo ou deixar que o backend 
    // (Neon/Node) resolva o "Primary Athlete" automaticamente através da chave "mono".
    const monoAthleteId = 'mono'; 
    
    // Faz a chamada à API e retorna o Atleta. 
    // O Riverpod coloca o estado como AsyncLoading() automaticamente enquanto aguarda!
    return await athleteService.getAthleteProfile(monoAthleteId);
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
      await athleteService.updateGelInventory(currentAthlete.id, newAmount);
    } catch (error, stackTrace) {
      // 3. Rollback: Se a internet falhar, desfazemos a alteração na UI silenciosamente
      state = previousState;
    }
  }

  /// Adiciona uma nova prova ao calendário do atleta
  Future<void> addRace(Map<String, dynamic> raceData) async {
    try {
      final athleteService = ref.read(athleteServiceProvider);
      // Envia a requisição vinculada ao dispositivo primário "mono"
      await athleteService.addRace('mono', raceData);
      // Força a recarga do Provider, atualizando os ponteiros e listas do Dashboard automaticamente
      ref.invalidateSelf();
    } catch (e) {
      throw Exception('Falha ao cadastrar a prova: $e');
    }
  }

  /// Define a prova âncora do macrociclo
  Future<void> setMacrocycleAnchor(String raceId) async {
    try {
      final athleteService = ref.read(athleteServiceProvider);
      // Envia a requisição vinculada ao dispositivo primário "mono"
      await athleteService.setMacrocycleAnchor('mono', raceId);
      // Recarrega o estado do atleta para que todo o app se reajuste ao novo macrociclo
      ref.invalidateSelf();
    } catch (e) {
      throw Exception('Falha ao definir âncora: $e');
    }
  }

  /// Salva o resultado de uma prova concluída
  Future<void> saveRaceResult(String raceId, Map<String, dynamic> resultData) async {
    try {
      final athleteService = ref.read(athleteServiceProvider);
      await athleteService.saveRaceResult(raceId, resultData);
      // Recarrega o estado do atleta para exibir o novo resultado na lista
      ref.invalidateSelf();
    } catch (e) {
      throw Exception('Falha ao salvar resultado: $e');
    }
  }
}