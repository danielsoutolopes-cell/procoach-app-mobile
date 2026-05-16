// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'workout.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Workout _$WorkoutFromJson(Map<String, dynamic> json) => Workout(
  id: json['id'] as String,
  date: DateTime.parse(json['date'] as String),
  activity: json['activity'] as String,
  targetPace: json['pace_alvo'] as String?,
  distanceKm: (json['distancia_km'] as num?)?.toInt(),
  estrutura: json['estrutura'] as String?,
  status:
      $enumDecodeNullable(_$WorkoutStatusEnumMap, json['status']) ??
      WorkoutStatus.open,
  shoeId: json['shoe_id'] as String?,
  treadmillSpeed: json['treadmill_speed'] as String?,
  suggestTreadmill: json['suggest_treadmill'] as bool?,
  rainProbability: (json['rain_probability'] as num?)?.toInt(),
);

Map<String, dynamic> _$WorkoutToJson(Workout instance) => <String, dynamic>{
  'id': instance.id,
  'date': instance.date.toIso8601String(),
  'activity': instance.activity,
  'pace_alvo': instance.targetPace,
  'distancia_km': instance.distanceKm,
  'estrutura': instance.estrutura,
  'status': _$WorkoutStatusEnumMap[instance.status]!,
  'shoe_id': instance.shoeId,
  'treadmill_speed': instance.treadmillSpeed,
  'suggest_treadmill': instance.suggestTreadmill,
  'rain_probability': instance.rainProbability,
};

const _$WorkoutStatusEnumMap = {
  WorkoutStatus.open: 'open',
  WorkoutStatus.completed: 'completed',
  WorkoutStatus.skipped: 'skipped',
};
