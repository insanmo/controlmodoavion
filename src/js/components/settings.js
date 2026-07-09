import { state } from "../state.js";
import { safeCell, dateText, svgIcon, cleanText, normalizeKey } from "../utils.js";
import { persist, updateRecord, deleteRecord, loadData } from "../db.js";
import { notify, confirmAction } from "../ui.js";

export function renderSettings(content) {
  if (state.currentUser.role !== "admin") {
    content.innerHTML = `<section class="dashboard-card"><div class="dashboard-card-header"><h3>Acceso restringido</h3></div></section>`;
    return;
  }
  const editing = state.filters.editHolidayId ? state.holidays.find((item) => item.id === state.filters.editHolidayId) : null;
  const editingColumn = state.filters.editColumnId ? state.columnConfigs.find((item) => item.id === state.filters.editColumnId) : null;
  const year = state.filters.holidayYear || String(new Date().getFullYear());
  const query = String(state.filters.holidaySearch || "").toLowerCase();
  const rows = state.holidays
    .slice()
    .filter((item) => !year || String(item.date || "").startsWith(year))
    .filter((item) => !query || `${item.date || ""} ${item.description || ""}`.toLowerCase().includes(query))
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));

  content.innerHTML = `
    <section class="dashboard-card settings-hero-card">
      <div class="settings-hero-main">
        <span class="settings-icon">${svgIcon("calendar")}</span>
        <div>
          <h3>Feriados configurables</h3>
          <p>Estos feriados se usan para calcular la fecha de retorno. Puedes agregar, editar o eliminar registros.</p>
        </div>
      </div>
      <form id="holidayForm" class="settings-holiday-form">
        <input type="hidden" name="id" value="${editing?.id || ""}">
        <label>Fecha<input name="date" type="date" value="${editing?.date || ""}" required></label>
        <label>Descripción<input name="description" type="text" value="${safeCell(cleanText(editing?.description || ""))}" placeholder="Ej: Año Nuevo" required></label>
        <div class="settings-form-actions">
          <button class="primary-btn" type="submit">${editing ? "Guardar cambios" : "+ Agregar feriado"}</button>
          ${editing ? `<button class="ghost-btn" id="cancelHolidayBtn" type="button">Cancelar</button>` : ""}
        </div>
      </form>
      <aside class="settings-note">
        <strong>${svgIcon("file")} Importante</strong>
        <span>Estos feriados se consideran al calcular la fecha de retorno de las vacaciones.</span>
      </aside>
    </section>
    <section class="dashboard-card settings-list-card">
      <div class="settings-list-header">
        <div class="settings-title-inline"><span>${svgIcon("calendar")}</span><h3>Lista de feriados</h3></div>
        <div class="settings-list-tools">
          <select data-holiday-filter="holidayYear" aria-label="Año">${["2026", "2027", "2028"].map((item) => `<option value="${item}" ${year === item ? "selected" : ""}>${item}</option>`).join("")}</select>
          <input data-holiday-filter="holidaySearch" value="${safeCell(state.filters.holidaySearch || "")}" placeholder="Buscar feriado...">
        </div>
      </div>
      <div class="table-wrap settings-table-wrap holiday-table-wrap">
        <table class="holiday-table">
          <thead><tr><th></th><th>Fecha</th><th>Día</th><th>Descripción</th><th>Acciones</th></tr></thead>
          <tbody>${rows.length ? rows.map((item) => holidayRow(item)).join("") : `<tr><td colspan="5">Sin feriados.</td></tr>`}</tbody>
        </table>
      </div>
      <div class="settings-list-footer">Mostrando ${rows.length ? 1 : 0} a ${rows.length} de ${rows.length} feriados</div>
    </section>
    ${columnConfigSection(editingColumn)}
  `;
}

