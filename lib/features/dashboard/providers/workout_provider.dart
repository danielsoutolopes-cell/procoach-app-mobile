import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/dashboard/services/workout_service.dart';
import 'package:procoach_os/shared/models/workout.dart';
import 'package:procoach_os/core/providers/location_provider.dart'; 

final workoutProvider = AsyncNotifierProvider<WorkoutNotifier, Workout?>(() {
  return WorkoutNotifier();
});

class WorkoutNotifier extends AsyncNotifier<Workout?> {
  @override
  FutureOr<Workout?> build() async {
    final workoutService = ref.watch(workoutServiceProvider);
    
    final position = await ref.watch(locationProvider.future);
    
    return await workoutService.getTodayWorkout(
      lat: position?.latitude,
      lon: position?.longitude,
    );
  }
}