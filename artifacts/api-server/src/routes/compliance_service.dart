import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/core/network/dio_client.dart';

final complianceServiceProvider = Provider<ComplianceService>((ref) {
  final dio = ref.watch(dioProvider);
  return ComplianceService(dio);
});

class DailyCompliance {
  final int dayIndex;
  final int plannedKm;
  final int completedKm;

  DailyCompliance(this.dayIndex, this.plannedKm, this.completedKm);

  factory DailyCompliance.fromJson(Map<String, dynamic> json) {
    return DailyCompliance(json['dayIndex'], json['plannedKm'], json['completedKm']);
  }
}

class ComplianceService {
  final Dio _dio;
  ComplianceService(this._dio);

  Future<List<DailyCompliance>> getWeeklyCompliance() async {
    final response = await _dio.get('/athletes/me/compliance/week');
    return (response.data as List).map((json) => DailyCompliance.fromJson(json)).toList();
  }
}