// The searchable picker behind every select: a modal with a filter box and keyboard navigation. One host serves every
// select rendered inside it; the legacy `SelectHost` (TeamPanel.tsx) and the team editor share it, each with its own look.
import { Modal } from "@getpaseo/plugin/client/ui";
import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { Pressable, ScrollView, Text, TextInput, type StyleProp, type TextStyle, type ViewStyle } from "react-native";
import { useT } from "./common";

export type SelectRequest = { label: string; options: readonly string[]; value: string; onChange(value: string): void };

const SelectContext = createContext<(request: SelectRequest) => void>(() => {});

/** Opens the picker of the nearest host. */
export function useSelect(): (request: SelectRequest) => void {
  return useContext(SelectContext);
}

export interface PickerLook {
  input: StyleProp<TextStyle>;
  placeholderColor?: string;
  muted: StyleProp<TextStyle>;
  row(selected: boolean, focused: boolean): StyleProp<ViewStyle>;
  rowText(selected: boolean): StyleProp<TextStyle>;
  check(selected: boolean): ReactNode;
}

/** Hosts the searchable picker that selects open, for everything rendered inside it. */
export function PickerHost({ look, children }: { look: PickerLook; children: ReactNode }) {
  const { t } = useT();
  const [picker, setPicker] = useState<SelectRequest | null>(null);
  const [pickerQuery, setPickerQuery] = useState("");
  const [highlight, setHighlight] = useState(0);
  const pickerRef = useRef<SelectRequest | null>(null);
  pickerRef.current = picker;
  const listRef = useRef<ScrollView>(null);
  const rowLayouts = useRef<Record<number, { y: number; height: number }>>({});
  const listHeight = useRef(0);
  const scrollY = useRef(0);
  const openSelect = useRef((request: SelectRequest) => {
    setPickerQuery("");
    const index = request.options.indexOf(request.value);
    setHighlight(index >= 0 ? index : 0);
    rowLayouts.current = {};
    scrollY.current = 0;
    setPicker(request);
  }).current;
  const pickerNeedle = pickerQuery.trim().toLowerCase();
  const pickerOptions = picker ? (pickerNeedle ? picker.options.filter((option) => option.toLowerCase().includes(pickerNeedle)) : picker.options) : [];
  const highlightedIndex = pickerOptions.length > 0 ? Math.min(highlight, pickerOptions.length - 1) : -1;
  const close = () => {
    pickerRef.current = null;
    setPicker(null);
    setPickerQuery("");
  };
  const pickOption = (option: string) => {
    const active = pickerRef.current;
    if (!active) return;
    close();
    active.onChange(option);
  };
  const pickHighlighted = () => {
    if (highlightedIndex >= 0 && highlightedIndex < pickerOptions.length) pickOption(pickerOptions[highlightedIndex]!);
  };
  useEffect(() => {
    if (!picker || highlightedIndex < 0) return;
    const row = rowLayouts.current[highlightedIndex] ?? { y: highlightedIndex * 40, height: 36 };
    const viewHeight = listHeight.current || 320;
    const top = scrollY.current;
    if (row.y < top) {
      scrollY.current = row.y;
      listRef.current?.scrollTo({ y: row.y, animated: false });
    } else if (row.y + row.height > top + viewHeight) {
      const nextY = row.y + row.height - viewHeight;
      scrollY.current = nextY;
      listRef.current?.scrollTo({ y: nextY, animated: false });
    }
  }, [highlightedIndex, picker, pickerQuery]);
  return (
    <SelectContext.Provider value={openSelect}>
      {children}
      <Modal title={picker?.label ?? ""} open={picker !== null} onOpenChange={(open) => { if (!open) close(); }}>
        <Modal.Content>
          {picker ? (
            <>
              <TextInput
                style={look.input}
                value={pickerQuery}
                placeholder={t("role.searchPlaceholder")}
                placeholderTextColor={look.placeholderColor}
                autoFocus
                autoCorrect={false}
                autoCapitalize="none"
                onChangeText={(text) => {
                  rowLayouts.current = {};
                  scrollY.current = 0;
                  setPickerQuery(text);
                  setHighlight(0);
                }}
                onKeyPress={(event) => {
                  const key = event.nativeEvent.key;
                  if (key === "ArrowDown") {
                    event.preventDefault?.();
                    if (pickerOptions.length > 0) setHighlight((current) => Math.min(pickerOptions.length - 1, Math.min(current, pickerOptions.length - 1) + 1));
                  } else if (key === "ArrowUp") {
                    event.preventDefault?.();
                    if (pickerOptions.length > 0) setHighlight((current) => Math.max(0, Math.min(current, pickerOptions.length - 1) - 1));
                  } else if (key === "Enter") {
                    event.preventDefault?.();
                    pickHighlighted();
                  }
                }}
                onSubmitEditing={pickHighlighted}
              />
              <ScrollView
                ref={listRef}
                style={{ maxHeight: 320 }}
                contentContainerStyle={{ gap: 4 }}
                keyboardShouldPersistTaps="handled"
                nestedScrollEnabled
                scrollEventThrottle={16}
                onLayout={(event) => {
                  listHeight.current = event.nativeEvent.layout.height;
                }}
                onScroll={(event) => {
                  scrollY.current = event.nativeEvent.contentOffset.y;
                }}
              >
                {pickerOptions.length === 0 ? <Text style={look.muted}>{t(picker.options.length === 0 ? "role.noOptions" : "role.noMatches")}</Text> : null}
                {pickerOptions.map((option, index) => {
                  const selected = option === picker.value;
                  return (
                    <Pressable
                      key={option}
                      accessibilityRole="button"
                      accessibilityLabel={option}
                      accessibilityState={{ selected }}
                      onLayout={(event) => {
                        const { y, height } = event.nativeEvent.layout;
                        rowLayouts.current[index] = { y, height };
                      }}
                      onPress={() => pickOption(option)}
                      style={look.row(selected, index === highlightedIndex)}
                    >
                      <Text style={look.rowText(selected)}>{option}</Text>
                      {look.check(selected)}
                    </Pressable>
                  );
                })}
              </ScrollView>
            </>
          ) : null}
        </Modal.Content>
      </Modal>
    </SelectContext.Provider>
  );
}

