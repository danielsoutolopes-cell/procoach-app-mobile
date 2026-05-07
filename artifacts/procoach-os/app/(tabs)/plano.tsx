import { Feather } from "@expo/vector-icons";
import * as Haptics from "expo-haptics";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import React, { useState } from "react";
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAthlete } from "@/context/AthleteContext";
import { useColors } from "@/hooks/useColors";
import {
  DaySession,
  formatWeekRange,
  getNikeSPWeekSessions,
  getPhase,
  getPhaseColor,
  getSessionColor,
  getWeekFocus,
  getWeeklyVolume,
  Phase,
} from "@/utils/training";
import { generateWeeklyScheduleHtml } from "@/utils/weeklyReport";

interface BlockInfo {
  blockNum: number;
  phase: Phase;
  weeks: number[];
}

const BLOCKS: BlockInfo[] = [
  { blockNum: 1, phase: "Base",       weeks: [1, 2, 3, 4] },
  { blockNum: 2, phase: "Construção", weeks: [5, 6, 7, 8] },
  { blockNum: 3, phase: "Pico",       weeks: [9, 10, 11, 12] },
  { blockNum: 4, phase: "Polimento",  weeks: [13, 14, 15, 16] },
];

const PHASE_DESCRIPTIONS: Record<Phase, string> = {
  Base:       "Construção aeróbica. Volume moderado, ritmo confortável. Adaptação musculo-esquelética.",
  Construção: "Aumento progressivo de volume e intensidade. Introdução de intervalados (tiros).",
  Pico:       "Máximo volume e intensidade. Treinos de simulação de prova. Semana 12 = recuperação.",
  Polimento:  "Redução de carga (tapering). Preservar forma e maximizar recuperação para a prova.",
};

const DAY_ICONS: Record<string, string> = {
  corrida:     "activity",
  tiros:       "zap",
  regenerativo:"heart",
  folga:       "moon",
  prova:       "award",
};

// ─── SESSION DETAIL PANEL ─────────────────────────────────────────────────────

function SessionRow({ session, colors }: { session: DaySession; colors: ReturnType<typeof import("@/hooks/useColors").useColors> }) {
  const [expanded, setExpanded] = useState(false);
  const col = getSessionColor(session.type);
  const icon = DAY_ICONS[session.type] ?? "activity";

  return (
    <Pressable
      onPress={() => {
        setExpanded((v) => !v);
        Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
      }}
      style={({ pressed }) => ({
        opacity: pressed ? 0.75 : 1,
        backgroundColor: session.isRace ? col + "18" : colors.secondary,
        borderRadius: 10,
        borderWidth: session.isRace ? 1.5 : 1,
        borderColor: session.isRace ? col : colors.border,
        padding: 12,
        marginBottom: 8,
      })}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 10 }}>
        {/* Day pill */}
        <View style={{
          backgroundColor: col + "22", borderRadius: 6,
          paddingHorizontal: 8, paddingVertical: 4, minWidth: 38, alignItems: "center",
        }}>
          <Text style={{ fontSize: 9, fontWeight: "800" as const, letterSpacing: 1, color: col }}>
            {session.day}
          </Text>
        </View>

        {/* Icon */}
        <Feather name={icon as any} size={13} color={col} />

        {/* Label + km */}
        <View style={{ flex: 1 }}>
          <Text style={{ fontSize: 12, fontWeight: "700" as const, color: colors.foreground, lineHeight: 16 }}>
            {session.label}
          </Text>
          {session.raceTag && (
            <Text style={{ fontSize: 9, letterSpacing: 1, color: col, fontWeight: "800" as const, marginTop: 1 }}>
              {session.raceTag}
            </Text>
          )}
        </View>

        {/* Distance badge */}
        {session.distanceKm > 0 && (
          <View style={{ alignItems: "flex-end" }}>
            <Text style={{ fontSize: 16, fontWeight: "800" as const, color: col, letterSpacing: -0.5 }}>
              {session.distanceKm}
            </Text>
            <Text style={{ fontSize: 8, color: colors.mutedForeground, letterSpacing: 1 }}>KM</Text>
          </View>
        )}

        <Feather
          name={expanded ? "chevron-up" : "chevron-down"}
          size={13}
          color={colors.mutedForeground}
        />
      </View>

      {/* Expanded description */}
      {expanded && (
        <Text style={{
          fontSize: 12, color: colors.mutedForeground, lineHeight: 18,
          marginTop: 10, paddingTop: 10,
          borderTopWidth: 1, borderTopColor: colors.border,
        }}>
          {session.description}
        </Text>
      )}
    </Pressable>
  );
}

