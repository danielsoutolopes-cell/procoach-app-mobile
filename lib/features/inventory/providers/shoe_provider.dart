import 'dart:async';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:procoach_os/features/inventory/services/shoe_service.dart';
import 'package:procoach_os/shared/models/shoe.dart';

final shoeProvider = AsyncNotifierProvider<ShoeNotifier, List<Shoe>>(() {
  return ShoeNotifier();
});

class ShoeNotifier extends AsyncNotifier<List<Shoe>> {
  @override
  FutureOr<List<Shoe>> build() async {
    final shoeService = ref.watch(shoeServiceProvider);
    return await shoeService.getAthleteShoes();
  }
}