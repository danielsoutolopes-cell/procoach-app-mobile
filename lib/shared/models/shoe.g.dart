// GENERATED CODE - DO NOT MODIFY BY HAND

part of 'shoe.dart';

// **************************************************************************
// JsonSerializableGenerator
// **************************************************************************

Shoe _$ShoeFromJson(Map<String, dynamic> json) => Shoe(
      id: json['id'] as String,
      nickname: json['nickname'] as String,
      brand: json['brand'] as String?,
      initialKm: (json['initial_km'] as num?)?.toInt() ?? 0,
      targetKm: (json['target_km'] as num).toInt(),
      isActive: json['is_active'] as bool? ?? true,
    );

Map<String, dynamic> _$ShoeToJson(Shoe instance) => <String, dynamic>{
      'id': instance.id,
      'nickname': instance.nickname,
      'brand': instance.brand,
      'initial_km': instance.initialKm,
      'target_km': instance.targetKm,
      'is_active': instance.isActive,
    };