function holidayRow(item) {
  if (state.filters.editingHolidayRowId === item.id) {
    return `<tr class="editing-row" data-holiday-row="${item.id}">
      <td>${svgIcon("calendar")}</td>
      <td><input type="date" name="date" value="${item.date || ""}" required></td>
      <td><span class="day-pill">${holidayDayLabel(item.date)}</span></td>
      <td><input type="text" name="description" value="${safeCell(item.description || "")}" placeholder="Ej: Año Nuevo" required></td>
      <td><div class="table-action-buttons">
        <button class="save-square" data-save-holiday-row="${item.id}" type="button" title="Guardar">${svgIcon("check")}</button>
        <button class="delete-square" data-cancel-holiday-row="${item.id}" type="button" title="Cancelar">${svgIcon("close")}</button>
      </div></td>
    </tr>`;
  }
  return `<tr><td>${svgIcon("calendar")}</td><td>${dateText(item.date)}</td><td><span class="day-pill">${holidayDayLabel(item.date)}</span></td><td>${safeCell(item.description)}</td><td><div class="table-action-buttons"><button class="edit-square" data-edit-holiday-row="${item.id}" type="button" title="Editar en la fila">${svgIcon("edit")}</button><button class="delete-square" data-delete-holiday="${item.id}" type="button">${svgIcon("trash")}</button></div></td></tr>`;
}

function columnConfigSection(editingColumn) {
  const columns = (state.columnConfigs || [])
    .slice()
    .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0) || String(a.excel_header).localeCompare(String(b.excel_header)));
  return `
    <section class="dashboard-card settings-list-card column-config-card">
      <div class="settings-list-header">
        <div class="settings-title-inline"><span>${svgIcon("settings")}</span><h3>Columnas del Excel oficial</h3></div>
      </div>
      <form id="columnConfigForm" class="settings-column-form">
        <input type="hidden" name="id" value="${editingColumn?.id || ""}">
        <label>Nombre en Excel<input name="excel_header" value="${safeCell(editingColumn?.excel_header || "")}" required></label>
        <label>Nombre en sistema<input name="display_name" value="${safeCell(editingColumn?.display_name || "")}" required></label>
        <label>Orden<input name="display_order" type="number" value="${safeCell(editingColumn?.display_order || nextColumnOrder(columns))}" required></label>
        <label>Tipo<select name="data_type">${["text", "number", "date", "email"].map((type) => `<option value="${type}" ${(editingColumn?.data_type || "text") === type ? "selected" : ""}>${type}</option>`).join("")}</select></label>
        <label>Rol de cálculo<select name="calculation_role"><option value="">Ninguno</option>${calculationRoles().map(([value, label]) => `<option value="${value}" ${editingColumn?.calculation_role === value ? "selected" : ""}>${label}</option>`).join("")}</select></label>
        <label class="check-field"><input name="load_to_db" type="checkbox" ${editingColumn?.load_to_db === false ? "" : "checked"}> Cargar</label>
        <label class="check-field"><input name="show_in_personal" type="checkbox" ${editingColumn?.show_in_personal === false ? "" : "checked"}> Mostrar</label>
        <div class="settings-form-actions">
          <button class="primary-btn" type="submit">${editingColumn ? "Guardar columna" : "+ Agregar columna"}</button>
          ${editingColumn ? `<button class="ghost-btn" id="cancelColumnBtn" type="button">Cancelar</button>` : ""}
        </div>
      </form>
      <div class="table-scroll-proxy" data-scroll-proxy="columnConfig"><div></div></div>
      <div class="table-wrap settings-table-wrap column-config-table-wrap" data-scroll-target="columnConfig">
        <table class="column-config-table">
          <thead><tr><th>Orden</th><th>Excel</th><th>Sistema</th><th>Tipo</th><th>Carga</th><th>Muestra</th><th>Rol</th><th>Acciones</th></tr></thead>
          <tbody>${columns.length ? columns.map((column) => columnRow(column)).join("") : `<tr><td colspan="8">Sin columnas configuradas.</td></tr>`}</tbody>
        </table>
      </div>
    </section>
  `;
}

