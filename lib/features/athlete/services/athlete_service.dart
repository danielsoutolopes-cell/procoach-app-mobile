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
    final response = await _dio.get('/athletes/$athleteId/profile');
    // O Dio já faz o parse do JSON automaticamente.
    // O `Athlete.fromJson` usará o mapa resultante para criar nosso objeto Dart.
    return Athlete.fromJson(response.data);
  }

  /// Atualiza o estoque de géis do atleta no servidor.
  Future<void> updateGelInventory(String athleteId, int newAmount) async {
    // Faz a chamada HTTP atualizando o valor. Adapte a rota '/gels' consoante o seu backend Node.js.
    await _dio.patch('/athletes/$athleteId/gels', data: {'gel_inventory': newAmount});
  }

  /// Cadastra uma nova prova e define se é a âncora do Macrociclo
  Future<void> addRace(String athleteId, Map<String, dynamic> raceData) async {
    await _dio.post('/athletes/$athleteId/races', data: raceData);
  }
}