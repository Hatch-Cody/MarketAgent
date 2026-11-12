import { useState } from "react";
import { Platform, Switch, Text, View } from "react-native";
import { useAuth } from "@/auth";
import { Banner, Button, Field, Label, Muted, Screen, Segment } from "@/components/ui";
import { sessionTime } from "@/format";
import { useTheme, type ThemeMode } from "@/theme";

export default function SettingsScreen() {
  const { user, baseUrl, setBaseUrl, api, logout, updateUser, market } = useAuth();
  const { mode, setMode, palette } = useTheme();
  const [url, setUrl] = useState(baseUrl);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  async function saveUrl() {
    setSaving(true);
    setError(null);
    try {
      await setBaseUrl(url);
      const health = await api.health();
      setStatus(`${health.provider === "mock" ? "Built-in market" : "Finnhub"} · ${health.open ? "NYSE open" : "NYSE closed"}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't reach that address.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Screen>
      <View style={{ gap: 16 }}>
        <Text style={{ color: palette.text, fontFamily: "Fraunces_600SemiBold", fontSize: 28 }}>Settings</Text>
        <Muted>Signed in as {user?.email}</Muted>
        <Field label="Server" autoCapitalize="none" autoCorrect={false} value={url} onChangeText={setUrl} />
        {Platform.OS !== "web" ? (
          <Muted>On a phone, localhost is the phone itself. Use your computer's LAN address, such as http://192.168.1.20:8787.</Muted>
        ) : null}
        <Button label="Save and test" onPress={saveUrl} loading={saving} />
        {status ? <Banner tone="good">{status}</Banner> : null}
        {error ? <Banner tone="bad">{error}</Banner> : null}
        <View style={{ gap: 8 }}>
          <Label>Appearance</Label>
          <Segment<ThemeMode>
            value={mode}
            onChange={setMode}
            options={[
              { value: "system", label: "System" },
              { value: "dark", label: "Dark" },
              { value: "light", label: "Light" },
            ]}
          />
        </View>
        <View style={{ flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 12 }}>
          <View style={{ flex: 1 }}>
            <Text style={{ color: palette.text, fontFamily: "DMSans_700Bold" }}>Queue when the NYSE is closed</Text>
            <Muted>On, orders wait for 9:30 AM ET. Off, they fill immediately at the latest price. Useful for trying the book outside market hours.</Muted>
          </View>
          <Switch
            value={user?.fillOnlyDuringMarketHours ?? true}
            onValueChange={(value) => {
              void updateUser({ fillOnlyDuringMarketHours: value });
            }}
            trackColor={{ true: palette.accent, false: palette.line }}
          />
        </View>
        <Muted>
          Session: {market?.open ? "regular hours" : "closed"}
          {market?.nextOpen ? `. Next open ${sessionTime(market.nextOpen)}` : ""}.
        </Muted>
        <Button label="Sign out" tone="ghost" onPress={() => void logout()} />
        <Muted>
          MarketSim is an independent paper-trading desk inspired by the iOS app of the same name. It is not affiliated with Third Line LLC. Dividends and splits run when a data provider supplies them; the built-in market does not.
        </Muted>
      </View>
    </Screen>
  );
}
