import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { useAuth } from "./auth";
import type { PortfolioDetail, PortfolioSummary } from "./types";

const KEY = "marketsim.portfolio";

type BooksValue = {
  portfolios: PortfolioSummary[];
  selectedId: string | null;
  detail: PortfolioDetail | null;
  range: string;
  loading: boolean;
  error: string | null;
  setRange: (range: string) => void;
  select: (id: string) => void;
  refresh: () => Promise<void>;
};

const BooksContext = createContext<BooksValue | null>(null);

export function BooksProvider({ children }: { children: ReactNode }) {
  const { api, token } = useAuth();
  const [portfolios, setPortfolios] = useState<PortfolioSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<PortfolioDetail | null>(null);
  const [range, setRange] = useState("1m");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!token) return;
    setLoading((current) => (detail ? current : true));
    try {
      const listed = await api.portfolios();
      const stored = await AsyncStorage.getItem(KEY);
      const preferred =
        listed.portfolios.find((item) => item.id === (selectedId ?? stored)) ??
        listed.portfolios.find((item) => !item.agent) ??
        listed.portfolios[0] ??
        null;
      setPortfolios(listed.portfolios);
      setSelectedId(preferred?.id ?? null);
      if (preferred) {
        await AsyncStorage.setItem(KEY, preferred.id);
        const view = await api.portfolio(preferred.id, range);
        setDetail(view.portfolio);
      } else {
        setDetail(null);
      }
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the book.");
    } finally {
      setLoading(false);
    }
  }, [api, token, range, selectedId]);

  useEffect(() => {
    if (!token) {
      setPortfolios([]);
      setDetail(null);
      setSelectedId(null);
      setLoading(false);
      return;
    }
    void refresh();
    // Refresh when the session or range changes. Selection changes call select().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, range]);

  async function select(id: string) {
    setSelectedId(id);
    await AsyncStorage.setItem(KEY, id);
    setLoading(true);
    try {
      const view = await api.portfolio(id, range);
      setDetail(view.portfolio);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't load the book.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <BooksContext.Provider value={{ portfolios, selectedId, detail, range, loading, error, setRange, select, refresh }}>
      {children}
    </BooksContext.Provider>
  );
}

export function useBooks() {
  const value = useContext(BooksContext);
  if (!value) throw new Error("Books missing");
  return value;
}
