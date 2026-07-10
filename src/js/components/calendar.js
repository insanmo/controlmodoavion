import { state } from "../state.js";
import { safeCell, slug, svgIcon, monthName, toMonth } from "../utils.js";
import { filteredVacations, collaboratorName, filterToolbar } from "./common.js";
import { collaboratorColorIndex } from "./dashboard.js";

export function renderCalendar(content) {
  const month = state.filters.month || toMonth(new Date());
  const [year, monthIndex] = month.split("-").map(Number);
  const first = new Date(year, monthIndex - 1, 1);
  const days = new Date(year, monthIndex, 0).getDate();
  const offset = (first.getDay() + 6) % 7;
  const vacations = filteredVacations().filter((item) => item.start_date && item.end_date && overlapsMonth(item, month));
  let cells = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"].map((day) => `<div class="day-name">${day}</div>`).join("");
  for (let i = 0; i < offset; i++) cells += `<div class="day-cell"></div>`;
  for (let day = 1; day <= days; day++) {
    const date = `${month}-${String(day).padStart(2, "0")}`;
    const events = uniqueCalendarEvents(vacations.filter((item) => item.start_date <= date && item.end_date >= date));
    cells += `<div class="day-cell"><div class="day-number">${day}</div>${events.map((event) => `<button class="event-pill color-${collaboratorColorIndex(event.collaborator_id)} status-${slug(event.status || "pendiente")}" data-detail="${event.id}" type="button">${safeCell(collaboratorName(event.collaborator_id))}<br>${safeCell(event.status)}</button>`).join("")}</div>`;
  }
  content.innerHTML = `
    ${filterToolbar({ forceMonth: month, hideNew: true, hideExport: true })}
    <section class="panel calendar-panel">
      <div class="panel-header calendar-month-header">
        <h3>Calendario mensual</h3>
        <div class="calendar-title-row">
          <button class="circle-nav" data-calendar-prev type="button" aria-label="Mes anterior">${svgIcon("chevronLeft")}</button>
          <strong>${monthName(month)}</strong>
          <button class="circle-nav" data-calendar-next type="button" aria-label="Mes siguiente">${svgIcon("chevronRight")}</button>
        </div>
      </div>
      <div class="calendar-grid">${cells}</div>
    </section>
  `;
}

export function shiftCalendarMonth(delta) {
  const current = state.filters.month || toMonth(new Date());
  const [year, month] = current.split("-").map(Number);
  const date = new Date(year, month - 1 + delta, 1);
  state.filters.month = toMonth(date);
  renderActiveTabInternal();
}

function renderActiveTabInternal() {
  import("../app-core.js").then((mod) => mod.renderActiveTab());
}

function overlapsMonth(item, month) {
  return item.start_date <= `${month}-31` && item.end_date >= `${month}-01`;
}

function uniqueCalendarEvents(events) {
  const seen = new Set();
  return events.filter((event) => {
    const key = [
      event.collaborator_id,
      event.type,
      event.start_date,
      event.end_date,
      event.return_date,
      event.period_id || ""
    ].join("|");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
