import 'dart:io';
import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/core/network/dio_client.dart';

final bioimpedanceServiceProvider = Provider<BioimpedanceService>((ref) {
  final dio = ref.watch(dioProvider);
  return BioimpedanceService(dio);
});

class Bioimpedance {
  final double weightKg;
  final double bodyFatPct;
  final double muscleMassKg;
  final double? bodyFatDiff;
  final double? weightDiff;
  final double? muscleMassDiff;

  Bioimpedance(this.weightKg, this.bodyFatPct, this.muscleMassKg, {this.bodyFatDiff, this.weightDiff, this.muscleMassDiff});

  factory Bioimpedance.fromJson(Map<String, dynamic> json) {
    return Bioimpedance(
      (json['weight_kg'] as num?)?.toDouble() ?? 0.0,
      (json['body_fat_pct'] as num?)?.toDouble() ?? 0.0,
      (json['muscle_mass_kg'] as num?)?.toDouble() ?? 0.0,
      bodyFatDiff: (json['body_fat_diff'] as num?)?.toDouble(),
      weightDiff: (json['weight_diff'] as num?)?.toDouble(),
      muscleMassDiff: (json['muscle_mass_diff'] as num?)?.toDouble(),
    );
  }
}

class BioimpedanceService {
  final Dio _dio;

  BioimpedanceService(this._dio);

  /// Faz o upload do PDF de bioimpedância para o backend Node.js,
  /// onde o Gemini fará a leitura via OCR/Vision.
  Future<void> uploadBioimpedancePdf(File file) async {
    final formData = FormData.fromMap({
      'file': await MultipartFile.fromFile(
        file.path,
        filename: file.path.split(Platform.pathSeparator).last,
      ),
    });

    // Ajuste a rota para bater com o endpoint do seu Cérebro/Node.js
    await _dio.post('/athletes/me/bioimpedance/upload', data: formData);
  }

  /// Retorna a última bioimpedância do atleta.
  Future<Bioimpedance?> getLatestBioimpedance() async {
    try {
      final response = await _dio.get('/athletes/me/bioimpedance/latest');
      if (response.data == null || response.data.toString().isEmpty) return null;
      return Bioimpedance.fromJson(response.data);
    } on DioException catch (e) {
      if (e.response?.statusCode == 404) return null; // Tratado como "sem dados"
      rethrow;
    }
  }
}