function WeekSessionsPanel({
  week,
  raceDate,
  currentWeek,
  phaseColor,
  onSetCurrentWeek,
  colors,
  athleteName,
  targetRaceName,
  targetPaceMinKm,
}: {
  week: number;
  raceDate: string;
  currentWeek: number;
  phaseColor: string;
  onSetCurrentWeek: (w: number) => void;
  colors: ReturnType<typeof import("@/hooks/useColors").useColors>;
  athleteName?: string;
  targetRaceName?: string;
  targetPaceMinKm?: number;
}) {
  const sessions = getNikeSPWeekSessions(week);
  const dateRange = formatWeekRange(raceDate, week);
  const vol = sessions.reduce((a, s) => a + s.distanceKm, 0);
  const isCurrent = week === currentWeek;
  const [exporting, setExporting] = useState(false);

  const handleExportPdf = async () => {
    setExporting(true);
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    try {
      const html = generateWeeklyScheduleHtml({
        week,
        raceDateISO: raceDate,
        athleteName,
        targetRaceName,
        targetPaceMinKm,
      });

      if (Platform.OS === "web") {
        // On web: open HTML in a new tab so the user can print/save as PDF
        const blob = new Blob([html], { type: "text/html" });
        const url = URL.createObjectURL(blob);
        window.open(url, "_blank");
      } else {
        // On native: generate PDF via expo-print then share
        const { uri } = await Print.printToFileAsync({ html, base64: false });
        const canShare = await Sharing.isAvailableAsync();
        if (canShare) {
          await Sharing.shareAsync(uri, {
            mimeType: "application/pdf",
            dialogTitle: `Semana ${week} — Plano de Treino`,
            UTI: "com.adobe.pdf",
          });
        } else {
          await Print.printAsync({ html });
        }
      }
    } catch (e) {
      // silently fail — user can retry
    } finally {
      setExporting(false);
    }
  };

  return (
    <View style={{
      marginTop: 16,
      backgroundColor: phaseColor + "08",
      borderRadius: 12,
      borderWidth: 1,
      borderColor: phaseColor + "33",
      padding: 14,
    }}>
      {/* Panel header */}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
        <View>
          <Text style={{ fontSize: 9, letterSpacing: 3, fontWeight: "800" as const, color: phaseColor }}>
            SEMANA {week} · {dateRange}
          </Text>
          <Text style={{ fontSize: 11, color: colors.mutedForeground, marginTop: 2 }}>
            {sessions.length} sessões · {vol}km planejados
          </Text>
        </View>
        <View style={{ flexDirection: "row", gap: 6 }}>
          {!isCurrent && (
            <Pressable
              onPress={() => onSetCurrentWeek(week)}
              style={({ pressed }) => ({
                backgroundColor: phaseColor + "22",
                borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Text style={{ fontSize: 9, fontWeight: "800" as const, color: phaseColor, letterSpacing: 1 }}>
                USAR SEMANA
              </Text>
            </Pressable>
          )}
          {isCurrent && (
            <View style={{ backgroundColor: phaseColor + "22", borderRadius: 8, paddingHorizontal: 10, paddingVertical: 6 }}>
              <Text style={{ fontSize: 9, fontWeight: "800" as const, color: phaseColor, letterSpacing: 1 }}>
                ◉ ATUAL
              </Text>
            </View>
          )}
        </View>
      </View>

      {/* Sessions list */}
      {sessions.map((s, i) => (
        <SessionRow key={i} session={s} colors={colors} />
      ))}

      {sessions.length === 0 && (
        <Text style={{ fontSize: 12, color: colors.mutedForeground, textAlign: "center", paddingVertical: 16 }}>
          Sessões não definidas para esta semana.
        </Text>
      )}

      {/* Export PDF button */}
      <Pressable
        onPress={handleExportPdf}
        disabled={exporting}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "center",
          gap: 8,
          marginTop: 12,
          paddingVertical: 11,
          borderRadius: 10,
          borderWidth: 1,
          borderColor: phaseColor + "44",
          backgroundColor: phaseColor + "10",
          opacity: pressed || exporting ? 0.65 : 1,
        })}
      >
        {exporting ? (
          <ActivityIndicator size="small" color={phaseColor} />
        ) : (
          <Feather name="download" size={13} color={phaseColor} />
        )}
        <Text style={{ fontSize: 10, fontWeight: "800" as const, letterSpacing: 2, color: phaseColor }}>
          {exporting ? "GERANDO PDF..." : "EXPORTAR PDF"}
        </Text>
      </Pressable>
    </View>
  );
}

