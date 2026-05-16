// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'athlete.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Athlete _$AthleteFromJson(Map<String, dynamic> json) => Athlete(
  id: json['id'] as String,
  name: json['name'] as String,
  gelInventory: (json['gel_inventory'] as num?)?.toInt() ?? 0,
  races:
      (json['races'] as List<dynamic>?)
          ?.map((e) => Race.fromJson(e as Map<String, dynamic>))
          .toList() ??
      const [],
);

Map<String, dynamic> _$AthleteToJson(Athlete instance) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'gel_inventory': instance.gelInventory,
  'races': instance.races.map((e) => e.toJson()).toList(),
};
