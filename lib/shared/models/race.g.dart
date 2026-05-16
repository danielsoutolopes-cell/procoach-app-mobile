// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'race.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Race _$RaceFromJson(Map<String, dynamic> json) => Race(
  id: json['id'] as String,
  name: json['name'] as String,
  date: DateTime.parse(json['date'] as String),
  type: $enumDecode(_$RaceTypeEnumMap, json['type']),
  isAnchor: json['is_anchor'] as bool? ?? false,
);

Map<String, dynamic> _$RaceToJson(Race instance) => <String, dynamic>{
  'id': instance.id,
  'name': instance.name,
  'date': instance.date.toIso8601String(),
  'type': _$RaceTypeEnumMap[instance.type]!,
  'is_anchor': instance.isAnchor,
};

const _$RaceTypeEnumMap = {
  RaceType.p1: 'p1',
  RaceType.p2: 'p2',
  RaceType.p3: 'p3',
};
