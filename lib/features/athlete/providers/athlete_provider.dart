import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/athlete/services/athlete_service.dart';
import 'package:procoach_os/shared/models/athlete.dart';

/// O AsyncNotifierProvider principal, focado APENAS em manter o estado do Atleta.
final athleteProvider = AsyncNotifierProvider<AthleteNotifier, Athlete>(() {
  return AthleteNotifier();
});

class AthleteNotifier extends AsyncNotifier<Athlete> {
  @override
  FutureOr<Athlete> build() async {
    final athleteService = ref.watch(athleteServiceProvider);
    const monoAthleteId = 'mono'; 
    return await athleteService.getAthleteProfile(monoAthleteId);
  }

  /// Permite que Controllers específicos façam atualizações otimistas no estado global.
  void setOptimisticState(Athlete newState) {
    state = AsyncData(newState);
  }

  /// Permite Rollback em caso de falha na API.
  void rollbackState(AsyncValue<Athlete> previousState) {
    state = previousState;
  }

  // =======================================================================
  // MÉTODOS LEGADOS (Delegando para os novos Controllers para manter retrocompatibilidade)
  // =======================================================================

  @Deprecated('Use ref.read(inventoryControllerProvider).updateGelInventory')
  Future<void> updateGelInventory(int newAmount) => 
      ref.read(inventoryControllerProvider).updateGelInventory(newAmount);

  @Deprecated('Use ref.read(raceControllerProvider).addRace')
  Future<void> addRace(Map<String, dynamic> raceData) => 
      ref.read(raceControllerProvider).addRace(raceData);

  @Deprecated('Use ref.read(raceControllerProvider).setMacrocycleAnchor')
  Future<void> setMacrocycleAnchor(String raceId) => 
      ref.read(raceControllerProvider).setMacrocycleAnchor(raceId);

  @Deprecated('Use ref.read(raceControllerProvider).saveRaceResult')
  Future<bool> saveRaceResult(String raceId, Map<String, dynamic> resultData) => 
      ref.read(raceControllerProvider).saveRaceResult(raceId, resultData);
}

/// Controller focado exclusivamente na gestão de Inventário (Géis, Tênis, etc).
final inventoryControllerProvider = Provider((ref) => InventoryController(ref));

class InventoryController {
  final Ref _ref;
  InventoryController(this._ref);

  Future<void> updateGelInventory(int newAmount) async {
    final athleteNotifier = _ref.read(athleteProvider.notifier);
    final previousState = _ref.read(athleteProvider);
    final currentAthlete = previousState.value;
    
    if (currentAthlete == null) return;

    athleteNotifier.setOptimisticState(
      Athlete(
        id: currentAthlete.id,
        name: currentAthlete.name,
        gelInventory: newAmount,
        races: currentAthlete.races,
      ),
    );

    try {
      await _ref.read(athleteServiceProvider).updateGelInventory(currentAthlete.id, newAmount);
    } catch (error) {
      athleteNotifier.rollbackState(previousState);
      throw Exception('Falha ao atualizar inventário: $error');
    }
  }
}

/// Controller focado exclusivamente na gestão de Provas (Races e Resultados).
final raceControllerProvider = Provider((ref) => RaceController(ref));

class RaceController {
  final Ref _ref;
  RaceController(this._ref);

  Future<void> addRace(Map<String, dynamic> raceData) async {
    try {
      await _ref.read(athleteServiceProvider).addRace('mono', raceData);
      _ref.invalidate(athleteProvider);
    } catch (e) {
      throw Exception('Falha ao cadastrar a prova: $e');
    }
  }

  Future<void> setMacrocycleAnchor(String raceId) async {
    try {
      await _ref.read(athleteServiceProvider).setMacrocycleAnchor('mono', raceId);
      _ref.invalidate(athleteProvider);
    } catch (e) {
      throw Exception('Falha ao definir âncora: $e');
    }
  }

  Future<bool> saveRaceResult(String raceId, Map<String, dynamic> resultData) async {
    try {
      bool isNewPR = false;
      final currentAthlete = _ref.read(athleteProvider).value;

      if (currentAthlete != null) {
        final races = currentAthlete.races;
        final currentRace = races.firstWhere((r) => r['id'].toString() == raceId, orElse: () => {});

        if (currentRace.isNotEmpty && resultData['finishTime'] != null) {
          final distance = double.tryParse(currentRace['distancia']?.toString() ?? '0') ?? 0;
          final newTimeStr = resultData['finishTime'] as String;

          int timeToSec(String t) {
            final p = t.split(':');
            if (p.length == 2) return (int.tryParse(p[0]) ?? 0) * 60 + (int.tryParse(p[1]) ?? 0);
            if (p.length == 3) return (int.tryParse(p[0]) ?? 0) * 3600 + (int.tryParse(p[1]) ?? 0) * 60 + (int.tryParse(p[2]) ?? 0);
            return 999999; 
          }

          final newSec = timeToSec(newTimeStr);
          int bestPreviousSec = 999999;

          for (var r in races) {
            if (r['id'].toString() == raceId) continue;
            final d = double.tryParse(r['distancia']?.toString() ?? '0') ?? 0;
            if ((d - distance).abs() <= 0.5) { 
              final t = r['finishTime'];
              if (t != null && t != '--:--') {
                final sec = timeToSec(t.toString());
                if (sec < bestPreviousSec) bestPreviousSec = sec;
              }
            }
          }
          if (newSec < bestPreviousSec) isNewPR = true;
        }
      }

      await _ref.read(athleteServiceProvider).saveRaceResult(raceId, resultData);
      _ref.invalidate(athleteProvider);
      
      return isNewPR;
    } catch (e) {
      throw Exception('Falha ao salvar resultado: $e');
    }
  }
}