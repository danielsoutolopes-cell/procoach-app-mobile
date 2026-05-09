import React from "react";
import {
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { Feather } from "@expo/vector-icons";

import { useColors } from "@/hooks/useColors";
import type { Shoe } from "@/services/api";

export function normalizeShoe(s: Shoe): Required<Pick<Shoe, "id" | "nickname">> & Shoe {
  return {
    ...s,
    id: Number((s as any).id),
    nickname: String((s as any).nickname ?? ""),
  };
}

export function isActiveShoe(s: Shoe): boolean {
  return !((s as any).retiredAt ?? (s as any).retired_at);
}

export default function ShoePickerModal(props: {
  visible: boolean;
  title: string;
  subtitle?: string;
  shoes: Shoe[];
  onSelectShoe: (shoe: Shoe) => void;
  onClose?: () => void;
  primaryActionLabel?: string;
  onPrimaryAction?: () => void;
}) {
  const colors = useColors();
  const s = StyleSheet.create({
    overlay: {
      flex: 1,
      backgroundColor: "rgba(0,0,0,0.65)",
      padding: 18,
      justifyContent: "flex-end",
    },
    sheet: {
      backgroundColor: colors.card,
      borderRadius: 16,
      borderWidth: 1,
      borderColor: colors.border,
      overflow: "hidden",
    },
    header: {
      padding: 16,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
    },
    title: {
      fontSize: 12,
      fontWeight: "800" as const,
      letterSpacing: 2,
      color: colors.foreground,
    },
    subtitle: {
      marginTop: 6,
      fontSize: 11,
      color: colors.mutedForeground,
      lineHeight: 16,
    },
    list: { maxHeight: 320 },
    item: {
      paddingHorizontal: 16,
      paddingVertical: 14,
      borderBottomWidth: 1,
      borderBottomColor: colors.border,
      flexDirection: "row",
      alignItems: "center",
      justifyContent: "space-between",
    },
    itemTitle: { fontSize: 13, fontWeight: "800" as const, color: colors.foreground },
    itemSub: { fontSize: 10, color: colors.mutedForeground, marginTop: 2, letterSpacing: 0.5 },
    footer: { padding: 12, flexDirection: "row", gap: 10 },
    btn: {
      flex: 1,
      paddingVertical: 10,
      borderRadius: 10,
      alignItems: "center",
      justifyContent: "center",
      borderWidth: 1,
      borderColor: colors.border,
      backgroundColor: colors.secondary,
    },
    btnPrimary: {
      backgroundColor: colors.primary,
      borderColor: colors.primary,
    },
    btnText: { fontSize: 10, fontWeight: "900" as const, letterSpacing: 2, color: colors.foreground },
    btnTextPrimary: { color: "#000" },
  });

  const activeShoes = props.shoes.filter(isActiveShoe);

  return (
    <Modal visible={props.visible} transparent animationType="slide" onRequestClose={props.onClose}>
      <View style={s.overlay}>
        <View style={s.sheet}>
          <View style={s.header}>
            <Text style={s.title}>{props.title}</Text>
            {props.subtitle ? <Text style={s.subtitle}>{props.subtitle}</Text> : null}
          </View>

          <ScrollView style={s.list}>
            {activeShoes.length === 0 ? (
              <View style={{ padding: 16 }}>
                <Text style={s.subtitle}>
                  Nenhum tênis ativo cadastrado. Crie um tênis primeiro para conseguir concluir corridas.
                </Text>
              </View>
            ) : (
              activeShoes.map((raw) => {
                const shoe = normalizeShoe(raw);
                const brand = (shoe as any).brand ?? null;
                const model = (shoe as any).model ?? null;
                const sub = [brand, model].filter(Boolean).join(" · ");
                return (
                  <Pressable key={String(shoe.id)} onPress={() => props.onSelectShoe(shoe)} style={({ pressed }) => [{ opacity: pressed ? 0.7 : 1 }]}>
                    <View style={s.item}>
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={s.itemTitle}>{shoe.nickname}</Text>
                        {sub ? <Text style={s.itemSub}>{sub}</Text> : null}
                      </View>
                      <Feather name="chevron-right" size={16} color={colors.mutedForeground} />
                    </View>
                  </Pressable>
                );
              })
            )}
          </ScrollView>

          <View style={s.footer}>
            <Pressable onPress={props.onClose} style={({ pressed }) => [s.btn, { opacity: pressed ? 0.7 : 1, backgroundColor: colors.card }]}>
              <Text style={s.btnText}>CANCELAR</Text>
            </Pressable>
            {props.primaryActionLabel && props.onPrimaryAction ? (
              <Pressable
                onPress={props.onPrimaryAction}
                style={({ pressed }) => [s.btn, s.btnPrimary, { opacity: pressed ? 0.7 : 1 }]}
              >
                <Text style={[s.btnText, s.btnTextPrimary]}>{props.primaryActionLabel}</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}

