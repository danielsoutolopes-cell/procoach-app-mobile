import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/core/network/dio_client.dart';

/// Gerencia a transição de estado ao solicitar uma estratégia de prova para a IA.
final raceStrategyProvider = AsyncNotifierProvider<RaceStrategyNotifier, String?>(() {
  return RaceStrategyNotifier();
});

class RaceStrategyNotifier extends AsyncNotifier<String?> {
  @override
  FutureOr<String?> build() {
    // O estado inicial é nulo (nenhuma estratégia gerada ainda)
    return null;
  }

  Future<void> generateStrategy(String raceName) async {
    // Coloca a UI em loading instantaneamente
    state = const AsyncValue.loading();
    
    try {
      final dio = ref.read(dioProvider);
      
      // Chamada para a rota oficial do atleta no backend Node.js
      final response = await dio.post('/athletes/me/race-strategy', data: {'raceName': raceName});
      state = AsyncValue.data(response.data['strategy']);
      
    } catch (e, stackTrace) {
      state = AsyncValue.error(e, stackTrace);
    }
  }
}