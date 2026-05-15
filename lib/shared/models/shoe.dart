import 'package:json_annotation/json_annotation.dart';

part 'shoe.g.dart';

@JsonSerializable()
class Shoe {
  final String id;
  final String nickname;
  final String? brand;
  
  @JsonKey(name: 'initial_km')
  final int initialKm;
  
  @JsonKey(name: 'target_km')
  final int targetKm;
  
  @JsonKey(name: 'is_active')
  final bool isActive;

  Shoe({
    required this.id,
    required this.nickname,
    this.brand,
    this.initialKm = 0,
    required this.targetKm,
    this.isActive = true,
  });

  factory Shoe.fromJson(Map<String, dynamic> json) => _$ShoeFromJson(json);
  
  Map<String, dynamic> toJson() => _$ShoeToJson(this);
}