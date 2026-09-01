import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../src/js/state.js";
import { canUpdateVacationRecord, minStartDateForVacationEdit } from "../src/js/components/common.js";

function setOperationalSeptember() {
  state.periods = [{ id: "period-september", month: "2026-09", status: "abierto" }];
}

test("permite actualizar septiembre hasta el día 10 del mes operativo", () => {
  setOperationalSeptember();
  const vacation = { month: "2026-09", type: "vacaciones", start_date: "2026-09-14" };
  assert.equal(canUpdateVacationRecord(vacation, new Date(2026, 8, 10, 12)), true);
  assert.equal(minStartDateForVacationEdit(vacation, new Date(2026, 8, 10, 12)), "2026-09-01");
});

test("bloquea septiembre después del día 10", () => {
  setOperationalSeptember();
  const vacation = { month: "2026-09", type: "vacaciones", start_date: "2026-09-14" };
  assert.equal(canUpdateVacationRecord(vacation, new Date(2026, 8, 11, 12)), false);
});

test("mantiene editables los registros futuros, incluido diciembre", () => {
  setOperationalSeptember();
  const vacation = { month: "2026-12", type: "vacaciones", start_date: "2026-12-14" };
  assert.equal(canUpdateVacationRecord(vacation, new Date(2026, 8, 20, 12)), true);
});
