import { state, TABLES, isIndraEmail, resetSessionViewForUser } from "./state.js";
import { readRuntimeConfig, waitForSupabaseClient } from "./config.js";
import { getSupabaseClient } from "../lib/supabaseClient.js";
import { AirControlApi } from "./aircontrol-api.js";
import { SupabaseStore } from "./supabase-store.js";
import { loadData } from "./db.js";
import { notify } from "./ui.js";

export async function initStorage() {
  const saved = readRuntimeConfig();
  const supabaseUrlInput = document.getElementById("supabaseUrl");
  const supabaseAnonKeyInput = document.getElementById("supabaseAnonKey");
  if (supabaseUrlInput) supabaseUrlInput.value = saved.supabaseUrl || "";
  if (supabaseAnonKeyInput) supabaseAnonKeyInput.value = saved.supabaseAnonKey || "";

  const supabaseClient = await waitForSupabaseClient();
  const url = (import.meta.env.VITE_SUPABASE_URL || saved.supabaseUrl || "").trim();
  const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY || saved.supabaseAnonKey || "").trim();
  if (supabaseClient && url && anonKey) {
    state.client = supabaseClient.createClient(url, anonKey);
    state.auth = new AirControlApi(state.client);
    state.store = new SupabaseStore({ api: state.auth, tables: TABLES, onError: notify });
  }
  if (!state.store) {
    const client = getSupabaseClient();
    if (client) {
      state.client = client;
      state.auth = new AirControlApi(client);
      state.store = new SupabaseStore({ api: state.auth, tables: TABLES, onError: notify });
    }
  }
  if (!state.store) {
    notify("Falta configuración de Supabase. Define VITE_SUPABASE_URL y VITE_SUPABASE_ANON_KEY en el archivo de entorno (.env.local).");
  }
}

export async function restoreSession() {
  try {
    if (!state.auth) return;
    const sessionUser = await state.auth.currentSessionUser();
    if (!sessionUser) return;
    await loadData(sessionUser?.role);
    const user = state.users.find(
      (item) => (item.id === sessionUser.id || item.email.toLowerCase() === sessionUser.email?.toLowerCase()) && item.active !== false
    );
    if (!user) {
      sessionStorage.removeItem("aircontrol_current_user_id");
      await state.auth.signOut();
      return;
    }
    state.currentUser = user;
    resetSessionViewForUser(user);
    document.getElementById("loginView").classList.add("hidden");
    document.getElementById("mainView").classList.remove("hidden");
    // El render inicial lo hace init() después de aplicar la ruta desde el hash,
    // para no pisar un deep link como #/focal-command/tareas.
    if (user.must_change_password) openChangePasswordDialog(user);
  } catch (error) {
    console.warn("restoreSession falló:", error);
  }
}

export async function onLogin(event) {
  event.preventDefault();
  const email = document.getElementById("loginEmail").value.trim().toLowerCase();
  const password = document.getElementById("loginPassword").value;
  if (!isIndraEmail(email)) return notify("Usa un correo corporativo Indra.");
  if (!state.auth) return notify("Configura Supabase para iniciar sesión en producción.");

  const loginBtn = event.currentTarget.querySelector(".primary-btn");
  if (loginBtn) { loginBtn.disabled = true; loginBtn.textContent = "Ingresando..."; }
  let authUser;
  try {
    authUser = await state.auth.signIn(email, password);
    await loadData(authUser?.role);
  } catch (error) {
    if (loginBtn) { loginBtn.disabled = false; loginBtn.textContent = "Iniciar sesión"; }
    return notify(`No se pudo iniciar sesión: ${error.message}`);
  }

  const user = state.users.find(
    (item) => (item.id === authUser.id || item.email.toLowerCase() === email) && item.active !== false
  );
  if (!user) {
    await state.auth.signOut();
    return notify("Tu cuenta no tiene perfil activo en Control Modo Avión.");
  }

  const loginBtnAfter = document.getElementById("loginForm")?.querySelector(".primary-btn");
  if (loginBtnAfter) { loginBtnAfter.disabled = false; loginBtnAfter.textContent = "Iniciar sesión"; }
  state.currentUser = user;
  saveSessionUser(user);
  resetSessionViewForUser(user, { clearState: true });
  document.getElementById("loginView").classList.add("hidden");
  document.getElementById("mainView").classList.remove("hidden");
  if (user.must_change_password) openChangePasswordDialog(user);
  const { renderApp } = await import("./app-core.js");
  renderApp();
}

export async function onForgotPassword(event) {
  event.preventDefault();
  const email = document.getElementById("forgotEmail").value.trim().toLowerCase();
  if (!isIndraEmail(email)) return notify("Usa un correo corporativo Indra.");
  try {
    await state.auth.requestPasswordReset(email);
  } catch (error) {
    return notify(`No se pudo registrar la solicitud: ${error.message}`);
  }
  notify("Solicitud registrada. El admin podrá asignarte una nueva contraseña temporal.");
  toggleForgot(false);
}

export async function saveNewPassword(event) {
  event.preventDefault();
  const password = document.getElementById("newPassword").value;
  const repeat = document.getElementById("newPasswordRepeat")?.value || "";
  if (password.length < 8) return notify("Ingresa una contraseña de al menos 8 caracteres.");
  if (password !== repeat) return notify("Las contraseñas no coinciden.");
  try {
    await state.auth.updateOwnPassword(password);
  } catch (error) {
    return notify(`No se pudo actualizar la contraseña: ${error.message}`);
  }
  state.currentUser.must_change_password = false;
  await storeBrowserCredential(state.currentUser.email, password);
  document.getElementById("changePasswordDialog").close();
  notify("Contraseña actualizada.");
}

export async function assignTemporaryPassword(user, tempPassword) {
  return state.auth.invokeTemporaryPassword(user.email, tempPassword);
}

export function logout() {
  state.auth?.signOut();
  state.currentUser = null;
  sessionStorage.removeItem("aircontrol_current_user_id");
  state.activeTab = "dashboard";
  state.previousTab = null;
  state.showVacationForm = false;
  state.editingVacationId = null;
  state.filters = {};
  document.getElementById("mainView").classList.add("hidden");
  document.getElementById("loginView").classList.remove("hidden");
  document.getElementById("loginPassword").value = "";
  const content = document.getElementById("content");
  if (content) content.innerHTML = "";
  const nav = document.getElementById("navTabs");
  if (nav) nav.innerHTML = "";
  const alerts = document.getElementById("alertsBar");
  if (alerts) alerts.innerHTML = "";
}

export function toggleForgot(show) {
  document.getElementById("loginForm").classList.toggle("hidden", show);
  document.getElementById("forgotForm").classList.toggle("hidden", !show);
}

export function openChangePasswordDialog(user = state.currentUser) {
  const usernameInput = document.getElementById("changePasswordUsername");
  if (usernameInput) usernameInput.value = user?.email || "";
  document.getElementById("newPassword").value = "";
  document.getElementById("newPasswordRepeat").value = "";
  document.getElementById("changePasswordDialog").showModal();
  document.getElementById("newPassword")?.focus();
}

function saveSessionUser(user) {
  sessionStorage.setItem("aircontrol_current_user_id", user.id);
}

async function storeBrowserCredential(email, password) {
  if (!email || !password || !window.PasswordCredential || !navigator.credentials?.store) return;
  try {
    const credential = new PasswordCredential({ id: email, password, name: state.currentUser?.name || email });
    await navigator.credentials.store(credential);
  } catch {
    // browser policy may disable password saving
  }
}
