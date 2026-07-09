import { state, allowedTabsForUser } from "../state.js";
import { safeCell, dateText, toDateInput, toMonth, titleText, monthLabel, monthName, slug, personInitials, svgIcon, overlapsMonth, normalizeKey, numberText } from "../utils.js";
import { visibleVacations, visiblePersonal, collaboratorName, userName, activePeriod, canCurrentUserWriteVacations } from "./common.js";
import { updateRecord } from "../db.js";
import { notify } from "../ui.js";

export function dashboardTemplate() {
  const vacations = visibleVacations().filter((item) => item && item.start_date && item.end_date);
  const people = visiblePersonal();
  const now = new Date();
  const today = toDateInput(now);
  const thisMonth = toMonth(now);

  const alertCards = dashboardAlertCards(vacations, people);
  const dueBuckets = vacationDueBuckets(people, now);
  const birthdayRows = birthdayPeopleThisMonth(people, vacations, now);
  const birthdayPendingCount = birthdayRows.filter((item) => item.needsRest).length;
  const kpis = [
    { label: "Vacaciones del mes", value: vacations.filter((item) => item.month === thisMonth || overlapsMonth(item, thisMonth)).length, unit: "registros", icon: "calendar", tone: "blue" },
    { label: "Pendientes en sistema formal", value: vacations.filter((item) => !item.registered_formal).length, unit: "registros", icon: "clock", tone: "orange" },
    { label: "Sin cobertura confirmada", value: vacations.filter((item) => item.coverage_confirmed !== "si").length, unit: "registros", icon: "users", tone: "purple" },
    { label: "Vencen en 2 meses", value: dueBuckets.urgent.length, unit: "colaboradores", icon: "calendarDays", tone: "red" },
    { label: "Cumpleanos habiles del mes", value: birthdayPendingCount, unit: "por registrar", icon: "edit", tone: "green" }
  ];
  const recent = vacations
    .slice()
    .sort((a, b) => String(a.start_date).localeCompare(String(b.start_date)))
    .filter((item) => item.end_date >= today || item.status !== "Completado")
    .slice(0, 4);

  return `
    <section class="dashboard-alert-strip">
      ${alertCards.map((item) => `
        <article class="alert-card ${item.tone}">
          <span class="alert-icon">${svgIcon(item.icon)}</span>
          <p><strong>${item.value}</strong> ${item.label}</p>
        </article>
      `).join("")}
    </section>
    <section class="dashboard-kpi-grid">
      ${kpis.map((item) => `
        <article class="dashboard-kpi">
          <span class="kpi-icon ${item.tone}">${svgIcon(item.icon)}</span>
          <div>
            <h3>${item.label}</h3>
            <strong>${item.value}</strong>
            <span>${item.unit}</span>
          </div>
        </article>
      `).join("")}
    </section>
    ${dashboardUrgentDuePanel(dueBuckets.urgent)}
    <section class="dashboard-main-grid">
      <article class="dashboard-card vacation-followup">
        <div class="dashboard-card-header">
          <div>
            <h3>Seguimiento de vacaciones</h3>
            <p>Ultimos registros y su estado actual</p>
          </div>
          ${allowedTabsForUser().includes("consolidated") ? `<button class="ghost-btn compact-btn dashboard-link" data-goto-tab="consolidated" type="button">Ver consolidado ${svgIcon("chevronRight")}</button>` : ""}
        </div>
        ${dashboardVacationTable(recent)}
        <div class="dashboard-card-footer">
          <button class="ghost-btn compact-btn dashboard-link" data-goto-tab="vacations" type="button">Ver todos los registros</button>
        </div>
      </article>
      <div class="dashboard-side-stack">
        <article class="dashboard-card dashboard-birthday-card">
          <div class="dashboard-card-header compact">
            <div>
              <h3>Cumpleanos del mes</h3>
              <p>Descanso de medio dia segun dia habil</p>
            </div>
          </div>
          ${dashboardBirthdayList(birthdayRows)}
        </article>
        <article class="dashboard-card dashboard-calendar-card">
          <div class="dashboard-card-header compact">
            <div>
              <h3>Calendario de vacaciones</h3>
              <p>Vista rapida del mes actual</p>
            </div>
          </div>
          ${dashboardCalendarWidget(thisMonth, vacations)}
        </article>
      </div>
    </section>
  `;
}

