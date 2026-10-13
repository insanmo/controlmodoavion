import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../src/js/state.js";
import { canReprogramVacationRecord, canUpdateVacationRecord, minStartDateForType, minStartDateForVacationEdit, vacationMinMonthValue } from "../src/js/components/common.js";
import { renderVacationForm, syncEmbeddedVacationDerivedFields } from "../src/js/components/vacations.js";

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

test("permite registrar septiembre después del día 10 y conserva el corte de edición", () => {
  setOperationalSeptember();
  const vacation = { month: "2026-09", type: "vacaciones", start_date: "2026-09-14" };
  const afterCutoff = new Date(2026, 8, 11, 12);
  assert.equal(vacationMinMonthValue(afterCutoff), "2026-09");
  assert.equal(minStartDateForType("vacaciones", afterCutoff), "2026-09-01");
  assert.equal(canUpdateVacationRecord(vacation, afterCutoff), false);
});

test("mantiene editables los registros futuros, incluido diciembre", () => {
  setOperationalSeptember();
  const vacation = { month: "2026-12", type: "vacaciones", start_date: "2026-12-14" };
  assert.equal(canUpdateVacationRecord(vacation, new Date(2026, 8, 20, 12)), true);
});

test("habilita octubre completo después del corte sin admitir septiembre", () => {
  state.periods = [{ id: "period-october", month: "2026-10", status: "abierto" }];
  for (const day of [10, 11, 13, 31]) {
    const today = new Date(2026, 9, day, 12);
    assert.equal(vacationMinMonthValue(today), "2026-10");
    assert.equal(minStartDateForType("vacaciones", today), "2026-10-01");
    assert.equal(minStartDateForType("otro", today), "2026-10-01");
    assert.equal("2026-09-30" < minStartDateForType("vacaciones", today), true);
  }
});

test("el formulario permite vacaciones de octubre a noviembre y calcula el retorno", () => {
  state.periods = [{ id: "period-october", month: "2026-10", status: "abierto" }];
  state.currentUser = { id: "focal-1", name: "Focal Uno", role: "focal" };
  state.personal = [];
  state.users = [];
  state.vacations = [];
  state.filters = {};
  state.showVacationForm = true;
  state.editingVacationId = null;
  state.prefillVacationDefaults = null;
  const content = { innerHTML: "" };
  renderVacationForm(content);
  assert.match(content.innerHTML, /name="start_date" type="date" min="2026-10-01"/);
  assert.match(content.innerHTML, /name="end_date" type="date" min="2026-10-01"/);

  const form = {
    elements: {
      type: { value: "vacaciones" }, id: { value: "" },
      start_date: { value: "2026-10-26" }, end_date: { value: "2026-11-11" },
      return_date: {}, days: {}, month: {}
    },
    querySelector: () => null
  };
  const originalDocument = globalThis.document;
  globalThis.document = { getElementById: () => form };
  try {
    syncEmbeddedVacationDerivedFields();
    assert.equal(form.elements.start_date.min, "2026-10-01");
    assert.equal(form.elements.end_date.min, "2026-10-26");
    assert.equal(form.elements.end_date.value, "2026-11-11");
    assert.equal(form.elements.return_date.value, "2026-11-12");
    assert.equal(form.elements.days.value, 17);
    assert.equal(form.elements.month.value, "2026-10");
  } finally {
    if (originalDocument === undefined) delete globalThis.document;
    else globalThis.document = originalDocument;
  }
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
