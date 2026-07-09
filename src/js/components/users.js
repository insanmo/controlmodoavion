import { state, isIndraEmail } from "../state.js";
import { safeCell, inputField, selectField } from "../utils.js";
import { persist, updateRecord, deleteRecord, loadData } from "../db.js";
import { notify, confirmAction } from "../ui.js";

export function renderUsers(content) {
  const editingUser = state.filters.editUserId ? state.users.find((user) => user.id === state.filters.editUserId) : null;
  content.innerHTML = `
    <section class="panel">
      <div class="panel-header"><h3>${editingUser ? "Editar usuario" : "Crear usuario"}</h3></div>
      <form id="userForm" class="form-grid user-form">
        <input type="hidden" name="id" value="${safeCell(editingUser?.id || "")}">
        ${inputField("name", "Nombre", "text", editingUser?.name || "")}
        ${inputField("email", "Correo Indra", "email", editingUser?.email || "")}
        ${selectField("role", "Rol", [["admin", "admin"], ["supervisor", "supervisor"], ["focal", "focal"]], editingUser?.role || "focal")}
        ${selectField("active", "Activo", [["true", "si"], ["false", "no"]], String(editingUser?.active !== false))}
        ${editingUser ? "" : inputField("temp_password", "Contrasena temporal", "password")}
        <div class="user-form-actions">
          ${editingUser ? `<button class="ghost-btn" id="cancelUserEditBtn" type="button">Cancelar</button>` : ""}
          <button class="primary-btn" type="submit">${editingUser ? "Guardar cambios" : "Crear usuario"}</button>
        </div>
      </form>
    </section>
    <section class="panel">
      <div class="panel-header"><h3>Usuarios</h3></div>
      ${userTable()}
    </section>
  `;
}

export async function saveUser(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget).entries());
  const id = form.id || "";
  const editingUser = id ? state.users.find((user) => user.id === id) : null;
  const email = String(form.email || "").trim().toLowerCase();
  const name = String(form.name || "").trim();
  if (!name) return notify("Ingresa el nombre del usuario.");
  if (!isIndraEmail(email)) return notify("Usa un correo corporativo Indra.");
  if (state.users.some((user) => user.id !== id && String(user.email || "").toLowerCase() === email)) return notify("El usuario ya existe.");

  if (editingUser) {
    await updateRecord("users", id, {
      name,
      email,
      role: form.role,
      active: form.active !== "false",
      updated_at: new Date().toISOString()
    });
    state.filters.editUserId = null;
    notify("Usuario actualizado.");
    const { renderApp } = await import("../app-core.js");
    renderApp();
    return;
  }

  if (!form.temp_password || form.temp_password.length < 8) return notify("Ingresa una contrasena temporal de al menos 8 caracteres.");
  const row = {
    id: crypto.randomUUID(),
    name,
    email,
    role: form.role,
    temp_password: form.temp_password,
    must_change_password: true,
    active: form.active !== "false",
    created_at: new Date().toISOString()
  };
  await persist("users", row);
  await loadData();
  notify("Usuario creado con contrasena temporal.");
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

function userTable() {
  const users = sortedUsers();
  return `
    <div class="table-wrap users-table-wrap">
      <table>
        <thead><tr><th>${userSortHeader("name", "Nombre")}</th><th>${userSortHeader("email", "Correo")}</th><th>${userSortHeader("role", "Rol")}</th><th>${userSortHeader("must_change_password", "Debe cambiar clave")}</th><th>${userSortHeader("active", "Activo")}</th><th>Clave temporal</th><th>Acciones</th></tr></thead>
        <tbody>
          ${users.map((user) => `
            <tr>
              <td>${safeCell(user.name)}</td>
              <td>${safeCell(user.email)}</td>
              <td><span class="status reprogramado">${safeCell(user.role)}</span></td>
              <td>${user.must_change_password ? "si" : "no"}</td>
              <td><span class="status ${user.active !== false ? "completado" : "observado"}">${user.active !== false ? "activo" : "inactivo"}</span></td>
              <td><input class="temp-password-input user-temp-password-input" data-user-temp-password="${user.id}" type="password" minlength="8" placeholder="Min. 8 caracteres"></td>
              <td>
                <div class="table-action-buttons user-action-buttons">
                  <button class="ghost-btn compact-btn" data-edit-user="${user.id}" type="button">Editar</button>
                  <button class="ghost-btn compact-btn" data-toggle-user="${user.id}" type="button">${user.active !== false ? "Desactivar" : "Activar"}</button>
                  <button class="ghost-btn compact-btn" data-reset-user="${user.id}" type="button">Clave</button>
                  <button class="danger-btn compact-btn" data-delete-user="${user.id}" type="button">Eliminar</button>
                </div>
              </td>
            </tr>
          `).join("")}
        </tbody>
      </table>
    </div>
  `;
}