function dashboardAlertCards(vacations, people) {
  const pendingRequests = state.passwordRequests.filter((item) => item.status === "pendiente").length;
  const dueBuckets = vacationDueBuckets(people);
  const birthdays = birthdayPeopleThisMonth(people, vacations);
  return [
    { icon: "calendar", tone: "red", value: dueBuckets.urgent.length, label: "vacaciones vencen en 2 meses" },
    { icon: "calendarDays", tone: "orange", value: dueBuckets.warning.length, label: "vacaciones vencen en 4 meses" },
    { icon: "edit", tone: "green", value: birthdays.filter((item) => item.needsRest).length, label: "cumpleanos habiles por registrar" },
    { icon: "file", tone: "yellow", value: vacations.filter((item) => item.po_approval !== "si").length, label: "registros sin conforme PO" },
    { icon: "users", tone: "purple", value: vacations.filter((item) => item.coverage_confirmed !== "si").length, label: "registros sin cobertura confirmada" },
    { icon: "edit", tone: "blue", value: vacations.filter((item) => !item.registered_formal).length, label: "pendientes de registrar en sistema" },
    { icon: "settings", tone: "green", value: pendingRequests, label: "solicitud de contrasena pendientes" }
  ];
}

function dashboardVacationTable(rows) {
  return `<div class="dashboard-table-wrap"><table class="dashboard-table dashboard-followup-table"><thead><tr><th>Colaborador</th><th>PO</th><th>Tipo</th><th>Inicio</th><th>Fin</th><th>Dias</th><th>Estado</th><th>Conforme PO</th></tr></thead><tbody>${rows.map((item) => `<tr><td><span class="person-cell"><span class="person-avatar color-${collaboratorColorIndex(item.collaborator_id)}">${personInitials(collaboratorName(item.collaborator_id))}</span><span class="dashboard-person-name">${safeCell(collaboratorName(item.collaborator_id))}</span></span></td><td>${safeCell(item.po || "")}</td><td>${titleText(item.type || "")}</td><td>${dateText(item.start_date)}</td><td>${dateText(item.end_date)}</td><td>${item.days || 0}</td><td><span class="status ${slug(item.status)}">${safeCell(item.status || "")}</span></td><td>${item.po_approval === "si" ? "Si" : titleText(item.po_approval || "pendiente")}</td></tr>`).join("") || `<tr><td colspan="8">Sin registros.</td></tr>`}</tbody></table></div>`;
}

function dashboardUrgentDuePanel(rows) {
  const sorted = rows
    .slice()
    .sort((a, b) => (parseDateValue(a.current_vacation_due_date)?.getTime() || 0) - (parseDateValue(b.current_vacation_due_date)?.getTime() || 0));
  return `
    <section class="dashboard-card due-execution-card">
      <div class="dashboard-card-header">
        <div>
          <h3>Vacaciones por ejecutar en 2 meses</h3>
          <p>Personas con dias por vencer y fecha maxima de salida cercana.</p>
        </div>
        <strong class="due-execution-count">${sorted.length}</strong>
      </div>
      ${sorted.length ? `
        <div class="due-execution-list">
          ${sorted.map((person) => `
            <article class="due-execution-item" title="Fecha maxima: ${dateText(person.current_vacation_due_date)}">
              <span class="person-avatar color-${collaboratorColorIndex(person.id)}">${personInitials(person.name)}</span>
              <div class="due-person">
                <strong>${safeCell(person.name)}</strong>
                <span>${safeCell(personExcelField(person, "PO") || person.po || "-")}</span>
              </div>
              <strong class="due-days">${dueMonthLabel(person.current_vacation_due_date)}</strong>
              <span class="due-date">${numberText(person.current_vacation_days)} dias</span>
            </article>
          `).join("")}
        </div>
      ` : `<div class="due-execution-empty">No hay vacaciones por vencer en los proximos 2 meses.</div>`}
    </section>
  `;
}

