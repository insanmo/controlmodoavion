const CONFIG_STORAGE_KEY = "aircontrol_supabase";

function normalizeSupabaseUrl(url) {
  return String(url || "").replace(/\/rest\/v1\/?$/i, "").replace(/\/$/, "");
}

// Lee primero las variables de entorno (import.meta.env / .env.*) y luego
// hace fallback a window.AIRCONTROL_CONFIG / localStorage para compatibilidad.
export function readRuntimeConfig() {
  const envUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL || "");
  const envKey = import.meta.env.VITE_SUPABASE_ANON_KEY || "";
  const fromWindow = window.AIRCONTROL_CONFIG || {};
  const fromStorage = JSON.parse(localStorage.getItem(CONFIG_STORAGE_KEY) || "null") || {};
  const url = envUrl || normalizeSupabaseUrl(fromWindow.supabaseUrl || fromStorage.url || "");
  const anonKey = envKey || fromWindow.supabaseAnonKey || fromStorage.anonKey || "";
  return {
    supabaseUrl: url,
    supabaseAnonKey: anonKey,
    hasSupabase: Boolean(url && anonKey)
  };
}

export function saveRuntimeConfig(url, anonKey) {
  localStorage.setItem(CONFIG_STORAGE_KEY, JSON.stringify({
    url: normalizeSupabaseUrl(url),
    anonKey
  }));
}

export async function waitForSupabaseClient(timeoutMs = 15000) {
  if (window.supabase) return window.supabase;
  const startedAt = Date.now();
  while (!window.supabase && Date.now() - startedAt < timeoutMs) {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  return window.supabase || null;
}
