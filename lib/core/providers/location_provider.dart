import 'package:geolocator/geolocator.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

/// Provider responsável por solicitar permissão e buscar a localização atual do aparelho.
final locationProvider = FutureProvider<Position?>((ref) async {
  bool serviceEnabled;
  LocationPermission permission;

  // 1. Verifica se o serviço de localização (GPS) está ativado no celular
  serviceEnabled = await Geolocator.isLocationServiceEnabled();
  if (!serviceEnabled) {
    // Retorna nulo para o app usar as coordenadas de fallback
    return null; 
  }

  // 2. Verifica o status da permissão
  permission = await Geolocator.checkPermission();
  if (permission == LocationPermission.denied) {
    // Pede a permissão ao usuário (Abre o pop-up nativo do Android/iOS)
    permission = await Geolocator.requestPermission();
    if (permission == LocationPermission.denied) {
      return null;
    }
  }
  
  // 3. Se o usuário negou permanentemente nas configurações
  if (permission == LocationPermission.deniedForever) {
    return null;
  } 

  // 4. Permissão concedida! Busca a posição atual (com precisão alta)
  return await Geolocator.getCurrentPosition(
    desiredAccuracy: LocationAccuracy.high,
  );
});