function dueMonthLabel(value) {
  const date = parseDateValue(value);
  if (!date) return "";
  const month = date.toLocaleDateString("es-PE", { month: "long" }).replace(/^./, (char) => char.toUpperCase());
  return `${month} ${String(date.getFullYear()).slice(-2)}`;
}

function dashboardCalendarWidget(month, vacations) {
  const [year, monthIndex] = month.split("-").map(Number);
  const first = new Date(year, monthIndex - 1, 1);
  const days = new Date(year, monthIndex, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const monthVacations = vacations.filter((item) => overlapsMonth(item, month));
  const peopleIds = [...new Set(monthVacations.map((item) => item.collaborator_id))].slice(0, 4);
  let cells = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"].map((day) => `<span class="dash-day-name">${day}</span>`).join("");
  for (let i = 0; i < offset; i++) cells += `<span class="dash-day muted"></span>`;
  for (let day = 1; day <= days; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const event = monthVacations.find((item) => item.start_date <= date && item.end_date >= date);
    cells += `<button class="dash-day ${event ? `marked color-${collaboratorColorIndex(event.collaborator_id)}` : ""}" data-detail="${event?.id || ""}" type="button" ${event ? "" : "disabled"}>${day}</button>`;
  }
  return `<div class="calendar-title-row current-month-only"><strong>${monthName(month)}</strong></div><div class="dashboard-calendar-grid">${cells}</div><div class="calendar-legend">${peopleIds.map((id) => `<span><i class="legend-dot color-${collaboratorColorIndex(id)}"></i>${safeCell(collaboratorName(id))}</span>`).join("")}</div>`;
}

function dashboardBirthdayList(rows) {
  if (!rows.length) return `<div class="birthday-list empty">Sin cumpleanos registrados este mes.</div>`;
  return `
    <div class="birthday-list">
      ${rows.map((item) => `
        <div class="birthday-item ${item.needsRest ? "needs-rest" : ""}">
          <span class="person-avatar color-${collaboratorColorIndex(item.person.id)}">${personInitials(item.person.name)}</span>
          <div>
            <strong>${safeCell(item.person.name)}</strong>
            <span>${dateText(item.date)} - ${item.isBusinessDay ? "Dia habil" : "No habil"}</span>
          </div>
          ${item.needsRest ? `<button class="birthday-register-btn" data-register-birthday-rest="${item.person.id}" data-birthday-date="${toDateInput(item.date)}" type="button" ${canCurrentUserWriteVacations() ? "" : "disabled"}>Registrar tarde libre</button>` : `<em>${item.restRegistered ? "Registrado" : "Solo cumpleanos"}</em>`}
        </div>
      `).join("")}
    </div>
  `;
}

export function collaboratorColorIndex(id) {
  const people = visiblePersonal().map((person) => person.id).sort();
  const index = people.indexOf(id);
  return index >= 0 ? index % 16 : 0;
}

export function dueSoonPeople() {
  return vacationDueBuckets().urgent;
}

export function warningDuePeople() {
  return vacationDueBuckets().warning;
}

export function vacationDueBuckets(people = visiblePersonal(), referenceDate = new Date()) {
  const today = startOfDay(referenceDate);
  const urgentLimit = addMonths(today, 2);
  const warningLimit = addMonths(today, 4);
  const buckets = { urgent: [], warning: [] };
  people.forEach((person) => {
    if (!person.current_vacation_due_date || Number(person.current_vacation_days || 0) <= 0) return;
    const due = parseDateValue(person.current_vacation_due_date);
    if (!due) return;
    if (due <= urgentLimit) buckets.urgent.push(person);
    else if (due <= warningLimit) buckets.warning.push(person);
  });
  return buckets;
}

export function birthdayPeopleThisMonth(people = visiblePersonal(), vacations = visibleVacations(), referenceDate = new Date()) {
  const month = referenceDate.getMonth();
  const year = referenceDate.getFullYear();
  return people
    .map((person) => {
      const birthDate = parseDateValue(personExcelField(person, "FECHA DE NACIMIENTO"));
      if (!birthDate || birthDate.getMonth() !== month) return null;
      const date = new Date(year, month, birthDate.getDate());
      const isBusinessDay = isBusinessDate(date);
      const restRegistered = hasBirthdayRestRegistration(person.id, toDateInput(date), vacations);
      return { person, date, isBusinessDay, restRegistered, needsRest: isBusinessDay && !restRegistered };
    })
    .filter(Boolean)
    .sort((a, b) => a.date - b.date || String(a.person.name || "").localeCompare(String(b.person.name || ""), "es"));
}

function hasBirthdayRestRegistration(personId, date, vacations) {
  return vacations.some((item) => {
    if (item.collaborator_id !== personId) return false;
    if (normalizeKey(item.type) !== "tarde_libre") return false;
    return item.start_date <= date && item.end_date >= date;
  });
}

function isBusinessDate(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const value = toDateInput(date);
  return !state.holidays.some((holiday) => holiday.date === value);
}

function addMonths(date, months) {
  const next = new Date(date);
  next.setMonth(next.getMonth() + months);
  return next;
}

function parseDateValue(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) return startOfDay(value);
  if (typeof value === "number") {
    const date = new Date(Math.round((value - 25569) * 86400 * 1000));
    return Number.isNaN(date.getTime()) ? null : startOfDay(date);
  }
  const raw = String(value).trim();
  if (!raw || raw === "-") return null;
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) {
    const year = Number(dmy[3].length === 2 ? `19${dmy[3]}` : dmy[3]);
    const date = new Date(year, Number(dmy[2]) - 1, Number(dmy[1]));
    return Number.isNaN(date.getTime()) ? null : startOfDay(date);
  }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
  const date = new Date(normalized);
  return Number.isNaN(date.getTime()) ? null : startOfDay(date);
}

