import 'dart:io';
import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:file_picker/file_picker.dart';
import 'package:procoach_os/features/status/services/bioimpedance_service.dart';
import 'package:procoach_os/features/status/providers/bioimpedance_provider.dart';
import 'package:procoach_os/features/status/providers/compliance_provider.dart';
import 'package:procoach_os/features/status/providers/strength_provider.dart';
import 'package:procoach_os/shared/models/strength_routine.dart';
import 'package:procoach_os/features/status/widgets/weekly_volume_chart.dart';
import 'package:procoach_os/features/status/providers/bioimpedance_history_provider.dart';
import 'package:procoach_os/features/athlete/providers/athlete_provider.dart';

class StatusScreen extends ConsumerWidget {
  const StatusScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'STATUS & COMPLIANCE',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, letterSpacing: 1.2),
        ),
        centerTitle: true,
        backgroundColor: const Color(0xFF0A0A0A),
        elevation: 0,
      ),
      body: RefreshIndicator(
        color: Colors.deepOrangeAccent,
        backgroundColor: const Color(0xFF1A1A1A),
        onRefresh: () async {
          // Recarrega todos os dados da tela ao puxar para baixo
          ref.invalidate(complianceProvider);
          ref.invalidate(bioimpedanceProvider);
          ref.invalidate(bioHistoryProvider);
          ref.invalidate(strengthRoutinesProvider);
        },
        child: ListView(
          padding: const EdgeInsets.all(16.0),
          children: [
            const WeeklyVolumeChart(),
            const SizedBox(height: 24),
            _buildPersonalBestsCard(context, ref),
            const SizedBox(height: 24),
            _buildMaintenanceActionsCard(context),
            const SizedBox(height: 24),
            _buildBioimpedanceCard(context, ref),
            const SizedBox(height: 24),
            _buildBioHistoryChart(context, ref),
            const SizedBox(height: 24),
            const StrengthLibraryWidget(),
          ],
        ),
      ),
    );
  }

  Widget _buildMaintenanceActionsCard(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(8),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
      ),
      child: ListTile(
        leading: const Icon(Icons.upload_file, color: Colors.deepOrangeAccent),
        title: const Text('Importadores do Plano', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
        subtitle: const Text('Planilhas de treino em JSON ou PDF', style: TextStyle(color: Colors.grey)),
        trailing: const Icon(Icons.arrow_forward_ios, color: Colors.grey, size: 16),
        onTap: () {
          context.go('/status/import');
        },
      ),
    );
  }

  Widget _buildBioHistoryChart(BuildContext context, WidgetRef ref) {
    final historyAsync = ref.watch(bioHistoryProvider);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'PROGRESSÃO DE PESO E GORDURA',
            style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1.2),
          ),
          const SizedBox(height: 24),
          SizedBox(
            height: 200,
            child: historyAsync.when(
              loading: () => const Center(child: CircularProgressIndicator(color: Colors.deepOrangeAccent)),
              error: (err, _) => const Center(child: Text('Erro ao carregar gráfico.', style: TextStyle(color: Colors.redAccent))),
              data: (data) {
                if (data.isEmpty || data.length < 2) {
                  return const Center(child: Text('Necessário 2+ registros para o gráfico.', style: TextStyle(color: Colors.white54)));
                }

                final barGroups = data.asMap().entries.map((entry) {
                  final index = entry.key;
                  final item = entry.value;
                  final weight = double.tryParse(item['weight_kg']?.toString() ?? '') ?? 0.0;
                  final fat = double.tryParse(item['body_fat_pct']?.toString() ?? '') ?? 0.0;

                  return BarChartGroupData(
                    x: index,
                    barsSpace: 4,
                    barRods: [
                      BarChartRodData(toY: weight, color: Colors.deepOrangeAccent, width: 8, borderRadius: BorderRadius.circular(4)),
                      BarChartRodData(toY: fat, color: Colors.redAccent.withOpacity(0.8), width: 8, borderRadius: BorderRadius.circular(4)),
                    ],
                  );
                }).toList();

                double maxY = 0;
                for (var item in data) {
                  final w = double.tryParse(item['weight_kg']?.toString() ?? '') ?? 0.0;
                  if (w > maxY) maxY = w;
                }

                return BarChart(
                  BarChartData(
                    maxY: maxY + 10,
                    barTouchData: BarTouchData(
                      touchTooltipData: BarTouchTooltipData(
                        getTooltipItem: (group, groupIndex, rod, rodIndex) {
                          final item = data[group.x.toInt()];
                          final isWeight = rodIndex == 0;
                          final val = isWeight ? item['weight_kg'] : item['body_fat_pct'];
                          final label = isWeight ? 'kg' : '% Gordura';
                          return BarTooltipItem('$val $label', const TextStyle(color: Colors.white, fontWeight: FontWeight.bold));
                        },
                      ),
                    ),
                    gridData: FlGridData(
                      show: true,
                      drawVerticalLine: false,
                      horizontalInterval: 20,
                      getDrawingHorizontalLine: (value) => const FlLine(color: Colors.white10, strokeWidth: 1),
                    ),
                    borderData: FlBorderData(show: false),
                    titlesData: FlTitlesData(
                      rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                      topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                      leftTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          reservedSize: 30,
                          getTitlesWidget: (value, meta) => Text(value.toInt().toString(), style: const TextStyle(color: Colors.grey, fontSize: 10)),
                        ),
                      ),
                      bottomTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          getTitlesWidget: (value, meta) {
                            final index = value.toInt();
                            if (index >= 0 && index < data.length) {
                              final dateStr = data[index]['entry_date'].toString();
                              final parts = dateStr.split('-');
                              if (parts.length >= 3) return Padding(padding: const EdgeInsets.only(top: 8.0), child: Text('${parts[2]}/${parts[1]}', style: const TextStyle(color: Colors.grey, fontSize: 10)));
                            }
                            return const SizedBox.shrink();
                          },
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
          const SizedBox(height: 16),
          const Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Icon(Icons.square, color: Colors.deepOrangeAccent, size: 12),
              SizedBox(width: 4),
              Text('Peso (kg)', style: TextStyle(color: Colors.white70, fontSize: 12)),
              SizedBox(width: 16),
              Icon(Icons.square, color: Colors.redAccent, size: 12),
              SizedBox(width: 4),
              Text('Gordura (%)', style: TextStyle(color: Colors.white70, fontSize: 12)),
            ],
          )
        ],
      ),
    );
  }

    final athleteAsync = ref.watch(athleteProvider);
    final currentYear = DateTime.now().year.toString();

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'RECORDES PESSOAIS (PRs) - $currentYear',
            style: const TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1.2),
          ),
          const SizedBox(height: 16),
          // TODO: Substituir por dados vindos da API (athlete.personalBests)
            data: (athlete) {
              final races = athlete.races ?? [];

              int timeToSec(String? t) {
                if (t == null || t == '--:--') return 999999;
                final p = t.split(':');
                if (p.length == 2) return (int.tryParse(p[0]) ?? 0) * 60 + (int.tryParse(p[1]) ?? 0);
                if (p.length == 3) return (int.tryParse(p[0]) ?? 0) * 3600 + (int.tryParse(p[1]) ?? 0) * 60 + (int.tryParse(p[2]) ?? 0);
                return 999999;
              }

              String formatDate(String d) {
                try {
                  final dt = DateTime.parse(d);
                  final months = ['Jan', 'Fev', 'Mar', 'Abr', 'Mai', 'Jun', 'Jul', 'Ago', 'Set', 'Out', 'Nov', 'Dez'];
                  return '${dt.day.toString().padLeft(2, '0')} ${months[dt.month - 1]} ${dt.year}';
                } catch (_) {
                  return d;
                }
              }

              final validRaces = races.where((r) {
                final d = r['date'] ?? r['data'] ?? '';
                final t = r['finishTime'];
                return d.toString().startsWith(currentYear) && t != null && t != '--:--';
              }).toList();

              Map<String, dynamic>? pr10k;
              Map<String, dynamic>? pr21k;

              for (var r in validRaces) {
                final dist = double.tryParse(r['distancia'].toString()) ?? 0;
                final sec = timeToSec(r['finishTime']);
                
                if (dist >= 9.5 && dist <= 10.5) {
                  if (pr10k == null || sec < timeToSec(pr10k['finishTime'])) pr10k = r;
                } else if (dist >= 20.5 && dist <= 21.5) {
                  if (pr21k == null || sec < timeToSec(pr21k['finishTime'])) pr21k = r;
                }
              }

              return Column(
                children: [
                  _buildPRItem('10K', pr10k?['finishTime'] ?? '--:--', pr10k?['finishPace'] ?? '--/km', pr10k != null ? '${formatDate(pr10k['date'] ?? pr10k['data'])} - ${pr10k['name']}' : 'Ainda sem marca no ano', pr10k?['weatherCondition'] ?? ''),
                  const Divider(color: Colors.white10, height: 24),
                  _buildPRItem('21K', pr21k?['finishTime'] ?? '--:--', pr21k?['finishPace'] ?? '--/km', pr21k != null ? '${formatDate(pr21k['date'] ?? pr21k['data'])} - ${pr21k['name']}' : 'Ainda sem marca no ano', pr21k?['weatherCondition'] ?? ''),
                ],
              );
            },
            loading: () => const Center(child: CircularProgressIndicator(color: Colors.deepOrangeAccent)),
            error: (_, __) => const Center(child: Text('Erro ao carregar recordes', style: TextStyle(color: Colors.white54))),
          ),
        ],
      ),
    );
  }

  Widget _buildPRItem(String distance, String time, String pace, String details, String weather) {
    return Row(
      crossAxisAlignment: CrossAxisAlignment.center,
      children: [
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 8),
          decoration: BoxDecoration(
            color: Colors.deepOrangeAccent.withOpacity(0.15),
            borderRadius: BorderRadius.circular(8),
            border: Border.all(color: Colors.deepOrangeAccent.withOpacity(0.5)),
          ),
          child: Text(
            distance,
            style: const TextStyle(color: Colors.deepOrangeAccent, fontWeight: FontWeight.bold, fontSize: 16),
          ),
        ),
        const SizedBox(width: 16),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Text(time, style: const TextStyle(color: Colors.white, fontSize: 18, fontWeight: FontWeight.bold)),
                  const SizedBox(width: 8),
                  if (pace.isNotEmpty && pace != '--/km')
                    Text('($pace)', style: const TextStyle(color: Colors.grey, fontSize: 12)),
                ],
              ),
              const SizedBox(height: 4),
              Row(
                children: [
                  Expanded(child: Text(details, style: const TextStyle(color: Colors.grey, fontSize: 12))),
                  if (weather.isNotEmpty)
                    Text(weather, style: const TextStyle(color: Colors.grey, fontSize: 12)),
                ],
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildBioimpedanceCard(BuildContext context, WidgetRef ref) {
    final bioAsync = ref.watch(bioimpedanceProvider);

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'ÚLTIMA BIOIMPEDÂNCIA',
            style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1.2),
          ),
          const SizedBox(height: 16),
          bioAsync.when(
            loading: () => const Center(child: CircularProgressIndicator()),
            error: (error, _) => const Text(
              'Erro ao carregar dados.',
              style: TextStyle(color: Colors.redAccent),
            ),
            data: (bio) {
              if (bio == null) {
                return const Center(child: Text('Nenhum dado importado.', style: TextStyle(color: Colors.grey)));
              }
              return Row(
                mainAxisAlignment: MainAxisAlignment.spaceAround,
                children: [
                  _buildBioItem(Icons.balance, bio.weightKg.toString(), 'kg', diff: bio.weightDiff),
                  _buildBioItem(Icons.local_fire_department, bio.bodyFatPct.toString(), '% Gordura', diff: bio.bodyFatDiff),
                  _buildBioItem(Icons.fitness_center, bio.muscleMassKg.toString(), 'kg Músculo', diff: bio.muscleMassDiff, invertColors: true),
                ],
              );
            },
          ),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: TextButton.icon(
              onPressed: () => _uploadPdf(context, ref),
              icon: const Icon(Icons.document_scanner, color: Colors.deepOrangeAccent),
              label: const Text('IMPORTAR PDF (IA)', style: TextStyle(color: Colors.deepOrangeAccent)),
            ),
          )
        ],
      ),
    );
  }

  Future<void> _uploadPdf(BuildContext context, WidgetRef ref) async {
    try {
      final result = await FilePicker.platform.pickFiles(
        type: FileType.custom,
        allowedExtensions: ['pdf'],
      );

      if (result != null && result.files.single.path != null) {
        final file = File(result.files.single.path!);

        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(content: Text('Enviando PDF para o Cérebro (IA)...')),
        );

        final service = ref.read(bioimpedanceServiceProvider);
        await service.uploadBioimpedancePdf(file);

        // Força a atualização da interface com os novos dados
        ref.invalidate(bioimpedanceProvider);

        if (context.mounted) {
          ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(
              content: Text('PDF analisado! Bioimpedância atualizada.'),
              backgroundColor: Colors.green,
            ),
          );
        }
      }
    } catch (e) {
      if (context.mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro: $e'), backgroundColor: Colors.redAccent),
        );
      }
    }
  }

  Widget _buildBioItem(IconData icon, String value, String label, {double? diff, bool invertColors = false}) {
    return Column(
      children: [
        Icon(icon, size: 24, color: Colors.deepOrangeAccent),
        const SizedBox(height: 8),
        Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            Text(value, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 18)),
            if (diff != null && diff != 0) ...[
              const SizedBox(width: 4),
              Icon(
                diff > 0 ? Icons.arrow_upward : Icons.arrow_downward,
                color: invertColors ? (diff > 0 ? Colors.green : Colors.redAccent) : (diff > 0 ? Colors.redAccent : Colors.green),
                size: 16,
              ),
            ]
          ],
        ),
        const SizedBox(height: 4),
        Text(label, style: const TextStyle(color: Colors.grey, fontSize: 12)),
      ],
    );
  }
}

