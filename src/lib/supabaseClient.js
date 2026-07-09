// Cliente centralizado de Supabase.
// Lee la configuración desde import.meta.env (variables VITE_* definidas en .env.local / .env.production).
// No se hardcodea ninguna URL ni key en los componentes.
//
// Se usa el cliente UMD cargado desde CDN en index.html (window.supabase) para no agregar
// dependencias de build; la URL/key vienen 100% de variables de entorno.

let cachedClient = null;

export function getSupabaseClient() {
  if (cachedClient) return cachedClient;
  const url = import.meta.env.VITE_SUPABASE_URL;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY;
  if (!url || !key) return null;
  if (!window.supabase) return null;
  cachedClient = window.supabase.createClient(url, key);
  return cachedClient;
}

export function hasSupabaseEnv() {
  return Boolean(import.meta.env.VITE_SUPABASE_URL && import.meta.env.VITE_SUPABASE_ANON_KEY);
}

export function appEnv() {
  return import.meta.env.VITE_APP_ENV || "local";
}

export function basePath() {
  return import.meta.env.VITE_BASE_PATH || "/";
}
