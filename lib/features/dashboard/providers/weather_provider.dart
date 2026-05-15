import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/dashboard/services/weather_service.dart';

final weatherProvider = AsyncNotifierProvider<WeatherNotifier, WeatherInfo>(() {
  return WeatherNotifier();
});

class WeatherNotifier extends AsyncNotifier<WeatherInfo> {
  @override
  FutureOr<WeatherInfo> build() async {
    final service = ref.watch(weatherServiceProvider);
    return await service.getCurrentWeather();
  }
}