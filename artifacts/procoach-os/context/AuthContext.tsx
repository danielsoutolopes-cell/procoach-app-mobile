import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from "react";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { ProCoachAPI } from "@/services/api";
import { getDeviceId } from "@/utils/deviceId";

export interface AuthUser {
  id: number;
  name: string;
  phone: string;
  token: string;
}

interface AuthState {
  user: AuthUser | null;
  loading: boolean;
  phone: string;
  otpSent: boolean;
  sending: boolean;
  verifying: boolean;
  error: string | null;
}

interface AuthContextType {
  auth: AuthState;
  sendOTP: (phone: string) => Promise<void>;
  verifyOTP: (code: string) => Promise<boolean>;
  logout: () => Promise<void>;
  clearError: () => void;
}

const AUTH_KEY = "@procoach_auth_v1";

const DEFAULT: AuthState = {
  user: null,
  loading: true,
  phone: "",
  otpSent: false,
  sending: false,
  verifying: false,
  error: null,
};

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [auth, setAuth] = useState<AuthState>(DEFAULT);

  useEffect(() => {
    (async () => {
      try {
        const raw = await AsyncStorage.getItem(AUTH_KEY);
        if (raw) {
          const saved = JSON.parse(raw) as AuthUser;
          const verified = await ProCoachAPI.verifyToken(saved.token);
          if (verified.valid) {
            setAuth((prev) => ({ ...prev, user: saved, loading: false }));
            return;
          }
          await AsyncStorage.removeItem(AUTH_KEY);
        }
      } catch {}
      setAuth((prev) => ({ ...prev, loading: false }));
    })();
  }, []);

  const sendOTP = useCallback(async (phone: string) => {
    setAuth((prev) => ({ ...prev, sending: true, error: null, phone }));
    try {
      await ProCoachAPI.sendOTP(phone);
      setAuth((prev) => ({ ...prev, sending: false, otpSent: true }));
    } catch (e: any) {
      setAuth((prev) => ({
        ...prev,
        sending: false,
        error: e?.message ?? "Falha ao enviar código",
      }));
    }
  }, []);

  const verifyOTP = useCallback(
    async (code: string): Promise<boolean> => {
      setAuth((prev) => ({ ...prev, verifying: true, error: null }));
      try {
        const deviceId = await getDeviceId();
        const result = await ProCoachAPI.verifyOTP(auth.phone, code, deviceId);
        const user: AuthUser = {
          id: (result.athlete as any).id,
          name: (result.athlete as any).name,
          phone: auth.phone,
          token: result.token,
        };
        await AsyncStorage.setItem(AUTH_KEY, JSON.stringify(user));
        setAuth((prev) => ({ ...prev, verifying: false, user }));
        return true;
      } catch (e: any) {
        setAuth((prev) => ({
          ...prev,
          verifying: false,
          error: e?.message?.includes("401") || e?.message?.includes("inválido")
            ? "Código incorreto. Tente novamente."
            : e?.message ?? "Falha ao verificar código",
        }));
        return false;
      }
    },
    [auth.phone]
  );

  const logout = useCallback(async () => {
    if (auth.user?.token) {
      try {
        await ProCoachAPI.logout(auth.user.token);
      } catch {}
    }
    await AsyncStorage.removeItem(AUTH_KEY);
    setAuth({ ...DEFAULT, loading: false });
  }, [auth.user]);

  const clearError = useCallback(() => {
    setAuth((prev) => ({ ...prev, error: null }));
  }, []);

  return (
    <AuthContext.Provider value={{ auth, sendOTP, verifyOTP, logout, clearError }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used inside AuthProvider");
  return ctx;
}
