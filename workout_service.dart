import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/core/network/dio_client.dart';
import 'package:procoach_os/shared/models/workout.dart';

final workoutServiceProvider = Provider<WorkoutService>((ref) {
  final dio = ref.watch(dioProvider);
  return WorkoutService(dio);
});

class WorkoutService {
  final Dio _dio;

  WorkoutService(this._dio);

  /// Retorna o treino planeado para o dia atual.
  /// Retorna `null` se for dia de descanso ou não houver treino importado.
  Future<Workout?> getTodayWorkout() async {
    try {
      final response = await _dio.get('/athletes/me/workouts/today');
      if (response.data == null || response.data.toString().isEmpty) return null;
      return Workout.fromJson(response.data);
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) return null; // 404 tratado graciosamente como descanso
      rethrow;
    }
  }
}