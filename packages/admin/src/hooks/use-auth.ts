import { useState, useCallback } from "react";

const STORAGE_KEY = "inv_admin_key";

export function useAuth() {
  const [adminKey, setAdminKeyState] = useState<string>(
    () => localStorage.getItem(STORAGE_KEY) ?? "",
  );

  const setAdminKey = useCallback((key: string) => {
    const trimmed = key.trim();
    setAdminKeyState(trimmed);
    if (trimmed) {
      localStorage.setItem(STORAGE_KEY, trimmed);
    } else {
      localStorage.removeItem(STORAGE_KEY);
    }
  }, []);

  const isAuthed = adminKey.length > 0;

  return { adminKey, setAdminKey, isAuthed } as const;
}