// ─── MAIN SCREEN ─────────────────────────────────────────────────────────────

export default function PlanoScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const { state, setCurrentWeek } = useAthlete();
  const { currentWeek, profile } = state;
  const raceDate = profile.targetRaceDate;

  const [expandedBlock, setExpandedBlock] = useState<number | null>(
    Math.ceil(currentWeek / 4)
  );
  const [selectedWeek, setSelectedWeek] = useState<number>(currentWeek);

  const handleWeekSelect = async (week: number) => {
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    setSelectedWeek(week);
    // Also open the block that contains this week
    setExpandedBlock(Math.ceil(week / 4));
  };

  const handleSetCurrentWeek = async (week: number) => {
    await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
    await setCurrentWeek(week);
    setSelectedWeek(week);
  };

  const s = StyleSheet.create({
    container:    { flex: 1, backgroundColor: colors.background },
    scroll:       { flex: 1 },
    content: {
      paddingHorizontal: 20,
      paddingTop: Platform.OS === "web" ? insets.top + 67 : insets.top + 16,
      paddingBottom: Platform.OS === "web" ? 34 + 84 : insets.bottom + 84,
    },
    pageTitle:   { fontSize: 10, letterSpacing: 4, color: colors.primary, fontWeight: "800" as const, marginBottom: 4 },
    pageSubtitle:{ fontSize: 22, fontWeight: "800" as const, color: colors.foreground, letterSpacing: -0.5, marginBottom: 6 },
    pageMeta:    { fontSize: 11, color: colors.mutedForeground, marginBottom: 20, lineHeight: 16 },
    progressRow: { flexDirection: "row", gap: 4, marginBottom: 24 },
    progressSeg: { flex: 1, height: 4, borderRadius: 2 },
    blockCard: {
      backgroundColor: colors.card, borderRadius: colors.radius,
      borderWidth: 1, borderColor: colors.border, marginBottom: 12, overflow: "hidden",
    },
    blockHeader: { flexDirection: "row", alignItems: "center", padding: 16, gap: 12 },
    blockNumBadge:{ width: 32, height: 32, borderRadius: 8, alignItems: "center", justifyContent: "center" },
    blockNumText: { fontSize: 14, fontWeight: "800" as const },
    blockInfo:    { flex: 1 },
    blockPhase:   { fontSize: 13, fontWeight: "800" as const, letterSpacing: 2 },
    blockMeta:    { fontSize: 10, letterSpacing: 1, color: colors.mutedForeground, marginTop: 2 },
    blockBody:    { paddingHorizontal: 16, paddingBottom: 16 },
    phaseDesc: {
      fontSize: 12, color: colors.mutedForeground, lineHeight: 18, marginBottom: 14,
      borderLeftWidth: 2, borderLeftColor: colors.border, paddingLeft: 10,
    },
    weeksGrid:    { flexDirection: "row", flexWrap: "wrap" as const, gap: 8 },
    weekCell: {
      width: "47%", borderRadius: 8, borderWidth: 1, padding: 12, gap: 3,
    },
    weekCellHeader:{ flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
    weekLabel:     { fontSize: 9, letterSpacing: 2, fontWeight: "700" as const },
    weekVolumeNum: { fontSize: 20, fontWeight: "800" as const, letterSpacing: -1 },
    weekVolumeUnit:{ fontSize: 9, letterSpacing: 1 },
    weekDateRange: { fontSize: 8, letterSpacing: 0.5, color: colors.mutedForeground, marginTop: 1 },
    weekFocusLabel:{ fontSize: 8, letterSpacing: 0, lineHeight: 11 },
    currentDot:    { width: 6, height: 6, borderRadius: 3, backgroundColor: colors.primary },
  });

  const totalVolume = BLOCKS.reduce(
    (acc, b) => acc + b.weeks.reduce((a, w) => a + getWeeklyVolume(w), 0), 0
  );

  return (
    <View style={s.container}>
      <ScrollView style={s.scroll} contentContainerStyle={s.content} showsVerticalScrollIndicator={false}>
        <Text style={s.pageTitle}>PLANO DE TREINO</Text>
        <Text style={s.pageSubtitle}>Nike SP City Marathon</Text>
        <Text style={s.pageMeta}>
          16 semanas · {totalVolume}km total · P2 Tribuna 10K (Sem 6) · P1 21K (Sem 16)
        </Text>

        {/* Phase progress bar */}
        <View style={s.progressRow}>
          {[1, 2, 3, 4].map((b) => {
            const phase = BLOCKS[b - 1].phase;
            const color = getPhaseColor(phase);
            const isActive = Math.ceil(currentWeek / 4) >= b;
            return (
              <View key={b} style={[s.progressSeg, { backgroundColor: isActive ? color : colors.border }]} />
            );
          })}
        </View>

        {/* Blocks */}
        {BLOCKS.map((block) => {
          const phaseColor = getPhaseColor(block.phase);
          const isExpanded = expandedBlock === block.blockNum;
          const isCurrentBlock = Math.ceil(currentWeek / 4) === block.blockNum;
          const blockVolume = block.weeks.reduce((a, w) => a + getWeeklyVolume(w), 0);
          const selectedInBlock = block.weeks.includes(selectedWeek);

          return (
            <View key={block.blockNum} style={[s.blockCard, isCurrentBlock && { borderColor: phaseColor + "44" }]}>
              <Pressable
                style={({ pressed }) => [s.blockHeader, { opacity: pressed ? 0.7 : 1 }]}
                onPress={() => {
                  setExpandedBlock(isExpanded ? null : block.blockNum);
                  Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
                }}
              >
                <View style={[s.blockNumBadge, { backgroundColor: phaseColor + "22" }]}>
                  <Text style={[s.blockNumText, { color: phaseColor }]}>{block.blockNum}</Text>
                </View>
                <View style={s.blockInfo}>
                  <Text style={[s.blockPhase, { color: phaseColor }]}>
                    {block.phase.toUpperCase()}
                  </Text>
                  <Text style={s.blockMeta}>
                    SEM {block.weeks[0]}–{block.weeks[3]} · {blockVolume}KM{isCurrentBlock ? " · ATUAL" : ""}
                    {block.blockNum === 2 ? " · 🏁 P2 S6" : ""}
                    {block.blockNum === 4 ? " · 🏁 P1 S16" : ""}
                  </Text>
                </View>
                <Feather
                  name={isExpanded ? "chevron-up" : "chevron-down"}
                  size={16} color={colors.mutedForeground} style={{ opacity: 0.5 }}
                />
              </Pressable>

              {isExpanded && (
                <View style={s.blockBody}>
                  <Text style={s.phaseDesc}>{PHASE_DESCRIPTIONS[block.phase]}</Text>

                  {/* Week cells grid */}
                  <View style={s.weeksGrid}>
                    {block.weeks.map((week) => {
                      const vol = getWeeklyVolume(week);
                      const isCurrent = week === currentWeek;
                      const isSelected = week === selectedWeek;
                      const isRaceWeek = week === 6 || week === 16;
                      const weekColor = isCurrent ? phaseColor : isSelected ? phaseColor + "88" : colors.border;
                      const dateRange = formatWeekRange(raceDate, week);
                      const focus = getWeekFocus(week);

                      return (
                        <Pressable
                          key={week}
                          style={({ pressed }) => [
                            s.weekCell,
                            {
                              backgroundColor: isCurrent
                                ? phaseColor + "20"
                                : isSelected
                                ? phaseColor + "10"
                                : colors.secondary,
                              borderColor: weekColor,
                              opacity: pressed ? 0.7 : 1,
                            },
                          ]}
                          onPress={() => handleWeekSelect(week)}
                        >
                          <View style={s.weekCellHeader}>
                            <Text style={[s.weekLabel, { color: isCurrent ? phaseColor : isSelected ? phaseColor : colors.mutedForeground }]}>
                              SEM {week}
                            </Text>
                            <View style={{ flexDirection: "row", gap: 4, alignItems: "center" }}>
                              {week % 4 === 0 && week !== 16 && (
                                <Text style={{ fontSize: 9, letterSpacing: 1, color: "#4CAF50" }}>REC</Text>
                              )}
                              {isRaceWeek && (
                                <Feather name="flag" size={10} color={week === 6 ? "#2196F3" : colors.primary} />
                              )}
                            </View>
                          </View>
                          <Text style={{ fontSize: 8, letterSpacing: 0.5, color: colors.mutedForeground, marginTop: 1 }}>
                            {dateRange}
                          </Text>
                          <Text style={[s.weekVolumeNum, { color: isCurrent ? phaseColor : colors.foreground }]}>
                            {vol}
                          </Text>
                          <Text style={[s.weekVolumeUnit, { color: colors.mutedForeground }]}>
                            {week === 16 ? "PROVA" : "KM"}
                          </Text>
                          <Text style={[s.weekFocusLabel, { color: isCurrent ? phaseColor + "CC" : colors.mutedForeground }]}>
                            {focus}
                          </Text>
                          {isCurrent && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
                              <View style={s.currentDot} />
                              <Text style={{ fontSize: 9, color: colors.primary, fontWeight: "700" as const, letterSpacing: 1 }}>
                                ATUAL
                              </Text>
                            </View>
                          )}
                          {isSelected && !isCurrent && (
                            <View style={{ flexDirection: "row", alignItems: "center", gap: 4, marginTop: 3 }}>
                              <Feather name="eye" size={8} color={phaseColor} />
                              <Text style={{ fontSize: 9, color: phaseColor, fontWeight: "700" as const, letterSpacing: 1 }}>
                                VER SESSÕES
                              </Text>
                            </View>
                          )}
                        </Pressable>
                      );
                    })}
                  </View>

                  {/* Session detail panel — shown when a week in this block is selected */}
                  {selectedInBlock && (
                    <WeekSessionsPanel
                      week={selectedWeek}
                      raceDate={raceDate}
                      currentWeek={currentWeek}
                      phaseColor={phaseColor}
                      onSetCurrentWeek={handleSetCurrentWeek}
                      colors={colors}
                      athleteName={profile.name}
                      targetRaceName={profile.targetRaceName}
                      targetPaceMinKm={6.75}
                    />
                  )}
                </View>
              )}
            </View>
          );
        })}

        <View style={{ marginTop: 8, alignItems: "center", gap: 4 }}>
          <Text style={{ fontSize: 10, letterSpacing: 2, color: colors.mutedForeground }}>
            VOLUME TOTAL DO CICLO: {totalVolume}KM
          </Text>
          <Text style={{ fontSize: 9, letterSpacing: 1, color: colors.mutedForeground + "88" }}>
            Toque em uma semana para ver as sessões detalhadas
          </Text>
        </View>
      </ScrollView>
    </View>
  );
}
