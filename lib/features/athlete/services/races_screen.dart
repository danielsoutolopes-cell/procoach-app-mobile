import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/athlete/providers/athlete_provider.dart';
import 'package:procoach_os/features/athlete/services/athlete_service.dart';
import 'package:procoach_os/shared/models/athlete.dart';
import 'package:procoach_os/shared/widgets/async_value_widget.dart';

class RacesScreen extends ConsumerWidget {
  const RacesScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final athleteAsync = ref.watch(athleteProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'PROVAS & MACROCICLO',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, letterSpacing: 1.2),
        ),
        centerTitle: true,
        backgroundColor: const Color(0xFF0A0A0A),
        elevation: 0,
      ),
      body: AsyncValueWidget<Athlete>(
        value: athleteAsync,
        data: (athlete) {
          final races = athlete.races;
          
          // Separa a prova âncora para exibição no topo (conforme o documento de design)
          final anchorRace = races.where((r) => r.isAnchor == true).firstOrNull;
          
          // Ordena as provas por data (mais próximas primeiro)
          final sortedRaces = List.from(races)..sort((a, b) => a.date.compareTo(b.date));

          return ListView(
            padding: const EdgeInsets.all(16.0),
            children: [
              _buildAnchorCard(anchorRace),
              const SizedBox(height: 24),
              
              const Text(
                'TODAS AS PROVAS',
                style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1.2),
              ),
              const SizedBox(height: 16),
              
              if (sortedRaces.isEmpty)
                const Padding(
                  padding: EdgeInsets.symmetric(vertical: 16.0),
                  child: Text('Nenhuma prova cadastrada no seu calendário.', style: TextStyle(color: Colors.white70)),
                )
              else
                ...sortedRaces.map((race) => _buildRaceCard(race)),
                
              const SizedBox(height: 32),
              SizedBox(
                width: double.infinity,
                child: ElevatedButton.icon(
                  onPressed: () => _showAddRaceModal(context, ref, athlete.id),
                  style: ElevatedButton.styleFrom(
                    backgroundColor: Colors.white10,
                    foregroundColor: Colors.white,
                    padding: const EdgeInsets.symmetric(vertical: 16),
                    shape: RoundedRectangleBorder(
                      borderRadius: BorderRadius.circular(12),
                      side: const BorderSide(color: Colors.white24),
                    ),
                  ),
                  icon: const Icon(Icons.flag, color: Colors.deepOrangeAccent),
                  label: const Text(
                    'CADASTRAR NOVA PROVA', 
                    style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: 1.2)
                  ),
                ),
              ),
            ],
          );
        },
      ),
    );
  }

  Widget _buildAnchorCard(dynamic anchorRace) {
    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.deepOrangeAccent.withOpacity(0.5)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            children: const [
              Icon(Icons.anchor, color: Colors.deepOrangeAccent, size: 18),
              SizedBox(width: 8),
              Text(
                'ÂNCORA DO MACROCICLO',
                style: TextStyle(color: Colors.deepOrangeAccent, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1.2),
              ),
            ],
          ),
          const SizedBox(height: 16),
          if (anchorRace != null) ...[
            Text(anchorRace.name.toUpperCase(), style: const TextStyle(color: Colors.white, fontSize: 20, fontWeight: FontWeight.w900)),
            const SizedBox(height: 8),
            Text('Data: ${anchorRace.date.day}/${anchorRace.date.month}/${anchorRace.date.year}', style: const TextStyle(color: Colors.white70, fontSize: 14)),
          ] else
            const Text('Nenhuma âncora definida. Selecione uma prova base para iniciar o seu ciclo.', style: TextStyle(color: Colors.grey, fontSize: 13, height: 1.5)),
        ],
      ),
    );
  }

  Widget _buildRaceCard(dynamic race) {
    return Container(
      margin: const EdgeInsets.only(bottom: 12),
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: Colors.black,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: race.isAnchor == true ? Colors.deepOrangeAccent : Colors.white10),
      ),
      child: Row(
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(race.name, style: const TextStyle(color: Colors.white, fontSize: 16, fontWeight: FontWeight.bold)),
                const SizedBox(height: 6),
                Text(
                  '${race.date.day}/${race.date.month}/${race.date.year}  •  Prioridade: ${race.priority ?? "P1"}', 
                  style: const TextStyle(color: Colors.grey, fontSize: 13)
                ),
              ],
            ),
          ),
          if (race.isAnchor == true) 
            const Icon(Icons.anchor, color: Colors.deepOrangeAccent, size: 20)
          else
            const Icon(Icons.flag_outlined, color: Colors.white24, size: 20),
        ],
      ),
    );
  }

  void _showAddRaceModal(BuildContext context, WidgetRef ref, String athleteId) {
    final nameController = TextEditingController();
    final dateController = TextEditingController();
    String selectedPriority = 'P1';
    bool isAnchor = false;

    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: const Color(0xFF1A1A1A),
      shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(24))),
      builder: (context) {
        return StatefulBuilder(
          builder: (context, setState) {
            return Padding(
              // Ajusta o padding bottom para o modal subir junto com o teclado!
              padding: EdgeInsets.only(bottom: MediaQuery.of(context).viewInsets.bottom, left: 24, right: 24, top: 24),
              child: Column(
                mainAxisSize: MainAxisSize.min,
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  const Text('NOVA PROVA', style: TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(height: 24),
                  TextField(
                    controller: nameController,
                    decoration: const InputDecoration(labelText: 'Nome da Prova (Ex: Maratona SP)', labelStyle: TextStyle(color: Colors.grey)),
                    style: const TextStyle(color: Colors.white),
                  ),
                  const SizedBox(height: 16),
                  TextField(
                    controller: dateController,
                    readOnly: true,
                    onTap: () async {
                      final pickedDate = await showDatePicker(
                        context: context,
                        initialDate: DateTime.now(),
                        firstDate: DateTime.now().subtract(const Duration(days: 365)), // Permite provas antigas
                        lastDate: DateTime.now().add(const Duration(days: 365 * 5)),   // Permite provas até 5 anos no futuro
                        selectableDayPredicate: (DateTime val) {
                          // 6 = Sábado, 7 = Domingo. Retorna true apenas nestes dias!
                          return val.weekday == DateTime.saturday || val.weekday == DateTime.sunday;
                        },
                        builder: (context, child) {
                          // Estilizando o calendário com o Dark Theme do ProCoach
                          return Theme(
                            data: ThemeData.dark().copyWith(
                              colorScheme: const ColorScheme.dark(
                                primary: Colors.deepOrangeAccent,
                                surface: Color(0xFF1A1A1A),
                              ),
                            ),
                            child: child!,
                          );
                        },
                      );
                      if (pickedDate != null) {
                        // Formata a data para o padrão YYYY-MM-DD exigido pelo banco
                        dateController.text = "${pickedDate.year}-${pickedDate.month.toString().padLeft(2, '0')}-${pickedDate.day.toString().padLeft(2, '0')}";
                      }
                    },
                    decoration: const InputDecoration(
                      labelText: 'Data da Prova', 
                      labelStyle: TextStyle(color: Colors.grey),
                      suffixIcon: Icon(Icons.calendar_today, color: Colors.deepOrangeAccent),
                    ),
                    style: const TextStyle(color: Colors.white),
                  ),
                  const SizedBox(height: 24),
                  DropdownButtonFormField<String>(
                    value: selectedPriority,
                    dropdownColor: Colors.black,
                    decoration: const InputDecoration(labelText: 'Prioridade', labelStyle: TextStyle(color: Colors.grey)),
                    items: ['P1', 'P2', 'P3'].map((String p) => DropdownMenuItem(value: p, child: Text(p, style: const TextStyle(color: Colors.white)))).toList(),
                    onChanged: (val) => setState(() => selectedPriority = val!),
                  ),
                  const SizedBox(height: 16),
                  SwitchListTile(
                    title: const Text('Âncora do Macrociclo', style: TextStyle(color: Colors.white, fontSize: 14, fontWeight: FontWeight.bold)),
                    subtitle: const Text('Esta prova define em que momento do seu ciclo de 16 semanas você está hoje.', style: TextStyle(color: Colors.grey, fontSize: 12)),
                    value: isAnchor,
                    activeColor: Colors.deepOrangeAccent,
                    contentPadding: EdgeInsets.zero,
                    onChanged: (val) => setState(() => isAnchor = val),
                  ),
                  const SizedBox(height: 32),
                  SizedBox(
                    width: double.infinity,
                    child: ElevatedButton(
                      style: ElevatedButton.styleFrom(
                        backgroundColor: Colors.deepOrangeAccent,
                        foregroundColor: Colors.white,
                        padding: const EdgeInsets.symmetric(vertical: 16),
                        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(12)),
                      ),
                      onPressed: () async {
                        if (nameController.text.trim().isEmpty || dateController.text.trim().isEmpty) {
                          ScaffoldMessenger.of(context).showSnackBar(
                            const SnackBar(content: Text('Preencha o nome e a data da prova.'), backgroundColor: Colors.redAccent),
                          );
                          return;
                        }

                        try {
                          final raceData = {
                            'name': nameController.text.trim(),
                            'date': dateController.text.trim(),
                            'priority': selectedPriority,
                            'isAnchor': isAnchor,
                          };

                          await ref.read(athleteServiceProvider).addRace(athleteId, raceData);
                          
                          if (context.mounted) {
                            Navigator.pop(context);
                            ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Prova salva com sucesso!'), backgroundColor: Colors.green));
                            ref.invalidate(athleteProvider); // Força o refresh da lista na UI
                          }
                        } catch (e) {
                          if (context.mounted) {
                            ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('Erro ao salvar prova: $e'), backgroundColor: Colors.redAccent));
                          }
                        }
                      },
                      child: const Text('SALVAR PROVA', style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: 1.2)),
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
}