import { Feather } from "@expo/vector-icons";
import React, { useEffect, useState, useCallback } from "react";
import {
  ActivityIndicator,
  Image,
  Linking,
  Platform,
  Pressable,
  Text,
  View,
} from "react-native";
import { useColors } from "@/hooks/useColors";
import { ProCoachAPI, SpotifyPlaylist } from "@/services/api";

interface Props {
  workoutType: string;
}

const SPOTIFY_GREEN = "#1DB954";

export function SpotifyPlaylistCard({ workoutType }: Props) {
  const colors = useColors();
  const [playlist, setPlaylist] = useState<SpotifyPlaylist | null>(null);
  const [workoutLabel, setWorkoutLabel] = useState<string>("");
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(false);

  const fetchPlaylist = useCallback(async () => {
    setLoading(true);
    setError(false);
    try {
      const result = await ProCoachAPI.getSpotifyPlaylist(workoutType);
      setPlaylist(result.playlist);
      setWorkoutLabel(result.workoutLabel);
    } catch {
      setError(true);
    } finally {
      setLoading(false);
    }
  }, [workoutType]);

  useEffect(() => {
    fetchPlaylist();
  }, [fetchPlaylist]);

  const handleOpen = async () => {
    if (!playlist) return;
    // Try Spotify deep link first, then HTTPS fallback
    const uri = playlist.spotifyUri;
    const canOpen = await Linking.canOpenURL(uri);
    if (canOpen) {
      await Linking.openURL(uri);
    } else {
      await Linking.openURL(playlist.spotifyUrl);
    }
  };

  // Silent no-op on error — don't pollute the UI
  if (error) return null;

  return (
    <View style={{
      backgroundColor: colors.card,
      borderRadius: colors.radius,
      borderWidth: 1,
      borderColor: SPOTIFY_GREEN + "33",
      overflow: "hidden",
      marginTop: 12,
    }}>
      {/* Header */}
      <View style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 6,
        paddingHorizontal: 14,
        paddingTop: 12,
        paddingBottom: 8,
        borderBottomWidth: 1,
        borderBottomColor: colors.border,
      }}>
        {/* Spotify logo text */}
        <View style={{
          backgroundColor: SPOTIFY_GREEN + "22",
          borderRadius: 4,
          paddingHorizontal: 6,
          paddingVertical: 2,
        }}>
          <Text style={{ fontSize: 9, fontWeight: "800" as const, color: SPOTIFY_GREEN, letterSpacing: 1 }}>
            ♫ SPOTIFY
          </Text>
        </View>
        <Text style={{ fontSize: 9, letterSpacing: 2, color: colors.mutedForeground, fontWeight: "700" as const, flex: 1 }}>
          PLAYLIST PARA {workoutLabel.toUpperCase()}
        </Text>
        <Pressable onPress={fetchPlaylist} hitSlop={8}>
          <Feather name="refresh-cw" size={12} color={colors.mutedForeground} />
        </Pressable>
      </View>

      {/* Body */}
      {loading ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 12, padding: 14 }}>
          <View style={{ width: 56, height: 56, borderRadius: 8, backgroundColor: colors.secondary }} />
          <View style={{ gap: 6, flex: 1 }}>
            <View style={{ height: 12, backgroundColor: colors.secondary, borderRadius: 4, width: "70%" }} />
            <View style={{ height: 10, backgroundColor: colors.secondary, borderRadius: 4, width: "45%" }} />
          </View>
          <ActivityIndicator size="small" color={SPOTIFY_GREEN} />
        </View>
      ) : playlist ? (
        <Pressable
          onPress={handleOpen}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: 12,
            padding: 14,
            opacity: pressed ? 0.75 : 1,
          })}
        >
          {/* Album art */}
          {playlist.imageUrl ? (
            <Image
              source={{ uri: playlist.imageUrl }}
              style={{ width: 56, height: 56, borderRadius: 8 }}
              resizeMode="cover"
            />
          ) : (
            <View style={{
              width: 56, height: 56, borderRadius: 8,
              backgroundColor: SPOTIFY_GREEN + "22",
              alignItems: "center", justifyContent: "center",
            }}>
              <Feather name="music" size={22} color={SPOTIFY_GREEN} />
            </View>
          )}

          {/* Info */}
          <View style={{ flex: 1, gap: 3 }}>
            <Text
              style={{ fontSize: 13, fontWeight: "700" as const, color: colors.foreground, lineHeight: 17 }}
              numberOfLines={2}
            >
              {playlist.name}
            </Text>
            <Text style={{ fontSize: 10, color: colors.mutedForeground }}>
              {playlist.tracksTotal > 0 ? `${playlist.tracksTotal} músicas · ` : ""}
              {playlist.owner ?? ""}
            </Text>
            {playlist.description ? (
              <Text
                style={{ fontSize: 10, color: colors.mutedForeground + "88", lineHeight: 14, marginTop: 2 }}
                numberOfLines={1}
              >
                {playlist.description}
              </Text>
            ) : null}
          </View>

          {/* CTA */}
          <View style={{
            backgroundColor: SPOTIFY_GREEN,
            borderRadius: 20,
            paddingHorizontal: 12,
            paddingVertical: 7,
            alignItems: "center",
            gap: 3,
          }}>
            <Feather name="play" size={13} color="#000" />
            <Text style={{ fontSize: 8, fontWeight: "800" as const, color: "#000", letterSpacing: 0.5 }}>
              ABRIR
            </Text>
          </View>
        </Pressable>
      ) : null}
    </View>
  );
}
