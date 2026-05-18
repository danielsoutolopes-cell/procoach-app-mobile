import 'package:flutter/material.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/athlete/providers/athlete_provider.dart';

class AddRaceScreen extends ConsumerStatefulWidget {
  const AddRaceScreen({super.key});

  @override
  ConsumerState<AddRaceScreen> createState() => _AddRaceScreenState();
}

class _AddRaceScreenState extends ConsumerState<AddRaceScreen> {
  final _formKey = GlobalKey<FormState>();
  final _nameController = TextEditingController();
  final _distanceController = TextEditingController();
  DateTime? _selectedDate;
  String _selectedType = 'P1';
  bool _isLoading = false;

  @override
  void dispose() {
    _nameController.dispose();
    _distanceController.dispose();
    super.dispose();
  }

  Future<void> _pickDate() async {
    final date = await showDatePicker(
      context: context,
      initialDate: DateTime.now().add(const Duration(days: 30)),
      firstDate: DateTime.now(),
      lastDate: DateTime.now().add(const Duration(days: 365 * 5)),
      builder: (context, child) {
        return Theme(
          data: Theme.of(context).copyWith(
            colorScheme: const ColorScheme.dark(
              primary: Colors.deepOrangeAccent,
              onPrimary: Colors.white,
              surface: Color(0xFF1E1E1E),
            ),
          ),
          child: child!,
        );
      },
    );
    if (date != null) {
      setState(() => _selectedDate = date);
    }
  }

  void _submit() async {
    if (!_formKey.currentState!.validate()) return;
    if (_selectedDate == null) {
      ScaffoldMessenger.of(context).showSnackBar(
        const SnackBar(content: Text('Por favor, selecione a data da prova.')),
      );
      return;
    }

    setState(() => _isLoading = true);

    // Monta o objeto de dados que será anexado à coluna JSON no Neon DB
    final raceData = {
      'id': DateTime.now().millisecondsSinceEpoch.toString(), // ID único local
      'name': _nameController.text.trim(),
      'nome': _nameController.text.trim(), // Compatibilidade com modelos antigos
      'date': _selectedDate!.toIso8601String().split('T')[0], // YYYY-MM-DD
      'data': _selectedDate!.toIso8601String().split('T')[0], // Compatibilidade
      'distancia': double.tryParse(_distanceController.text.replaceAll(',', '.')) ?? 0,
      'tipo_tatico': _selectedType, // P1, P2, P3
      'type': _selectedType, // Compatibilidade
      'status': 'aberta',
    };

    try {
      await ref.read(athleteProvider.notifier).addRace(raceData);
      if (mounted) {
        Navigator.of(context).pop(); // Volta para a tela anterior
        ScaffoldMessenger.of(context).showSnackBar(
          const SnackBar(
            content: Text('Prova cadastrada com sucesso!', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold)),
            backgroundColor: Colors.green,
          ),
        );
      }
    } catch (e) {
      if (mounted) {
        ScaffoldMessenger.of(context).showSnackBar(
          SnackBar(content: Text('Erro: $e', style: const TextStyle(color: Colors.white)), backgroundColor: Colors.redAccent),
        );
      }
    } finally {
      if (mounted) setState(() => _isLoading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final inputDecoration = InputDecoration(
      filled: true,
      fillColor: Colors.white10,
      border: OutlineInputBorder(borderRadius: BorderRadius.circular(8), borderSide: BorderSide.none),
    );

    return Scaffold(
      appBar: AppBar(
        title: const Text('NOVA PROVA', style: TextStyle(fontWeight: FontWeight.bold, letterSpacing: 1.2)),
        backgroundColor: const Color(0xFF0A0A0A),
      ),
      body: Form(
        key: _formKey,
        child: ListView(
          padding: const EdgeInsets.all(16),
          children: [
            const Text('Nome do Evento', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            TextFormField(
              controller: _nameController,
              decoration: inputDecoration.copyWith(hintText: 'Ex: Maratona do Rio'),
              validator: (val) => val == null || val.isEmpty ? 'O nome é obrigatório' : null,
            ),
            const SizedBox(height: 16),
            const Text('Distância (km)', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            TextFormField(
              controller: _distanceController,
              keyboardType: const TextInputType.numberWithOptions(decimal: true),
              decoration: inputDecoration.copyWith(hintText: 'Ex: 42.2'),
              validator: (val) => val == null || val.isEmpty ? 'A distância é obrigatória' : null,
            ),
            const SizedBox(height: 16),
            const Text('Data da Prova', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            InkWell(
              onTap: _pickDate,
              child: Container(
                padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 16),
                decoration: BoxDecoration(color: Colors.white10, borderRadius: BorderRadius.circular(8)),
                child: Row(
                  mainAxisAlignment: MainAxisAlignment.spaceBetween,
                  children: [
                    Text(_selectedDate == null ? 'Selecione a data no calendário' : '${_selectedDate!.day.toString().padLeft(2, '0')}/${_selectedDate!.month.toString().padLeft(2, '0')}/${_selectedDate!.year}', style: TextStyle(color: _selectedDate == null ? Colors.white54 : Colors.white)),
                    const Icon(Icons.calendar_month, color: Colors.deepOrangeAccent),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 16),
            const Text('Prioridade (Alvo)', style: TextStyle(fontWeight: FontWeight.bold)),
            const SizedBox(height: 8),
            DropdownButtonFormField<String>(
              value: _selectedType,
              decoration: inputDecoration,
              items: const [
                DropdownMenuItem(value: 'P1', child: Text('P1 - Prova Alvo Principal')),
                DropdownMenuItem(value: 'P2', child: Text('P2 - Prova Preparatória (Simulado)')),
                DropdownMenuItem(value: 'P3', child: Text('P3 - Treino de Luxo / Festiva')),
              ],
              onChanged: (val) { if (val != null) setState(() => _selectedType = val); },
            ),
            const SizedBox(height: 32),
            SizedBox(
              height: 54,
              child: ElevatedButton(
                onPressed: _isLoading ? null : _submit,
                style: ElevatedButton.styleFrom(
                  backgroundColor: Colors.deepOrangeAccent,
                  shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(8)),
                ),
                child: _isLoading 
                  ? const SizedBox(height: 24, width: 24, child: CircularProgressColor(color: Colors.white, strokeWidth: 2))
                  : const Text('CADASTRAR PROVA', style: TextStyle(color: Colors.white, fontWeight: FontWeight.bold, letterSpacing: 1.2)),
              ),
            ),
          ],
        ),
      ),
    );
  }
}