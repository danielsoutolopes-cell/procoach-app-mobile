import 'package:json_annotation/json_annotation.dart';

part 'workout.g.dart';

enum WorkoutStatus { open, completed, skipped }

@JsonSerializable()
class Workout {
  final String id;
  final DateTime date;
  final String activity; // Ex: Corrida, Bike, Força, Descanso
  
  @JsonKey(name: 'pace_alvo')
  final String? targetPace;
  
  // Regra de Ouro: Telemetria tratada como Integer (Quilometragem inteira)
  @JsonKey(name: 'distancia_km')
  final int? distanceKm; 
  
  final String? estrutura;
  final WorkoutStatus status;
  
  @JsonKey(name: 'shoe_id')
  final String? shoeId;

  Workout({
    required this.id,
    required this.date,
    required this.activity,
    this.targetPace,
    this.distanceKm,
    this.estrutura,
    this.status = WorkoutStatus.open,
    this.shoeId,
  });

  factory Workout.fromJson(Map<String, dynamic> json) => _$WorkoutFromJson(json);
  
  Map<String, dynamic> toJson() => _$WorkoutToJson(this);
}