class StrengthLibraryWidget extends ConsumerStatefulWidget {
  const StrengthLibraryWidget({super.key});

  @override
  ConsumerState<StrengthLibraryWidget> createState() => _StrengthLibraryWidgetState();
}

class _StrengthLibraryWidgetState extends ConsumerState<StrengthLibraryWidget> {
  String _selectedType = 'A';
  final _nameController = TextEditingController();
  List<StrengthExercise> _exercises = [];
  bool _isLoaded = false;

  @override
  void dispose() {
    _nameController.dispose();
    super.dispose();
  }

  void _loadRoutineData(List<StrengthRoutine>? routines) {
    final routine = routines?.where((r) => r.routineType == _selectedType).firstOrNull;
    _nameController.text = routine?.name ?? '';
    _exercises = routine?.exercises.toList() ?? [];
  }

  void _changeTab(String type) {
    setState(() {
      _selectedType = type;
    });
    _loadRoutineData(ref.read(strengthRoutinesProvider).value);
  }

  @override
  Widget build(BuildContext context) {
    final routinesAsync = ref.watch(strengthRoutinesProvider);
    
    ref.listen<AsyncValue<List<StrengthRoutine>>>(strengthRoutinesProvider, (prev, next) {
      if (next.value != null && !_isLoaded) {
        _loadRoutineData(next.value);
        _isLoaded = true;
      }
    });

    return Container(
      padding: const EdgeInsets.all(16),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Text(
            'BIBLIOTECA DE FORÇA (A/B/C)',
            style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1.2),
          ),
          const SizedBox(height: 16),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildFichaButton('FICHA A', 'A'),
              _buildFichaButton('FICHA B', 'B'),
              _buildFichaButton('FICHA C', 'C'),
            ],
          ),
          const SizedBox(height: 16),
          TextField(
            controller: _nameController,
            decoration: InputDecoration(
              labelText: 'Nome da Ficha (ex: Inferiores / Potência)',
              labelStyle: TextStyle(color: Colors.grey[600], fontSize: 12),
              enabledBorder: const UnderlineInputBorder(borderSide: BorderSide(color: Colors.white10)),
              focusedBorder: const UnderlineInputBorder(borderSide: BorderSide(color: Colors.deepOrangeAccent)),
            ),
            style: const TextStyle(color: Colors.white, fontSize: 14),
          ),
          const SizedBox(height: 16),
          GestureDetector(
            onTap: () => _showExerciseCatalogModal(context),
            child: Container(
              padding: const EdgeInsets.symmetric(horizontal: 12, vertical: 12),
              decoration: BoxDecoration(
                color: Colors.black,
                borderRadius: BorderRadius.circular(8),
                border: Border.all(color: Colors.white10),
              ),
              child: const Row(
                children: [
                  Icon(Icons.search, color: Colors.grey, size: 18),
                  SizedBox(width: 8),
                  Text('BUSCAR EXERCÍCIO NO CATÁLOGO...', style: TextStyle(color: Colors.grey, fontSize: 12)),
                ],
              ),
            ),
          ),
          const SizedBox(height: 16),
          if (routinesAsync.isLoading && !_isLoaded)
            const Center(child: CircularProgressIndicator())
          else if (_exercises.isEmpty)
            const Padding(
              padding: EdgeInsets.symmetric(vertical: 16),
              child: Text('Nenhum exercício na ficha.', style: TextStyle(color: Colors.grey, fontSize: 12)),
            )
          else
            ..._exercises.asMap().entries.map((e) => _buildExerciseItem(e.key, e.value)),
          const SizedBox(height: 16),
          SizedBox(
            width: double.infinity,
            child: ElevatedButton.icon(
              onPressed: () {
                if (_nameController.text.isEmpty) return;
                final routine = StrengthRoutine(routineType: _selectedType, name: _nameController.text, exercises: _exercises);
                ref.read(strengthRoutinesProvider.notifier).saveRoutine(routine);
                ScaffoldMessenger.of(context).showSnackBar(
                  const SnackBar(content: Text('Ficha salva no Neon DB!'), backgroundColor: Colors.deepOrangeAccent),
                );
              },
              style: ElevatedButton.styleFrom(
                backgroundColor: Colors.white10,
                foregroundColor: Colors.white,
                padding: const EdgeInsets.symmetric(vertical: 12),
                shape: RoundedRectangleBorder(
                  borderRadius: BorderRadius.circular(8),
                  side: const BorderSide(color: Colors.white24),
                ),
              ),
              icon: const Icon(Icons.cloud_upload, size: 18),
              label: const Text('SALVAR FICHA NO NEON', style: TextStyle(fontWeight: FontWeight.bold, fontSize: 12, letterSpacing: 1.0)),
            ),
          )
        ],
      ),
    );
  }

  Widget _buildFichaButton(String label, String type) {
    final isSelected = _selectedType == type;
    return GestureDetector(
      onTap: () => _changeTab(type),
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 8),
        decoration: BoxDecoration(
          color: isSelected ? Colors.deepOrangeAccent.withOpacity(0.15) : Colors.black,
          border: Border.all(color: isSelected ? Colors.deepOrangeAccent : Colors.white10),
          borderRadius: BorderRadius.circular(8),
        ),
        child: Text(label, style: TextStyle(color: isSelected ? Colors.deepOrangeAccent : Colors.grey, fontWeight: FontWeight.bold, fontSize: 12)),
      ),
    );
  }

  Widget _buildExerciseItem(int index, StrengthExercise ex) {
    return Container(
      margin: const EdgeInsets.only(bottom: 8),
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(color: Colors.black, borderRadius: BorderRadius.circular(8), border: Border.all(color: Colors.white10)),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceBetween,
            children: [
              Text(ex.name, style: const TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14)),
              Row(
                children: [
                  GestureDetector(
                    onTap: () => _showEditExerciseModal(context, index),
                    child: const Icon(Icons.edit_outlined, color: Colors.deepOrangeAccent, size: 16),
                  ),
                  const SizedBox(width: 12),
                  GestureDetector(
                    onTap: () => setState(() => _exercises.removeAt(index)),
                    child: const Icon(Icons.delete_outline, color: Colors.redAccent, size: 16),
                  ),
                ],
              ),
            ],
          ),
          const SizedBox(height: 4),
          Text('${ex.sets} séries x ${ex.reps} reps', style: const TextStyle(color: Colors.deepOrangeAccent, fontSize: 12, fontWeight: FontWeight.bold)),
          const SizedBox(height: 2),
          Text('RPE: ${ex.rpe ?? '-'} | Descanso: ${ex.rest ?? '-'} | Carga: ${ex.weight ?? '-'}', style: const TextStyle(color: Colors.grey, fontSize: 11)),
          if (ex.tempo != null || ex.notes != null) ...[
            const SizedBox(height: 4),
            if (ex.tempo != null && ex.tempo!.isNotEmpty) Text('Tempo (Cadência): ${ex.tempo}', style: const TextStyle(color: Colors.white70, fontSize: 11)),
            if (ex.notes != null && ex.notes!.isNotEmpty) Text('Obs: ${ex.notes}', style: const TextStyle(color: Colors.grey, fontSize: 11, fontStyle: FontStyle.italic)),
          ],
        ],
      ),
    );
  }

  void _showExerciseCatalogModal(BuildContext context) {
    final fullCatalog = ['Agachamento Livre', 'Cadeira Extensora', 'Mesa Flexora', 'Leg Press 45', 'Elevação Pélvica', 'Panturrilha Sentado', 'Supino Reto', 'Puxada Frontal', 'Desenvolvimento com Halteres', 'Rosca Direta', 'Tríceps na Polia'];
    showModalBottomSheet(
      context: context,
      isScrollControlled: true,
      backgroundColor: Colors.transparent,
      builder: (context) {
        String searchQuery = '';
        return DraggableScrollableSheet(
          initialChildSize: 0.6,
          minChildSize: 0.4,
          maxChildSize: 0.9,
          builder: (context, scrollController) {
            return StatefulBuilder(
              builder: (context, setModalState) {
                final filteredCatalog = fullCatalog
                    .where((ex) => ex.toLowerCase().contains(searchQuery.toLowerCase()))
                    .toList();

                return Container(
                  decoration: const BoxDecoration(color: Color(0xFF1A1A1A), borderRadius: BorderRadius.vertical(top: Radius.circular(20))),
                  child: Column(
                    children: [
                      const SizedBox(height: 12),
                      Container(width: 40, height: 4, decoration: BoxDecoration(color: Colors.white24, borderRadius: BorderRadius.circular(2))),
                      const Padding(padding: EdgeInsets.all(16.0), child: Text('CATÁLOGO DE EXERCÍCIOS', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, fontSize: 14))),
                      Padding(
                        padding: const EdgeInsets.symmetric(horizontal: 16.0, vertical: 8.0),
                        child: TextField(
                          onChanged: (value) {
                            setModalState(() {
                              searchQuery = value;
                            });
                          },
                          style: const TextStyle(color: Colors.white, fontSize: 14),
                          decoration: InputDecoration(
                            hintText: 'Buscar exercício...',
                            hintStyle: const TextStyle(color: Colors.grey),
                            prefixIcon: const Icon(Icons.search, color: Colors.grey),
                            filled: true,
                            fillColor: Colors.black,
                            border: OutlineInputBorder(
                              borderRadius: BorderRadius.circular(8),
                              borderSide: BorderSide.none,
                            ),
                          ),
                        ),
                      ),
                      Expanded(
                        child: ListView.builder(
                          controller: scrollController,
                          itemCount: filteredCatalog.length,
                          itemBuilder: (context, index) {
                            final exerciseName = filteredCatalog[index];
                            return ListTile(
                              title: Text(exerciseName, style: const TextStyle(color: Colors.white, fontSize: 14)),
                              trailing: const Icon(Icons.add_circle_outline, color: Colors.deepOrangeAccent),
                              onTap: () {
                                Navigator.pop(context);
                                ScaffoldMessenger.of(context).showSnackBar(SnackBar(content: Text('$exerciseName adicionado!'), backgroundColor: Colors.green));
                                setState(() {
                                  _exercises.add(StrengthExercise(name: exerciseName, sets: 3, reps: '10'));
                                });
                              },
                            );
                          },
                        ),
                      ),
                    ],
                  ),
                );
              },
            );
          },
        );
      },
    );
  }

  InputDecoration _inputDeco(String label, String hint) {
    return InputDecoration(
      labelText: label,
      hintText: hint,
      labelStyle: TextStyle(color: Colors.grey[600], fontSize: 12),
      enabledBorder: const UnderlineInputBorder(borderSide: BorderSide(color: Colors.white10)),
      focusedBorder: const UnderlineInputBorder(borderSide: BorderSide(color: Colors.deepOrangeAccent)),
    );
  }

  void _showEditExerciseModal(BuildContext context, int index) {
    final exercise = _exercises[index];
    // Instancia os controladores já populados com os valores atuais do modelo!
    final setsController = TextEditingController(text: exercise.sets.toString());
    final repsController = TextEditingController(text: exercise.reps);
    final weightController = TextEditingController(text: exercise.weight ?? '');
    final rpeController = TextEditingController(text: exercise.rpe?.toString() ?? '');
    final restController = TextEditingController(text: exercise.rest ?? '');
    final tempoController = TextEditingController(text: exercise.tempo ?? '');
    final notesController = TextEditingController(text: exercise.notes ?? '');

    showDialog(
      context: context,
      builder: (context) {
        return AlertDialog(
          backgroundColor: const Color(0xFF1A1A1A),
          shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(16)),
          insetPadding: const EdgeInsets.symmetric(horizontal: 16, vertical: 24),
          title: Text('Editar: ${exercise.name}', style: const TextStyle(color: Colors.white, fontSize: 16)),
          content: ConstrainedBox(
            constraints: BoxConstraints(maxHeight: MediaQuery.of(context).size.height * 0.45),
            child: SingleChildScrollView(
            child: Column(
              mainAxisSize: MainAxisSize.min,
              children: [
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: setsController,
                        keyboardType: TextInputType.number,
                        decoration: _inputDeco('Séries', 'Ex: 4'),
                        style: const TextStyle(color: Colors.white, fontSize: 14),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: repsController,
                        decoration: _inputDeco('Reps', 'Ex: 8-10'),
                        style: const TextStyle(color: Colors.white, fontSize: 14),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: weightController,
                  decoration: _inputDeco('Carga', 'Ex: 80kg'),
                  style: const TextStyle(color: Colors.white, fontSize: 14),
                ),
                const SizedBox(height: 8),
                Row(
                  children: [
                    Expanded(
                      child: TextField(
                        controller: rpeController,
                        keyboardType: TextInputType.number,
                        decoration: _inputDeco('RPE', 'Ex: 8'),
                        style: const TextStyle(color: Colors.white, fontSize: 14),
                      ),
                    ),
                    const SizedBox(width: 8),
                    Expanded(
                      child: TextField(
                        controller: restController,
                        decoration: _inputDeco('Descanso', 'Ex: 90s'),
                        style: const TextStyle(color: Colors.white, fontSize: 14),
                      ),
                    ),
                  ],
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: tempoController,
                  decoration: _inputDeco('Tempo (Cadência)', 'Ex: 3010'),
                  style: const TextStyle(color: Colors.white, fontSize: 14),
                ),
                const SizedBox(height: 8),
                TextField(
                  controller: notesController,
                  decoration: _inputDeco('Observações', 'Ex: Focar na excêntrica'),
                  style: const TextStyle(color: Colors.white, fontSize: 14),
                ),
              ],
            ),
            ),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.pop(context),
              child: const Text('CANCELAR', style: TextStyle(color: Colors.grey)),
            ),
            ElevatedButton(
              style: ElevatedButton.styleFrom(backgroundColor: Colors.deepOrangeAccent),
              onPressed: () {
                // Quando clicar em salvar, atualizamos o estado local mapeando os inputs de volta para a classe!
                setState(() {
                  _exercises[index] = StrengthExercise(
                    name: exercise.name,
                    sets: int.tryParse(setsController.text) ?? exercise.sets,
                    reps: repsController.text,
                    weight: weightController.text.isEmpty ? null : weightController.text,
                    rpe: int.tryParse(rpeController.text),
                    rest: restController.text.isEmpty ? null : restController.text,
                    notes: notesController.text.isEmpty ? null : notesController.text,
                    tempo: tempoController.text.isEmpty ? null : tempoController.text,
                  );
                });
                Navigator.pop(context); // Fecha o modal
                ScaffoldMessenger.of(context).showSnackBar(const SnackBar(content: Text('Exercício atualizado!'), backgroundColor: Colors.green));
              },
              child: const Text('SALVAR', style: TextStyle(color: Colors.white)),
            ),
          ],
        );
      },
    );
  }
}