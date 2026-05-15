import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/core/network/dio_client.dart';
import 'package:procoach_os/shared/models/workout.dart';

final nextWorkoutProvider = AsyncNotifierProvider<NextWorkoutNotifier, Workout?>(() {
  return NextWorkoutNotifier();
});

class NextWorkoutNotifier extends AsyncNotifier<Workout?> {
  @override
  FutureOr<Workout?> build() async {
    final dio = ref.watch(dioProvider);
    try {
      final response = await dio.get('/athletes/me/workouts/next');
      if (response.data == null) return null;
      return Workout.fromJson(response.data);
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) return null;
      rethrow;
    }
  }
}