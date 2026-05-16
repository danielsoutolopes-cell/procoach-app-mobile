import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/core/network/dio_client.dart';
import 'package:procoach_os/core/providers/location_provider.dart';

final weatherProvider = AsyncNotifierProvider<WeatherNotifier, Map<String, dynamic>?>(() {
  return WeatherNotifier();
});

class WeatherNotifier extends AsyncNotifier<Map<String, dynamic>?> {
  @override
  FutureOr<Map<String, dynamic>?> build() async {
    final dio = ref.watch(dioProvider);
    
    // Aguarda e busca a localização (Pede permissão no primeiro acesso)
    final position = await ref.watch(locationProvider.future);
    
    final queryParams = <String, dynamic>{};
    if (position?.latitude != null) queryParams['lat'] = position!.latitude;
    if (position?.longitude != null) queryParams['lon'] = position!.longitude;

    try {
      // Faz a requisição enviando as coordenadas exatas do corredor!
      final response = await dio.get(
        '/weather',
        queryParameters: queryParams,
      );
      return response.data as Map<String, dynamic>;
    } catch (e) {
      return null;
    }
  }
}