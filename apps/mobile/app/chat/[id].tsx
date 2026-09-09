import { Ionicons } from "@expo/vector-icons";
import { Image } from "expo-image";
import { Stack, useLocalSearchParams, useRouter } from "expo-router";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AppState, FlatList, KeyboardAvoidingView, Linking, Modal, Platform, Pressable, StyleSheet, Text, TextInput, View } from "react-native";
import Animated, { FadeIn, FadeInUp, FadeOut } from "react-native-reanimated";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import type { Attachment, Conversation, Member, ReplyPreview } from "@mapp/protocol";
import { errorMessage } from "../../src/api";
import { useCall } from "../../src/callStore";
import { activeTypers, conversationLabel, previewOf, useChat, type LocalMessage } from "../../src/chatStore";
import { formatBytes, formatDuration, kindOfMime, pickDocument, pickMedia, takePhoto, uploadFile, type LocalFile } from "../../src/media";
import { MediaViewer, type ViewerItem } from "../../src/MediaViewer";
import { realtime } from "../../src/realtime";
import { useSession } from "../../src/session";
import { fonts, radius, spacing } from "../../src/theme";
import { Avatar, ErrorText, IconButton, InfoText, Loading, Muted, PressableScale, TypingDots, type IconName } from "../../src/ui";
import { useStyles, useTheme, type Theme } from "../../src/useTheme";
import { RecordButton, VoiceNotePlayer } from "../../src/VoiceNote";

const QUICK_REACTIONS = ["👍", "❤️", "😂", "😮", "😢", "🙏"];
const EDIT_WINDOW_MS = 15 * 60 * 1000;

