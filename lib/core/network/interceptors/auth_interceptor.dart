import 'package:dio/dio.dart';
import 'package:flutter/material.dart';

/// Interceptor responsável por injetar tokens de autorização globalmente
class AuthInterceptor extends Interceptor {
  @override
  void onRequest(RequestOptions options, RequestInterceptorHandler handler) async {
    // TODO: Substitua pela leitura real do seu token (ex: SharedPreferences, FlutterSecureStorage, etc.)
    // final prefs = await SharedPreferences.getInstance();
    // final token = prefs.getString('auth_token');
    const token = 'SEU_TOKEN_DE_EXEMPLO'; 

    if (token.isNotEmpty) {
      // Injeta o token no cabeçalho
      options.headers['Authorization'] = 'Bearer $token';
      debugPrint('🔑 AuthInterceptor: Token injetado na rota ${options.path}');
    } else {
      debugPrint('⚠️ AuthInterceptor: Nenhum token encontrado para a rota ${options.path}');
    }

    // Continua a requisição normalmente
    super.onRequest(options, handler);
  }
}