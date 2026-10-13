import test from "node:test";
import assert from "node:assert/strict";
import { isImportablePersonalRow, normalizeAssignedExcelPersonRow, effectiveColumnConfigs } from "../src/js/components/personal.js";
import { personPo } from "../src/js/utils.js";
import { state } from "../src/js/state.js";

test("omite una fila de Excel que solo contiene PO o FOCAL", () => {
  assert.equal(isImportablePersonalRow({ PO: "Daniel Ayala", NOMBRE: "" }), false);
  assert.equal(isImportablePersonalRow({ FOCAL: "Daniel Ayala", TM: "" }), false);
});

test("acepta nombres de colaborador en las cabeceras compatibles", () => {
  assert.equal(isImportablePersonalRow({ NOMBRE: "PÉREZ, ANA" }), true);
  assert.equal(isImportablePersonalRow({ COLABORADOR: "Ana Pérez" }), true);
  assert.equal(isImportablePersonalRow({ TM: "Ana Pérez" }), true);
});

test("importa PO/PM como PO y reconoce su rol de columna", () => {
  state.columnConfigs = [];
  const row = normalizeAssignedExcelPersonRow({ TM: "Ana Pérez", " PO/PM ": "  Responsable actualizado  " });
  assert.equal(row.po, "Responsable actualizado");
  const [column] = effectiveColumnConfigs(["PO/PM"]);
  assert.equal(column.calculation_role, "po");
  assert.equal(column.load_to_db, true);
  assert.equal(normalizeAssignedExcelPersonRow({ PO: "Responsable anterior" }).po, "Responsable anterior");
  assert.equal(normalizeAssignedExcelPersonRow({ "PO/PM": "" }).po, "");
});

test("muestra PO/PM de la última carga aunque el PO guardado esté vacío o desactualizado", () => {
  for (const po of [null, "Responsable anterior"]) {
    assert.equal(personPo({ po, excel_fields: { "PO/PM": "Responsable nuevo" } }), "Responsable nuevo");
  }
  assert.equal(personPo({ po: "Respaldo", excel_fields: { PO: "PO anterior", "PO/PM": "PO nuevo" } }), "PO nuevo");
  assert.equal(personPo({ excel_fields: { PO: "PO clásico" } }), "PO clásico");
  assert.equal(personPo({ po: "PO guardado" }), "PO guardado");
  assert.equal(personPo(null), "");
});
