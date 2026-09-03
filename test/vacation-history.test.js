import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { state } from "../src/js/state.js";
import { filteredVacations, visibleVacations } from "../src/js/components/common.js";
import { renderCalendar } from "../src/js/components/calendar.js";
import { toDateInput, toMonth } from "../src/js/utils.js";
import { renderVacationForm } from "../src/js/components/vacations.js";
import { calculateVacationBalance, effectiveVacationBalance, vacationDueBuckets } from "../src/js/components/dashboard.js";

const ACTIVE_PERIOD_ID = "dc0ca20e-e28e-4cac-89e3-1c741dddfe19";
const CLOSED_PERIOD_ID = "25f40ea3-0378-41f3-9b93-67a45c5cd044";

function person(id, name) {
  return {
    id,
    name,
    status: "activo",
    current_vacation_days: 100,
    truncated_vacation_days: 100,
    excel_fields: {}
  };
}

function vacation({ id, collaboratorId, periodId, start, end, month = start.slice(0, 7), type = "vacaciones" }) {
  return {
    id,
    collaborator_id: collaboratorId,
    focal_user_id: "focal-1",
    period_id: periodId,
    month,
    start_date: start,
    end_date: end,
    return_date: end,
    days: 7,
    type,
    status: "Completado",
    po_approval: "si",
    coverage_confirmed: "si",
    registered_formal: true
  };
}

beforeEach(() => {
  state.currentUser = { id: "admin-1", name: "Administrador", role: "admin" };
  state.activeTab = "vacations";
  state.filters = {};
  state.showVacationForm = false;
  state.periods = [
    { id: ACTIVE_PERIOD_ID, month: "2026-08", status: "abierto" },
    { id: CLOSED_PERIOD_ID, month: "2026-07", status: "cerrado" }
  ];
  state.users = [{ id: "focal-1", name: "Focal Uno", role: "focal" }];
  state.personal = [
    person("historical", "Histórico Agosto"),
    person("active-september", "Activo Septiembre"),
    person("spanning", "Cruza Agosto Septiembre"),
    person("active-august", "Activo Agosto"),
    person("wrong-month", "Mes Derivado Incorrecto")
  ];
  state.vacations = [
    vacation({
      id: "historical-august",
      collaboratorId: "historical",
      periodId: CLOSED_PERIOD_ID,
      start: "2026-08-03",
      end: "2026-08-09"
    }),
    vacation({
      id: "active-september",
      collaboratorId: "active-september",
      periodId: ACTIVE_PERIOD_ID,
      start: "2026-09-14",
      end: "2026-09-20"
    }),
    vacation({
      id: "spanning-months",
      collaboratorId: "spanning",
      periodId: CLOSED_PERIOD_ID,
      start: "2026-08-17",
      end: "2026-09-03"
    }),
    vacation({
      id: "active-august",
      collaboratorId: "active-august",
      periodId: ACTIVE_PERIOD_ID,
      start: "2026-08-10",
      end: "2026-08-10",
      type: "tarde libre"
    }),
    vacation({
      id: "wrong-derived-month",
      collaboratorId: "wrong-month",
      periodId: ACTIVE_PERIOD_ID,
      start: "2026-09-28",
      end: "2026-10-04",
      month: "2026-08"
    })
  ];
});

test("Registro incluye vacaciones de un período cerrado al consultar agosto", () => {
  const ids = filteredVacations({ includeHistorical: true, month: "2026-08" }).map((item) => item.id);
  assert.ok(ids.includes("historical-august"));
});

test("Calendario de agosto renderiza vacaciones históricas", () => {
  state.filters.month = "2026-08";
  const content = { innerHTML: "" };
  renderCalendar(content);
  assert.match(content.innerHTML, /Histórico Agosto/);
});

test("Calendario remarca automáticamente el día actual", () => {
  const today = new Date();
  state.filters.month = toMonth(today);
  const content = { innerHTML: "" };
  renderCalendar(content);
  assert.match(content.innerHTML, new RegExp(`class="day-cell is-today" data-date="${toDateInput(today)}" aria-current="date"`));
  assert.match(content.innerHTML, /class="today-label">Hoy</);
});

test("Una vacación activa de septiembre no aparece en agosto y sí en septiembre", () => {
  const augustIds = filteredVacations({ includeHistorical: true, month: "2026-08" }).map((item) => item.id);
  const septemberIds = filteredVacations({ includeHistorical: true, month: "2026-09" }).map((item) => item.id);
  assert.ok(!augustIds.includes("active-september"));
  assert.ok(septemberIds.includes("active-september"));
});

