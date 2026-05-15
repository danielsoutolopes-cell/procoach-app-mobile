import 'dart:async';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/core/network/dio_client.dart';

final raceStrategyProvider = AsyncNotifierProvider<RaceStrategyNotifier, String?>(() {
  return RaceStrategyNotifier();
});

class RaceStrategyNotifier extends AsyncNotifier<String?> {
  @override
  FutureOr<String?> build() => null;

  Future<void> generateStrategy(String raceName) async {
    state = const AsyncLoading();
    try {
      final dio = ref.read(dioProvider);
      final response = await dio.post('/athletes/me/race-strategy', data: {
        'raceName': raceName,
      });
      state = AsyncData(response.data['strategy'] as String);
    } catch (e) {
      state = AsyncError(e, StackTrace.current);
    }
  }
}