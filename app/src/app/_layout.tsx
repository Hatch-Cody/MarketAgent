import "react-native-gesture-handler";
import { DMSans_400Regular, DMSans_500Medium, DMSans_600SemiBold, DMSans_700Bold } from "@expo-google-fonts/dm-sans";
import { Fraunces_600SemiBold } from "@expo-google-fonts/fraunces";
import { useFonts } from "expo-font";
import { Stack } from "expo-router";
import { StatusBar } from "expo-status-bar";
import { View } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { AuthProvider, useAuth } from "@/auth";
import { useTheme, ThemeProvider as AppTheme } from "@/theme";

function Navigation() {
  const { palette, dark } = useTheme();
  const { ready, token } = useAuth();
  const [fontsLoaded] = useFonts({
    DMSans_400Regular,
    DMSans_500Medium,
    DMSans_600SemiBold,
    DMSans_700Bold,
    Fraunces_600SemiBold,
  });
  if (!ready || !fontsLoaded) {
    return <View style={{ flex: 1, backgroundColor: palette.bg }} />;
  }

  return (
    <View style={{ flex: 1, backgroundColor: palette.bg }}>
      <StatusBar style={dark ? "light" : "dark"} />
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }}>
        <Stack.Protected guard={!!token} redirectTo="/login">
          <Stack.Screen name="(app)" />
        </Stack.Protected>
        <Stack.Protected guard={!token} redirectTo="/">
          <Stack.Screen name="(auth)" />
        </Stack.Protected>
      </Stack>
    </View>
  );
}

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <AppTheme>
        <AuthProvider>
          <Navigation />
        </AuthProvider>
      </AppTheme>
    </SafeAreaProvider>
  );
}
