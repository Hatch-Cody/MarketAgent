import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useColorScheme } from "react-native";

export type Palette = {
  bg: string;
  elevated: string;
  card: string;
  text: string;
  muted: string;
  faint: string;
  line: string;
  up: string;
  down: string;
  accent: string;
  accentSoft: string;
  onAccent: string;
};

export const dark: Palette = {
  bg: "#10140F",
  elevated: "#171D16",
  card: "#1C2419",
  text: "#F4F1E8",
  muted: "#A3AD9C",
  faint: "#6F7868",
  line: "#2C3628",
  up: "#7DCEA0",
  down: "#E07A5F",
  accent: "#E3B23C",
  accentSoft: "#3A3118",
  onAccent: "#1A1408",
};

export const light: Palette = {
  bg: "#F3F0E7",
  elevated: "#FBF9F4",
  card: "#FFFCF7",
  text: "#1C2118",
  muted: "#5C6658",
  faint: "#8A9184",
  line: "#E3DCCE",
  up: "#1B7A4A",
  down: "#B23A2F",
  accent: "#8C6A1A",
  accentSoft: "#F3E6C4",
  onAccent: "#FFF8E8",
};

export type ThemeMode = "system" | "dark" | "light";

const KEY = "marketsim.theme";

const ThemeContext = createContext<{
  mode: ThemeMode;
  palette: Palette;
  dark: boolean;
  setMode: (mode: ThemeMode) => void;
} | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme();
  const [mode, setModeState] = useState<ThemeMode>("system");
  useEffect(() => {
    AsyncStorage.getItem(KEY).then((stored) => {
      if (stored === "dark" || stored === "light" || stored === "system") setModeState(stored);
    });
  }, []);
  const setMode = (next: ThemeMode) => {
    setModeState(next);
    void AsyncStorage.setItem(KEY, next);
  };
  const isDark = mode === "system" ? system !== "light" : mode === "dark";
  const value = useMemo(
    () => ({ mode, palette: isDark ? dark : light, dark: isDark, setMode }),
    [mode, isDark],
  );
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme() {
  const value = useContext(ThemeContext);
  if (!value) throw new Error("Theme missing");
  return value;
}