test("Una vacación 17/08/2026–03/09/2026 aparece en ambos meses", () => {
  const augustIds = filteredVacations({ includeHistorical: true, month: "2026-08" }).map((item) => item.id);
  const septemberIds = filteredVacations({ includeHistorical: true, month: "2026-09" }).map((item) => item.id);
  assert.ok(augustIds.includes("spanning-months"));
  assert.ok(septemberIds.includes("spanning-months"));
});

test("Registro aplica desde el primer render el mismo mes que muestra", () => {
  const currentMonth = `${new Date().getFullYear()}-${String(new Date().getMonth() + 1).padStart(2, "0")}`;
  const nextMonthDate = new Date(`${currentMonth}-01T00:00:00`);
  nextMonthDate.setMonth(nextMonthDate.getMonth() + 1);
  const nextMonth = `${nextMonthDate.getFullYear()}-${String(nextMonthDate.getMonth() + 1).padStart(2, "0")}`;
  state.personal.push(person("current-render", "Visible Mes Inicial"), person("next-render", "Oculto Mes Siguiente"));
  state.vacations.push(
    vacation({ id: "current-render", collaboratorId: "current-render", periodId: ACTIVE_PERIOD_ID, start: `${currentMonth}-10`, end: `${currentMonth}-10` }),
    vacation({ id: "next-render", collaboratorId: "next-render", periodId: ACTIVE_PERIOD_ID, start: `${nextMonth}-10`, end: `${nextMonth}-10` })
  );
  const content = { innerHTML: "" };
  renderVacationForm(content);
  assert.match(content.innerHTML, new RegExp(`data-filter="month" type="month" value="${currentMonth}"`));
  assert.match(content.innerHTML, /Visible Mes Inicial/);
  assert.doesNotMatch(content.innerHTML, /Oculto Mes Siguiente/);
});

test("Cambiar agosto → septiembre → agosto conserva resultados correctos", () => {
  const firstAugust = filteredVacations({ includeHistorical: true, month: "2026-08" }).map((item) => item.id);
  const september = filteredVacations({ includeHistorical: true, month: "2026-09" }).map((item) => item.id);
  const secondAugust = filteredVacations({ includeHistorical: true, month: "2026-08" }).map((item) => item.id);
  assert.deepEqual(secondAugust, firstAugust);
  assert.ok(september.includes("active-september"));
});

test("El filtro period de Consolidado no contamina Registro ni Calendario", () => {
  state.filters.period = ACTIVE_PERIOD_ID;
  const regularIds = filteredVacations({ includeHistorical: true, month: "2026-08" }).map((item) => item.id);
  const consolidatedIds = filteredVacations({ includeHistorical: true, month: "2026-08", applyPeriodFilter: true }).map((item) => item.id);
  assert.ok(regularIds.includes("historical-august"));
  assert.ok(!consolidatedIds.includes("historical-august"));

  state.filters.month = "2026-08";
  const calendarContent = { innerHTML: "" };
  renderCalendar(calendarContent);
  assert.match(calendarContent.innerHTML, /Histórico Agosto/);
});

test("Dashboard conserva el alcance del período activo", () => {
  const ids = visibleVacations().map((item) => item.id);
  assert.ok(ids.includes("active-september"));
  assert.ok(ids.includes("active-august"));
  assert.ok(!ids.includes("historical-august"));
  assert.ok(!ids.includes("spanning-months"));
});