function calculationRoles() {
  return [
    ["identity_usuario", "Identidad: Usuario"],
    ["identity_matric_bcp", "Identidad: MATRIC. BCP"],
    ["name", "Nombre"],
    ["focal", "Focal"],
    ["po", "PO"],
    ["project", "Proyecto/Squad"],
    ["current_days", "Vacaciones por vencer"],
    ["truncated_days", "Vacaciones truncas"],
    ["pending_days", "Vacaciones pendientes"],
    ["final_pending_days", "Vacaciones pendientes finales"],
    ["black_days", "Vacaciones negras"],
    ["black_status", "Estado vacaciones negras"],
    ["current_due_date", "Fecha maxima"],
    ["truncated_to_current_date", "Fecha fin acta"]
  ];
}

function calculationRoleLabel(value) {
  if (!value) return "-";
  const found = calculationRoles().find(([val]) => val === value);
  return found ? found[1] : safeCell(value);
}

function columnRow(column) {
  if (state.filters.editingColumnRowId === column.id) {
    const dataTypes = ["text", "number", "date", "email"];
    return `<tr class="editing-row" data-column-row="${column.id}">
      <td><input type="number" name="display_order" value="${column.display_order || 0}" required></td>
      <td><input type="text" name="excel_header" value="${safeCell(column.excel_header || "")}" required></td>
      <td><input type="text" name="display_name" value="${safeCell(column.display_name || "")}" required></td>
      <td><select name="data_type">${dataTypes.map((type) => `<option value="${type}" ${(column.data_type || "text") === type ? "selected" : ""}>${type}</option>`).join("")}</select></td>
      <td><label class="check-inline"><input type="checkbox" name="load_to_db" ${column.load_to_db === false ? "" : "checked"}> Cargar</label></td>
      <td><label class="check-inline"><input type="checkbox" name="show_in_personal" ${column.show_in_personal === false ? "" : "checked"}> Mostrar</label></td>
      <td><select name="calculation_role"><option value="">Ninguno</option>${calculationRoles().map(([value, label]) => `<option value="${value}" ${column.calculation_role === value ? "selected" : ""}>${label}</option>`).join("")}</select></td>
      <td><div class="table-action-buttons">
        <button class="save-square" data-save-column-row="${column.id}" type="button" title="Guardar">${svgIcon("check")}</button>
        <button class="delete-square" data-cancel-column-row="${column.id}" type="button" title="Cancelar">${svgIcon("close")}</button>
      </div></td>
    </tr>`;
  }
  return `<tr>
    <td>${column.display_order || ""}</td>
    <td>${safeCell(column.excel_header)}</td>
    <td>${safeCell(column.display_name)}</td>
    <td>${safeCell(column.data_type || "text")}</td>
    <td>${column.load_to_db === false ? "no" : "si"}</td>
    <td>${column.show_in_personal === false ? "no" : "si"}</td>
    <td>${calculationRoleLabel(column.calculation_role)}</td>
    <td><div class="table-action-buttons"><button class="edit-square" data-edit-column-row="${column.id}" type="button" title="Editar en la fila">${svgIcon("edit")}</button><button class="delete-square" data-disable-column="${column.id}" type="button">${svgIcon("trash")}</button></div></td>
  </tr>`;
}

function nextColumnOrder(columns) {
  return Math.max(0, ...columns.map((column) => Number(column.display_order || 0))) + 1;
}

function holidayDayLabel(date) {
  if (!date) return "-";
  return new Date(`${date}T00:00:00`).toLocaleDateString("es-PE", { weekday: "short" }).replace(".", "").replace(/^./, (char) => char.toUpperCase());
}

