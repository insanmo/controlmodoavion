import test, { beforeEach } from "node:test";
import assert from "node:assert/strict";
import { state } from "../src/js/state.js";
import { calculateVacationBalance, importedVacationBalanceFields, vacationBalanceCutoff } from "../src/js/components/dashboard.js";

const UPLOADED_AT = "2026-10-13T18:00:00Z";

beforeEach(() => {
  state.currentUser = { id: "admin", role: "admin" };
  state.personalImports = [{ id: "import-october", uploaded_at: UPLOADED_AT }];
  state.periods = [{ id: "october", month: "2026-10", status: "abierto" }];
  state.vacations = [];
});

function importedPerson(black = 0, current = 22, truncated = 19.92) {
  const person = {
    id: "casusol", last_import_id: "import-october",
    current_vacation_days: current, truncated_vacation_days: truncated,
    excel_fields: { "VACACIONES NEGRAS (Dias Laborables)": black, "VACACIONES POR VENCER": current, "VACACIONES TRUNCAS": truncated }
  };
  person.excel_fields = importedVacationBalanceFields(person, UPLOADED_AT);
  return person;
}

function booking(id, start, end, days, extra = {}) {
  return { id, collaborator_id: "casusol", period_id: "september", start_date: start, end_date: end, days, type: "vacaciones", status: "Completado", ...extra };
}

function casusolBookings() {
  return [booking("eight", "2026-11-30", "2026-12-07", 8), booking("three", "2026-11-11", "2026-11-13", 3)];
}

test("Casusol: descuenta los 11 días futuros registrados en septiembre del Excel de octubre", () => {
  const person = importedPerson();
  state.vacations = casusolBookings();
  const balance = calculateVacationBalance(person);
  assert.equal(balance.current, 11);
  assert.equal(balance.truncated, 19.92);
  assert.equal(balance.pending, 30.92);
  assert.equal(balance.allocations.get("three").currentDays, 3);
  assert.equal(balance.allocations.get("eight").currentDays, 8);
});

test("reserva primero negras, después por vencer y finalmente truncas en orden de fechas", () => {
  const person = importedPerson(4, 5, 10);
  state.vacations = casusolBookings();
  const balance = calculateVacationBalance(person);
  assert.equal(balance.black, 0);
  assert.equal(balance.current, 0);
  assert.equal(balance.truncated, 8);
  assert.deepEqual(balance.allocations.get("eight"), {
    blackDays: 1, currentDays: 5, truncatedDays: 2, formalDays: 7, usedBlack: true, usedTruncas: true
  });
});

test("no vuelve a descontar vacaciones iniciadas hasta el corte ni registros de otra persona", () => {
  const person = importedPerson();
  state.vacations = [
    ...casusolBookings(),
    booking("past", "2026-09-01", "2026-09-10", 10),
    booking("cutoff", "2026-10-13", "2026-10-13", 1),
    booking("ongoing", "2026-10-10", "2026-10-15", 6),
    booking("other", "2026-11-01", "2026-11-07", 7, { collaborator_id: "someone-else" })
  ];
  const balance = calculateVacationBalance(person);
  assert.equal(balance.current, 11);
  assert.equal(balance.allocations.size, 2);
});

test("recupera el corte de cargas anteriores y usa el día de Lima", () => {
  const person = importedPerson();
  for (const key of Object.keys(person.excel_fields)) {
    if (key.startsWith("__aircontrol_")) delete person.excel_fields[key];
  }
  state.personalImports[0].uploaded_at = "2026-10-14T02:00:00Z";
  assert.equal(vacationBalanceCutoff(person), "2026-10-13");
  state.vacations = casusolBookings();
  assert.equal(calculateVacationBalance(person).current, 11);
});

test("sin metadatos de importación tampoco excluye reservas futuras por su período", () => {
  const person = importedPerson();
  delete person.last_import_id;
  delete person.excel_fields.__aircontrol_vacation_cutoff_date;
  state.vacations = casusolBookings();
  assert.equal(calculateVacationBalance(person).current, 11);
});

test("mantiene las reservas al cambiar de período y al recalcular el saldo guardado", () => {
  const person = importedPerson();
  state.vacations = casusolBookings();
  const balance = calculateVacationBalance(person);
  person.current_vacation_days = balance.current;
  person.excel_fields["VACACIONES POR VENCER"] = balance.current;
  state.periods = [{ id: "december", month: "2026-12", status: "abierto" }];
  assert.equal(calculateVacationBalance(person).current, 11);
  assert.equal(calculateVacationBalance(person).current, 11);
});

test("una nueva carga reemplaza la base y el corte, sin conservar descuentos de la carga anterior", () => {
  const person = importedPerson();
  state.vacations = casusolBookings();
  assert.equal(calculateVacationBalance(person).current, 11);
  person.current_vacation_days = 19;
  person.excel_fields = { "VACACIONES POR VENCER": 19, "VACACIONES TRUNCAS": 19.92 };
  person.excel_fields = importedVacationBalanceFields(person, "2026-11-14T18:00:00Z");
  const balance = calculateVacationBalance(person);
  assert.equal(balance.current, 11);
  assert.equal(balance.allocations.has("three"), false);
  assert.equal(balance.allocations.get("eight").currentDays, 8);
});

test("editar o eliminar una reserva recalcula sobre la misma base sin doble descuento", () => {
  const person = importedPerson();
  state.vacations = casusolBookings();
  assert.equal(calculateVacationBalance(person, state.vacations.filter((item) => item.id !== "eight")).current, 19);
  const edited = state.vacations.map((item) => item.id === "eight" ? { ...item, days: 6 } : item);
  assert.equal(calculateVacationBalance(person, edited).current, 13);
});

test("reprogramados y descansos no duplican ni consumen la reserva", () => {
  const person = importedPerson();
  state.vacations = [
    ...casusolBookings(),
    booking("source", "2026-10-20", "2026-10-27", 8, { status: "Reprogramado", reprogrammed_to_id: "eight" }),
    booking("medical", "2026-11-02", "2026-11-04", 3, { type: "descanso médico" }),
    booking("birthday", "2026-11-05", "2026-11-05", 0.5, { type: "tarde libre" })
  ];
  assert.equal(calculateVacationBalance(person).current, 11);
});
