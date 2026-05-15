import 'package:json_annotation/json_annotation.dart';
import 'race.dart';

part 'athlete.g.dart';

@JsonSerializable(explicitToJson: true)
class Athlete {
  final String id;
  final String name;
  
  @JsonKey(name: 'gel_inventory')
  final int gelInventory;
  
  final List<Race> races;

  Athlete({
    required this.id,
    required this.name,
    this.gelInventory = 0,
    this.races = const [],
  });

  factory Athlete.fromJson(Map<String, dynamic> json) => _$AthleteFromJson(json);
  
  Map<String, dynamic> toJson() => _$AthleteToJson(this);
}