export default function Thread() {
  const params = useLocalSearchParams<{ id: string }>();
  const conversationId = Array.isArray(params.id) ? (params.id[0] ?? "") : (params.id ?? "");
  const router = useRouter();
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const me = useSession((st) => st.user);
  const conversation = useChat((st) => st.conversations[conversationId]);
  const messages = useChat((st) => st.messages[conversationId]);
  const receipts = useChat((st) => st.receipts);
  const presence = useChat((st) => st.presence);
  const typing = useChat((st) => st.typing[conversationId]);
  const connected = useChat((st) => st.connected);
  const loadMessages = useChat((st) => st.loadMessages);
  const loadConversations = useChat((st) => st.loadConversations);
  const addPending = useChat((st) => st.addPending);
  const markFailed = useChat((st) => st.markFailed);
  const markHiddenLocally = useChat((st) => st.markHiddenLocally);
  const clearUnread = useChat((st) => st.clearUnread);
  const markRead = useChat((st) => st.markRead);
  const startCall = useCall((c) => c.startCall);
  const insets = useSafeAreaInsets();
  // Native-stack header: status bar inset plus the platform toolbar height.
  const headerHeight = insets.top + (Platform.OS === "ios" ? 44 : 56);

  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [replyTo, setReplyTo] = useState<ReplyPreview | null>(null);
  const [editing, setEditing] = useState<LocalMessage | null>(null);
  const [actionsFor, setActionsFor] = useState<LocalMessage | null>(null);
  const [attachOpen, setAttachOpen] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const typingSentAt = useRef(0);
  const lastReadId = useRef<string | null>(null);
  const inputRef = useRef<TextInput>(null);
  const [, tick] = useState(0);

  const meId = me?.id ?? "";
  const label = conversation ? conversationLabel(conversation, meId) : null;
  const isGroup = conversation?.type === "group";
  const peer = !isGroup ? conversation?.members.find((m) => m.id !== meId) : undefined;
  const myRole = conversation?.members.find((m) => m.id === meId)?.role ?? "member";
  const membersById = useMemo(() => {
    const map = new Map<string, Member>();
    for (const m of conversation?.members ?? []) map.set(m.id, m);
    return map;
  }, [conversation?.members]);

  useEffect(() => {
    if (!conversationId) return;
    (async () => {
      try {
        if (!conversation) await loadConversations();
        await loadMessages(conversationId);
      } catch (e) {
        setError(errorMessage(e));
      } finally {
        setLoaded(true);
      }
    })();
  }, [conversationId, conversation, loadConversations, loadMessages]);

  // Mark the chat read whenever a new incoming message is on screen. Goes over HTTP so it
  // survives a cold start where the socket is not connected yet; only remembered as done on success.
  const newestIncoming = useMemo(() => {
    if (!messages || !me) return null;
    return [...messages].reverse().find((m) => m.senderId !== me.id && !m.pending && m.contentType !== "system")?.id ?? null;
  }, [messages, me]);
  useEffect(() => {
    if (!loaded) return;
    clearUnread(conversationId);
    if (!newestIncoming || newestIncoming === lastReadId.current) return;
    let cancelled = false;
    markRead(conversationId)
      .then(() => {
        if (!cancelled) lastReadId.current = newestIncoming;
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [newestIncoming, loaded, conversationId, clearUnread, markRead]);

  // Coming back from the background: re-sync in case anything arrived while suspended.
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active" && loaded) {
        lastReadId.current = null;
        void markRead(conversationId).catch(() => undefined);
      }
    });
    return () => sub.remove();
  }, [conversationId, loaded, markRead]);

  // Re-render so stale typing indicators expire.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!notice) return;
    const t = setTimeout(() => setNotice(null), 2500);
    return () => clearTimeout(t);
  }, [notice]);

  const typers = activeTypers(typing).filter((id) => id !== meId);
  const typingNames = typers.map((id) => membersById.get(id)?.displayName.split(" ")[0] ?? "Someone");
  const isTyping = typers.length > 0;
  const subtitle = isTyping
    ? isGroup
      ? `${typingNames.join(", ")} typing`
      : "typing"
    : isGroup
      ? `${conversation?.members.length ?? 0} members`
      : peer && (presence[peer.id] ?? peer.online)
        ? "online"
        : peer
          ? "offline"
          : "";
  const peerOnline = peer ? (presence[peer.id] ?? peer.online) : false;

  const data = useMemo(() => [...(messages ?? [])].reverse(), [messages]);

  function onChangeText(next: string) {
    setText(next);
    const now = Date.now();
    if (next.length > 0 && now - typingSentAt.current > 2500) {
      typingSentAt.current = now;
      realtime.send({ type: "typing", conversationId, isTyping: true });
    }
  }

  function newClientId() {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }

  function send() {
    const body = text.trim();
    if (!me) return;
    if (editing) {
      if (!body) return;
      if (!realtime.send({ type: "message.edit", messageId: editing.id, body })) setError("Not connected.");
      setEditing(null);
      setText("");
      return;
    }
    if (!body) return;
    const clientId = newClientId();
    addPending({ conversationId, clientId, senderId: me.id, body, contentType: "text", replyTo: replyTo ?? undefined });
    setText("");
    setReplyTo(null);
    realtime.send({ type: "typing", conversationId, isTyping: false });
    if (!realtime.send({ type: "message.send", clientId, conversationId, body, contentType: "text", replyToId: replyTo?.id })) {
      markFailed(conversationId, clientId);
      setError("Not connected. The message was not sent.");
    } else {
      setError(null);
    }
  }

  async function sendFile(file: LocalFile, kind: "image" | "video" | "file" | "audio") {
    if (!me) return;
    const clientId = newClientId();
    const caption = kind === "audio" ? "" : text.trim();
    addPending({
      conversationId,
      clientId,
      senderId: me.id,
      body: caption,
      contentType: kind,
      attachment: { mediaId: "local", url: file.uri, mime: file.mime, name: file.name, size: file.size ?? 0, width: file.width, height: file.height, durationMs: file.durationMs },
      replyTo: replyTo ?? undefined,
    });
    if (kind !== "audio") setText("");
    const reply = replyTo;
    setReplyTo(null);
    try {
      const uploaded = await uploadFile(file);
      const { url: _url, ...attachment } = uploaded;
      if (!realtime.send({ type: "message.send", clientId, conversationId, body: caption, contentType: kind, attachment, replyToId: reply?.id })) {
        throw new Error("Not connected. The message was not sent.");
      }
      setError(null);
    } catch (e) {
      markFailed(conversationId, clientId);
      setError(errorMessage(e));
    }
  }

  async function attach(source: "library" | "camera" | "file") {
    setAttachOpen(false);
    try {
      const file = source === "library" ? await pickMedia() : source === "camera" ? await takePhoto() : await pickDocument();
      if (!file) return;
      await sendFile(file, kindOfMime(file.mime));
    } catch (e) {
      setError(errorMessage(e));
    }
  }

  function act(action: "reply" | "edit" | "deleteMe" | "deleteAll", m: LocalMessage) {
    setActionsFor(null);
    switch (action) {
      case "reply":
        setEditing(null);
        setReplyTo({ id: m.id, senderId: m.senderId, body: m.body || previewOf(m), contentType: m.contentType, deleted: m.deleted });
        inputRef.current?.focus();
        return;
      case "edit":
        setReplyTo(null);
        setEditing(m);
        setText(m.body);
        inputRef.current?.focus();
        return;
      case "deleteMe":
        markHiddenLocally(m.id);
        realtime.send({ type: "message.delete", messageId: m.id, scope: "me" });
        return;
      case "deleteAll":
        realtime.send({ type: "message.delete", messageId: m.id, scope: "everyone" });
        return;
    }
  }

  function react(m: LocalMessage, emoji: string) {
    setActionsFor(null);
    const mine = m.reactions.find((r) => r.userId === meId);
    realtime.send({ type: "reaction", messageId: m.id, emoji: mine?.emoji === emoji ? null : emoji });
  }

  function call() {
    if (!conversation || !peer) return;
    void startCall(conversation.id, peer);
  }

  const viewingMessage = viewing ? (messages ?? []).find((m) => m.id === viewing) : undefined;
  const viewerItem: ViewerItem | null =
    viewingMessage?.attachment && !viewingMessage.deleted
      ? {
          attachment: viewingMessage.attachment,
          senderName: viewingMessage.senderId === meId ? "You" : (membersById.get(viewingMessage.senderId)?.displayName ?? "Unknown"),
          sentAt: viewingMessage.createdAt,
          reactions: viewingMessage.reactions,
          caption: viewingMessage.body || undefined,
        }
      : null;

  const header = (
    <Stack.Screen
        options={{
          title: label?.name ?? "",
          headerTitle: () =>
            label ? (
            <Pressable onPress={() => (isGroup ? router.push(`/group/${conversationId}`) : undefined)} style={s.headerRow}>
              <Avatar name={label?.name ?? "?"} size={34} online={peerOnline} uri={label?.avatarUrl} />
              <View style={s.flexShrink}>
                <View style={s.headerNameRow}>
                  <Text style={s.headerTitle} numberOfLines={1}>
                    {label?.name ?? "Chat"}
                  </Text>
                  {peer?.verifiedCountry ? <Ionicons name="shield-checkmark" size={14} color={colors.primary} /> : null}
                </View>
                {subtitle ? (
                  <View style={s.headerSubtitleRow}>
                    <Text style={s.headerSubtitle} numberOfLines={1}>
                      {subtitle}
                    </Text>
                    {isTyping ? <TypingDots /> : null}
                  </View>
                ) : null}
              </View>
            </Pressable>
            ) : (
              <View style={s.headerRow} />
            ),
          headerRight: () =>
            label ? (
            <View style={s.headerActions}>
              {isGroup ? (
                <IconButton icon="people-outline" size={24} onPress={() => router.push(`/group/${conversationId}`)} label="Group info" />
              ) : (
                <IconButton icon="call-outline" size={22} onPress={call} label="Voice call" />
              )}
            </View>
            ) : null,
        }}
      />
  );

  if (!loaded) {
    return (
      <>
        {header}
        <Loading />
      </>
    );
  }

  const canSend = text.trim().length > 0 && connected;
  const showMic = text.trim().length === 0 && !editing;

  return (
    <KeyboardAvoidingView style={s.screen} behavior="padding" keyboardVerticalOffset={headerHeight}>
      {header}
      {notice ? (
        <Animated.View entering={FadeIn} exiting={FadeOut} style={s.notice}>
          <InfoText icon="time-outline">{notice}</InfoText>
        </Animated.View>
      ) : null}
      <View style={s.flex}>
      <FlatList
        inverted
        data={data}
        keyExtractor={(m) => m.id}
        renderItem={({ item, index }) => {
          if (item.contentType === "system") {
            const actor = membersById.get(item.senderId)?.displayName ?? "Someone";
            return (
              <View style={s.systemRow}>
                <Text style={s.systemText}>
                  {item.senderId === meId ? "You" : actor} {item.body}
                </Text>
              </View>
            );
          }
          const mine = item.senderId === meId;
          return (
            <Animated.View entering={FadeInUp.delay(Math.min(index, 6) * 30).springify().damping(24).stiffness(140)}>
              <Bubble
                message={item}
                mine={mine}
                senderName={isGroup && !mine ? (membersById.get(item.senderId)?.displayName ?? "Unknown") : null}
                replySenderName={item.replyTo ? (item.replyTo.senderId === meId ? "You" : (membersById.get(item.replyTo.senderId)?.displayName ?? "Unknown")) : null}
                receipt={receipts[item.id]}
                meId={meId}
                onLongPress={() => (item.deleted || item.pending ? undefined : setActionsFor(item))}
                onPressReaction={(emoji) => react(item, emoji)}
                onOpenMedia={() => (item.pending ? undefined : setViewing(item.id))}
              />
            </Animated.View>
          );
        }}
        contentContainerStyle={s.list}
      />
      {data.length === 0 ? (
        <View style={s.empty} pointerEvents="none">
          <Ionicons name="lock-closed-outline" size={20} color={colors.muted} />
          <Muted>No messages yet. Say hello.</Muted>
        </View>
      ) : null}
      </View>
      <ErrorText>{error}</ErrorText>

      {replyTo || editing ? (
        <View style={s.banner}>
          <Ionicons name={editing ? "pencil" : "arrow-undo"} size={18} color={colors.primary} />
          <View style={s.flex}>
            <Text style={s.bannerTitle}>{editing ? "Editing message" : `Replying to ${replyTo?.senderId === meId ? "yourself" : (membersById.get(replyTo?.senderId ?? "")?.displayName ?? "message")}`}</Text>
            <Text style={s.bannerBody} numberOfLines={1}>
              {editing ? editing.body : replyTo?.body}
            </Text>
          </View>
          <IconButton
            icon="close"
            size={20}
            onPress={() => {
              setReplyTo(null);
              if (editing) setText("");
              setEditing(null);
            }}
            label="Cancel"
          />
        </View>
      ) : null}

      <View style={s.composer}>
        {!editing ? (
          <PressableScale onPress={() => setAttachOpen(true)} scaleTo={0.85} style={s.attachButton} accessibilityLabel="Attach" accessibilityRole="button">
            <Ionicons name="add-circle-outline" size={28} color={colors.primary} />
          </PressableScale>
        ) : null}
        <TextInput
          ref={inputRef}
          style={s.input}
          value={text}
          onChangeText={onChangeText}
          placeholder={connected ? (editing ? "Edit message" : "Message") : "Connecting…"}
          placeholderTextColor={colors.muted}
          multiline
          onSubmitEditing={send}
          blurOnSubmit
        />
        {showMic ? (
          <RecordButton disabled={!connected} onRecorded={(file) => void sendFile(file, "audio")} onError={setError} />
        ) : (
          <PressableScale onPress={send} disabled={!canSend} scaleTo={0.85} style={[s.sendButton, !canSend && s.sendDisabled]} accessibilityLabel={editing ? "Save" : "Send"}>
            <Ionicons name={editing ? "checkmark" : "send"} size={20} color={colors.onPrimary} />
          </PressableScale>
        )}
      </View>

      <MediaViewer item={viewerItem} meId={meId} onClose={() => setViewing(null)} onReact={(emoji) => viewingMessage && react(viewingMessage, emoji)} />

      <Sheet visible={attachOpen} onClose={() => setAttachOpen(false)}>
        <SheetItem icon="images-outline" label="Photo or video" onPress={() => void attach("library")} />
        {Platform.OS !== "web" ? <SheetItem icon="camera-outline" label="Take a photo" onPress={() => void attach("camera")} /> : null}
        <SheetItem icon="document-outline" label="File" onPress={() => void attach("file")} />
      </Sheet>

      <Sheet visible={!!actionsFor} onClose={() => setActionsFor(null)}>
        {actionsFor ? (
          <>
            <View style={s.reactionRow}>
              {QUICK_REACTIONS.map((emoji) => {
                const active = actionsFor.reactions.some((r) => r.userId === meId && r.emoji === emoji);
                return (
                  <PressableScale key={emoji} onPress={() => react(actionsFor, emoji)} scaleTo={0.8} style={[s.reactionPick, active && s.reactionPickActive]}>
                    <Text style={s.reactionPickText}>{emoji}</Text>
                  </PressableScale>
                );
              })}
            </View>
            <SheetItem icon="arrow-undo-outline" label="Reply" onPress={() => act("reply", actionsFor)} />
            {actionsFor.senderId === meId && actionsFor.contentType === "text" && Date.now() - new Date(actionsFor.createdAt).getTime() < EDIT_WINDOW_MS ? (
              <SheetItem icon="pencil-outline" label="Edit" onPress={() => act("edit", actionsFor)} />
            ) : null}
            {actionsFor.attachment && kindOfMime(actionsFor.attachment.mime) !== "audio" ? (
              <SheetItem
                icon="open-outline"
                label={kindOfMime(actionsFor.attachment.mime) === "file" ? "Open file" : "View"}
                onPress={() => {
                  const m = actionsFor;
                  setActionsFor(null);
                  if (kindOfMime(m.attachment!.mime) === "file") void Linking.openURL(m.attachment!.url);
                  else setViewing(m.id);
                }}
              />
            ) : null}
            <SheetItem icon="eye-off-outline" label="Delete for me" onPress={() => act("deleteMe", actionsFor)} />
            {actionsFor.senderId === meId || myRole === "admin" ? <SheetItem icon="trash-outline" label="Delete for everyone" destructive onPress={() => act("deleteAll", actionsFor)} /> : null}
          </>
        ) : null}
      </Sheet>
    </KeyboardAvoidingView>
  );
}

