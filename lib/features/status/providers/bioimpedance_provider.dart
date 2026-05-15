import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/status/services/bioimpedance_service.dart';

final bioimpedanceProvider = AsyncNotifierProvider<BioimpedanceNotifier, Bioimpedance?>(() {
  return BioimpedanceNotifier();
});

class BioimpedanceNotifier extends AsyncNotifier<Bioimpedance?> {
  @override
  FutureOr<Bioimpedance?> build() async {
    final service = ref.watch(bioimpedanceServiceProvider);
    return await service.getLatestBioimpedance();
  }
}