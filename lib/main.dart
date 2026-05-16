import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/core/router/app_router.dart';
import 'package:firebase_core/firebase_core.dart';
import 'package:firebase_messaging/firebase_messaging.dart';
import 'firebase_options.dart';
import 'package:dio/dio.dart';
import 'package:flutter_dotenv/flutter_dotenv.dart';
import 'package:procoach_os/core/network/dio_client.dart';

void main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await dotenv.load(fileName: ".env");

  // Inicializa um ProviderContainer para acessarmos providers antes da montagem da UI
  final container = ProviderContainer();

  try {
    await Firebase.initializeApp(options: DefaultFirebaseOptions.currentPlatform);
    await _setupPushNotifications(container);
  } catch (e) {
    debugPrint('Firebase não inicializado: $e');
  }

  // O ProviderScope é o coração do Riverpod. Ele envolve o app inteiro 
  // para que os nossos Providers (como o athleteProvider) funcionem globalmente.
  runApp(
    UncontrolledProviderScope(
      container: container,
      child: ProCoachApp(),
    ),
  );
}

Future<void> _setupPushNotifications(ProviderContainer container) async {
  final messaging = FirebaseMessaging.instance;
  
  // Solicita permissão do sistema para exibir alertas
  await messaging.requestPermission(alert: true, badge: true, sound: true);
  
  // Gera o identificador único deste aparelho para o Firebase
  final fcmToken = await messaging.getToken();
  debugPrint('🔥 Token FCM (Substitui o Expo): $fcmToken');
  
  if (fcmToken != null) {
    try {
      // Envia o token para o backend (Neon DB) para substituir o expoPushToken
      final dio = container.read(dioProvider);
      await dio.patch(
        '/athletes/me/push-token',
        data: {'token': fcmToken},
      );
      debugPrint('✅ Token FCM salvo no servidor!');
    } catch (e) {
      debugPrint('❌ Erro ao salvar Token FCM: $e');
    }
  }
}

class ProCoachApp extends ConsumerWidget {
  const ProCoachApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final goRouter = ref.watch(goRouterProvider);

    return MaterialApp.router(
      title: 'ProCoach OS V6.1',
      debugShowCheckedModeBanner: false,
      // Tema sombrio oficial do ProCoach OS (Input-Light / Visual-First)
      theme: ThemeData.dark().copyWith(
        scaffoldBackgroundColor: const Color(0xFF0A0A0A),
        primaryColor: Colors.deepOrangeAccent,
        colorScheme: const ColorScheme.dark(
          primary: Colors.deepOrangeAccent,
          secondary: Colors.blueAccent,
        ),
      ),
      // Liga o Flutter ao GoRouter
      routerConfig: goRouter,
    );
  }
}