export async function saveHoliday(event) {
  event.preventDefault();
  const form = new FormData(event.currentTarget);
  const id = form.get("id") || crypto.randomUUID();
  const row = { id, date: form.get("date"), description: form.get("description"), created_at: new Date().toISOString() };
  if (!row.date || !row.description) return notify("Completa fecha y descripción.");
  if (form.get("id")) await updateRecord("holidays", id, row);
  else await persist("holidays", row);
  state.filters.editHolidayId = null;
  await loadData();
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

export async function removeHoliday(id) {
  const confirmed = await confirmAction("Eliminar este feriado?", { title: "Eliminar feriado", confirmText: "Eliminar" });
  if (!confirmed) return;
  await deleteRecord("holidays", id);
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

export async function saveColumnConfig(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget).entries());
  const id = form.id || crypto.randomUUID();
  const duplicate = state.columnConfigs.find((column) =>
    column.id !== form.id && normalizeKey(column.excel_header) === normalizeKey(form.excel_header)
  );
  if (duplicate) return notify("Ya existe una columna con ese nombre de Excel.");
  const row = {
    excel_header: String(form.excel_header || "").trim(),
    display_name: String(form.display_name || "").trim(),
    display_order: Number(form.display_order || 0),
    data_type: form.data_type || "text",
    calculation_role: form.calculation_role || null,
    load_to_db: form.load_to_db === "on",
    show_in_personal: form.show_in_personal === "on",
    updated_at: new Date().toISOString()
  };
  if (!row.excel_header || !row.display_name) return notify("Completa nombre en Excel y nombre en sistema.");
  if (form.id) await updateRecord("columnConfigs", id, row);
  else await persist("columnConfigs", { id, ...row, created_at: new Date().toISOString() });
  state.filters.editColumnId = null;
  await loadData(state.currentUser?.role);
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

export async function disableColumnConfig(id) {
  const confirmed = await confirmAction("Desactivar esta columna? No se borrarÃ¡ el historial ya cargado.", { title: "Desactivar columna", confirmText: "Desactivar" });
  if (!confirmed) return;
  await updateRecord("columnConfigs", id, {
    load_to_db: false,
    show_in_personal: false,
    updated_at: new Date().toISOString()
  });
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

export function editColumnRow(id) {
  state.filters.editingColumnRowId = id;
  import("../app-core.js").then((mod) => mod.renderApp());
}

export function cancelColumnRowEdit() {
  state.filters.editingColumnRowId = null;
  import("../app-core.js").then((mod) => mod.renderApp());
}

export async function saveColumnConfigRow(id, rowEl) {
  const get = (name) => rowEl.querySelector(`[name="${name}"]`);
  const excelHeader = String(get("excel_header").value || "").trim();
  const displayName = String(get("display_name").value || "").trim();
  if (!excelHeader || !displayName) return notify("Completa nombre en Excel y nombre en sistema.");
  const duplicate = state.columnConfigs.find((column) => column.id !== id && normalizeKey(column.excel_header) === normalizeKey(excelHeader));
  if (duplicate) return notify("Ya existe una columna con ese nombre de Excel.");
  const row = {
    excel_header: excelHeader,
    display_name: displayName,
    display_order: Number(get("display_order").value || 0),
    data_type: get("data_type").value || "text",
    calculation_role: get("calculation_role").value || null,
    load_to_db: get("load_to_db").checked,
    show_in_personal: get("show_in_personal").checked,
    updated_at: new Date().toISOString()
  };
  await updateRecord("columnConfigs", id, row);
  state.filters.editingColumnRowId = null;
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

export function editColumnConfig(id) {
  state.filters.editColumnId = id;
  import("../app-core.js").then((mod) => mod.renderApp());
}

export function cancelColumnEdit() {
  state.filters.editColumnId = null;
  import("../app-core.js").then((mod) => mod.renderApp());
}

export function editHolidayRow(id) {
  state.filters.editingHolidayRowId = id;
  import("../app-core.js").then((mod) => mod.renderApp());
}

export function cancelHolidayRowEdit() {
  state.filters.editingHolidayRowId = null;
  import("../app-core.js").then((mod) => mod.renderApp());
}

export async function saveHolidayRow(id, rowEl) {
  const get = (name) => rowEl.querySelector(`[name="${name}"]`);
  const date = get("date").value;
  const description = String(get("description").value || "").trim();
  if (!date || !description) return notify("Completa fecha y descripción.");
  await updateRecord("holidays", id, { date, description, updated_at: new Date().toISOString() });
  state.filters.editingHolidayRowId = null;
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

export function editHoliday(id) {
  state.filters.editHolidayId = id;
  import("../app-core.js").then((mod) => mod.renderApp());
}

export function cancelHolidayEdit() {
  state.filters.editHolidayId = null;
  import("../app-core.js").then((mod) => mod.renderApp());
}
