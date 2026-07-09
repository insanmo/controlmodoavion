import { state, isIndraEmail } from "../state.js";
import { safeCell } from "../utils.js";
import { updateRecord } from "../db.js";
import { notify, confirmAction } from "../ui.js";

export function renderProfilePage(content) {
  content.innerHTML = `
    <section class="dashboard-card profile-page-card">
      <div class="dashboard-card-header">
        <div>
          <h3>Mi perfil</h3>
          <p>Modifica tu usuario, correo y contraseña de acceso.</p>
        </div>
      </div>
      <form id="profilePageForm" class="profile-page-form">
        <label>Usuario<input name="name" type="text" value="${safeCell(state.currentUser.name || "")}" required></label>
        <label>Correo<input name="email" type="email" value="${safeCell(state.currentUser.email || "")}" required></label>
        <label>Nueva contraseña<input name="password" type="password" minlength="8" autocomplete="new-password" placeholder="Dejar vacío para no cambiar"></label>
        <label>Repetir nueva contraseña<input name="password_repeat" type="password" minlength="8" autocomplete="new-password" placeholder="Repetir contraseña nueva"></label>
        <div class="profile-actions">
          <button class="ghost-btn" id="cancelProfilePageBtn" type="button">Cancelar</button>
          <button class="primary-btn" type="submit">Guardar cambios</button>
        </div>
      </form>
      <hr class="profile-divider">
      <div class="profile-sessions">
        <h4>Sesiones activas</h4>
        <p>Cerrar todas las sesiones iniciadas en otros dispositivos o navegadores.</p>
        <button class="ghost-btn" id="revokeSessionsBtn" type="button">Cerrar otras sesiones</button>
      </div>
    </section>
  `;
}

export async function saveProfilePage(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget).entries());
  const name = form.name.trim();
  const email = form.email.trim().toLowerCase();
  const password = form.password;
  const passwordRepeat = form.password_repeat;
  if (!name) return notify("Ingresa tu usuario.");
  if (!isIndraEmail(email)) return notify("Usa un correo corporativo Indra.");
  if (password !== passwordRepeat) return notify("Las contraseñas no coinciden.");
  if (email !== state.currentUser.email.toLowerCase()) return notify("El correo no se puede cambiar desde el perfil para mantener la sesión segura.");
  if (state.users.some((user) => user.id !== state.currentUser.id && user.email.toLowerCase() === email)) return notify("Ese correo ya está registrado.");

  const changes = { name };
  if (password) {
    try {
      await state.auth.updateOwnPassword(password);
      await storeBrowserCredential(state.currentUser.email, password);
    } catch (error) {
      return notify(`No se pudo actualizar la contraseña: ${error.message}`);
    }
    changes.must_change_password = false;
  }
  await updateRecord("users", state.currentUser.id, changes);
  state.currentUser = state.users.find((user) => user.id === state.currentUser.id) || { ...state.currentUser, ...changes };
  notify("Perfil actualizado.");
  state.activeTab = state.previousTab || "dashboard";
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

export function cancelProfilePage() {
  state.activeTab = state.previousTab || "dashboard";
  import("../app-core.js").then((mod) => mod.renderApp());
}

export async function revokeSessions() {
  const confirmed = await confirmAction("Se cerrarán todas las demás sesiones activas. ¿Continuar?", {
    title: "Cerrar otras sesiones",
    confirmText: "Cerrar"
  });
  if (!confirmed) return;
  try {
    await state.auth.revokeOtherSessions();
    notify("Sesiones cerradas correctamente.");
  } catch (error) {
    notify(`No se pudieron cerrar las sesiones: ${error.message}`);
  }
}

async function storeBrowserCredential(email, password) {
  if (!email || !password || !window.PasswordCredential || !navigator.credentials?.store) return;
  try {
    const credential = new PasswordCredential({ id: email, password, name: state.currentUser?.name || email });
    await navigator.credentials.store(credential);
  } catch { /* browser policy may disable */ }
}
