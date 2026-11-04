import test from "node:test";
import assert from "node:assert/strict";
import { state } from "../src/js/state.js";
import { findUserByName, focalUsers, userIdentityKey, defaultFocalUser, resolvePersonalFocal, DEFAULT_FOCAL_CONFIG } from "../src/js/user-identity.js";
import { findOrCreateFocal } from "../src/js/components/personal.js";

const supervisor = { id: "supervisor", name: "Daniel Ayala", role: "supervisor", active: true };
const focal = { id: "focal", name: "Daniel Ayala", role: "focal", active: true };

test("la carga reutiliza al supervisor incluso si ya hay un focal duplicado", async () => {
  state.currentUser = { id: "admin", role: "admin" };
  state.users = [focal, supervisor];
  state.store = { insert() { assert.fail("No debe crear otra cuenta"); } };
  assert.equal(await findOrCreateFocal("DANIEL AYALA", [focal]), supervisor);
  state.users = [supervisor];
  assert.equal(await findOrCreateFocal("Ayala, Daniel", []), supervisor);
  assert.equal(supervisor.role, "supervisor");
});

test("normaliza acentos, espacios y orden de nombres con coma sin adivinar abreviaturas", () => {
  const rosa = { id: "rosa", name: "Rosa Hernández", role: "supervisor" };
  assert.equal(userIdentityKey(" HERNÁNDEZ,  ROSA "), userIdentityKey(rosa.name));
  assert.equal(findUserByName("Rosa Hernandez", [rosa]), rosa);
  assert.equal(findUserByName("Rosa H.", [rosa]), null);
  assert.equal(findUserByName("", [rosa]), null);
});

test("los selectores incluyen al supervisor asignado y mantienen una sola opción por persona", () => {
  const other = { id: "other", name: "Otro supervisor", role: "supervisor" };
  state.users = [focal, supervisor, other];
  state.personal = [{ focal_user_id: focal.id }];
  assert.deepEqual(focalUsers(), [supervisor]);
  state.users = [supervisor, other];
  state.personal = [{ focal_user_id: supervisor.id }];
  assert.deepEqual(focalUsers(), [supervisor]);
  state.personal = [{ excel_fields: { FOCAL: "AYALA, DANIEL" } }];
  assert.deepEqual(focalUsers(), [supervisor]);
});

test("la carga sigue creando focales nuevos cuando no existe la persona", async () => {
  state.currentUser = { id: "admin", role: "admin" };
  state.users = [];
  state.importedFocalCredentials = [];
  const inserts = [];
  state.store = {
    async insert(table, row) { inserts.push({ table, row }); },
    async select() { return inserts.map(({ row }) => ({ ...row, id: "real-database-id", temp_password: undefined })); }
  };
  const created = await findOrCreateFocal("Nueva Persona", []);
  assert.equal(created.role, "focal");
  assert.equal(created.id, "real-database-id");
  assert.notEqual(created.id, inserts[0].row.id);
  assert.equal(inserts.length, 1);
  assert.equal(inserts[0].table, "users");
  assert.equal(await findOrCreateFocal("NUEVA PERSONA", []), created);
  assert.equal(inserts.length, 1);
});

test("Rosa supervisora es el destino inicial; la configuración compartida permite elegir otro", () => {
  const rosa = { id: "rosa", name: "Hernández, Rosa", role: "supervisor", active: true };
  state.users = [supervisor, rosa];
  state.defaultFocalConfig = null;
  assert.equal(defaultFocalUser(), rosa);
  assert.equal(resolvePersonalFocal({ focal_user_id: "id-eliminado" }, ""), rosa);
  assert.equal(resolvePersonalFocal({ focal_user_id: "id-eliminado" }, "Daniel Ayala"), supervisor);
  state.defaultFocalConfig = { display_name: supervisor.id };
  assert.equal(defaultFocalUser(), supervisor);
  state.defaultFocalConfig = { display_name: "id-eliminado" };
  assert.equal(defaultFocalUser(), null);
});

test("vacíos y marcadores sin focal se asignan al predeterminado sin crear cuentas", async () => {
  const rosa = { id: "rosa", name: "Rosa Hernandez", role: "supervisor", active: true };
  state.currentUser = { id: "admin", role: "admin" };
  state.users = [rosa];
  state.defaultFocalConfig = null;
  state.store = { insert() { assert.fail("No debe crear un usuario sin focal"); } };
  for (const name of ["", "  ", "-", "Sin Focal", "SIN ASIGNAR", "N/A"]) {
    assert.equal(await findOrCreateFocal(name, []), rosa);
  }
});

test("recargar guarda los colaboradores sin focal y separa la preferencia de columnas Excel", async () => {
  const { loadData } = await import("../src/js/db.js");
  const rosa = { id: "rosa", name: "Rosa Hernandez", role: "supervisor", active: true };
  state.currentUser = { id: "admin", role: "admin" };
  const writes = [];
  state.store = {
    async select(table) {
      if (table === "users") return [rosa];
      if (table === "personal") return [{ id: "unassigned", focal_user_id: null }, { id: "assigned", focal_user_id: "another" }];
      if (table === "columnConfigs") return [{ id: "setting", excel_header: DEFAULT_FOCAL_CONFIG, display_name: rosa.id }, { id: "column", excel_header: "TM" }];
      return [];
    },
    async batchUpdate(table, ids, changes) { writes.push({ table, ids, changes }); }
  };
  await loadData("admin");
  assert.equal(state.personal[0].focal_user_id, rosa.id);
  assert.equal(state.personal[1].focal_user_id, "another");
  assert.deepEqual(writes[0].ids, ["unassigned"]);
  assert.equal(writes[0].changes.focal_user_id, rosa.id);
  assert.deepEqual(state.columnConfigs.map((column) => column.excel_header), ["TM"]);
  assert.equal(defaultFocalUser().id, rosa.id);
});

test("una cuenta con el correo generado se reutiliza sin cambiar su contraseña ni inventar un ID", async () => {
  const { fallbackEmail } = await import("../src/js/utils.js");
  const existing = { id: "real-user", name: "Nombre registrado", email: fallbackEmail("Nombre Excel"), role: "supervisor", active: true };
  state.currentUser = { id: "admin", role: "admin" };
  state.users = [existing];
  state.store = { insert() { assert.fail("No debe sobrescribir la cuenta existente"); } };
  assert.equal(await findOrCreateFocal("Nombre Excel", []), existing);
});
