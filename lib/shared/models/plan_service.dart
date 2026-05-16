import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/core/network/dio_client.dart';
import 'package:procoach_os/shared/models/plan_session.dart';

class PlanService {
  final Dio _dio;

  PlanService(this._dio);

  Future<List<PlanSession>> getPlanSessions() async {
    try {
      final response = await _dio.get('/athletes/me/plan-sessions');
      final data = response.data as List;
      return data.map((e) => PlanSession.fromJson(e as Map<String, dynamic>)).toList();
    } catch (e) {
      throw Exception('Erro ao buscar plano de treinos: $e');
    }
  }
}

final planServiceProvider = Provider<PlanService>((ref) {
  return PlanService(ref.watch(dioProvider));
});