import React, { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import { ProCoachAPI, type Shoe } from "@/services/api";

const SHOES_CACHE_KEY = "@procoach_shoes_cache_v1";

function num(v: any): number {
  const n = typeof v === "number" ? v : Number(String(v ?? "").replace(",", "."));
  return Number.isFinite(n) ? n : 0;
}

function getField<T = any>(obj: any, a: string, b?: string): T | undefined {
  return (obj?.[a] ?? (b ? obj?.[b] : undefined)) as any;
}

function isArchived(s: Shoe): boolean {
  return Boolean(getField(s, "retiredAt", "retired_at"));
}

function kmTotal(s: Shoe): number {
  return Math.max(0, Math.round(num(getField(s, "kmTotal", "km_total") ?? 0)));
}

function targetKm(s: Shoe): number {
  return Math.max(1, Math.round(num(getField(s, "targetKm", "target_km") ?? 500)));
}

function pct(done: number, total: number): number {
  return total > 0 ? Math.max(0, Math.min(1, done / total)) : 0;
}

export default function EquipamentosScreen() {
  const colors = useColors();
  const [tab, setTab] = useState<"ativos" | "arquivados">("ativos");
  const [loading, setLoading] = useState(true);
  const [shoes, setShoes] = useState<Shoe[]>([]);

  const [createOpen, setCreateOpen] = useState(false);
  const [nickname, setNickname] = useState("");
  const [brand, setBrand] = useState("");
  const [model, setModel] = useState("");
  const [initialKm, setInitialKm] = useState("0");
  const [targetKmText, setTargetKmText] = useState("500");
  const [saving, setSaving] = useState(false);

  const loadCache = useCallback(async () => {
    try {
      const raw = await AsyncStorage.getItem(SHOES_CACHE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) setShoes(parsed);
    } catch {}
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const r = await ProCoachAPI.getShoes();
      const list = Array.isArray(r.shoes) ? r.shoes : [];
      setShoes(list);
      await AsyncStorage.setItem(SHOES_CACHE_KEY, JSON.stringify(list));
    } catch (e: any) {
      // Mantém cache
      if (!shoes.length) {
        Alert.alert("Equipamentos", e?.message ?? "Falha ao carregar tênis.");
      }
    } finally {
      setLoading(false);
    }
  }, [shoes.length]);

  useEffect(() => {
    loadCache().then(refresh);
  }, [loadCache, refresh]);

  const ativos = useMemo(() => shoes.filter((s) => !isArchived(s)), [shoes]);
  const arquivados = useMemo(() => shoes.filter(isArchived), [shoes]);
  const list = tab === "ativos" ? ativos : arquivados;

  const s = StyleSheet.create({
    container: { flex: 1, backgroundColor: colors.background },
    content: { paddingHorizontal: 20, paddingTop: 20, paddingBottom: 100 },
    headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginBottom: 14 },
    title: { fontSize: 12, fontWeight: "900" as const, letterSpacing: 3, color: colors.primary },
    tabs: { flexDirection: "row", gap: 8, marginBottom: 16 },
    tabBtn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.border,
      alignItems: "center",
      justifyContent: "center",
    },
    tabText: { fontSize: 10, fontWeight: "900" as const, letterSpacing: 2 },
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 14,
      marginBottom: 12,
    },
    shoeTitle: { fontSize: 13, fontWeight: "900" as const, color: colors.foreground },
    shoeSub: { marginTop: 2, fontSize: 10, color: colors.mutedForeground, letterSpacing: 0.5 },
    row: { flexDirection: "row", justifyContent: "space-between", marginTop: 10, alignItems: "center" },
    kmText: { fontSize: 11, fontWeight: "800" as const, color: colors.foreground },
    bar: { height: 8, backgroundColor: colors.secondary, borderRadius: 6, overflow: "hidden", marginTop: 10 },
    barFill: { height: "100%", backgroundColor: colors.primary },
    hint: { fontSize: 10, color: colors.mutedForeground, lineHeight: 15 },
    btn: {
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 8,
      paddingVertical: 12,
      borderRadius: 10,
      backgroundColor: colors.primary,
    },
    btnText: { fontSize: 10, fontWeight: "900" as const, letterSpacing: 2, color: "#000" },
    modalOverlay: { flex: 1, backgroundColor: "rgba(0,0,0,0.65)", padding: 18, justifyContent: "flex-end" },
    modalSheet: { backgroundColor: colors.card, borderRadius: 16, borderWidth: 1, borderColor: colors.border, padding: 16 },
    input: {
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.secondary,
      borderRadius: 10,
      paddingHorizontal: 12,
      paddingVertical: 10,
      color: colors.foreground,
      fontSize: 12,
    },
    label: { marginTop: 10, marginBottom: 6, fontSize: 9, color: colors.mutedForeground, letterSpacing: 2, fontWeight: "800" as const },
    modalRow: { flexDirection: "row", gap: 10, marginTop: 14 },
    modalBtn: { flex: 1, paddingVertical: 12, borderRadius: 10, alignItems: "center", justifyContent: "center", borderWidth: 1, borderColor: colors.border },
    modalBtnPrimary: { backgroundColor: colors.primary, borderColor: colors.primary },
    modalBtnText: { fontSize: 10, fontWeight: "900" as const, letterSpacing: 2, color: colors.foreground },
    modalBtnTextPrimary: { color: "#000" },
  });

  const openCreate = () => {
    setNickname("");
    setBrand("");
    setModel("");
    setInitialKm("0");
    setTargetKmText("500");
    setCreateOpen(true);
  };

  const saveShoe = async () => {
    const nn = nickname.trim();
    if (!nn) {
      Alert.alert("Equipamentos", "Digite um nome/apelido para o tênis.");
      return;
    }
    setSaving(true);
    try {
      await ProCoachAPI.createShoe({
        nickname: nn,
        brand: brand.trim() || null,
        model: model.trim() || null,
        initialKm: Math.max(0, Math.round(num(initialKm))),
        targetKm: Math.max(1, Math.round(num(targetKmText))),
      });
      setCreateOpen(false);
      await refresh();
    } catch (e: any) {
      Alert.alert("Equipamentos", e?.message ?? "Falha ao salvar.");
    } finally {
      setSaving(false);
    }
  };

  const archive = async (shoe: Shoe) => {
    Alert.alert("Aposentar tênis", `Aposentar "${getField(shoe, "nickname")}"?`, [
      { text: "Cancelar", style: "cancel" },
      {
        text: "Aposentar",
        style: "destructive",
        onPress: async () => {
          try {
            await ProCoachAPI.archiveShoe(Number(getField(shoe, "id")));
            await refresh();
          } catch (e: any) {
            Alert.alert("Equipamentos", e?.message ?? "Falha ao aposentar.");
          }
        },
      },
    ]);
  };

  return (
    <View style={s.container}>
      <ScrollView contentContainerStyle={s.content}>
        <View style={s.headerRow}>
          <Text style={s.title}>EQUIPAMENTOS</Text>
          <Pressable onPress={refresh} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
            <Feather name="refresh-cw" size={16} color={colors.mutedForeground} />
          </Pressable>
        </View>

        <View style={s.tabs}>
          <Pressable
            onPress={() => setTab("ativos")}
            style={[
              s.tabBtn,
              tab === "ativos" ? { borderColor: colors.primary, backgroundColor: `${colors.primary}22` } : null,
            ]}
          >
            <Text style={[s.tabText, { color: tab === "ativos" ? colors.primary : colors.mutedForeground }]}>
              ATIVOS ({ativos.length})
            </Text>
          </Pressable>
          <Pressable
            onPress={() => setTab("arquivados")}
            style={[
              s.tabBtn,
              tab === "arquivados" ? { borderColor: colors.primary, backgroundColor: `${colors.primary}22` } : null,
            ]}
          >
            <Text style={[s.tabText, { color: tab === "arquivados" ? colors.primary : colors.mutedForeground }]}>
              ARQUIVADOS ({arquivados.length})
            </Text>
          </Pressable>
        </View>

        {loading ? (
          <View style={[s.card, { alignItems: "center", paddingVertical: 24 }]}>
            <ActivityIndicator color={colors.primary} />
          </View>
        ) : list.length === 0 ? (
          <View style={s.card}>
            <Text style={s.hint}>
              {tab === "ativos"
                ? "Nenhum tênis ativo cadastrado. Toque em “+ TÊNIS” para criar o primeiro."
                : "Nenhum tênis arquivado ainda."}
            </Text>
          </View>
        ) : (
          list.map((shoe, idx) => {
            const done = kmTotal(shoe);
            const total = targetKm(shoe);
            const p = pct(done, total);
            const nick = String(getField(shoe, "nickname") ?? "");
            const sub = [getField(shoe, "brand"), getField(shoe, "model")].filter(Boolean).join(" · ");
            const alertColor = p >= 1 ? "#EF4444" : p >= 0.8 ? "#FF9800" : colors.primary;
            return (
              <Pressable
                key={`${nick}-${idx}`}
                onLongPress={() => (tab === "ativos" ? archive(shoe) : null)}
                style={({ pressed }) => [{ opacity: pressed ? 0.85 : 1 }]}
              >
                <View style={s.card}>
                  <Text style={s.shoeTitle}>{nick}</Text>
                  {sub ? <Text style={s.shoeSub}>{sub}</Text> : null}
                  <View style={s.row}>
                    <Text style={s.kmText}>
                      {done} / {total} km
                    </Text>
                    <Text style={[s.shoeSub, { marginTop: 0, color: alertColor }]}>
                      {p >= 1 ? "APOSENTAR" : p >= 0.8 ? "ATENÇÃO" : "OK"}
                    </Text>
                  </View>
                  <View style={s.bar}>
                    <View style={[s.barFill, { width: `${Math.round(p * 100)}%`, backgroundColor: alertColor }]} />
                  </View>
                  {tab === "ativos" ? (
                    <Text style={[s.shoeSub, { marginTop: 10 }]}>Segure para aposentar</Text>
                  ) : null}
                </View>
              </Pressable>
            );
          })
        )}

        {tab === "ativos" ? (
          <Pressable style={({ pressed }) => [s.btn, { opacity: pressed ? 0.8 : 1 }]} onPress={openCreate}>
            <Feather name="plus" size={16} color="#000" />
            <Text style={s.btnText}>+ TÊNIS</Text>
          </Pressable>
        ) : null}
      </ScrollView>

      <Modal visible={createOpen} transparent animationType="slide" onRequestClose={() => setCreateOpen(false)}>
        <View style={s.modalOverlay}>
          <View style={s.modalSheet}>
            <Text style={[s.title, { marginBottom: 10 }]}>NOVO TÊNIS</Text>

            <Text style={s.label}>APELIDO*</Text>
            <TextInput value={nickname} onChangeText={setNickname} style={s.input} placeholder="Ex: Corre 4" placeholderTextColor={colors.mutedForeground} />

            <Text style={s.label}>MARCA</Text>
            <TextInput value={brand} onChangeText={setBrand} style={s.input} placeholder="Ex: Olympikus" placeholderTextColor={colors.mutedForeground} />

            <Text style={s.label}>MODELO</Text>
            <TextInput value={model} onChangeText={setModel} style={s.input} placeholder="Ex: Corre 4" placeholderTextColor={colors.mutedForeground} />

            <View style={{ flexDirection: "row", gap: 10 }}>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>KM INICIAL</Text>
                <TextInput value={initialKm} onChangeText={setInitialKm} style={s.input} keyboardType="numeric" />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={s.label}>VIDA ÚTIL (KM)</Text>
                <TextInput value={targetKmText} onChangeText={setTargetKmText} style={s.input} keyboardType="numeric" />
              </View>
            </View>

            <View style={s.modalRow}>
              <Pressable onPress={() => setCreateOpen(false)} style={({ pressed }) => [s.modalBtn, { opacity: pressed ? 0.8 : 1, backgroundColor: colors.card }]}>
                <Text style={s.modalBtnText}>CANCELAR</Text>
              </Pressable>
              <Pressable
                onPress={saveShoe}
                disabled={saving}
                style={({ pressed }) => [s.modalBtn, s.modalBtnPrimary, { opacity: pressed ? 0.8 : 1 }]}
              >
                {saving ? <ActivityIndicator color="#000" /> : <Text style={[s.modalBtnText, s.modalBtnTextPrimary]}>SALVAR</Text>}
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