function startOfDay(value) {
  const date = new Date(value);
  date.setHours(0, 0, 0, 0);
  return date;
}

export function calculateVacationBalance(person, vacations = state.vacations) {
  const scopedVacations = vacations
    .filter((item) => item.collaborator_id === person.id)
    .filter((item) => {
      const period = activePeriod();
      return !period || !item.period_id || item.period_id === period.id;
    })
    .slice()
    .sort(compareVacationOrder);
  const base = vacationBaseBalance(person);
  let black = base.black;
  let current = base.current;
  let truncated = base.truncated;
  const allocations = new Map();

  for (const vacation of scopedVacations) {
    const isNonDeductible = ["descanso médico", "tarde libre"].includes(vacation.type);
    const needed = isNonDeductible ? 0 : Number(vacation.days || 0);
    const fromBlack = Math.min(black, needed);
    const afterBlack = needed - fromBlack;
    const fromCurrent = Math.min(current, afterBlack);
    const afterCurrent = afterBlack - fromCurrent;
    const fromTruncated = Math.min(truncated, afterCurrent);
    if (afterCurrent > fromTruncated) {
      notify(`Saldo insuficiente: ${needed} dias solicitados, ${numberText(black + current + truncated)} disponibles para ${collaboratorName(person.id)}.`);
      throw new Error("Saldo insuficiente");
    }
    black = roundBalance(black - fromBlack);
    current = roundBalance(current - fromCurrent);
    truncated = roundBalance(truncated - fromTruncated);
    allocations.set(vacation.id, {
      blackDays: roundBalance(fromBlack),
      currentDays: roundBalance(fromCurrent),
      truncatedDays: roundBalance(fromTruncated),
      formalDays: roundBalance(fromCurrent + fromTruncated),
      usedBlack: fromBlack > 0,
      usedTruncas: fromTruncated > 0
    });
  }

  return { black, current, truncated, pending: roundBalance(black + current + truncated), allocations, base };
}

