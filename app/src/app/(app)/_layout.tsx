import { Stack } from "expo-router";
import { BooksProvider } from "@/books";
import { useTheme } from "@/theme";

export default function AppLayout() {
  const { palette } = useTheme();
  return (
    <BooksProvider>
      <Stack screenOptions={{ headerShown: false, contentStyle: { backgroundColor: palette.bg } }} />
    </BooksProvider>
  );
}
