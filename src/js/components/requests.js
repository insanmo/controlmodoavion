import { state } from "../state.js";
import { safeCell, dateTimeText, slug, svgIcon } from "../utils.js";
import { notify } from "../ui.js";

export function renderRequests(content) {
  const rows = state.passwordRequests.slice().sort((a, b) => String(b.requested_at || "").localeCompare(String(a.requested_at || "")));
  content.innerHTML = `
    <section class="dashboard-card requests-card">
      <div class="dashboard-card-header"><div><h3>Solicitudes de recuperación</h3><p>Asigna una contraseña temporal a la cuenta que pidió recuperación.</p></div></div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>Correo</th><th>Estado</th><th>Solicitado</th><th>Contraseña temporal</th><th>Acciones</th></tr></thead>
          <tbody>${rows.map((request) => `<tr><td>${safeCell(request.email)}</td><td><span class="status ${slug(request.status)}">${safeCell(request.status)}</span></td><td>${dateTimeText(request.requested_at)}</td><td>${request.status === "pendiente" ? `<input class="temp-password-input" data-temp-password="${request.id}" type="text" placeholder="Mín. 8 caracteres">` : "Asignada"}</td><td>${request.status === "pendiente" ? `<button class="primary-btn compact-btn" data-resolve-request="${request.id}" type="button">Asignar Temporal</button>` : ""}</td></tr>`).join("") || `<tr><td colspan="5">Sin solicitudes.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

export async function resolveRequest(id) {
  const request = state.passwordRequests.find((item) => item.id === id);
  if (!request) return notify("Solicitud no encontrada.");
  const user = state.users.find((item) => item.email.toLowerCase() === request.email.toLowerCase());
  if (!user) return notify("No existe un usuario con ese correo.");
  const input = document.querySelector(`[data-temp-password="${id}"]`);
  const tempPassword = input?.value?.trim();
  if (!tempPassword || tempPassword.length < 8) { input?.focus(); return notify("Ingresa una contraseña temporal de al menos 8 caracteres."); }
  const { assignTemporaryPassword } = await import("../auth.js");
  await assignTemporaryPassword(user, tempPassword);
  notify("Contraseña temporal asignada.");
  import("../app-core.js").then((mod) => mod.renderApp({ forceReload: true }));
}
