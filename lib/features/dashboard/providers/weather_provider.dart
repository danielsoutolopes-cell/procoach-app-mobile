import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/dashboard/services/weather_service.dart';

final weatherProvider = AsyncNotifierProviderFamily<WeatherNotifier, WeatherInfo, DateTime?>(() {
  return WeatherNotifier();
});

class WeatherNotifier extends FamilyAsyncNotifier<WeatherInfo, DateTime?> {
  @override
  FutureOr<WeatherInfo> build(DateTime? arg) async {
    final service = ref.watch(weatherServiceProvider);
    // O 'arg' aqui é a targetDate (DateTime?) passada pela UI (como a aba do Próximo Treino).
    // Nota: Lembre-se de atualizar o método no seu weather_service.dart para aceitar este parâmetro!
    return await service.getCurrentWeather(targetDate: arg);
  }
}