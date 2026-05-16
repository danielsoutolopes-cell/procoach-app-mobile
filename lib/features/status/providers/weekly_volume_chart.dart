import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:fl_chart/fl_chart.dart';
import 'package:procoach_os/features/status/providers/compliance_provider.dart';

class WeeklyVolumeChart extends ConsumerWidget {
  const WeeklyVolumeChart({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
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
            'VOLUME DA SEMANA (KM)',
            style: TextStyle(
              color: Colors.grey,
              fontSize: 12,
              fontWeight: FontWeight.bold,
              letterSpacing: 1.2,
            ),
          ),
          const SizedBox(height: 24),
          SizedBox(
            height: 200,
            child: complianceAsync.when(
              loading: () => const Center(child: CircularProgressIndicator(color: Colors.deepOrangeAccent)),
              error: (err, _) => Center(
                child: Text('Erro ao carregar gráfico.', style: TextStyle(color: Colors.red[300])),
              ),
              data: (data) {
                if (data.isEmpty) {
                  return const Center(child: Text('Sem dados', style: TextStyle(color: Colors.white54)));
                }

                // Mapeia os dados do backend para as barras do gráfico
                final barGroups = data.map((dayData) {
                  final index = dayData['dayIndex'] as int;
                  final planned = (dayData['plannedKm'] as num).toDouble();
                  final completed = (dayData['completedKm'] as num).toDouble();

                  return BarChartGroupData(
                    x: index,
                    barRods: [
                      // Barra de Planejado (Cinza)
                      BarChartRodData(
                        toY: planned,
                        color: Colors.white24,
                        width: 8,
                        borderRadius: BorderRadius.circular(4),
                      ),
                      // Barra de Concluído (Laranja)
                      BarChartRodData(
                        toY: completed,
                        color: Colors.deepOrangeAccent,
                        width: 8,
                        borderRadius: BorderRadius.circular(4),
                      ),
                    ],
                  );
                }).toList();

                return BarChart(
                  BarChartData(
                    barGroups: barGroups,
                    gridData: FlGridData(
                      show: true,
                      drawVerticalLine: false,
                      horizontalInterval: 10,
                      getDrawingHorizontalLine: (value) => FlLine(color: Colors.white10, strokeWidth: 1),
                    ),
                    borderData: FlBorderData(show: false),
                    titlesData: FlTitlesData(
                      rightTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                      topTitles: const AxisTitles(sideTitles: SideTitles(showTitles: false)),
                      leftTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          reservedSize: 30,
                          getTitlesWidget: (value, meta) => Text(
                            value.toInt().toString(),
                            style: const TextStyle(color: Colors.grey, fontSize: 10),
                          ),
                        ),
                      ),
                      bottomTitles: AxisTitles(
                        sideTitles: SideTitles(
                          showTitles: true,
                          getTitlesWidget: (value, meta) {
                            const days = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];
                            return Padding(
                              padding: const EdgeInsets.only(top: 8.0),
                              child: Text(days[value.toInt() % 7], style: const TextStyle(color: Colors.white, fontSize: 12, fontWeight: FontWeight.bold)),
                            );
                          },
                        ),
                      ),
                    ),
                  ),
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
