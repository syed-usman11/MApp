import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { useVideoPlayer, VideoView } from "expo-video";
import { useEffect, useState } from "react";
import { ActivityIndicator, Modal, Platform, Pressable, StyleSheet, Text, useWindowDimensions, View } from "react-native";
import Animated, { FadeIn, FadeInUp } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Attachment, Reaction } from "@mapp/protocol";
import { formatBytes, kindOfMime, saveToDevice } from "./media";
import { fonts, radius, spacing } from "./theme";
import { PressableScale } from "./ui";
import { useStyles, type Theme } from "./useTheme";

export const VIEWER_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];

export interface ViewerItem {
  attachment: Attachment;
  senderName: string;
  sentAt: string;
  reactions: Reaction[];
  caption?: string;
}

/**
 * Full-screen photo/video viewer: close button, save to device, and the
 * quick-reaction row so people can react without leaving the media.
 */
export function MediaViewer({ item, meId, onClose, onReact }: { item: ViewerItem | null; meId: string; onClose: () => void; onReact: (emoji: string) => void }) {
  const s = useStyles(makeStyles);
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [showUi, setShowUi] = useState(true);

  useEffect(() => {
    setNotice(null);
    setSaving(false);
    setShowUi(true);
  }, [item?.attachment.mediaId]);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2200);
    return () => clearTimeout(t);
  }, [notice]);

  async function save() {
    if (!item || saving) return;
    setSaving(true);
    try {
      await saveToDevice(item.attachment);
      setNotice(Platform.OS === "web" ? "Download started" : "Saved to your gallery");
    } catch (e) {
      setNotice(e instanceof Error ? e.message : "Could not save");
    } finally {
      setSaving(false);
    }
  }

  if (!item) return null;
  const { attachment } = item;
  const kind = kindOfMime(attachment.mime);
  const grouped = new Map<string, { count: number; mine: boolean }>();
  for (const r of item.reactions) {
    const g = grouped.get(r.emoji) ?? { count: 0, mine: false };
    g.count++;
    if (r.userId === meId) g.mine = true;
    grouped.set(r.emoji, g);
  }
  const when = new Date(item.sentAt).toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });

  return (
    <Modal visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={s.screen}>
        <Pressable style={s.stage} onPress={() => setShowUi((v) => !v)}>
          {kind === "video" ? (
            <VideoStage url={attachment.url} width={width} height={height} />
          ) : (
            <Image source={{ uri: attachment.url }} style={{ width, height }} contentFit="contain" transition={120} />
          )}
        </Pressable>

        {showUi ? (
          <>
            <Animated.View entering={FadeIn} style={[s.top, { paddingTop: insets.top + spacing.sm }]}>
              <PressableScale onPress={onClose} scaleTo={0.85} style={s.roundButton} accessibilityLabel="Close" accessibilityRole="button">
                <Ionicons name="close" size={26} color="#fff" />
              </PressableScale>
              <View style={s.meta}>
                <Text style={s.sender} numberOfLines={1}>
                  {item.senderName}
                </Text>
                <Text style={s.when}>
                  {when} · {formatBytes(attachment.size)}
                </Text>
              </View>
              <PressableScale onPress={() => void save()} scaleTo={0.85} style={s.roundButton} accessibilityLabel="Save to device" accessibilityRole="button" disabled={saving}>
                {saving ? <ActivityIndicator color="#fff" /> : <Ionicons name="download-outline" size={24} color="#fff" />}
              </PressableScale>
            </Animated.View>

            <Animated.View entering={FadeInUp} style={[s.bottom, { paddingBottom: insets.bottom + spacing.md }]}>
              {notice ? <Text style={s.notice}>{notice}</Text> : null}
              {item.caption ? (
                <Text style={s.caption} numberOfLines={3}>
                  {item.caption}
                </Text>
              ) : null}
              {grouped.size > 0 ? (
                <View style={s.reactionSummary}>
                  {[...grouped.entries()].map(([emoji, g]) => (
                    <View key={emoji} style={[s.summaryChip, g.mine && s.summaryChipMine]}>
                      <Text style={s.summaryText}>
                        {emoji}
                        {g.count > 1 ? ` ${g.count}` : ""}
                      </Text>
                    </View>
                  ))}
                </View>
              ) : null}
              <View style={s.reactionRow}>
                {VIEWER_REACTIONS.map((emoji) => {
                  const active = item.reactions.some((r) => r.userId === meId && r.emoji === emoji);
                  return (
                    <PressableScale key={emoji} onPress={() => onReact(emoji)} scaleTo={0.8} style={[s.reactionPick, active && s.reactionPickActive]} accessibilityLabel={`React ${emoji}`}>
                      <Text style={s.reactionText}>{emoji}</Text>
                    </PressableScale>
                  );
                })}
              </View>
            </Animated.View>
          </>
        ) : null}
      </View>
    </Modal>
  );
}

function VideoStage({ url, width, height }: { url: string; width: number; height: number }) {
  const player = useVideoPlayer({ uri: url }, (p) => {
    p.loop = false;
    p.play();
  });
  return <VideoView player={player} style={{ width, height }} contentFit="contain" nativeControls allowsPictureInPicture={false} />;
}

const makeStyles = (_: Theme) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: "#000" },
    stage: { flex: 1, alignItems: "center", justifyContent: "center" },
    top: { position: "absolute", top: 0, left: 0, right: 0, flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingBottom: spacing.md, backgroundColor: "rgba(0,0,0,0.45)" },
    roundButton: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.14)" },
    meta: { flex: 1 },
    sender: { fontFamily: fonts.bold, fontSize: 15, color: "#fff" },
    when: { fontFamily: fonts.regular, fontSize: 12, color: "rgba(255,255,255,0.75)" },
    bottom: { position: "absolute", left: 0, right: 0, bottom: 0, paddingHorizontal: spacing.md, paddingTop: spacing.md, gap: spacing.sm, backgroundColor: "rgba(0,0,0,0.45)" },
    notice: { fontFamily: fonts.semibold, fontSize: 13, color: "#fff", textAlign: "center" },
    caption: { fontFamily: fonts.regular, fontSize: 15, color: "#fff", lineHeight: 21 },
    reactionSummary: { flexDirection: "row", flexWrap: "wrap", gap: 6 },
    summaryChip: { backgroundColor: "rgba(255,255,255,0.14)", borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 3 },
    summaryChipMine: { backgroundColor: "rgba(46,209,138,0.35)" },
    summaryText: { fontFamily: fonts.semibold, fontSize: 12, color: "#fff" },
    reactionRow: { flexDirection: "row", justifyContent: "space-between" },
    reactionPick: { width: 46, height: 46, borderRadius: 23, alignItems: "center", justifyContent: "center", backgroundColor: "rgba(255,255,255,0.12)" },
    reactionPickActive: { backgroundColor: "rgba(46,209,138,0.45)" },
    reactionText: { fontSize: 24 },
  });
