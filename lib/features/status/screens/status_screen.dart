import 'dart:io';
import 'package:flutter/material.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:file_picker/file_picker.dart';
import 'package:procoach_os/features/status/services/bioimpedance_service.dart';
import 'package:procoach_os/features/status/providers/bioimpedance_provider.dart';
import 'package:procoach_os/features/status/providers/compliance_provider.dart';

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
      body: ListView(
        padding: const EdgeInsets.all(16.0),
        children: [
            _buildComplianceChart(context, ref),
          const SizedBox(height: 24),
          _buildBioimpedanceCard(context, ref),
        ],
      ),
    );
  }

  Widget _buildComplianceChart(BuildContext context, WidgetRef ref) {
    final complianceAsync = ref.watch(complianceProvider);

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
            'COMPLIANCE DA SEMANA (KM)',
            style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1.2),
          ),
          const SizedBox(height: 32),
          SizedBox(
            height: 200,
            child: complianceAsync.when(
              loading: () => const Center(child: CircularProgressIndicator()),
              error: (error, _) => const Center(child: Text('Erro ao carregar gráfico', style: TextStyle(color: Colors.redAccent))),
              data: (data) {
                double maxY = 16;
                for (var d in data) {
                  if (d.plannedKm > maxY) maxY = d.plannedKm.toDouble();
                  if (d.completedKm > maxY) maxY = d.completedKm.toDouble();
                }
                maxY += 4; // Folga visual no topo do gráfico

                return BarChart(
                  BarChartData(
                    alignment: BarChartAlignment.spaceAround,
                    maxY: maxY,
                    barTouchData: BarTouchData(enabled: false),
                    titlesData: FlTitlesData(
                      show: true,
                      bottomTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          getTitlesWidget: (value, meta) {
                            const days = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
                            if (value.toInt() >= 0 && value.toInt() < days.length) {
                              return Padding(
                                padding: const EdgeInsets.only(top: 8.0),
                                child: Text(
                                  days[value.toInt()],
                                  style: const TextStyle(color: Colors.grey, fontWeight: FontWeight.bold, fontSize: 12),
                                ),
                              );
                            }
                            return const SizedBox.shrink();
                          },
                        ),
                      ),
                      leftTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                      topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                      rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                    ),
                    gridData: FlGridData(
                      show: true,
                      drawVerticalLine: false,
                      horizontalInterval: 5,
                      getDrawingHorizontalLine: (value) => const FlLine(
                        color: Colors.white10,
                        strokeWidth: 1,
                        dashArray: [4, 4],
                      ),
                    ),
                    borderData: FlBorderData(show: false),
                    barGroups: data.map((d) {
                      return _makeBarData(d.dayIndex, d.completedKm.toDouble(), d.plannedKm.toDouble());
                    }).toList(),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }

  BarChartGroupData _makeBarData(int x, double completed, double target) {
    // Se foi planeado um descanso e completado 0, mostra um pequeno traço cinza.
    final isRestDay = completed == 0 && target == 0;
    // Se completou 0, mas tinha target, sinalizamos em vermelho opaco (Falta)
    final isMissed = completed == 0 && target > 0;

    return BarChartGroupData(
      x: x,
      barRods: [
        BarChartRodData(
          toY: isRestDay ? 0.2 : (isMissed ? target : completed),
          color: isRestDay ? Colors.grey[800] : (isMissed ? Colors.redAccent.withOpacity(0.5) : Colors.deepOrangeAccent),
          width: 16,
          borderRadius: BorderRadius.circular(4),
          backDrawRodData: BackgroundBarChartRodData(
            show: target > 0, // Mostra a barra cinza de fundo (o Alvo)
            toY: target,
            color: Colors.grey[850],
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
                  _buildBioItem('⚖️', bio.weightKg.toString(), 'kg', diff: bio.weightDiff),
                  _buildBioItem('🔥', bio.bodyFatPct.toString(), '% Gordura', diff: bio.bodyFatDiff),
                  _buildBioItem('💪', bio.muscleMassKg.toString(), 'kg Músculo', diff: bio.muscleMassDiff, invertColors: true),
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

  Widget _buildBioItem(String emoji, String value, String label, {double? diff, bool invertColors = false}) {
    return Column(
      children: [
        Text(emoji, style: const TextStyle(fontSize: 24)),
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