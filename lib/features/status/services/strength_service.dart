import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/core/network/dio_client.dart';
import 'package:procoach_os/shared/models/strength_routine.dart';

class StrengthService {
  final Dio _dio;

  StrengthService(this._dio);

  Future<List<StrengthRoutine>> getStrengthRoutines() async {
    try {
      final response = await _dio.get('/athletes/me/strength-routines');
      final data = response.data as List;
      return data.map((e) => StrengthRoutine.fromJson(e)).toList();
    } catch (e) {
      throw Exception('Erro ao buscar fichas de força: $e');
    }
  }

  Future<void> saveStrengthRoutine(StrengthRoutine routine) async {
    await _dio.post(
      '/athletes/me/strength-routine',
      data: routine.toJson(),
    );
  }
}

final strengthServiceProvider = Provider<StrengthService>((ref) {
  return StrengthService(ref.watch(dioProvider));
});