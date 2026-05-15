import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/status/services/compliance_service.dart';

final complianceProvider = AsyncNotifierProvider<ComplianceNotifier, List<DailyCompliance>>(() {
  return ComplianceNotifier();
});

class ComplianceNotifier extends AsyncNotifier<List<DailyCompliance>> {
  @override
  FutureOr<List<DailyCompliance>> build() async {
    final service = ref.watch(complianceServiceProvider);
    return await service.getWeeklyCompliance();
  }
}