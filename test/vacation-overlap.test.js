import test from "node:test";
import assert from "node:assert/strict";
import { findVacationConflict } from "../src/js/components/vacations.js";

const proposed = { collaborator_id: "person", type: "vacaciones", start_date: "2026-12-21", end_date: "2027-01-04" };
const november = { id: "nov", collaborator_id: "person", type: "vacaciones", start_date: "2026-11-23", end_date: "2026-11-29", status: "Completado" };
const december = { ...november, id: "dec", start_date: "2026-12-28", end_date: "2027-01-03" };

test("el registro de noviembre de la captura no bloquea diciembre-enero", () => {
  assert.equal(findVacationConflict(proposed, [november]), null);
});
test("detecta un cruce de diciembre-enero aunque la tabla esté filtrada a noviembre", () => {
  assert.equal(findVacationConflict(proposed, [november, december]), december);
});
test("no bloquea un registro sustituido por una reprogramación ni un eliminado", () => {
  assert.equal(findVacationConflict(proposed, [
    { ...december, status: "Reprogramado", reprogrammed_to_id: "replacement" },
    { ...december, deleted_at: "2026-11-04T12:00:00Z" }
  ]), null);
});
test("un estado Reprogramado sin sustituto sigue ocupando su rango", () => {
  const pending = { ...december, status: "Reprogramado", reprogrammed_to_id: null };
  assert.equal(findVacationConflict(proposed, [pending]), pending);
});
test("editar el mismo registro, otros colaboradores y otros tipos no genera falso cruce", () => {
  assert.equal(findVacationConflict({ ...proposed, id: december.id }, [december]), null);
  assert.equal(findVacationConflict(proposed, [{ ...december, collaborator_id: "other" }, { ...december, type: "tarde libre" }]), null);
});
test("fin e inicio en el mismo día sí se cruzan; el día siguiente no", () => {
  const adjacent = { ...december, start_date: "2027-01-04", end_date: "2027-01-05" };
  assert.equal(findVacationConflict(proposed, [adjacent]), adjacent);
  assert.equal(findVacationConflict(proposed, [{ ...adjacent, start_date: "2027-01-05" }]), null);
});
