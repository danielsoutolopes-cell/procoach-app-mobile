import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/dashboard/services/workout_service.dart';
import 'package:procoach_os/features/inventory/providers/shoe_provider.dart';
import 'package:procoach_os/features/athlete/providers/athlete_provider.dart';

class DebriefDialog extends ConsumerStatefulWidget {
  final String workoutId;
  final double distanceKm;
  final String? initialShoeId;
  
  const DebriefDialog({
    super.key,
    required this.workoutId,
    required this.distanceKm,
    this.initialShoeId,
  });

  @override
  ConsumerState<DebriefDialog> createState() => _DebriefDialogState();
}

class _DebriefDialogState extends ConsumerState<DebriefDialog> {
  int _rpe = 5;
  int _pain = 0;
  String? _selectedShoeId;
  bool _isLoading = false;
  int _gelsUsed = 0;

  @override
  void initState() {
    super.initState();
    _selectedShoeId = widget.initialShoeId;
  }

  Future<void> _submit() async {
    setState(() => _isLoading = true);
    
    try {
      // 1. Salva os dados no Backend via WorkoutService
      await ref.read(workoutServiceProvider).submitDebrief(
        workoutId: widget.workoutId,
        rpe: _rpe,
        painLevel: _pain,
        shoeId: _selectedShoeId,
        distanceKm: widget.distanceKm,
      );

      // 2. Atualiza os dados localmente na UI do Tênis
      if (_selectedShoeId != null && widget.distanceKm > 0) {
        ref.read(shoeProvider.notifier).addKmToShoeOptimistically(
          _selectedShoeId!, 
          widget.distanceKm,
        );
      }

      // 3. Abate os géis do estoque caso seja um Longão (Atualização Otimista)
      if (_gelsUsed > 0) {
        final athlete = ref.read(athleteProvider).value;
        if (athlete != null) {
          final newGelCount = (athlete.gelInventory - _gelsUsed).clamp(0, 9999).toInt();
          ref.read(athleteProvider.notifier).updateGelInventory(newGelCount);
        }
      }

      if (mounted) Navigator.of(context).pop(true);
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Falha ao registrar debrief: $e')),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final shoesAsync = ref.watch(shoeProvider);

    return AlertDialog(
      backgroundColor: const Color(0xFF1A1A1A),
      title: const Text('Debrief do Treino', style: TextStyle(color: Colors.white)),
      content: SingleChildScrollView(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Esforço Percebido (RPE):', style: TextStyle(color: Colors.white70)),
            Slider(
              value: _rpe.toDouble(),
              min: 1, max: 10, divisions: 9,
              label: _rpe.toString(),
              activeColor: Colors.deepOrangeAccent,
              onChanged: (val) => setState(() => _rpe = val.toInt()),
            ),
            const SizedBox(height: 16),
            
            const Text('Nível de Dor:', style: TextStyle(color: Colors.white70)),
            Slider(
              value: _pain.toDouble(),
              min: 0, max: 5, divisions: 5,
              label: _pain.toString(),
              activeColor: Colors.redAccent,
              onChanged: (val) => setState(() => _pain = val.toInt()),
            ),
            const SizedBox(height: 16),
            
            // Renderiza o Slider de Géis apenas para distâncias de "Longão" (>= 10km)
            if (widget.distanceKm >= 10) ...[
              const Text('Géis Consumidos (Longão):', style: TextStyle(color: Colors.white70)),
              Slider(
                value: _gelsUsed.toDouble(),
                min: 0, max: 6, divisions: 6,
                label: _gelsUsed.toString(),
                activeColor: Colors.amberAccent,
                onChanged: (val) => setState(() => _gelsUsed = val.toInt()),
              ),
              const SizedBox(height: 16),
            ],

            // Renderiza o Dropdown apenas se o treino tem distância
            if (widget.distanceKm > 0) ...[
              const Text('Equipamento Usado:', style: TextStyle(color: Colors.white70)),
              const SizedBox(height: 8),
              shoesAsync.when(
                loading: () => const Center(child: CircularProgressIndicator(color: Colors.deepOrangeAccent)),
                error: (err, stack) => Text('Erro: $err', style: const TextStyle(color: Colors.redAccent)),
                data: (shoes) {
                  final activeShoes = shoes.where((s) => s.isActive).toList();
                  if (activeShoes.isEmpty) {
                    return const Text('Nenhum tênis ativo.', style: TextStyle(color: Colors.white54));
                  }
                  return DropdownButtonFormField<String>(
                    value: _selectedShoeId,
                    decoration: InputDecoration(
                      border: OutlineInputBorder(borderRadius: BorderRadius.circular(12)),
                      enabledBorder: const OutlineInputBorder(borderSide: BorderSide(color: Colors.white24)),
                      focusedBorder: const OutlineInputBorder(borderSide: BorderSide(color: Colors.deepOrangeAccent)),
                    ),
                    dropdownColor: const Color(0xFF2A2A2A),
                    style: const TextStyle(color: Colors.white),
                    items: activeShoes.map((s) {
                      return DropdownMenuItem(
                        value: s.id,
                        child: Text('${s.nickname} (${s.currentKm.toStringAsFixed(1)} km)'),
                      );
                    }).toList(),
                    onChanged: (val) => setState(() => _selectedShoeId = val),
                  );
                },
              ),
            ],
          ],
        ),
      ),
      actions: [
        TextButton(
          onPressed: _isLoading ? null : () => Navigator.of(context).pop(false),
          child: const Text('CANCELAR', style: TextStyle(color: Colors.white54)),
        ),
        ElevatedButton(
          onPressed: _isLoading ? null : _submit,
          style: ElevatedButton.styleFrom(backgroundColor: Colors.deepOrangeAccent),
          child: _isLoading 
            ? const SizedBox(width: 16, height: 16, child: CircularProgressIndicator(strokeWidth: 2, color: Colors.white))
            : const Text('SALVAR', style: TextStyle(color: Colors.white)),
        ),
      ],
    );
  }
}