export async function applyVacationBalance(person, vacations = state.vacations) {
  const result = calculateVacationBalance(person, vacations);
  await updateRecord("personal", person.id, {
    current_vacation_days: result.current,
    truncated_vacation_days: result.truncated,
    updated_at: new Date().toISOString()
  });
  return result;
}

export function vacationTruncasUsageMap(vacations = state.vacations) {
  const usage = new Map();
  for (const person of visiblePersonal()) {
    try {
      const result = calculateVacationBalance(person, vacations);
      for (const [id, allocation] of result.allocations.entries()) {
        usage.set(id, allocation);
      }
    } catch {
      // Invalid balance is already reported during save; table rendering should keep working.
    }
  }
  return usage;
}

function vacationBaseBalance(person) {
  const internalBlack = numberFromPersonExcel(person, "__aircontrol_vacation_base_black");
  const internalCurrent = numberFromPersonExcel(person, "__aircontrol_vacation_base_current");
  const internalTruncated = numberFromPersonExcel(person, "__aircontrol_vacation_base_truncated");
  const excelBlack = numberFromPersonExcel(person, "VACACIONES NEGRAS (Dias Laborables)");
  const excelCurrent = numberFromPersonExcel(person, "VACACIONES POR VENCER");
  const excelTruncated = numberFromPersonExcel(person, "VACACIONES TRUNCAS");
  const savedVacations = state.vacations
    .filter((item) => item.collaborator_id === person.id)
    .filter((item) => {
      const period = activePeriod();
      return !period || !item.period_id || item.period_id === period.id;
    })
    .slice()
    .sort(compareVacationOrder);
  const savedBlackDays = savedVacations.reduce((sum, item) => sum + Number(item.black_vacation_days || 0), 0);
  const savedCurrentDays = savedVacations.reduce((sum, item) => sum + Number(item.current_vacation_days_used || 0), 0);
  const savedTruncatedDays = savedVacations.reduce((sum, item) => sum + Number(item.truncated_vacation_days_used || 0), 0);
  return {
    black: internalBlack.hasValue
      ? internalBlack.value
      : (excelBlack.hasValue ? excelBlack.value : savedBlackDays),
    current: internalCurrent.hasValue
      ? internalCurrent.value
      : (excelCurrent.hasValue ? excelCurrent.value : Number(person.current_vacation_days || 0) + savedCurrentDays),
    truncated: internalTruncated.hasValue
      ? internalTruncated.value
      : (excelTruncated.hasValue ? excelTruncated.value : Number(person.truncated_vacation_days || 0) + savedTruncatedDays)
  };
}

function numberFromPersonExcel(person, header) {
  const value = personExcelField(person, header);
  const raw = String(value ?? "").trim();
  if (!raw) return { hasValue: false, value: 0 };
  const number = Number(raw.replace(",", "."));
  return Number.isFinite(number) ? { hasValue: true, value: number } : { hasValue: false, value: 0 };
}

function personExcelField(person, header) {
  if (!person?.excel_fields || typeof person.excel_fields !== "object") return "";
  const exact = person.excel_fields[header];
  if (exact !== undefined && exact !== null) return exact;
  const normalized = normalizeKey(header);
  const key = Object.keys(person.excel_fields).find((item) => normalizeKey(item) === normalized);
  return key ? person.excel_fields[key] : "";
}

function roundBalance(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

function compareVacationOrder(a, b) {
  return String(a.start_date || "").localeCompare(String(b.start_date || ""))
    || String(a.created_at || "").localeCompare(String(b.created_at || ""))
    || String(a.id || "").localeCompare(String(b.id || ""));
}
