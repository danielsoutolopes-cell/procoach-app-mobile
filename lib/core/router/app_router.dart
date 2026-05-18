import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:procoach_os/core/router/scaffold_with_navbar.dart';
import 'package:procoach_os/features/dashboard/screens/dashboard_screen.dart';
import 'package:procoach_os/features/dashboard/screens/next_workout_screen.dart';
import 'package:procoach_os/features/status/screens/status_screen.dart';
import 'package:procoach_os/shared/models/plan_screen.dart';
import 'package:procoach_os/features/status/screens/import_screen.dart';
import 'package:procoach_os/shared/models/shoes_screen.dart';

/// Provider que expõe as nossas Rotas. 
/// Utilizar Riverpod aqui permite que futuramente façamos redirecionamentos 
/// baseados em login/logout de forma totalmente reativa!
final goRouterProvider = Provider<GoRouter>((ref) {
  return GoRouter(
    initialLocation: '/',
    routes: [
      // A StatefulShellRoute mantém o estado de cada Aba preservado na memória
      StatefulShellRoute.indexedStack(
        builder: (context, state, navigationShell) {
          return ScaffoldWithNavBar(navigationShell: navigationShell);
        },
        branches: [
          // Aba 0: Dashboard (Home)
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/',
                builder: (context, state) => const DashboardScreen(),
              ),
            ],
          ),
          // Aba 1: Plano (Matriz e Importado)
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/plan',
                builder: (context, state) => const PlanScreen(),
              ),
            ],
          ),
          // Aba 2: Status (Bioimpedância, PDF, Macro)
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/status',
                builder: (context, state) => const StatusScreen(),
                routes: [
                  GoRoute(
                    path: 'import', // Acessível via /status/import
                    builder: (context, state) => const ImportScreen(),
                  ),
                ],
              ),
            ],
          ),
          // Aba 3: Próximo Treino
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/next',
                builder: (context, state) => const NextWorkoutScreen(),
              ),
            ],
          ),
          // Aba 4: Inventário (Géis, Tênis)
          StatefulShellBranch(
            routes: [
              GoRoute(
                path: '/inventory',
                builder: (context, state) => const ShoesScreen(),
              ),
            ],
          ),
        ],
      ),
    ],
  );
});