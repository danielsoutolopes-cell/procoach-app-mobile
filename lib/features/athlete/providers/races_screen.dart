import 'package:flutter/material.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/intl.dart';
import 'package:procoach_os/features/athlete/providers/athlete_provider.dart';
import 'package:procoach_os/features/athlete/services/athlete_service.dart';
import 'package:procoach_os/features/athlete/screens/add_race_screen.dart';

/// Formata o texto inserido para o padrão de Tempo (MM:SS ou HH:MM:SS)
class TimeTextInputFormatter extends TextInputFormatter {
  @override
  TextEditingValue formatEditUpdate(TextEditingValue oldValue, TextEditingValue newValue) {
    final text = newValue.text.replaceAll(RegExp(r'[^0-9]'), '');
    if (text.length > 6) return oldValue;
    String formatted = '';
    for (int i = 0; i < text.length; i++) {
      if (i == 2 || i == 4) formatted += ':';
      formatted += text[i];
    }
    return TextEditingValue(
      text: formatted,
      selection: TextSelection.collapsed(offset: formatted.length),
    );
  }
}

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

  void _showAddResultModal(BuildContext context, WidgetRef ref, Map<String, dynamic> race) {
    final distanceKm = double.tryParse(race['distancia']?.toString() ?? '0') ?? 0.0;
    final timeController = TextEditingController();
    String calculatedPace = '--:--/km';

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF1A1A1A),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setModalState) {
            void calculatePace() {
              if (distanceKm <= 0) return;
              final timeText = timeController.text.trim();
              final parts = timeText.split(':');
              double totalMinutes = 0;
              
              if (parts.length == 2) {
                // Formato MM:SS
                final m = double.tryParse(parts[0]) ?? 0;
                final s = double.tryParse(parts[1]) ?? 0;
                totalMinutes = m + (s / 60);
              } else if (parts.length == 3) {
                // Formato HH:MM:SS
                final h = double.tryParse(parts[0]) ?? 0;
                final m = double.tryParse(parts[1]) ?? 0;
                final s = double.tryParse(parts[2]) ?? 0;
                totalMinutes = (h * 60) + m + (s / 60);
              }

              if (totalMinutes > 0) {
                final paceDecimal = totalMinutes / distanceKm;
                final paceMinutes = paceDecimal.floor();
                final paceSeconds = ((paceDecimal - paceMinutes) * 60).round();
                setModalState(() {
                  calculatedPace = '$paceMinutes:${paceSeconds.toString().padLeft(2, '0')}/km';
                });
              } else {
                setModalState(() => calculatedPace = '--:--/km');
              }
            }

            return Padding(
              padding: EdgeInsets.only(
                bottom: MediaQuery.of(context).viewInsets.bottom + 24,
                top: 24, left: 24, right: 24,
              ),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('REGISTRAR RESULTADO', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.deepOrangeAccent)),
                  const SizedBox(height: 8),
                  Text('${race['name'] ?? 'Prova'} - $distanceKm km', style: const TextStyle(color: Colors.white70, fontSize: 14)),
                  const SizedBox(height: 24),
                  TextField(
                    controller: timeController,
                    keyboardType: TextInputType.number,
                    inputFormatters: [TimeTextInputFormatter()],
                    style: const TextStyle(color: Colors.white, fontSize: 24, fontWeight: FontWeight.bold),
                    decoration: const InputDecoration(
                      labelText: 'Tempo Final (HH:MM:SS ou MM:SS)',
                      labelStyle: TextStyle(color: Colors.grey),
                      enabledBorder: UnderlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                      focusedBorder: UnderlineInputBorder(borderSide: BorderSide(color: Colors.deepOrangeAccent)),
                    ),
                    onChanged: (_) => calculatePace(),
                  ),
                  const SizedBox(height: 24),
                  Row(
                    mainAxisAlignment: MainAxisAlignment.spaceBetween,
                    children: [
                      const Text('Pace Médio Calculado:', style: TextStyle(color: Colors.grey, fontSize: 14)),
                      Text(calculatedPace, style: const TextStyle(color: Colors.deepOrangeAccent, fontSize: 20, fontWeight: FontWeight.bold)),
                    ],
                  ),
                  const SizedBox(height: 32),
                  SizedBox(
                    width: double.infinity,
                    height: 50,
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(backgroundColor: Colors.deepOrangeAccent, shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8))),
                      onPressed: () async {
                        if (timeController.text.isEmpty) return;
                        final raceId = race['id'].toString();
                        final resultData = {
                          'finishTime': timeController.text.trim(),
                          'finishPace': calculatedPace,
                          'weatherCondition': '', // Deixa em branco para o servidor preencher automaticamente com OpenWeather!
                        };
                        Navigator.of(context).pop();
                        ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Salvando resultado...')));
                        try {
                          final isNewPR = await ref.read(raceControllerProvider).saveRaceResult(raceId, resultData);
                          if (context.mounted) {
                            if (isNewPR) {
                              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('🏆 NOVO RECORDE PESSOAL! PARABÉNS!'), backgroundColor: Colors.deepOrangeAccent, duration: Duration(seconds: 4)));
                            } else {
                              ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Resultado salvo com sucesso!'), backgroundColor: Colors.green));
                            }
                          }
                        } catch (e) {
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao salvar: $e'), backgroundColor: Colors.redAccent));
                          }
                        }
                      },
                      child: const Text('SALVAR RESULTADO', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
                    ),
                  ),
                ],
              ),
            );
          },
        );
      },
    );
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

          // Separa as provas em futuras e passadas
          final now = DateTime.now();
          final upcomingRaces = races.where((r) {
            final dateStr = r['date'] ?? r['data'];
            if (dateStr == null) return false;
            final raceDate = DateTime.tryParse(dateStr);
            return raceDate != null && (raceDate.isAfter(now) || DateUtils.isSameDay(raceDate, now));
          }).toList();

          final completedRaces = races.where((r) {
            final dateStr = r['date'] ?? r['data'];
            if (dateStr == null) return false;
            final raceDate = DateTime.tryParse(dateStr);
            return raceDate != null && raceDate.isBefore(now) && !DateUtils.isSameDay(raceDate, now);
          }).toList();

          // Ordena as listas
          upcomingRaces.sort((a, b) => (a['date'] ?? a['data'] ?? '').compareTo(b['date'] ?? b['data'] ?? ''));
          completedRaces.sort((a, b) => (b['date'] ?? b['data'] ?? '').compareTo(a['date'] ?? a['data'] ?? ''));

          return ListView(
            padding: const EdgeInsets.all(16),
            children: [
              if (upcomingRaces.isNotEmpty) ...[
                const Text('PRÓXIMAS PROVAS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 16),
                ...upcomingRaces.map((race) => _buildUpcomingRaceCard(context, ref, race, athlete.macrocycleRaceId)),
              ],
              if (completedRaces.isNotEmpty) ...[
                const SizedBox(height: 32),
                const Text('HISTÓRICO DE PROVAS', style: TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
                const SizedBox(height: 16),
                ...completedRaces.map((race) => _buildCompletedRaceCard(context, ref, race)),
              ],
            ],
          );
        },
        loading: () => const Center(child: CircularProgressIndicator(color: Colors.deepOrangeAccent)),
        error: (err, _) => Center(child: Text('Erro: $err', style: const TextStyle(color: Colors.redAccent))),
      ),
    );
  }

  Widget _buildUpcomingRaceCard(BuildContext context, WidgetRef ref, Map<String, dynamic> race, String? macrocycleRaceId) {
    final raceId = race['id']?.toString() ?? '';
    final bool isAnchor = (macrocycleRaceId == raceId) || (race['is_anchor'] == true);

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
                        ref.read(raceControllerProvider).setMacrocycleAnchor(raceId);
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
  }

  Widget _buildCompletedRaceCard(BuildContext context, WidgetRef ref, Map<String, dynamic> race) {
    final dateStr = race['date'] ?? race['data'] ?? '';
    String formattedDate = dateStr;
    try {
      formattedDate = DateFormat('dd/MM/yyyy').format(DateTime.parse(dateStr));
    } catch (_) {}

    final finishTime = race['finishTime'] as String? ?? '--:--';
    final finishPace = race['finishPace'] as String? ?? '--/km';
    final weather = race['weatherCondition'] as String? ?? '';

    return Card(
      color: const Color(0xFF1A1A1A),
      margin: const EdgeInsets.only(bottom: 12),
      shape: RoundedRectangleBorder(
        borderRadius: BorderRadius.circular(12),
        side: const BorderSide(color: Colors.white10),
      ),
      child: InkWell(
        onTap: () => _showAddResultModal(context, ref, race),
        borderRadius: BorderRadius.circular(12),
        child: Padding(
          padding: const EdgeInsets.all(16),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                mainAxisAlignment: MainAxisAlignment.spaceBetween,
                children: [
                  Text(
                    race['name'] ?? race['nome'] ?? 'Prova sem nome',
                    style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16, color: Colors.white),
                  ),
                  if (finishTime == '--:--')
                    const Icon(Icons.edit_outlined, color: Colors.white54, size: 18),
                ],
              ),
              const SizedBox(height: 4),
              Text('$formattedDate • ${race['distancia']} km', style: const TextStyle(color: Colors.grey)),
              const Divider(color: Colors.white24, height: 24),
              Row(
                children: [
                  const Icon(Icons.timer_outlined, color: Colors.deepOrangeAccent, size: 20),
                  const SizedBox(width: 8),
                  Text(finishTime, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(width: 16),
                  const Icon(Icons.speed_outlined, color: Colors.deepOrangeAccent, size: 20),
                  const SizedBox(width: 8),
                  Text(finishPace, style: const TextStyle(color: Colors.white, fontSize: 16)),
                  const Spacer(),
                  if (weather.isNotEmpty) Text(weather, style: const TextStyle(color: Colors.grey, fontSize: 14)),
                ],
              ),
            ],
          ),
        ),
      ),
    );
  }
}