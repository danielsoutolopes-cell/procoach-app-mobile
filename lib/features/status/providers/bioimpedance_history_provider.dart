import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/core/network/dio_client.dart';

final bioHistoryProvider = AsyncNotifierProvider<BioHistoryNotifier, List<dynamic>>(() {
  return BioHistoryNotifier();
});

class BioHistoryNotifier extends AsyncNotifier<List<dynamic>> {
  @override
  FutureOr<List<dynamic>> build() async {
    final dio = ref.watch(dioProvider);
    try {
      // Traz as últimas 7 medições para o gráfico
      final response = await dio.get('/me/bioimpedance?limit=7');
      final entries = response.data['entries'] as List<dynamic>? ?? [];
      // Inverte para os mais antigos ficarem à esquerda e o atual à direita
      return entries.reversed.toList();
    } catch (e) {
      throw Exception('Erro ao buscar histórico de biometria: $e');
    }
  }
}