test("Cerrar período no contiene operaciones sobre vacaciones", () => {
  const source = readFileSync(new URL("../src/js/components/personal.js", import.meta.url), "utf8");
  const closeBody = source.slice(source.indexOf("export async function startPeriodClose"), source.indexOf("export async function activateNextPeriod"));
  assert.match(closeBody, /updateRecord\("periods", period\.id/);
  assert.doesNotMatch(closeBody, /updateRecord\("vacations"|deleteRecord\("vacations"|state\.vacations\s*=/);
});

test("La API continúa excluyendo vacaciones con deleted_at", () => {
  const source = readFileSync(new URL("../supabase/functions/aircontrol-api/index.ts", import.meta.url), "utf8");
  assert.match(source, /\["users", "personal", "vacations"\]\.includes\(name\)\) query = query\.is\("deleted_at", null\)/);
});

test("El filtro mensual usa fechas aunque month sea incorrecto", () => {
  const augustIds = filteredVacations({ includeHistorical: true, month: "2026-08" }).map((item) => item.id);
  const septemberIds = filteredVacations({ includeHistorical: true, month: "2026-09" }).map((item) => item.id);
  assert.ok(!augustIds.includes("wrong-derived-month"));
  assert.ok(septemberIds.includes("wrong-derived-month"));
});

test("El saldo incluye una vacación registrada en el período anterior si se ejecuta en el período activo", () => {
  state.periods = [
    { id: ACTIVE_PERIOD_ID, month: "2026-09", status: "abierto" },
    { id: CLOSED_PERIOD_ID, month: "2026-08", status: "cerrado" }
  ];
  const target = person("prior-period-booking", "Registrado en Agosto");
  target.current_vacation_days = 15;
  target.excel_fields = { "VACACIONES POR VENCER": 15 };
  state.personal.push(target);
  state.vacations.push(vacation({
    id: "august-registration-september-execution",
    collaboratorId: target.id,
    periodId: CLOSED_PERIOD_ID,
    start: "2026-09-14",
    end: "2026-09-27"
  }));
  state.vacations.at(-1).days = 14;

  assert.equal(calculateVacationBalance(target).current, 1);
});

test("La alerta descuenta vacaciones programadas aunque se hayan registrado en agosto", () => {
  state.periods = [
    { id: ACTIVE_PERIOD_ID, month: "2026-09", status: "abierto" },
    { id: CLOSED_PERIOD_ID, month: "2026-08", status: "cerrado" }
  ];
  const covered = person("covered-due-days", "Vacaciones Cubiertas");
  covered.current_vacation_days = 12;
  covered.current_vacation_due_date = "2026-09-26";
  covered.excel_fields = { "VACACIONES POR VENCER": 12 };
  state.personal.push(covered);
  state.vacations.push(vacation({
    id: "covered-from-august",
    collaboratorId: covered.id,
    periodId: CLOSED_PERIOD_ID,
    start: "2026-09-02",
    end: "2026-09-13"
  }));
  state.vacations.at(-1).days = 12;

  const buckets = vacationDueBuckets([covered], new Date("2026-09-03T12:00:00"));
  assert.equal(buckets.urgent.length, 0);
});

test("El saldo efectivo actualiza por vencer, truncas y pendientes en Personal", () => {
  state.periods = [
    { id: ACTIVE_PERIOD_ID, month: "2026-09", status: "abierto" },
    { id: CLOSED_PERIOD_ID, month: "2026-08", status: "cerrado" }
  ];
  const target = person("mixed-balance", "Saldo Mixto");
  target.current_vacation_days = 4;
  target.truncated_vacation_days = 25.17;
  target.current_vacation_due_date = "2026-09-26";
  target.excel_fields = {
    "VACACIONES POR VENCER": 4,
    "VACACIONES TRUNCAS": 25.17,
    "VACACIONES GANADAS": 29.17,
    "VACACIONES PENDIENTES": 29.17
  };
  state.personal.push(target);
  state.vacations.push(vacation({
    id: "mixed-from-august",
    collaboratorId: target.id,
    periodId: CLOSED_PERIOD_ID,
    start: "2026-09-21",
    end: "2026-09-27"
  }));

  const balance = effectiveVacationBalance(target);
  assert.equal(balance.current, 0);
  assert.equal(balance.truncated, 22.17);
  assert.equal(balance.pending, 22.17);
  assert.equal(vacationDueBuckets([target], new Date("2026-09-03T12:00:00")).urgent.length, 0);
});

test("Una reprogramación negra transfiere el consumo sin descontarlo dos veces", () => {
  state.periods = [{ id: ACTIVE_PERIOD_ID, month: "2026-09", status: "abierto" }];
  const target = person("reprogrammed-person", "Jaime Valer");
  target.current_vacation_days = 22;
  target.excel_fields = { "VACACIONES POR VENCER": 22 };
  state.personal.push(target);
  const source = vacation({
    id: "august-source",
    collaboratorId: target.id,
    periodId: CLOSED_PERIOD_ID,
    start: "2026-08-17",
    end: "2026-08-23"
  });
  source.status = "Reprogramado";
  source.reprogrammed_to_id = "september-destination";
  const destination = vacation({
    id: "september-destination",
    collaboratorId: target.id,
    periodId: ACTIVE_PERIOD_ID,
    start: "2026-09-14",
    end: "2026-09-18"
  });
  destination.reprogrammed_from_id = source.id;
  destination.is_exception_black = true;
  destination.exception_black_days = 7;
  state.vacations.push(source, destination);

  const result = calculateVacationBalance(target);
  assert.equal(result.current, 15);
  assert.equal(result.allocations.has(source.id), false);
  assert.equal(result.allocations.get(destination.id).currentDays, 7);
});

test("El diálogo de reprogramación importa el formateador de días que utiliza", () => {
  const source = readFileSync(new URL("../src/js/components/vacations.js", import.meta.url), "utf8");
  const imports = source.slice(0, source.indexOf("export function"));
  assert.match(imports, /import \{[^}]*\bnumberText\b[^}]*\} from "\.\.\/utils\.js"/s);
});
