import AsyncStorage from "@react-native-async-storage/async-storage";
import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { createApi, type Api } from "./api";
import type { MarketState, User } from "./types";

const TOKEN_KEY = "marketsim.token";
const URL_KEY = "marketsim.baseUrl";
const DEFAULT_URL = process.env.EXPO_PUBLIC_API_URL ?? "http://127.0.0.1:8787";

type AuthValue = {
  ready: boolean;
  token: string | null;
  user: User | null;
  market: MarketState | null;
  baseUrl: string;
  api: Api;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  setBaseUrl: (url: string) => Promise<void>;
  refresh: () => Promise<void>;
  updateUser: (patch: { name?: string; fillOnlyDuringMarketHours?: boolean }) => Promise<void>;
};

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [baseUrl, setBaseUrlState] = useState(DEFAULT_URL);
  const [user, setUser] = useState<User | null>(null);
  const [market, setMarket] = useState<MarketState | null>(null);

  const api = useMemo(() => createApi(() => ({ baseUrl, token })), [baseUrl, token]);

  useEffect(() => {
    let cancel = false;
    (async () => {
      const [storedToken, storedUrl] = await Promise.all([AsyncStorage.getItem(TOKEN_KEY), AsyncStorage.getItem(URL_KEY)]);
      const nextUrl = (storedUrl || DEFAULT_URL).replace(/\/$/, "");
      if (cancel) return;
      setBaseUrlState(nextUrl);
      if (!storedToken) {
        setReady(true);
        return;
      }
      try {
        const client = createApi(() => ({ baseUrl: nextUrl, token: storedToken }));
        const me = await client.me();
        if (cancel) return;
        setToken(storedToken);
        setUser(me.user);
        setMarket(me.market);
      } catch {
        await AsyncStorage.removeItem(TOKEN_KEY);
      } finally {
        if (!cancel) setReady(true);
      }
    })();
    return () => {
      cancel = true;
    };
  }, []);

  async function persistSession(nextToken: string, nextUser: User) {
    await AsyncStorage.setItem(TOKEN_KEY, nextToken);
    setToken(nextToken);
    setUser(nextUser);
    try {
      const status = await createApi(() => ({ baseUrl, token: nextToken })).market();
      setMarket(status);
    } catch {
      setMarket(null);
    }
  }

  const value: AuthValue = {
    ready,
    token,
    user,
    market,
    baseUrl,
    api,
    async login(email, password) {
      const result = await api.login({ email, password });
      await persistSession(result.token, result.user);
    },
    async register(name, email, password) {
      const result = await api.register({ name, email, password });
      await persistSession(result.token, result.user);
    },
    async logout() {
      try {
        await api.logout();
      } catch {
        // The local session goes either way.
      }
      await AsyncStorage.removeItem(TOKEN_KEY);
      setToken(null);
      setUser(null);
    },
    async setBaseUrl(url: string) {
      const next = url.trim().replace(/\/$/, "");
      await AsyncStorage.setItem(URL_KEY, next);
      setBaseUrlState(next);
    },
    async refresh() {
      if (!token) return;
      const me = await api.me();
      setUser(me.user);
      setMarket(me.market);
    },
    async updateUser(patch) {
      const result = await api.updateMe(patch);
      setUser(result.user);
    },
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error("Auth missing");
  return value;
}
