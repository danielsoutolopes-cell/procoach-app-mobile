import 'package:dio/dio.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/core/network/interceptors/rounding_interceptor.dart';
import 'package:procoach_os/core/network/interceptors/auth_interceptor.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';

/// Provider do Riverpod que cria e expõe uma instância única (singleton) do Dio.
/// Widgets e outros providers poderão ler este provider para obter o cliente HTTP
/// já configurado.
final dioProvider = Provider<Dio>((ref) {
  // TODO: A URL base será lida dinamicamente do SharedPreferences.
  // Puxa do .env, com fallback para segurança
  final baseUrl = dotenv.env['API_URL'] ?? 'https://coach-pro-v8e4.onrender.com/api/procoach';

  final options = BaseOptions(
    baseUrl: baseUrl,
    connectTimeout: const Duration(seconds: 10),
    receiveTimeout: const Duration(seconds: 10),
  );

  final dio = Dio(options);

  // Adicionando nosso interceptor customizado para a "Regra de Ouro".
  dio.interceptors.add(RoundingInterceptor());
  dio.interceptors.add(AuthInterceptor());

  return dio;
});