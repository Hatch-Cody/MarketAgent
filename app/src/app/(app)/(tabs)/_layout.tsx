import { Ionicons } from "@expo/vector-icons";
import { Tabs } from "expo-router";
import { useTheme } from "@/theme";

export default function TabsLayout() {
  const { palette } = useTheme();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: palette.accent,
        tabBarInactiveTintColor: palette.faint,
        tabBarStyle: { backgroundColor: palette.bg, borderTopColor: palette.line, height: 62, paddingTop: 4, paddingBottom: 6 },
        tabBarLabelStyle: { fontFamily: "DMSans_600SemiBold", fontSize: 10 },
        sceneStyle: { backgroundColor: palette.bg },
      }}
    >
      <Tabs.Screen
        name="index"
        options={{ title: "Home", tabBarIcon: ({ color, size }) => <Ionicons name="pie-chart-outline" color={typeof color === "string" ? color : palette.faint} size={size} /> }}
      />
      <Tabs.Screen
        name="explore"
        options={{ title: "Explore", tabBarIcon: ({ color, size }) => <Ionicons name="search-outline" color={typeof color === "string" ? color : palette.faint} size={size} /> }}
      />
      <Tabs.Screen
        name="trade"
        options={{ title: "Trade", tabBarIcon: ({ color, size }) => <Ionicons name="swap-horizontal" color={typeof color === "string" ? color : palette.faint} size={size} /> }}
      />
      <Tabs.Screen
        name="watchlist"
        options={{ title: "Watch", tabBarIcon: ({ color, size }) => <Ionicons name="star-outline" color={typeof color === "string" ? color : palette.faint} size={size} /> }}
      />
      <Tabs.Screen
        name="agents"
        options={{ title: "Agents", tabBarIcon: ({ color, size }) => <Ionicons name="hardware-chip-outline" color={typeof color === "string" ? color : palette.faint} size={size} /> }}
      />
      <Tabs.Screen
        name="settings"
        options={{ title: "Settings", tabBarIcon: ({ color, size }) => <Ionicons name="options-outline" color={typeof color === "string" ? color : palette.faint} size={size} /> }}
      />
    </Tabs>
  );
}