function Bubble({
  message,
  mine,
  senderName,
  replySenderName,
  receipt,
  meId,
  onLongPress,
  onPressReaction,
  onOpenMedia,
}: {
  message: LocalMessage;
  mine: boolean;
  senderName: string | null;
  replySenderName: string | null;
  receipt?: { deliveredAt?: string; readAt?: string };
  meId: string;
  onLongPress: () => void;
  onPressReaction: (emoji: string) => void;
  onOpenMedia: () => void;
}) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const time = new Date(message.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  // Sending: hollow dot. Sent to the server: one tick. Delivered to their device: two ticks. Seen: two blue ticks.
  const status: { icon: IconName; color: string } = message.failed
    ? { icon: "alert-circle", color: colors.danger }
    : message.pending
      ? { icon: "ellipse-outline", color: colors.muted }
      : receipt?.readAt
        ? { icon: "checkmark-done", color: colors.read }
        : receipt?.deliveredAt
          ? { icon: "checkmark-done", color: colors.muted }
          : { icon: "checkmark", color: colors.muted };

  const grouped = new Map<string, { count: number; mine: boolean }>();
  for (const r of message.reactions) {
    const g = grouped.get(r.emoji) ?? { count: 0, mine: false };
    g.count++;
    if (r.userId === meId) g.mine = true;
    grouped.set(r.emoji, g);
  }

  return (
    <View style={[s.bubbleWrap, mine ? s.bubbleWrapMine : s.bubbleWrapTheirs]}>
      <Pressable
        onLongPress={onLongPress}
        delayLongPress={250}
        style={[s.bubble, mine ? s.bubbleMine : s.bubbleTheirs, message.attachment && ["image", "video"].includes(kindOfMime(message.attachment.mime)) && s.bubbleImage]}
      >
        {senderName ? <Text style={s.sender}>{senderName}</Text> : null}
        {message.replyTo ? (
          <View style={s.reply}>
            <Text style={s.replyName}>{replySenderName}</Text>
            <Text style={s.replyBody} numberOfLines={2}>
              {message.replyTo.deleted ? "This message was deleted" : message.replyTo.body || previewOf({ ...message.replyTo, deleted: false })}
            </Text>
          </View>
        ) : null}
        {message.deleted ? (
          <View style={s.tombstone}>
            <Ionicons name="ban-outline" size={14} color={colors.muted} />
            <Text style={s.tombstoneText}>This message was deleted</Text>
          </View>
        ) : null}
        {message.attachment ? <AttachmentView attachment={message.attachment} mine={mine} pending={!!message.pending} onOpen={onOpenMedia} onLongPress={onLongPress} /> : null}
        {message.body && !message.deleted ? <Text style={s.body}>{message.body}</Text> : null}
        <View style={s.meta}>
          {message.editedAt ? <Text style={s.time}>edited</Text> : null}
          <Text style={s.time}>{time}</Text>
          {mine && !message.deleted ? <Ionicons name={status.icon} size={14} color={status.color} /> : null}
        </View>
      </Pressable>
      {grouped.size > 0 ? (
        <View style={[s.reactions, mine ? s.reactionsMine : s.reactionsTheirs]}>
          {[...grouped.entries()].map(([emoji, g]) => (
            <Pressable key={emoji} onPress={() => onPressReaction(emoji)} style={[s.reactionChip, g.mine && s.reactionChipMine]}>
              <Text style={s.reactionText}>
                {emoji}
                {g.count > 1 ? ` ${g.count}` : ""}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

function AttachmentView({ attachment, mine, pending, onOpen, onLongPress }: { attachment: Attachment; mine: boolean; pending: boolean; onOpen: () => void; onLongPress: () => void }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  const kind = kindOfMime(attachment.mime);
  if (kind === "image" || kind === "video") {
    const ratio = attachment.width && attachment.height ? attachment.width / attachment.height : kind === "video" ? 16 / 9 : 4 / 3;
    const width = 240;
    const height = Math.max(120, Math.min(320, width / ratio));
    return (
      <Pressable onPress={onOpen} onLongPress={onLongPress} delayLongPress={250} style={s.imageWrap} accessibilityLabel={kind === "video" ? "Open video" : "Open photo"}>
        {kind === "image" ? (
          <Image source={{ uri: attachment.url }} style={{ width, height, borderRadius: radius.md }} contentFit="cover" transition={150} />
        ) : (
          <View style={[s.videoBox, { width, height }]}>
            <Ionicons name="videocam" size={28} color="rgba(255,255,255,0.7)" />
            <View style={s.playBadge}>
              <Ionicons name="play" size={26} color="#fff" style={{ marginLeft: 3 }} />
            </View>
            {attachment.durationMs ? <Text style={s.videoDuration}>{formatDuration(attachment.durationMs)}</Text> : null}
          </View>
        )}
        {pending ? (
          <View style={s.uploading}>
            <Ionicons name="cloud-upload-outline" size={18} color="#fff" />
            <Text style={s.uploadingText}>Uploading…</Text>
          </View>
        ) : null}
      </Pressable>
    );
  }
  if (attachment.mime.startsWith("audio/")) {
    return <VoiceNotePlayer url={attachment.url} durationMs={attachment.durationMs} tint={mine ? colors.primary : colors.primaryDark} />;
  }
  return (
    <Pressable onPress={() => void Linking.openURL(attachment.url)} style={s.file}>
      <View style={s.fileIcon}>
        <Ionicons name="document-text-outline" size={22} color={colors.primary} />
      </View>
      <View style={s.flexShrink}>
        <Text style={s.fileName} numberOfLines={1}>
          {attachment.name}
        </Text>
        <Text style={s.fileMeta}>{pending ? "Uploading…" : formatBytes(attachment.size)}</Text>
      </View>
    </Pressable>
  );
}

function Sheet({ visible, onClose, children }: { visible: boolean; onClose: () => void; children: ReactNode }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.backdrop} onPress={onClose}>
        <Pressable style={s.sheet} onPress={() => undefined}>
          <View style={[s.grabber, { backgroundColor: colors.border }]} />
          {children}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function SheetItem({ icon, label, onPress, destructive }: { icon: IconName; label: string; onPress: () => void; destructive?: boolean }) {
  const s = useStyles(makeStyles);
  const { colors } = useTheme();
  return (
    <PressableScale onPress={onPress} scaleTo={0.98} style={s.sheetItem}>
      <Ionicons name={icon} size={22} color={destructive ? colors.danger : colors.primary} />
      <Text style={[s.sheetLabel, destructive && { color: colors.danger }]}>{label}</Text>
    </PressableScale>
  );
}

const makeStyles = ({ colors }: Theme) =>
  StyleSheet.create({
    flex: { flex: 1 },
    flexShrink: { flexShrink: 1 },
    screen: { flex: 1, backgroundColor: colors.bg },
    headerRow: { flexDirection: "row", alignItems: "center", gap: spacing.sm, maxWidth: 260 },
    headerNameRow: { flexDirection: "row", alignItems: "center", gap: 4 },
    headerTitle: { fontFamily: fonts.bold, fontSize: 17, color: colors.text, flexShrink: 1 },
    headerSubtitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
    headerSubtitle: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted, flexShrink: 1 },
    headerActions: { flexDirection: "row", alignItems: "center", gap: spacing.xs, marginRight: spacing.sm },
    notice: { paddingHorizontal: spacing.md, paddingTop: spacing.sm },
    list: { padding: spacing.md, gap: 6 },
    empty: { position: "absolute", top: 0, left: 0, right: 0, bottom: 0, alignItems: "center", justifyContent: "center", gap: spacing.xs },
    systemRow: { alignItems: "center", marginVertical: 4 },
    systemText: { fontFamily: fonts.medium, fontSize: 12, color: colors.muted, backgroundColor: colors.cardAlt, paddingHorizontal: spacing.md, paddingVertical: 4, borderRadius: radius.pill, overflow: "hidden" },
    bubbleWrap: { maxWidth: "82%" },
    bubbleWrapMine: { alignSelf: "flex-end", alignItems: "flex-end" },
    bubbleWrapTheirs: { alignSelf: "flex-start", alignItems: "flex-start" },
    bubble: { borderRadius: radius.xl - 2, paddingHorizontal: spacing.md + 2, paddingVertical: spacing.sm + 2, borderWidth: 1, borderColor: colors.border, gap: 4 },
    bubbleImage: { paddingHorizontal: 6, paddingTop: 6 },
    bubbleMine: { backgroundColor: colors.bubbleMine, borderBottomRightRadius: 6 },
    bubbleTheirs: { backgroundColor: colors.bubbleTheirs, borderBottomLeftRadius: 6 },
    sender: { fontFamily: fonts.bold, fontSize: 12, color: colors.primary, marginBottom: 2 },
    reply: { borderLeftWidth: 3, borderLeftColor: colors.primary, backgroundColor: colors.cardAlt, borderRadius: radius.sm, paddingHorizontal: spacing.sm, paddingVertical: 6, marginBottom: 4, gap: 2 },
    replyName: { fontFamily: fonts.bold, fontSize: 12, color: colors.primary },
    replyBody: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    body: { fontFamily: fonts.regular, fontSize: 16, color: colors.text, lineHeight: 22 },
    tombstone: { flexDirection: "row", alignItems: "center", gap: 6 },
    tombstoneText: { fontFamily: fonts.regular, fontSize: 15, color: colors.muted, fontStyle: "italic" },
    meta: { flexDirection: "row", justifyContent: "flex-end", alignItems: "center", gap: 4, marginTop: 2 },
    time: { fontFamily: fonts.regular, fontSize: 11, color: colors.muted },
    reactions: { flexDirection: "row", flexWrap: "wrap", gap: 4, marginTop: 3, paddingHorizontal: 4 },
    reactionsMine: { justifyContent: "flex-end" },
    reactionsTheirs: { justifyContent: "flex-start" },
    reactionChip: { flexDirection: "row", alignItems: "center", backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border, borderRadius: radius.pill, paddingHorizontal: 8, paddingVertical: 2 },
    reactionChipMine: { borderColor: colors.primary, backgroundColor: colors.primarySoft },
    reactionText: { fontFamily: fonts.semibold, fontSize: 12, color: colors.text },
    imageWrap: { position: "relative" },
    videoBox: { borderRadius: radius.md, backgroundColor: "#0f172a", alignItems: "center", justifyContent: "center", overflow: "hidden" },
    playBadge: { position: "absolute", width: 56, height: 56, borderRadius: 28, backgroundColor: "rgba(0,0,0,0.55)", alignItems: "center", justifyContent: "center", borderWidth: 1.5, borderColor: "rgba(255,255,255,0.7)" },
    videoDuration: { position: "absolute", right: 8, bottom: 6, fontFamily: fonts.semibold, fontSize: 11, color: "#fff", backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 6, paddingVertical: 2, borderRadius: 6, overflow: "hidden" },
    uploading: { position: "absolute", bottom: 8, left: 8, flexDirection: "row", alignItems: "center", gap: 6, backgroundColor: "rgba(0,0,0,0.55)", paddingHorizontal: 10, paddingVertical: 4, borderRadius: radius.pill },
    uploadingText: { fontFamily: fonts.medium, color: "#fff", fontSize: 12 },
    file: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minWidth: 180, maxWidth: 260, paddingVertical: 2 },
    fileIcon: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.primarySoft, alignItems: "center", justifyContent: "center" },
    fileName: { fontFamily: fonts.semibold, fontSize: 14, color: colors.text },
    fileMeta: { fontFamily: fonts.regular, fontSize: 12, color: colors.muted },
    banner: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
    bannerTitle: { fontFamily: fonts.bold, fontSize: 12, color: colors.primary },
    bannerBody: { fontFamily: fonts.regular, fontSize: 13, color: colors.muted },
    composer: { flexDirection: "row", alignItems: "center", gap: spacing.sm, paddingHorizontal: spacing.md, paddingVertical: spacing.sm + 2, backgroundColor: colors.card, borderTopWidth: 1, borderTopColor: colors.border },
    attachButton: { width: 44, height: 44, alignItems: "center", justifyContent: "center" },
    input: {
      flex: 1,
      minHeight: 44,
      maxHeight: 120,
      borderWidth: 1.5,
      borderColor: colors.border,
      borderRadius: radius.pill,
      paddingHorizontal: spacing.lg,
      paddingTop: Platform.OS === "ios" ? 12 : 10,
      paddingBottom: Platform.OS === "ios" ? 12 : 10,
      fontFamily: fonts.regular,
      fontSize: 16,
      lineHeight: 20,
      color: colors.text,
      backgroundColor: colors.bg,
      textAlignVertical: "center",
    },
    sendButton: { width: 44, height: 44, borderRadius: 22, backgroundColor: colors.primary, alignItems: "center", justifyContent: "center" },
    sendDisabled: { backgroundColor: colors.border },
    backdrop: { flex: 1, backgroundColor: "rgba(0,0,0,0.45)", justifyContent: "flex-end" },
    sheet: { backgroundColor: colors.card, borderTopLeftRadius: radius.xl, borderTopRightRadius: radius.xl, padding: spacing.lg, paddingBottom: spacing.xl, gap: 4 },
    grabber: { alignSelf: "center", width: 40, height: 4, borderRadius: 2, marginBottom: spacing.sm },
    sheetItem: { flexDirection: "row", alignItems: "center", gap: spacing.md, paddingVertical: spacing.md, paddingHorizontal: spacing.sm, borderRadius: radius.md },
    sheetLabel: { fontFamily: fonts.semibold, fontSize: 16, color: colors.text },
    reactionRow: { flexDirection: "row", justifyContent: "space-between", paddingHorizontal: spacing.sm, paddingBottom: spacing.sm },
    reactionPick: { width: 44, height: 44, borderRadius: 22, alignItems: "center", justifyContent: "center", backgroundColor: colors.cardAlt },
    reactionPickActive: { backgroundColor: colors.primarySoft, borderWidth: 1, borderColor: colors.primary },
    reactionPickText: { fontSize: 22 },
  });
