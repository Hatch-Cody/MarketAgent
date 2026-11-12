import * as Clipboard from "expo-clipboard";
import { router, useLocalSearchParams } from "expo-router";
import { useState } from "react";
import { Text, View } from "react-native";
import { Banner, Button, Card, Screen } from "@/components/ui";
import { clearKey, peekKey } from "@/keys";
import { useTheme } from "@/theme";

export default function RevealScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const stored = id ? peekKey(id) : null;
  const { palette } = useTheme();
  const [copied, setCopied] = useState(false);

  if (!stored) {
    return (
      <Screen>
        <View style={{ gap: 12 }}>
          <Banner>This key was already hidden. Generate a new one from the agent if you still need it.</Banner>
          <Button label="Back to agents" onPress={() => router.replace("/agents")} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <View style={{ gap: 16, paddingTop: 12 }}>
        <Text style={{ color: palette.text, fontFamily: "Fraunces_600SemiBold", fontSize: 28 }}>{stored.name}'s key</Text>
        <Banner tone="bad">Copy it now. MarketSim will not show this key again.</Banner>
        <Card>
          <Text selectable style={{ color: palette.text, fontFamily: "DMSans_500Medium", fontSize: 16, lineHeight: 24 }}>
            {stored.apiKey}
          </Text>
        </Card>
        <Button
          label={copied ? "Copied" : "Copy key"}
          onPress={async () => {
            await Clipboard.setStringAsync(stored.apiKey);
            setCopied(true);
          }}
        />
        <Button
          label="I've stored this key"
          tone="ghost"
          onPress={() => {
            clearKey();
            router.replace(`/agent/${stored.agentId}`);
          }}
        />
      </View>
    </Screen>
  );
}
