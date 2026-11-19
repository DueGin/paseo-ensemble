// The delegation cards in a lead's chat (see shared/cards.ts): "Handed off to agent" when a member is given work, and
// "Update from worker" when its turn ends with a result, as Orca shows a native handoff. Pressing a card opens the
// member's agent; its arrow opens the session dashboard.
import type { PluginClientContext, PluginTimelineItemProps } from "@getpaseo/plugin/client";
import { useTranslation } from "@getpaseo/plugin/client";
import { Icon } from "@getpaseo/plugin/client/ui";
import { useState } from "react";
import { Pressable, Text, View } from "react-native";
import { HANDOFF_CARD, HandoffCardSchema, UPDATE_CARD, UpdateCardSchema, type HandoffCard, type UpdateCard } from "../shared/cards";
import { providerIcon } from "../shared/provider-icons";
import { withAlpha } from "../shared/color";
import { messages } from "./i18n";
import { useKit, type Kit } from "./kit";
import { SESSION_PANEL } from "./session-access";

const clock = (iso: string) => {
  const at = new Date(iso);
  return Number.isNaN(at.getTime()) ? "" : `${String(at.getHours()).padStart(2, "0")}:${String(at.getMinutes()).padStart(2, "0")}`;
};

function ProviderMark({ k, provider }: { k: Kit; provider: string }) {
  const icon = providerIcon(provider);
  return (
    <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: k.c.muted, alignItems: "center", justifyContent: "center" }}>
      {icon.kind === "svg" ? <Icon icon={{ svg: icon.svg }} size={13} color={k.c.fg} /> : <Text style={{ color: k.c.fg, fontWeight: "700", fontSize: 11 }}>{icon.letter}</Text>}
    </View>
  );
}

/** The card's frame: a mark, a quiet verb, the member in bold, an arrow and the time; tap to expand. */
function CardFrame({ k, mark, verb, title, at, tone, onOpen, onDashboard, children }: { k: Kit; mark: React.ReactNode; verb: string; title: string; at: string; tone?: string; onOpen?: () => void; onDashboard?: () => void; children?: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  return (
    <View style={{ borderWidth: 1, borderColor: k.c.border, borderRadius: 12, backgroundColor: k.c.card, overflow: "hidden", marginVertical: 2 }}>
      <Pressable accessibilityRole="button" accessibilityLabel={`${verb} ${title}`} onPress={() => setOpen((value) => !value)} style={{ flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 12, paddingVertical: 10 }}>
        {mark}
        <Text style={{ color: k.c.mutedFg, fontSize: 13 }} numberOfLines={1}>
          {verb}
        </Text>
        <Pressable accessibilityRole="link" accessibilityLabel={title} onPress={onOpen} disabled={!onOpen} style={{ flexDirection: "row", alignItems: "center", gap: 4, flexShrink: 1 }}>
          <Text style={{ color: tone ?? k.c.fg, fontSize: 13, fontWeight: "700", flexShrink: 1 }} numberOfLines={1}>
            {title}
          </Text>
          {onOpen ? <Icon name="ArrowUpRight" size={13} color={k.c.mutedFg} /> : null}
        </Pressable>
        <View style={{ flex: 1 }} />
        <Text style={{ color: k.c.mutedFg, fontSize: 12 }}>{clock(at)}</Text>
        {onDashboard ? (
          <Pressable accessibilityRole="button" onPress={onDashboard} hitSlop={6}>
            <Icon name="Network" size={14} color={k.c.mutedFg} />
          </Pressable>
        ) : null}
        <Icon name={open ? "ChevronUp" : "ChevronDown"} size={14} color={k.c.mutedFg} />
      </Pressable>
      {open && children ? <View style={{ paddingHorizontal: 12, paddingBottom: 12, gap: 6, borderTopWidth: 1, borderTopColor: k.c.border, paddingTop: 10 }}>{children}</View> : null}
    </View>
  );
}

function makeCards(client: PluginClientContext) {
  function HandoffView({ theme, layout, item, navigation }: PluginTimelineItemProps<HandoffCard> & { navigation?: { openAgent(input: { agentId: string }): void } }) {
    const k = useKit(theme, layout.compact);
    const { t } = useTranslation(messages);
    const card = item.data;
    return (
      <CardFrame
        k={k}
        mark={<ProviderMark k={k} provider={card.provider} />}
        verb={card.continued ? t("cards.continued") : t("cards.handoff")}
        title={card.title}
        at={card.at}
        onOpen={navigation ? () => navigation.openAgent({ agentId: card.agentId }) : undefined}
        onDashboard={card.workspaceId ? () => client.openPanel(SESSION_PANEL, { workspaceId: card.workspaceId!, agentId: card.agentId, location: "explorer" }) : undefined}
      >
        <Text style={{ color: k.c.mutedFg, fontSize: 12 }}>
          {card.role} · {card.provider}/{card.model}
        </Text>
        <Text style={{ color: k.c.fg, fontSize: 13, lineHeight: 19 }} selectable>
          {card.task}
        </Text>
      </CardFrame>
    );
  }

  function UpdateView({ theme, layout, item, navigation }: PluginTimelineItemProps<UpdateCard> & { navigation?: { openAgent(input: { agentId: string }): void } }) {
    const k = useKit(theme, layout.compact);
    const { t } = useTranslation(messages);
    const card = item.data;
    const tone = card.outcome === "failed" ? k.c.bad : card.outcome === "canceled" ? k.c.warn : undefined;
    return (
      <CardFrame
        k={k}
        mark={
          <View style={{ width: 22, height: 22, borderRadius: 11, backgroundColor: withAlpha(tone ?? k.c.ok, 0.18), alignItems: "center", justifyContent: "center" }}>
            <Icon name={card.outcome === "completed" ? "Check" : card.outcome === "failed" ? "X" : "CircleSlash"} size={13} color={tone ?? k.c.ok} />
          </View>
        }
        verb={card.outcome === "completed" ? t("cards.update") : `${t("cards.update")} · ${card.outcome === "failed" ? t("cards.failed") : t("cards.canceled")}`}
        title={card.title}
        tone={tone}
        at={card.at}
        onOpen={navigation ? () => navigation.openAgent({ agentId: card.agentId }) : undefined}
        onDashboard={card.workspaceId ? () => client.openPanel(SESSION_PANEL, { workspaceId: card.workspaceId!, agentId: card.agentId, location: "explorer" }) : undefined}
      >
        <Text style={{ color: k.c.fg, fontSize: 13, lineHeight: 19 }} selectable>
          {card.result.trim() || t("cards.noResult")}
        </Text>
      </CardFrame>
    );
  }
  return { HandoffView, UpdateView };
}

export function contributeCards(client: PluginClientContext): () => void {
  // Apps without plugin timeline rows don't draw them.
  if (typeof client.addTimelineRenderer !== "function") return () => {};
  const { HandoffView, UpdateView } = makeCards(client);
  const removeHandoff = client.addTimelineRenderer({ kind: HANDOFF_CARD, version: 1, schema: HandoffCardSchema, Component: HandoffView as never });
  const removeUpdate = client.addTimelineRenderer({ kind: UPDATE_CARD, version: 1, schema: UpdateCardSchema, Component: UpdateView as never });
  return () => {
    removeHandoff();
    removeUpdate();
  };
}