function sortedUsers() {
  const key = state.filters.userSortKey || "name";
  const direction = state.filters.userSortDir === "desc" ? -1 : 1;
  return state.users.slice().sort((a, b) => {
    const left = userSortValue(a, key);
    const right = userSortValue(b, key);
    return left.localeCompare(right, "es", { numeric: true, sensitivity: "base" }) * direction;
  });
}

function userSortValue(user, key) {
  const values = {
    name: user.name,
    email: user.email,
    role: user.role,
    must_change_password: user.must_change_password ? "si" : "no",
    active: user.active !== false ? "si" : "no",
    temp_password: "",
    actions: ""
  };
  return String(values[key] ?? "");
}

function userSortHeader(key, label) {
  const active = state.filters.userSortKey === key || (!state.filters.userSortKey && key === "name");
  const dir = active && state.filters.userSortDir === "desc" ? "desc" : "asc";
  const mark = active ? (dir === "desc" ? " ↓" : " ↑") : "";
  return `<button class="table-sort-btn ${active ? "active" : ""}" data-user-sort="${key}" type="button">${label}${mark}</button>`;
}

export function sortUsersBy(key) {
  const currentKey = state.filters.userSortKey || "name";
  const currentDir = state.filters.userSortDir || "asc";
  state.filters.userSortKey = key;
  state.filters.userSortDir = currentKey === key && currentDir === "asc" ? "desc" : "asc";
  import("../app-core.js").then((mod) => mod.renderActiveTab());
}

export function editUser(id) {
  state.filters.editUserId = id;
  import("../app-core.js").then((mod) => mod.renderActiveTab());
}

export function cancelUserEdit() {
  state.filters.editUserId = null;
  import("../app-core.js").then((mod) => mod.renderActiveTab());
}

export async function toggleUserActive(id) {
  const user = state.users.find((item) => item.id === id);
  if (!user) return notify("Usuario no encontrado.");
  if (user.id === state.currentUser.id && user.active !== false) return notify("No puedes desactivar tu propio usuario.");
  await updateRecord("users", id, { active: user.active === false, updated_at: new Date().toISOString() });
  notify(user.active === false ? "Usuario activado." : "Usuario desactivado.");
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

export async function removeUser(id) {
  const user = state.users.find((item) => item.id === id);
  if (!user) return notify("Usuario no encontrado.");
  if (user.id === state.currentUser.id) return notify("No puedes eliminar tu propio usuario.");
  const confirmed = await confirmAction(`Eliminar el usuario ${user.name}?`, { title: "Eliminar usuario", confirmText: "Eliminar" });
  if (!confirmed) return;
  try {
    await deleteRecord("users", id);
  } catch (error) {
    if (String(error?.message || "").toLowerCase().includes("registros asignados")) {
      await updateRecord("users", id, { active: false, updated_at: new Date().toISOString() });
      notify("El usuario tiene registros asignados, por eso se desactivo en lugar de eliminarse.");
      const { renderApp } = await import("../app-core.js");
      renderApp();
      return;
    }
    notify(`No se pudo eliminar el usuario: ${error.message}`);
    return;
  }
  state.filters.editUserId = null;
  notify("Usuario eliminado.");
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

export async function resetUserPassword(id) {
  const user = state.users.find((item) => item.id === id);
  if (!user) return notify("Usuario no encontrado.");
  const input = document.querySelector(`[data-user-temp-password="${id}"]`);
  const temp = input?.value?.trim() || "";
  try {
    const { assignTemporaryPassword } = await import("../auth.js");
    const result = await assignTemporaryPassword(user, temp);
    if (input) input.value = "";
    if (result?.temporaryPassword) {
      notify(`Contrasena temporal generada: ${result.temporaryPassword}. Compartela con el usuario.`);
    } else {
      notify("Contrasena temporal asignada. El usuario debera cambiarla al iniciar sesion.");
    }
    await import("../app-core.js").then((mod) => mod.renderApp({ forceReload: true }));
  } catch (error) {
    notify(`No se pudo asignar la clave temporal: ${error.message}`);
  }
}
