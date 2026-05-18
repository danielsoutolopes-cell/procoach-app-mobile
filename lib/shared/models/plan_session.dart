class PlanSession {
  final int week;
  final String day;
  final String activity;
  final String? details;
  final String? pace;
  final int? km;

  PlanSession({
    required this.week,
    required this.day,
    required this.activity,
    this.details,
    this.pace,
    this.km,
  });

  // Fábrica para demonstração, pode ser ajustada para o JSON real da sua API
  factory PlanSession.fromJson(Map<String, dynamic> json) {
    return PlanSession(
      week: json['week'] as int,
      day: json['day'] as String,
      activity: json['activity'] as String,
      details: json['details'] as String?,
      km: json['km'] as int?,
    );
  }
}