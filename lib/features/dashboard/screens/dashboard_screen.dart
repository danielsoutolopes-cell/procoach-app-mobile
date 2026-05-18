import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/athlete/providers/athlete_provider.dart';
import 'package:procoach_os/features/dashboard/widgets/weather_card.dart';
import 'package:procoach_os/features/dashboard/widgets/workout_card.dart';
import 'package:procoach_os/features/dashboard/widgets/spotify_card.dart';
import 'package:procoach_os/features/dashboard/widgets/race_day_card.dart';
import 'package:procoach_os/shared/models/athlete.dart';
import 'package:procoach_os/shared/widgets/async_value_widget.dart';
import 'package:procoach_os/core/providers/location_provider.dart';
import 'package:procoach_os/features/dashboard/providers/weather_provider.dart';
import 'package:procoach_os/features/dashboard/providers/workout_provider.dart';
import 'package:procoach_os/features/athlete/services/races_screen.dart';

class DashboardScreen extends ConsumerWidget {
  const DashboardScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // O Riverpod "escuta" o estado do atleta. 
    // Se a API estiver a carregar, o AsyncValueWidget trata disso!
    final athleteAsync = ref.watch(athleteProvider);

    final now = DateTime.now();
    final months = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];
    final today = "${now.day} de ${months[now.month - 1]}";

    return Scaffold(
      backgroundColor: const Color(0xFF0A0A0A), // Fundo escuro ProCoach
      appBar: AppBar(
        backgroundColor: const Color(0xFF0A0A0A),
        elevation: 0,
        title: const Text(
          'PROCOACH OS V6.1',
          style: TextStyle(
            fontWeight: FontWeight.w900,
            letterSpacing: 1.5,
            color: Colors.white,
          ),
        ),
        centerTitle: true,
      ),
      body: AsyncValueWidget<Athlete>(
        value: athleteAsync,
        data: (athlete) {
          // Encontra dinamicamente a prova âncora usando o novo ID do macrociclo (ou fallback)
          var anchorRace;
          try {
            anchorRace = athlete.races.where((r) => 
              (athlete.macrocycleRaceId != null && r.id == athlete.macrocycleRaceId) || r.isAnchor
            ).firstOrNull;
          } catch (e) {
            anchorRace = null;
          }
          
          final daysToRace = anchorRace != null 
              ? anchorRace.date.difference(DateTime.now()).inDays 
              : 0;
              
          // Modo Race Day ativa nos 3 dias antecedentes à prova âncora
          final isRaceDayMode = anchorRace != null && daysToRace >= 0 && daysToRace <= 3;
          
          // Calcula a semana atual do Macrociclo (1 a 16)
          int currentWeek = 0;
          int weeksLeft = 0;
          if (anchorRace != null) {
            final planStart = anchorRace.date.subtract(const Duration(days: 16 * 7));
            final daysSinceStart = now.difference(planStart).inDays;
            currentWeek = (daysSinceStart ~/ 7) + 1;
            currentWeek = currentWeek.clamp(1, 16); // Garante que o valor fique entre 1 e 16
            
            weeksLeft = daysToRace > 0 ? (daysToRace / 7).ceil() : 0;
          }

          return RefreshIndicator(
            onRefresh: () async {
              ref.invalidate(locationProvider); // Força a buscar o GPS nativo novamente
              ref.invalidate(weatherProvider);  // Limpa o cache do Clima
              ref.invalidate(workoutProvider);  // Limpa o cache do Treino do Dia
              await ref.refresh(athleteProvider.future); // Aguarda o perfil recarregar
            },
            child: ListView(
              padding: const EdgeInsets.all(16.0),
              children: [
                // Cabeçalho de Data e Prova
                Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(
                      today.toUpperCase(),
                      style: const TextStyle(color: Colors.grey, fontSize: 14, fontWeight: FontWeight.bold),
                    ),
                    GestureDetector(
                      onTap: () {
                        Navigator.of(context).push(MaterialPageRoute(builder: (_) => const RacesScreen()));
                      },
                      child: Row(
                        children: [
                          Text(
                            anchorRace != null ? '$daysToRace DIAS ($weeksLeft SEMANAS) P/ PROVA' : 'CADASTRAR PROVA',
                            style: const TextStyle(color: Colors.deepOrangeAccent, fontSize: 14, fontWeight: FontWeight.bold),
                          ),
                          const SizedBox(width: 4),
                          const Icon(Icons.arrow_forward_ios, size: 14, color: Colors.deepOrangeAccent),
                        ],
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 24),
                
                // Exibe o card sempre que houver prova âncora para acompanhar o progresso!
                if (anchorRace != null) ...[
                  RaceDayCard(race: anchorRace, daysToRace: daysToRace, currentWeek: currentWeek, isRaceDayMode: isRaceDayMode),
                  const SizedBox(height: 16),
                ],
                
                // Previsão de Hoje
                const WeatherCard(),
                const SizedBox(height: 16),
                
                // Treino do Dia
                const WorkoutCard(),
                const SizedBox(height: 16),
                
                // Spotify
                const SpotifyCard(),
              ],
            ),
          );
        },
      ),
    );
  }
}