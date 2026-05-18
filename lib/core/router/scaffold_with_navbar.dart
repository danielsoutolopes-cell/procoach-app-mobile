import 'package:flutter/material.dart';
import 'package:go_router/go_router.dart';

class ScaffoldWithNavBar extends StatelessWidget {
  const ScaffoldWithNavBar({
    super.key,
    required this.navigationShell,
  });

  final StatefulNavigationShell navigationShell;

  void _goBranch(int index) {
    // Troca para a aba clicada. O goBranch do GoRouter sabe gerir isto.
    navigationShell.goBranch(
      index,
      // Se já estivermos nesta aba, clica-la de novo leva o utilizador
      // de volta ao início dessa aba (excelente padrão de UX).
      initialLocation: index == navigationShell.currentIndex,
    );
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: navigationShell, // O ecrã ativo entra aqui
      bottomNavigationBar: BottomNavigationBar(
        backgroundColor: const Color(0xFF0A0A0A), // Cor de Fundo
        type: BottomNavigationBarType.fixed, // Garante que as 5 abas aparecem corretamente sem quebrar o layout
        selectedItemColor: Colors.deepOrangeAccent,
        unselectedItemColor: Colors.grey[700],
        currentIndex: navigationShell.currentIndex,
        onTap: _goBranch,
        items: const [
          BottomNavigationBarItem(
            icon: Icon(Icons.dashboard_outlined),
            label: 'Home',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.calendar_month),
            label: 'Plano',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.build_circle_outlined),
            label: 'Manutenção',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.event_available),
            label: 'Próximo',
          ),
          BottomNavigationBarItem(
            icon: Icon(Icons.directions_run),
            label: 'Equipamento',
          ),
        ],
      ),
    );
  }
}