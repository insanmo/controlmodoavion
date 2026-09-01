import test from "node:test";
import assert from "node:assert/strict";
import { isImportablePersonalRow } from "../src/js/components/personal.js";

test("omite una fila de Excel que solo contiene PO o FOCAL", () => {
  assert.equal(isImportablePersonalRow({ PO: "Daniel Ayala", NOMBRE: "" }), false);
  assert.equal(isImportablePersonalRow({ FOCAL: "Daniel Ayala", TM: "" }), false);
});

test("acepta nombres de colaborador en las cabeceras compatibles", () => {
  assert.equal(isImportablePersonalRow({ NOMBRE: "PÉREZ, ANA" }), true);
  assert.equal(isImportablePersonalRow({ COLABORADOR: "Ana Pérez" }), true);
  assert.equal(isImportablePersonalRow({ TM: "Ana Pérez" }), true);
});
