import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import { type ReactNode } from "react";
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  type TextInputProps,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { pct, signedMoney } from "@/format";
import { useTheme } from "@/theme";

export function Screen({
  children,
  scroll = true,
  refreshing,
  onRefresh,
}: {
  children: ReactNode;
  scroll?: boolean;
  refreshing?: boolean;
  onRefresh?: () => void;
}) {
  const { palette } = useTheme();
  const insets = useSafeAreaInsets();
  const body = (
    <View style={{ width: "100%", maxWidth: 760, alignSelf: "center", paddingHorizontal: 20, paddingBottom: 28 }}>{children}</View>
  );
  if (!scroll) {
    return <View style={{ flex: 1, backgroundColor: palette.bg, paddingTop: Math.max(insets.top, 16) }}>{body}</View>;
  }
  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: palette.bg }}
      contentContainerStyle={{ paddingTop: Math.max(insets.top, 16), paddingBottom: insets.bottom + 28 }}
      keyboardShouldPersistTaps="handled"
      refreshControl={
        onRefresh ? <RefreshControl refreshing={!!refreshing} onRefresh={onRefresh} tintColor={palette.accent} /> : undefined
      }
    >
      {body}
    </ScrollView>
  );
}

export function Display({ children }: { children: ReactNode }) {
  const { palette } = useTheme();
  return <Text style={{ color: palette.text, fontFamily: "Fraunces_600SemiBold", fontSize: 40, letterSpacing: -0.8 }}>{children}</Text>;
}

export function H1({ children }: { children: ReactNode }) {
  const { palette } = useTheme();
  return <Text style={{ color: palette.text, fontFamily: "Fraunces_600SemiBold", fontSize: 28, letterSpacing: -0.4 }}>{children}</Text>;
}

export function Label({ children }: { children: ReactNode }) {
  const { palette } = useTheme();
  return (
    <Text style={{ color: palette.faint, fontFamily: "DMSans_600SemiBold", fontSize: 12, letterSpacing: 0.6, textTransform: "uppercase" }}>
      {children}
    </Text>
  );
}

export function Muted({ children }: { children: ReactNode }) {
  const { palette } = useTheme();
  return <Text style={{ color: palette.muted, fontFamily: "DMSans_400Regular", fontSize: 15, lineHeight: 22 }}>{children}</Text>;
}

export function Card({ children }: { children: ReactNode }) {
  const { palette } = useTheme();
  return (
    <View style={{ backgroundColor: palette.card, borderColor: palette.line, borderWidth: 1, borderRadius: 18, padding: 16 }}>{children}</View>
  );
}

export function Banner({ tone = "info", children }: { tone?: "info" | "bad" | "good"; children: ReactNode }) {
  const { palette } = useTheme();
  const color = tone === "bad" ? palette.down : tone === "good" ? palette.up : palette.accent;
  return (
    <View style={{ borderRadius: 14, padding: 12, backgroundColor: palette.elevated, borderColor: palette.line, borderWidth: 1 }}>
      <Text style={{ color, fontFamily: "DMSans_500Medium", fontSize: 14, lineHeight: 20 }}>{children}</Text>
    </View>
  );
}

export function Button({
  label,
  onPress,
  tone = "accent",
  disabled,
  loading,
}: {
  label: string;
  onPress: () => void;
  tone?: "accent" | "ghost" | "buy" | "sell" | "danger";
  disabled?: boolean;
  loading?: boolean;
}) {
  const { palette } = useTheme();
  const background =
    tone === "ghost" ? "transparent" : tone === "buy" ? palette.up : tone === "sell" || tone === "danger" ? palette.down : palette.accent;
  const color = tone === "ghost" ? palette.text : tone === "accent" ? palette.onAccent : "#102016";
  const border = tone === "ghost" ? palette.line : "transparent";
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled || loading}
      style={({ pressed }) => ({
        backgroundColor: background,
        borderColor: border,
        borderWidth: 1,
        borderRadius: 14,
        minHeight: 48,
        alignItems: "center",
        justifyContent: "center",
        paddingHorizontal: 16,
        opacity: disabled ? 0.45 : pressed ? 0.82 : 1,
      })}
    >
      {loading ? (
        <ActivityIndicator color={color} />
      ) : (
        <Text style={{ color, fontFamily: "DMSans_700Bold", fontSize: 16 }}>{label}</Text>
      )}
    </Pressable>
  );
}

