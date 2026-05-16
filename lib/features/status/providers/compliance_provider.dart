import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/core/network/dio_client.dart';

final complianceProvider = AsyncNotifierProvider<ComplianceNotifier, List<dynamic>>(() {
  return ComplianceNotifier();
});

class ComplianceNotifier extends AsyncNotifier<List<dynamic>> {
  @override
  FutureOr<List<dynamic>> build() async {
    final dio = ref.watch(dioProvider);
    try {
      final response = await dio.get('/athletes/me/compliance/week');
      return response.data as List<dynamic>;
    } catch (e) {
      throw Exception('Erro ao buscar compliance da semana: $e');
    }
  }
}