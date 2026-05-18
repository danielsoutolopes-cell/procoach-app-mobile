import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/core/network/dio_client.dart';
import 'package:procoach_os/shared/models/athlete.dart';

/// Provider que expõe o nosso serviço de atleta.
final athleteServiceProvider = Provider<AthleteService>((ref) {
  final dio = ref.watch(dioProvider);
  return AthleteService(dio);
});

/// Classe de serviço responsável por todas as chamadas de API
/// relacionadas ao domínio do Atleta.
class AthleteService {
  final Dio _dio;

  AthleteService(this._dio);

  /// Busca o perfil completo do atleta no servidor.
  Future<Athlete> getAthleteProfile(String athleteId) async {
    final response = await _dio.get('/procoach/athletes/$athleteId/profile');
    // O Dio já faz o parse do JSON automaticamente.
    // O `Athlete.fromJson` usará o mapa resultante para criar nosso objeto Dart.
    return Athlete.fromJson(response.data);
  }

  /// Atualiza o estoque de géis do atleta no servidor.
  Future<void> updateGelInventory(String athleteId, int newAmount) async {
    // Aponta para a rota correta do domínio procoach que cuida do gel-stock
    await _dio.put('/procoach/athletes/$athleteId/gel-stock', data: {'gelsInStock': newAmount});
  }

  /// Cadastra uma nova prova e define se é a âncora do Macrociclo
  Future<void> addRace(String athleteId, Map<String, dynamic> raceData) async {
    await _dio.post('/procoach/athletes/$athleteId/races', data: raceData);
  }

  /// Define a prova âncora do macrociclo
  Future<void> setMacrocycleAnchor(String athleteId, String raceId) async {
    await _dio.put('/procoach/athletes/$athleteId/macrocycle-anchor', data: {'raceId': raceId});
  }

  /// Solicita uma Estratégia de Prova Tática gerada via Inteligência Artificial (Gemini)
  Future<String> getRaceStrategy(String raceName) async {
    final response = await _dio.post('/procoach/me/race-strategy', data: {'raceName': raceName});
    return response.data['strategy'] as String;
  }
}