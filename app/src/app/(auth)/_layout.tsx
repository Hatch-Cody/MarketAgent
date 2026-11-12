import { Stack } from "expo-router";
import { useTheme } from "@/theme";

export default function AuthLayout() {
  const { palette } = useTheme();
  return <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }} />;
}