export function Field({ label, ...props }: { label: string } & TextInputProps) {
  const { palette } = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Label>{label}</Label>
      <TextInput
        placeholderTextColor={palette.faint}
        {...props}
        style={[
          {
            backgroundColor: palette.elevated,
            color: palette.text,
            borderColor: palette.line,
            borderWidth: 1,
            borderRadius: 14,
            paddingHorizontal: 14,
            paddingVertical: 13,
            fontFamily: "DMSans_500Medium",
            fontSize: 16,
          },
          props.style,
        ]}
      />
    </View>
  );
}

export function Segment<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", backgroundColor: palette.elevated, borderRadius: 12, padding: 3, gap: 2 }}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <Pressable
            key={option.value}
            onPress={() => onChange(option.value)}
            style={{
              flex: 1,
              borderRadius: 10,
              paddingVertical: 8,
              alignItems: "center",
              backgroundColor: active ? palette.card : "transparent",
            }}
          >
            <Text style={{ color: active ? palette.text : palette.muted, fontFamily: "DMSans_600SemiBold", fontSize: 13 }}>{option.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function ReturnText({ money, percent }: { money?: number; percent?: number }) {
  const { palette } = useTheme();
  const basis = percent ?? money ?? 0;
  const color = basis > 0 ? palette.up : basis < 0 ? palette.down : palette.muted;
  const parts = [money != null ? signedMoney(money) : null, percent != null ? pct(percent) : null].filter(Boolean);
  return <Text style={{ color, fontFamily: "DMSans_600SemiBold", fontSize: 15 }}>{parts.join("  ")}</Text>;
}

export function QuoteRow({
  symbol,
  name,
  price,
  changePercent,
  onPress,
}: {
  symbol: string;
  name: string;
  price: string;
  changePercent?: number | null;
  onPress: () => void;
}) {
  const { palette } = useTheme();
  const color = (changePercent ?? 0) >= 0 ? palette.up : palette.down;
  return (
    <Pressable onPress={onPress} style={{ flexDirection: "row", alignItems: "center", paddingVertical: 12, gap: 12 }}>
      <View style={{ width: 44, height: 44, borderRadius: 12, backgroundColor: palette.elevated, alignItems: "center", justifyContent: "center" }}>
        <Text style={{ color: palette.text, fontFamily: "DMSans_700Bold", fontSize: 13 }}>{symbol.slice(0, 2)}</Text>
      </View>
      <View style={{ flex: 1 }}>
        <Text style={{ color: palette.text, fontFamily: "DMSans_700Bold", fontSize: 16 }}>{symbol}</Text>
        <Text style={{ color: palette.muted, fontFamily: "DMSans_400Regular", fontSize: 13 }} numberOfLines={1}>
          {name}
        </Text>
      </View>
      <View style={{ alignItems: "flex-end" }}>
        <Text style={{ color: palette.text, fontFamily: "DMSans_600SemiBold", fontSize: 16 }}>{price}</Text>
        {changePercent == null ? null : <Text style={{ color, fontFamily: "DMSans_600SemiBold", fontSize: 13 }}>{pct(changePercent)}</Text>}
      </View>
    </Pressable>
  );
}

export function BackHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  const { palette } = useTheme();
  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 8, marginBottom: 12 }}>
      <Pressable onPress={() => router.back()} hitSlop={10} style={styles.back}>
        <Ionicons name="chevron-back" size={22} color={palette.text} />
      </Pressable>
      <View style={{ flex: 1 }}>
        <Text style={{ color: palette.text, fontFamily: "Fraunces_600SemiBold", fontSize: 22 }}>{title}</Text>
        {subtitle ? <Muted>{subtitle}</Muted> : null}
      </View>
    </View>
  );
}

export function Empty({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <Card>
      <View style={{ gap: 8 }}>
        <H1>{title}</H1>
        <Muted>{body}</Muted>
        {action}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  back: { width: 36, height: 36, alignItems: "center", justifyContent: "center" },
});
