import { Feather } from "@expo/vector-icons";
import * as WebBrowser from "expo-web-browser";
import React, { useCallback, useEffect, useRef, useState } from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useRouter } from "expo-router";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  View,
} from "react-native";

import { useColors } from "@/hooks/useColors";
import { ProCoachAPI, type Shoe } from "@/services/api";
import ShoePickerModal, { isActiveShoe } from "@/components/ShoePickerModal";

interface StravaStatus {
  connected: boolean;
  lastSyncAt: string | null;
  configured?: boolean;
}

interface Props {
  onSyncComplete?: () => void;
}

function getSaoPauloDayKey(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "America/Sao_Paulo" });
}

export function StravaCard({ onSyncComplete }: Props) {
  const colors = useColors();
  const router = useRouter();
  const [status, setStatus] = useState<StravaStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const appStateRef = useRef(AppState.currentState);

  const [shoes, setShoes] = useState<Shoe[]>([]);
  const [pendingShoe, setPendingShoe] = useState<any[]>([]);
  const [pendingIdx, setPendingIdx] = useState(0);
  const [shoeModalOpen, setShoeModalOpen] = useState(false);

  const fetchStatus = useCallback(async () => {
    try {
      const s = await ProCoachAPI.stravaStatus();
      setStatus(s);
    } catch {}
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (appStateRef.current.match(/inactive|background/) && next === "active") {
        if (connecting) {
          setConnecting(false);
          fetchStatus();
        }
      }
      appStateRef.current = next;
    });
    return () => sub.remove();
  }, [connecting, fetchStatus]);

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    try {
      const url = await ProCoachAPI.stravaConnectUrl();
      if (Platform.OS === "web") {
        window.open(url, "_blank", "width=600,height=700");
        let attempts = 0;
        const poll = setInterval(async () => {
          attempts++;
          const s = await ProCoachAPI.stravaStatus().catch(() => null);
          if (s?.connected || attempts > 30) {
            clearInterval(poll);
            setConnecting(false);
            if (s) setStatus(s);
          }
        }, 2000);
      } else {
        await WebBrowser.openBrowserAsync(url);
        let attempts = 0;
        while (attempts < 12) {
          attempts++;
          const s = await ProCoachAPI.stravaStatus().catch(() => null);
          if (s) setStatus(s);
          if (s?.connected) break;
          await new Promise((r) => setTimeout(r, 2000));
        }
        setConnecting(false);
      }
    } catch (e: any) {
      setConnecting(false);
      if (Platform.OS !== "web") {
        Alert.alert("Strava", e?.message ?? "Falha ao abrir conexão com o Strava.");
      }
    }
  }, [fetchStatus]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (loading) return;
      if (!status) return;
      if (status.connected) return;
      if (status.configured === false) return;
      const key = `@procoach_strava_autoconnect_${getSaoPauloDayKey()}`;
      const already = await AsyncStorage.getItem(key).catch(() => null);
      if (already) return;
      await AsyncStorage.setItem(key, "1").catch(() => {});
      if (!cancelled) {
        await handleConnect();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [loading, status, handleConnect]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const result = await ProCoachAPI.stravaSync();
      await fetchStatus();
      onSyncComplete?.();
      const pending = Array.isArray((result as any).pendingShoe) ? (result as any).pendingShoe : [];
      if (pending.length > 0) {
        const r = await ProCoachAPI.getShoes().catch(() => ({ shoes: [] as Shoe[] }));
        setShoes(Array.isArray(r.shoes) ? r.shoes : []);
        setPendingShoe(pending);
        setPendingIdx(0);
        setShoeModalOpen(true);
      } else if (Platform.OS !== "web") {
        Alert.alert(
          "Sincronização Completa",
          result.imported > 0
            ? `${result.imported} treino${result.imported !== 1 ? "s" : ""} importado${result.imported !== 1 ? "s" : ""} do Strava.`
            : "Nenhum treino novo encontrado.",
          [{ text: "OK" }]
        );
      }
    } catch (e: any) {
      if (Platform.OS !== "web") {
        Alert.alert("Erro", e?.message ?? "Falha ao sincronizar");
      }
    }
    setSyncing(false);
  }, [fetchStatus, onSyncComplete]);

  const activeShoes = shoes.filter(isActiveShoe);
  const currentPending = pendingShoe[pendingIdx];
  const pendingTitle = currentPending
    ? `SELECIONE O TÊNIS (${pendingIdx + 1}/${pendingShoe.length})`
    : "SELECIONE O TÊNIS";
  const pendingSubtitle = currentPending
    ? `Treino novo do Strava: ${currentPending.entry_date ?? currentPending.entryDate ?? "—"} · ${currentPending.distance_km ?? currentPending.distanceKm ?? "—"}km`
    : undefined;

  const closePending = () => {
    setShoeModalOpen(false);
    setPendingShoe([]);
    setPendingIdx(0);
  };

  const handleSelectShoe = async (shoe: Shoe) => {
    if (!currentPending) return;
    const workoutId = Number(currentPending.id);
    if (!Number.isFinite(workoutId)) return;
    try {
      await ProCoachAPI.setWorkoutShoe(workoutId, Number((shoe as any).id));
      const next = pendingIdx + 1;
      if (next >= pendingShoe.length) {
        closePending();
        await fetchStatus();
        onSyncComplete?.();
      } else {
        setPendingIdx(next);
      }
    } catch (e: any) {
      Alert.alert("Tênis", e?.message ?? "Falha ao salvar o tênis.");
    }
  };

  const handleDisconnect = useCallback(async () => {
    const confirmed = Platform.OS === "web"
      ? window.confirm("Desconectar o Strava?")
      : await new Promise<boolean>((resolve) =>
          Alert.alert("Desconectar Strava", "Tem certeza?", [
            { text: "Cancelar", onPress: () => resolve(false) },
            { text: "Desconectar", style: "destructive", onPress: () => resolve(true) },
          ])
        );
    if (!confirmed) return;
    await ProCoachAPI.stravaDisconnect().catch(() => {});
    setStatus({ connected: false, lastSyncAt: null });
  }, []);

  const s = StyleSheet.create({
    card: {
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: colors.border,
      padding: 16,
      marginBottom: 16,
    },
    header: {
      flexDirection: "row",
      alignItems: "center",
      gap: 10,
      marginBottom: 12,
    },
    stravaLogo: {
      width: 32,
      height: 32,
      borderRadius: 8,
      backgroundColor: "#FC4C02",
      alignItems: "center",
      justifyContent: "center",
    },
    titleBlock: { flex: 1 },
    title: {
      fontSize: 13,
      fontWeight: "800" as const,
      color: colors.foreground,
      letterSpacing: 0.5,
    },
    subtitle: {
      fontSize: 10,
      color: colors.mutedForeground,
      letterSpacing: 1,
      marginTop: 1,
    },
    badge: {
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: 6,
    },
    badgeText: {
      fontSize: 8,
      fontWeight: "800" as const,
      letterSpacing: 1.5,
    },
    row: {
      flexDirection: "row",
      gap: 8,
    },
    btn: {
      flex: 1,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "center",
      gap: 6,
      paddingVertical: 10,
      borderRadius: 8,
    },
    btnText: {
      fontSize: 10,
      fontWeight: "800" as const,
      letterSpacing: 1.5,
    },
    syncInfo: {
      fontSize: 9,
      color: colors.mutedForeground,
      letterSpacing: 1,
      marginTop: 8,
      textAlign: "center" as const,
    },
  });

  if (loading) {
    return (
      <View style={[s.card, { alignItems: "center", paddingVertical: 24 }]}>
        <ActivityIndicator color={colors.primary} />
      </View>
    );
  }

  return (
    <View style={s.card}>
      <ShoePickerModal
        visible={shoeModalOpen}
        title={pendingTitle}
        subtitle={pendingSubtitle}
        shoes={shoes}
        onSelectShoe={handleSelectShoe}
        onClose={() => {
          // fluxo é obrigatório: só permite fechar se não houver pendências ou se não houver tênis cadastrado
          if (pendingShoe.length > 0 && activeShoes.length > 0) return;
          closePending();
        }}
        primaryActionLabel={activeShoes.length === 0 ? "IR PARA TÊNIS" : undefined}
        onPrimaryAction={
          activeShoes.length === 0
            ? () => {
                closePending();
                router.push("/(tabs)/equipamentos");
              }
            : undefined
        }
      />
      <View style={s.header}>
        <View style={s.stravaLogo}>
          <Text style={{ fontSize: 16 }}>🏃</Text>
        </View>
        <View style={s.titleBlock}>
          <Text style={s.title}>STRAVA</Text>
          <Text style={s.subtitle}>
            {status?.connected
              ? "CONECTADO AO STRAVA"
              : "IMPORTAR TREINOS REAIS"}
          </Text>
        </View>
        <View
          style={[
            s.badge,
            {
              backgroundColor: status?.connected
                ? "#4CAF5022"
                : colors.secondary,
            },
          ]}
        >
          <Text
            style={[
              s.badgeText,
              { color: status?.connected ? "#4CAF50" : colors.mutedForeground },
            ]}
          >
            {status?.connected ? "CONECTADO" : "DESCONECTADO"}
          </Text>
        </View>
      </View>

      {status?.connected ? (
        <>
          <View style={s.row}>
            <Pressable
              style={[s.btn, { backgroundColor: "#FC4C0222", flex: 2 }]}
              onPress={handleSync}
              disabled={syncing}
            >
              {syncing ? (
                <ActivityIndicator color="#FC4C02" size="small" />
              ) : (
                <Feather name="refresh-cw" size={12} color="#FC4C02" />
              )}
              <Text style={[s.btnText, { color: "#FC4C02" }]}>
                {syncing ? "SINCRONIZANDO..." : "SINCRONIZAR"}
              </Text>
            </Pressable>
            <Pressable
              style={[s.btn, { backgroundColor: colors.secondary, flex: 1 }]}
              onPress={handleDisconnect}
            >
              <Feather name="link-2" size={12} color={colors.mutedForeground} />
              <Text style={[s.btnText, { color: colors.mutedForeground }]}>
                DESCONECTAR
              </Text>
            </Pressable>
          </View>
          {status.lastSyncAt && (
            <Text style={s.syncInfo}>
              Última sync:{" "}
              {new Date(status.lastSyncAt).toLocaleDateString("pt-BR", {
                day: "2-digit",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              })}
            </Text>
          )}
        </>
      ) : (
        <Pressable
          style={[
            s.btn,
            { backgroundColor: "#FC4C02", opacity: connecting ? 0.7 : 1 },
          ]}
          onPress={handleConnect}
          disabled={connecting}
        >
          {connecting ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Feather name="zap" size={13} color="#fff" />
          )}
          <Text style={[s.btnText, { color: "#fff" }]}>
            {connecting ? "AGUARDANDO AUTORIZAÇÃO..." : "CONECTAR COM STRAVA"}
          </Text>
        </Pressable>
      )}
    </View>
  );
}
