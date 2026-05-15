import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/athlete/providers/athlete_provider.dart';
import 'package:procoach_os/shared/models/athlete.dart';
import 'package:procoach_os/shared/widgets/async_value_widget.dart';
import 'package:procoach_os/features/inventory/providers/shoe_provider.dart';
import 'package:procoach_os/shared/models/shoe.dart';

class InventoryScreen extends ConsumerWidget {
  const InventoryScreen({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    // Escuta o estado global do atleta
    final athleteAsync = ref.watch(athleteProvider);

    return Scaffold(
      appBar: AppBar(
        title: const Text(
          'INVENTÁRIO',
          style: TextStyle(fontWeight: FontWeight.bold, fontSize: 16, letterSpacing: 1.2),
        ),
        centerTitle: true,
        backgroundColor: const Color(0xFF0A0A0A),
        elevation: 0,
      ),
      body: AsyncValueWidget<Athlete>(
        value: athleteAsync,
        data: (athlete) {
          return ListView(
            padding: const EdgeInsets.all(16.0),
            children: [
              // Componente de Gestão de Géis
              _buildGelCard(context, ref, athlete),
              const SizedBox(height: 24),
              // Componente de Rotação de Tênis
              _buildShoesCard(context, ref),
            ],
          );
        },
      ),
    );
  }

  Widget _buildGelCard(BuildContext context, WidgetRef ref, Athlete athlete) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: const Color(0xFF1A1A1A),
        borderRadius: BorderRadius.circular(16),
        border: Border.all(color: Colors.white10),
      ),
      child: Column(
        children: [
          const Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text('🥤', style: TextStyle(fontSize: 28)),
              SizedBox(width: 8),
              Text(
                'ESTOQUE DE GÉIS',
                style: TextStyle(color: Colors.grey, fontSize: 14, fontWeight: FontWeight.bold, letterSpacing: 1.2),
              ),
            ],
          ),
          const SizedBox(height: 24),
          Row(
            mainAxisAlignment: MainAxisAlignment.spaceEvenly,
            children: [
              _buildRoundButton(
                icon: Icons.remove,
                onTap: () {
                  if (athlete.gelInventory > 0) {
                    ref.read(athleteProvider.notifier).updateGelInventory(athlete.gelInventory - 1);
                  }
                },
              ),
              Text(
                '${athlete.gelInventory}',
                style: const TextStyle(fontSize: 48, fontWeight: FontWeight.bold, color: Colors.white),
              ),
              _buildRoundButton(
                icon: Icons.add,
                onTap: () {
                  ref.read(athleteProvider.notifier).updateGelInventory(athlete.gelInventory + 1);
                },
              ),
            ],
          ),
        ],
      ),
    );
  }

  Widget _buildRoundButton({required IconData icon, required VoidCallback onTap}) {
    return InkWell(
      onTap: onTap,
      borderRadius: BorderRadius.circular(32),
      child: Container(
        width: 64, // Área de toque expandida (Input-Light)
        height: 64,
        decoration: BoxDecoration(color: Colors.grey[850], shape: BoxShape.circle),
        child: Icon(icon, size: 32, color: Colors.deepOrangeAccent),
      ),
    );
  }

  Widget _buildShoesCard(BuildContext context, WidgetRef ref) {
    // Escuta o nosso novo provider focado apenas nos Tênis
    // Assim o cartão de tênis atualiza de forma isolada aos géis!
    final shoesAsync = ref.watch(shoeProvider);

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
            'ROTAÇÃO DE TÊNIS',
            style: TextStyle(color: Colors.grey, fontSize: 12, fontWeight: FontWeight.bold, letterSpacing: 1.2),
          ),
          const SizedBox(height: 16),
          shoesAsync.when(
            loading: () => const Center(
              child: Padding(
                padding: EdgeInsets.all(16.0),
                child: CircularProgressIndicator(),
              ),
            ),
            error: (error, _) => Text(
              'Erro ao carregar tênis.',
              style: const TextStyle(color: Colors.redAccent),
            ),
            data: (shoes) {
              if (shoes.isEmpty) {
                return const Padding(
                  padding: EdgeInsets.only(bottom: 16.0),
                  child: Text('Nenhum tênis ativo cadastrado.', style: TextStyle(color: Colors.grey)),
                );
              }
              return Column(
                children: shoes.map((shoe) {
                  // Usamos initialKm como o "km atual" mapeado através da API
                  final km = shoe.initialKm;
                  final target = shoe.targetKm;
                  final progress = target > 0 ? km / target : 0.0;
                  final isCritical = progress > 0.85; // Alerta visual

                  return Padding(
                    padding: const EdgeInsets.only(bottom: 16.0),
                    child: Row(
                      children: [
                        const Icon(Icons.snowshoeing, color: Colors.white70, size: 32),
                        const SizedBox(width: 16),
                        Expanded(
                          child: Column(
                            crossAxisAlignment: CrossAxisAlignment.start,
                            children: [
                              Text(
                                '${shoe.nickname} ${shoe.brand != null ? '(${shoe.brand})' : ''}',
                                style: const TextStyle(fontWeight: FontWeight.bold, fontSize: 16),
                              ),
                              const SizedBox(height: 8),
                              LinearProgressIndicator(
                                value: progress,
                                backgroundColor: Colors.grey[800],
                                color: isCritical ? Colors.redAccent : Colors.deepOrangeAccent,
                                minHeight: 6,
                                borderRadius: BorderRadius.circular(4),
                              ),
                              const SizedBox(height: 4),
                              Text(
                                '$km / $target km',
                                style: TextStyle(color: isCritical ? Colors.redAccent : Colors.grey, fontSize: 12),
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  );
                }).toList(),
              );
            },
          ),
          const SizedBox(height: 8),
          SizedBox(
            width: double.infinity,
            child: TextButton.icon(
              onPressed: () {},
              icon: const Icon(Icons.add, color: Colors.deepOrangeAccent),
              label: const Text('ADICIONAR TÊNIS', style: TextStyle(color: Colors.deepOrangeAccent)),
            ),
          )
        ],
      ),
    );
  }
}