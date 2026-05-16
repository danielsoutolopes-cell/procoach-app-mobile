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
  Future<Workout?> getTodayWorkout(String athleteId) async {
    try {
      final response = await _dio.get('/athletes/$athleteId/workouts/today');
      if (response.data == null || response.data.toString().isEmpty) return null;
      return Workout.fromJson(response.data);
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) return null; // 404 tratado graciosamente como descanso
      rethrow;
    }
  }

  /// Envia o debrief do treino e atualiza a quilometragem do tênis se necessário
  Future<void> submitDebrief({
    required String workoutId,
    required int rpe,
    required int painLevel,
    String? shoeId,
    double? distanceKm,
  }) async {
    try {
      await _dio.post(
        '/athletes/me/workouts/$workoutId/debrief',
        data: {
          'rpe': rpe,
          'pain_level': painLevel,
          if (shoeId != null) 'shoe_id': shoeId,
          if (distanceKm != null) 'distance_km': distanceKm,
        },
      );
    } catch (e) {
      throw Exception('Erro ao salvar o debrief do treino: $e');
    }
  }

  /// Sincroniza atividades do Strava e retorna o resultado.
  Future<Map<String, dynamic>> syncStrava() async {
    try {
      final response = await _dio.post('/strava/sync');
      return response.data as Map<String, dynamic>;
    } catch (e) {
      throw Exception('Erro ao sincronizar com o Strava: $e');
    }
  }
}