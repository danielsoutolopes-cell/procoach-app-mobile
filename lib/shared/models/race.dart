import 'package:json_annotation/json_annotation.dart';

part 'race.g.dart';

enum RaceType { p1, p2, p3 }

@JsonSerializable()
class Race {
  final String id;
  final String name;
  final DateTime date;
  final RaceType type;
  
  @JsonKey(name: 'is_anchor')
  final bool isAnchor;

  Race({
    required this.id,
    required this.name,
    required this.date,
    required this.type,
    this.isAnchor = false,
  });

  factory Race.fromJson(Map<String, dynamic> json) => _$RaceFromJson(json);
  
  Map<String, dynamic> toJson() => _$RaceToJson(this);
}