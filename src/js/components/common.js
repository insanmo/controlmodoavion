import { state } from "../state.js";
import { safeCell, dateText, titleText, slug, svgIcon, normalizeKey } from "../utils.js";

const MARCHA_BLANCA_OPERATIONAL_MONTH = "2026-07";

export function visiblePersonal() {
  const rows = state.personal.filter((person) => person.status !== "inactivo" && !person.missing_from_latest_import);
  if (state.currentUser.role === "focal") {
    return rows.filter((person) => personBelongsToCurrentFocal(person));
  }
  return rows;
}

export function activePeriod() {
  const abierto = state.periods.find((period) => period.status === "abierto");
  if (abierto) return abierto;
  return state.periods.slice().sort((a, b) => String(b.month || "").localeCompare(String(a.month || "")))[0] || null;
}

export function periodStatusLabel(status) {
  if (status === "abierto") return "Abierto";
  if (status === "cerrado") return "Cerrado";
  return String(status || "");
}

export function canCurrentUserWriteVacations() {
  return activePeriod()?.status !== "cerrado";
}

export function currentMonthValue() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function nextMonthValue(month) {
  const [year, monthIndex] = String(month || currentMonthValue()).split("-").map(Number);
  const date = new Date(year, monthIndex, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function operationalMonthValue() {
  return activePeriod()?.month || currentMonthValue();
}

export function vacationMinMonthValue() {
  const operationalMonth = operationalMonthValue();
  if (operationalMonth === MARCHA_BLANCA_OPERATIONAL_MONTH) return operationalMonth;
  return nextMonthValue(operationalMonth);
}

export function minStartDateForType(type) {
  const vacationTypes = ["vacaciones", "otro"];
  const base = vacationTypes.includes(type) ? vacationMinMonthValue() : operationalMonthValue();
  return `${base}-01`;
}

export function visibleVacations(options = {}) {
  const peopleIds = new Set(visiblePersonal().map((person) => person.id));
  const period = activePeriod();
  const includeHistorical = Boolean(options.includeHistorical);
  if (state.currentUser.role === "focal") {
    return state.vacations
      .filter((vacation) => peopleIds.has(vacation.collaborator_id))
      .filter((vacation) => includeHistorical || !period || !vacation.period_id || vacation.period_id === period.id);
  }
  return state.vacations.filter((vacation) => includeHistorical || !period || !vacation.period_id || vacation.period_id === period.id);
}

export function personBelongsToCurrentFocal(person) {
  if (!state.currentUser || state.currentUser.role !== "focal") return true;
  const excelFocal = rawExcelField(person, "FOCAL");
  if (String(excelFocal || "").trim()) return normalizeKey(excelFocal) === normalizeKey(state.currentUser.name);
  return person.focal_user_id === state.currentUser.id;
}

export function rawExcelField(person, header) {
  if (!person?.excel_fields || typeof person.excel_fields !== "object") return "";
  const exact = person.excel_fields[header];
  if (exact !== undefined && exact !== null) return exact;
  const normalizedHeader = normalizeKey(header);
  const key = Object.keys(person.excel_fields).find((item) => normalizeKey(item) === normalizedHeader);
  return key ? person.excel_fields[key] : "";
}

export function collaboratorName(id) {
  return state.personal.find((item) => item.id === id)?.name || "Sin asignar";
}

export function userName(id) {
  return state.users.find((item) => item.id === id)?.name || "Sin asignar";
}

export function getEmailStatus(item) {
  if (!item) return "pendiente";
  if (item.email_status) return item.email_status;
  return item.email_sent ? "si" : "pendiente";
}

export function emailStatusLabel(item) {
  const status = getEmailStatus(item);
  if (status === "si") return "sí";
  if (status === "no") return "no";
  return "pendiente";
}

export function filterToolbar(options = {}) {
  const focals = state.users.filter((user) => user.role === "focal");
  const monthValue = options.forceMonth ?? state.filters.month ?? (options.allowEmptyMonth ? "" : toMonthInput(new Date()));
  const periodOptions = options.showPeriod
    ? `<label>Periodo<select data-filter="period"><option value="">Todos</option>${state.periods.map((period) => `<option value="${period.id}" ${state.filters.period === period.id ? "selected" : ""}>${safeCell(period.month)} - ${safeCell(periodStatusLabel(period.status))}</option>`).join("")}</select></label>`
    : "";
  const focalFilter = state.currentUser.role === "focal"
    ? `<label>Focal<input value="${safeCell(state.currentUser.name)}" readonly></label>`
    : `<label>Focal<select data-filter="focal"><option value="">Todos</option>${focals.map((user) => `<option value="${user.id}" ${state.filters.focal === user.id ? "selected" : ""}>${safeCell(user.name)}</option>`).join("")}</select></label>`;
  return `
    <section class="dashboard-card filters-card">
      <div class="filter-grid">
        <label>Mes<input data-filter="month" type="month" value="${monthValue}"></label>
        ${periodOptions}
        ${focalFilter}
        <label>PO<input data-filter="po" value="${safeCell(state.filters.po || "")}" placeholder="Buscar PO"></label>
        <label>Proyecto/Squad<input data-filter="project" value="${safeCell(state.filters.project || "")}" placeholder="Buscar squad..."></label>
        <label>Estado<select data-filter="status"><option value="">Todos</option>${["Completado", "Pendiente", "Reprogramado", "Observado"].map((status) => `<option value="${status}" ${state.filters.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
        <label>Cobertura<select data-filter="coverage"><option value="">Todos</option>${["si", "no", "pendiente"].map((coverage) => `<option value="${coverage}" ${state.filters.coverage === coverage ? "selected" : ""}>${coverage}</option>`).join("")}</select></label>
        <label>Colaborador<input data-filter="collaboratorText" value="${safeCell(state.filters.collaboratorText || "")}" placeholder="Buscar colaborador..."></label>
      </div>
      <div class="filter-actions">
        <button class="ghost-btn compact-btn" id="clearFiltersBtn" type="button">Limpiar filtros</button>
        ${options.hideNew ? "" : `<button class="primary-btn compact-btn" id="newVacationBtn" type="button" ${canCurrentUserWriteVacations() ? "" : "disabled title=\"Periodo cerrado\""}>+ Nuevo registro</button>`}
        ${options.hideExport ? "" : `<button class="ghost-btn compact-btn export-green" id="exportBtn" type="button">Exportar Excel</button>`}
      </div>
    </section>
  `;
}

export function filteredVacations(options = {}) {
  const collaboratorText = String(state.filters.collaboratorText || "").toLowerCase();
  const projectText = String(state.filters.project || "").toLowerCase();
  return visibleVacations({ includeHistorical: options.includeHistorical }).filter((item) => {
    const person = state.personal.find((row) => row.id === item.collaborator_id);
    if (state.filters.period && item.period_id !== state.filters.period) return false;
    if (state.filters.month && item.month !== state.filters.month && !overlapsMonth(item, state.filters.month)) return false;
    if (state.filters.focal && item.focal_user_id !== state.filters.focal) return false;
    if (state.filters.po && !String(item.po || "").toLowerCase().includes(String(state.filters.po).toLowerCase())) return false;
    if (projectText && !String(item.project || "").toLowerCase().includes(projectText)) return false;
    if (state.filters.status && item.status !== state.filters.status) return false;
    if (state.filters.coverage && item.coverage_confirmed !== state.filters.coverage) return false;
    if (collaboratorText && !String(person?.name || "").toLowerCase().includes(collaboratorText)) return false;
    return true;
  });
}

function toMonthInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function overlapsMonth(item, month) {
  return item.start_date <= `${month}-31` && item.end_date >= `${month}-01`;
}

export {
  toMonthInput,
  overlapsMonth
};
