import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/athlete/providers/athlete_provider.dart';
import 'package:procoach_os/features/athlete/services/athlete_service.dart';
import 'package:procoach_os/features/athlete/screens/add_race_screen.dart';

class RacesScreen extends ConsumerWidget {
  const RacesScreen({super.key});

  Future<void> _showRaceStrategy(BuildContext context, WidgetRef ref, String raceName) async {
    // Mostra indicador de carregamento
    showDialog(
      context: context,
      barrierDismissible: false,
      builder: (_) => const Center(child: CircularProgressIndicator(color: Colors.deepPurpleAccent)),
    );

    try {
      // Requisição à API da IA
      final strategy = await ref.read(athleteServiceProvider).getRaceStrategy(raceName);
      
      if (context.mounted) {
        Navigator.of(context).pop(); // Esconde o indicador
        
        // Exibe o Bottom Sheet com o resultado tático
        showModalBottomSheet(
          context: context,
          isScrollControlled: true,
          backgroundColor: const Color(0xFF1E1E1E),
          shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
          builder: (_) => Padding(
            padding: EdgeInsets.only(
              bottom: MediaQuery.of(context).viewInsets.bottom + 24, 
              top: 24, left: 24, right: 24
            ),
            child: Column(
              mainAxisSize: MainAxisSize.min,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Row(
                  children: [
                    const Icon(Icons.psychology, color: Colors.deepPurpleAccent, size: 28),
                    const SizedBox(width: 8),
                    Expanded(
                      child: Text(
                        'ESTRATÉGIA: ${raceName.toUpperCase()}',
                        style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.deepPurpleAccent),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 16),
                Text(strategy, style: const TextStyle(fontSize: 15, height: 1.5, color: Colors.white)),
                const SizedBox(height: 24),
                SizedBox(
                  width: double.infinity,
                  height: 50,
                  child: ElevatedButton(
                    onPressed: () => Navigator.of(context).pop(),
                    style: ElevatedButton.styleFrom(backgroundColor: Colors.deepPurpleAccent, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8))),
                    child: const Text('FECHAR ESTRATÉGIA', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, letterSpacing: 1.1)),
                  ),
                ),
              ],
            ),
          ),
        );
      }
    } catch (e) {
      if (context.mounted) {
        Navigator.of(context).pop();
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Falha na conexão com a IA: $e', style: const TextStyle(color: Colors.white)), backgroundColor: Colors.redAccent));
      }
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final athleteAsync = ref.watch(athleteProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text('CALENDÁRIO DE PROVAS', style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: 1.2)),
        backgroundColor: const Color(0xFF0A0A0A),
        actions: [
          IconButton(
            icon: const Icon(Icons.add, color: Colors.deepOrangeAccent),
            tooltip: 'Cadastrar Nova Prova',
            onPressed: () {
              Navigator.of(context).push(MaterialPageRoute(builder: (_) => const AddRaceScreen()));
            },
          ),
        ],
      ),
      body: athleteAsync.when(
        data: (athlete) {
          final List<dynamic> races = athlete.races ?? [];
          if (races.isEmpty) {
            return const Center(child: Text('Nenhuma prova cadastrada no momento.', style: TextStyle(color: Colors.white54)));
          }

          // Filtra e ordena as provas pela data
          final validRaces = races.where((r) => r['status'] != 'cancelada').toList();
          validRaces.sort((a, b) => (a['date'] ?? a['data'] ?? '').compareTo(b['date'] ?? b['data'] ?? ''));

          return ListView.builder(
            padding: const EdgeInsets.all(16),
            itemCount: validRaces.length,
            itemBuilder: (context, index) {
              final race = validRaces[index];
              final raceId = race['id']?.toString() ?? '';
              
              // Verifica dinamicamente se a prova listada é a nossa âncora
              // Assumindo que seu modelo Athlete exponha macrocycleRaceId
              final bool isAnchor = (athlete.macrocycleRaceId == raceId) || (race['is_anchor'] == true);

              return Card(
                color: isAnchor ? Colors.deepOrangeAccent.withOpacity(0.08) : Colors.white10,
                margin: const EdgeInsets.only(bottom: 12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(12),
                  side: BorderSide(color: isAnchor ? Colors.deepOrangeAccent.withOpacity(0.5) : Colors.transparent),
                ),
                child: Padding(
                  padding: const EdgeInsets.all(16),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Row(
                        mainAxisAlignment: MainAxisAlignment.spaceBetween,
                        children: [
                          Expanded(
                            child: Text(
                              race['name'] ?? race['nome'] ?? 'Prova sem nome',
                              style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: isAnchor ? Colors.white : Colors.white70),
                            ),
                          ),
                          Container(
                            padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 4),
                            decoration: BoxDecoration(
                              color: Colors.deepOrangeAccent.withOpacity(0.2),
                              borderRadius: BorderRadius.circular(4),
                            ),
                            child: Text(
                              race['tipo_tatico'] ?? race['type'] ?? 'P1',
                              style: const TextStyle(color: Colors.deepOrangeAccent, fontWeight: FontWeight.bold, fontSize: 12),
                            ),
                          ),
                        ],
                      ),
                      const SizedBox(height: 8),
                      Text('Data: ${race['date'] ?? race['data'] ?? '-'}', style: const TextStyle(color: Colors.white70)),
                      Text('Distância: ${race['distancia']} km', style: const TextStyle(color: Colors.white70)),
                      const SizedBox(height: 12),
                      const Divider(color: Colors.white24),
                      Row(
                        crossAxisAlignment: CrossAxisAlignment.center,
                        children: [
                          Expanded(
                            child: SwitchListTile(
                              contentPadding: EdgeInsets.zero,
                              title: Text('Âncora do Macrociclo', style: TextStyle(fontSize: 14, fontWeight: FontWeight.bold, color: isAnchor ? Colors.greenAccent : Colors.white)),
                              subtitle: const Text('Define e baliza as fases de treinamento', style: TextStyle(fontSize: 12, color: Colors.white54)),
                              value: isAnchor,
                              activeColor: Colors.greenAccent,
                              onChanged: (val) {
                                if (val) {
                                  ref.read(athleteProvider.notifier).setMacrocycleAnchor(raceId);
                                }
                              },
                            ),
                          ),
                          Container(
                            decoration: BoxDecoration(color: Colors.deepPurpleAccent.withOpacity(0.15), shape: BoxShape.circle),
                            child: IconButton(
                              icon: const Icon(Icons.psychology, color: Colors.deepPurpleAccent),
                              tooltip: 'Gerar Estratégia de Prova (IA)',
                              onPressed: () => _showRaceStrategy(context, ref, race['name'] ?? race['nome'] ?? 'Prova'),
                            ),
                          ),
                        ],
                      ),
                    ],
                  ),
                ),
              );
            },
          );
        },
        loading: () => const Center(child: CircularProgressIndicator(color: Colors.deepOrangeAccent)),
        error: (err, _) => Center(child: Text('Erro: $err', style: const TextStyle(color: Colors.redAccent))),
      ),
    );
  }
}