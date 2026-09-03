import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../src/js/state.js";
import { canReprogramVacationRecord, canUpdateVacationRecord, minStartDateForType, minStartDateForVacationEdit, vacationMinMonthValue } from "../src/js/components/common.js";

function setOperationalSeptember() {
  state.periods = [{ id: "period-september", month: "2026-09", status: "abierto" }];
}

test("permite actualizar septiembre hasta el día 10 del mes operativo", () => {
  setOperationalSeptember();
  const vacation = { month: "2026-09", type: "vacaciones", start_date: "2026-09-14" };
  assert.equal(canUpdateVacationRecord(vacation, new Date(2026, 8, 10, 12)), true);
  assert.equal(minStartDateForVacationEdit(vacation, new Date(2026, 8, 10, 12)), "2026-09-01");
});

test("permite registrar vacaciones de septiembre hasta el día 10", () => {
  setOperationalSeptember();
  const cutoffDay = new Date(2026, 8, 10, 12);
  assert.equal(vacationMinMonthValue(cutoffDay), "2026-09");
  assert.equal(minStartDateForType("vacaciones", cutoffDay), "2026-09-01");
});

test("bloquea septiembre después del día 10", () => {
  setOperationalSeptember();
  const vacation = { month: "2026-09", type: "vacaciones", start_date: "2026-09-14" };
  const afterCutoff = new Date(2026, 8, 11, 12);
  assert.equal(vacationMinMonthValue(afterCutoff), "2026-10");
  assert.equal(minStartDateForType("vacaciones", afterCutoff), "2026-10-01");
  assert.equal(canUpdateVacationRecord(vacation, afterCutoff), false);
});

test("mantiene editables los registros futuros, incluido diciembre", () => {
  setOperationalSeptember();
  const vacation = { month: "2026-12", type: "vacaciones", start_date: "2026-12-14" };
  assert.equal(canUpdateVacationRecord(vacation, new Date(2026, 8, 20, 12)), true);
});

test("el focal reprograma su equipo hasta el día 10 y queda bloqueado después", () => {
  setOperationalSeptember();
  state.currentUser = { id: "focal-1", name: "Focal Uno", role: "focal" };
  state.personal = [{ id: "person-1", name: "Persona", status: "activo", focal_user_id: "focal-1", excel_fields: {} }];
  const vacation = { id: "vac-1", collaborator_id: "person-1", focal_user_id: "focal-1", type: "vacaciones", status: "Completado", end_date: "2026-08-23" };
  assert.equal(canReprogramVacationRecord(vacation, new Date(2026, 8, 10, 12)), true);
  assert.equal(canReprogramVacationRecord(vacation, new Date(2026, 8, 11, 12)), false);
});

test("admin y supervisor pueden reprogramar después del corte", () => {
  setOperationalSeptember();
  const vacation = { id: "vac-1", collaborator_id: "person-1", type: "vacaciones", status: "Completado", end_date: "2026-08-23" };
  state.currentUser = { id: "admin-1", role: "admin" };
  assert.equal(canReprogramVacationRecord(vacation, new Date(2026, 8, 20, 12)), true);
  state.currentUser = { id: "supervisor-1", role: "supervisor" };
  assert.equal(canReprogramVacationRecord(vacation, new Date(2026, 8, 20, 12)), true);
});
