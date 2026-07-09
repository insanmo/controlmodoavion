import { state, isUuid } from "../state.js";
import { safeCell, dateText, numberText, normalizeKey, normalizeName, normalizePersonDisplayName, normalizeExcelDate, normalizeStatus, fallbackEmail, toDateInput, personInitials, svgIcon, inputField, selectField, monthName } from "../utils.js";
import { visiblePersonal, userName, activePeriod, canCurrentUserWriteVacations, periodStatusLabel, currentMonthValue, nextMonthValue, operationalMonthValue, vacationMinMonthValue, minStartDateForType } from "./common.js";
import { persist, updateRecord, upsertPersonalRows, loadData, batchUpsertImportRows, batchMarkMissingPersonal } from "../db.js";
import { notify, confirmAction, promptAction } from "../ui.js";

export function renderPersonal(content) {
  const canManagePersonal = state.currentUser.role === "admin" || state.currentUser.role === "supervisor";
  const canEditRows = state.currentUser.role === "admin" || state.currentUser.role === "focal" || state.currentUser.role === "supervisor";
  const rows = sortedPersonalRows(filteredPersonalRows(visiblePersonal()));
  content.innerHTML = `
    ${canManagePersonal ? periodWorkflowPanel() : ""}
    <section class="dashboard-card personal-assigned-card excel-personal-card">
      <div class="personal-card-header">
        <div>
          <h3>Personal asignado</h3>
          <p>${assignedExcelSnapshot().sheet || "TOTAL"} - ${rows.length} registros cargados</p>
        </div>
        <div class="row-actions personal-actions">
          ${canManagePersonal ? `<button class="primary-btn compact-btn" id="newPersonalBtn" type="button">Nuevo registro</button><button class="ghost-btn compact-btn" id="importPersonalBtn" type="button">Cargar Excel</button>` : ""}
          <button class="ghost-btn compact-btn export-green" id="exportPersonalBtn" type="button">Exportar Excel</button>
          ${canManagePersonal ? `<input class="hidden" id="personalExcelInput" type="file" accept=".xlsx,.xls,.csv">` : ""}
        </div>
      </div>
      <div class="filter-grid personal-filter-grid">
        <label>PO<input data-personal-filter="po" value="${safeCell(state.filters.personalPo || "")}" placeholder="Buscar PO"></label>
        <label>Proyecto/Squad<input data-personal-filter="project" value="${safeCell(state.filters.personalProject || "")}" placeholder="Buscar squad..."></label>
        <label>Colaborador<input data-personal-filter="name" value="${safeCell(state.filters.personalName || "")}" placeholder="Buscar colaborador..."></label>
        <label class="filter-actions-label"><button class="ghost-btn compact-btn" id="clearPersonalFiltersBtn" type="button">Limpiar</button></label>
      </div>
      <div class="personal-legend">
        <span class="legend-item"><span class="legend-swatch legend-black"></span> V. Negras &gt; 0</span>
        <span class="legend-item"><span class="legend-swatch legend-danger"></span> Vence en ≤ 2 meses</span>
        <span class="legend-item"><span class="legend-swatch legend-warning"></span> Vence en ≤ 4 meses</span>
        <span class="legend-item"><span class="legend-swatch legend-birthday"></span> Cumplea&ntilde;os (d&iacute;a h&aacute;bil)</span>
      </div>
      ${personalTable(rows, canEditRows)}
    </section>
  `;
}

function periodWorkflowPanel() {
  const period = activePeriod();
  const latestImport = state.personalImports[0];
  const isOpen = period && period.status === "abierto";
  const isClosed = period && period.status === "cerrado";
  const canClose = isOpen;
  const canActivate = isClosed;
  const operationalMonth = operationalMonthValue();
  const vacationFrom = vacationMinMonthValue();
  const reopenTarget = isClosed
    ? period
    : state.periods.filter((p) => p.status === "cerrado").sort((a, b) => String(b.month || "").localeCompare(String(a.month || "")))[0];
  const canReopen = Boolean(reopenTarget) && (state.currentUser.role === "admin" || state.currentUser.role === "supervisor");
  return `
    <section class="dashboard-card period-workflow-card">
      <div class="dashboard-card-header">
        <div>
          <h3>Cierre mensual</h3>
          <p>Mes operativo: ${safeCell(monthName(operationalMonth))}</p>
          <p>Vacaciones habilitadas desde: ${safeCell(monthName(vacationFrom))}</p>
          <p>Estado: ${safeCell(periodStatusLabel(period?.status || "pendiente"))}${latestImport ? ` | Ultima carga: ${safeCell(latestImport.file_name || "Excel")} (${latestImport.row_count || 0} filas)` : ""}</p>
        </div>
        <div class="row-actions">
          <button class="ghost-btn compact-btn" id="startPeriodCloseBtn" type="button" ${canClose ? "" : "disabled"}>Iniciar cierre</button>
          <button class="primary-btn compact-btn" id="activatePeriodBtn" type="button" ${canActivate ? "" : "disabled"}>Activar nuevo periodo</button>
          ${canReopen ? `<button class="ghost-btn compact-btn" id="reopenPeriodBtn" type="button">Reabrir ${reopenTarget.month}</button>` : ""}
        </div>
      </div>
    </section>
  `;
}

function filteredPersonalRows(rows) {
  const po = String(state.filters.personalPo || "").toLowerCase();
  const project = String(state.filters.personalProject || "").toLowerCase();
  const name = String(state.filters.personalName || "").toLowerCase();
  return rows.filter((person) => {
    if (po && !String(excelFieldValue(person, "PO") || person.po || "").toLowerCase().includes(po)) return false;
    if (project && !String(excelFieldValue(person, "SQUAD REAL") || person.project || "").toLowerCase().includes(project)) return false;
    if (name && !String(person.name || "").toLowerCase().includes(name)) return false;
    return true;
  });
}

function personalTable(rows, canEdit) {
  const headers = assignedExcelHeaders();
  const nameIndex = headers.findIndex((header) => normalizeKey(sourceHeaderForDisplay(header)) === "nombre" || normalizeKey(sourceHeaderForDisplay(header)) === "tm" || normalizeKey(header) === "nombre");
  const stickyEnd = nameIndex >= 0 ? nameIndex : -1;
  const stickyLayout = [];
  let stickyOffset = 0;
  for (let i = 0; i <= stickyEnd; i++) {
    const isName = i === nameIndex;
    const width = isName ? 240 : 150;
    stickyLayout.push({ left: stickyOffset, width, isName });
    stickyOffset += width;
  }
  const colClass = (index) => {
    if (index > stickyEnd) return "";
    return index === nameIndex ? "sticky-col sticky-name-col" : "sticky-col";
  };
  const colStyle = (index) => {
    if (index > stickyEnd) return "";
    const layout = stickyLayout[index];
    return `style="left:${layout.left}px;min-width:${layout.width}px;max-width:${layout.width}px;"`;
  };
  const headerCell = (header, index) => `<th class="${colClass(index)}" ${colStyle(index)}>${personalSortHeader(header)}</th>`;
  const bodyCell = (item, header, index) => {
    const rawValue = excelFieldValue(item, header);
    const value = excelDisplayValue(rawValue);
    const isBirthdayCol = normalizeKey(sourceHeaderForDisplay(header)) === "fecha_de_nacimiento";
    const cake = isBirthdayCol && personalBusinessBirthdayThisMonth(item)
      ? ' <span class="birthday-cake" title="Cumplea&ntilde;os de este mes (d&iacute;a h&aacute;bil)">\u{1F382}</span>'
      : "";
    const titleAttr = index === nameIndex ? ` title="${safeCell(value)}"` : "";
    return `<td class="${colClass(index)}" ${colStyle(index)}${titleAttr}>${value}${cake}</td>`;
  };
  const poGroups = groupByPoAndSort(rows);
  const poValues = Object.keys(poGroups);
  const groupRow = (po, count) => `
    <tr class="po-group-header">
      <td class="po-group-cell" colspan="${headers.length + 1}">
        <span class="po-group-label">
          <strong>${safeCell(po || "Sin PO/Focal")}</strong>
          <span class="po-count">${count} ${count === 1 ? "integrante" : "integrantes"}</span>
        </span>
      </td>
    </tr>
  `;
  return `
    <div class="table-wrap personal-table-wrap excel-personal-table-wrap has-actions">
      <table>
        <thead><tr>${headers.map(headerCell).join("")}<th>Acciones</th></tr></thead>
        <tbody>
          ${poValues.length ? poValues.map((po) => `
            ${groupRow(po, poGroups[po].length)}
            ${poGroups[po].map((item) => `
              <tr class="${personalDueRowClass(item)}">
                ${headers.map((header, index) => bodyCell(item, header, index)).join("")}
                <td><div class="personal-row-actions"><button class="primary-btn compact-btn" data-register-vacation="${item.id}" type="button" ${canCurrentUserWriteVacations() ? "" : "disabled"}>Vacaciones</button>${canEdit ? `<button class="ghost-btn compact-btn" data-edit-personal="${item.id}" type="button">Editar</button>` : ""}</div></td>
              </tr>
            `).join("")}
          `).join("") : `<tr><td colspan="${headers.length + 1}">Sin personal asignado.</td></tr>`}
        </tbody>
      </table>
    </div>
  `;
}

function groupByPoAndSort(rows) {
  const groups = {};
  for (const person of rows) {
    const po = groupPoFocalName(person);
    if (!groups[po]) groups[po] = [];
    groups[po].push(person);
  }
  for (const po of Object.keys(groups)) {
    groups[po].sort((a, b) => {
      const rolA = String(excelFieldValue(a, "ROL") || "").toLowerCase();
      const rolB = String(excelFieldValue(b, "ROL") || "").toLowerCase();
      const cmp = rolA.localeCompare(rolB);
      if (cmp !== 0) return cmp;
      const clA = String(excelFieldValue(a, "CL") || "").toLowerCase();
      const clB = String(excelFieldValue(b, "CL") || "").toLowerCase();
      return clA.localeCompare(clB);
    });
  }
  return groups;
}

function groupPoFocalName(person) {
  return String(
    excelFieldValue(person, "PO")
    || person.po
    || excelFieldValue(person, "FOCAL")
    || userName(person.focal_user_id)
    || "Sin PO/Focal"
  ).trim() || "Sin PO/Focal";
}

export function personalFormTemplate(person = null) {
  const focalOptions = state.currentUser.role === "admin"
    ? state.users.filter((u) => u.role === "focal").map((u) => [u.id, u.name])
    : [[state.currentUser.id, state.currentUser.name]];
  return `
    <form id="personalForm" class="form-grid modal-form">
      <input type="hidden" name="id" value="${person?.id || ""}">
      <div class="span-4 modal-title-row">
        <div>
          <h3>${person ? "Editar colaborador" : "Nuevo colaborador"}</h3>
          <p>Completa los datos del colaborador asignado.</p>
        </div>
        <button class="ghost-btn compact-btn" id="closePersonalDialogBtn" type="button">Cerrar</button>
      </div>
      ${inputField("name", "Nombre del colaborador", "text", person?.name)}
      ${inputField("email", "Correo", "email", person?.email)}
      ${inputField("service_start_date", "Fecha de ingreso", "date", person?.service_start_date)}
      ${inputField("current_vacation_days", "Vacaciones vigentes", "number", person?.current_vacation_days)}
      ${inputField("current_vacation_due_date", "Fecha máxima de uso", "date", person?.current_vacation_due_date)}
      ${inputField("truncated_vacation_days", "Vacaciones truncas", "number", person?.truncated_vacation_days)}
      ${inputField("truncated_to_current_date", "Truncas pasan a vigentes", "date", person?.truncated_to_current_date)}
      ${inputField("po", "PO", "text", person?.po)}
      ${inputField("project", "Proyecto/Squad", "text", person?.project)}
      ${selectField("focal_user_id", "Focal asignado", focalOptions, person?.focal_user_id || state.currentUser.id)}
      ${selectField("status", "Estado", ["activo", "inactivo"], person?.status || "activo")}
      <div class="modal-actions span-4">
        <button class="ghost-btn compact-btn" id="cancelPersonalBtn" type="button">Cancelar</button>
        <button class="primary-btn compact-btn" type="submit">Guardar colaborador</button>
      </div>
    </form>
  `;
}

export function openPersonalDialog(id = null) {
  const person = id ? state.personal.find((item) => item.id === id) : null;
  if (id && !person) return notify("No se encontró el colaborador.");
  document.getElementById("personalDialogContent").innerHTML = personalFormTemplate(person);
  document.getElementById("personalDialog").showModal();
  bindPersonalDialogEvents();
}

function bindPersonalDialogEvents() {
  const personalForm = document.getElementById("personalForm");
  if (personalForm) personalForm.addEventListener("submit", savePersonal);
  document.getElementById("cancelPersonalBtn")?.addEventListener("click", closePersonalDialog);
  document.getElementById("closePersonalDialogBtn")?.addEventListener("click", closePersonalDialog);
}

export function closePersonalDialog() {
  document.getElementById("personalDialog").close();
}

async function savePersonal(event) {
  event.preventDefault();
  const form = Object.fromEntries(new FormData(event.currentTarget).entries());
  if (!form.name?.trim()) return notify("Ingresa el nombre del colaborador.");
  if (!form.email?.trim()) return notify("Ingresa el correo del colaborador.");
  const id = form.id;
  const existing = id ? state.personal.find((person) => person.id === id) : null;
  if (state.currentUser.role === "focal" && existing && existing.focal_user_id !== state.currentUser.id) return notify("No puedes editar colaboradores de otro focal.");
  const row = {
    name: form.name.trim(),
    email: form.email.trim().toLowerCase(),
    focal_user_id: state.currentUser.role === "focal" ? state.currentUser.id : form.focal_user_id,
    po: form.po,
    project: form.project,
    service_start_date: form.service_start_date,
    current_vacation_days: Number(form.current_vacation_days || 0),
    current_vacation_due_date: form.current_vacation_due_date,
    truncated_vacation_days: Number(form.truncated_vacation_days || 0),
    truncated_to_current_date: form.truncated_to_current_date,
    status: form.status
  };
  if (id) {
    await updateRecord("personal", id, { ...row, updated_at: new Date().toISOString() });
    notify("Colaborador actualizado.");
  } else {
    await persist("personal", { id: crypto.randomUUID(), ...row, created_at: new Date().toISOString() });
    notify("Colaborador guardado.");
  }
  closePersonalDialog();
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

export async function importPersonalFromExcel(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  if (!window.XLSX) return notify("La librería de Excel aún no está cargada. Verifica la conexión a internet y vuelve a intentar.");
  if (state.currentUser.role === "focal") return notify("Solo supervisor o admin pueden cargar el Excel oficial.");
  showLoadingOverlay("Procesando archivo Excel...");
  let importId = null;
  try {
    const period = await ensurePeriodForImport();
    const buffer = await file.arrayBuffer();
    const book = XLSX.read(buffer, { type: "array", cellDates: true });
    state.importedFocalCredentials = [];
    const sheetName = book.SheetNames.find((name) => normalizeKey(name) === "total") || book.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(book.Sheets[sheetName], { defval: "" });
    if (!rows.length) { hideLoadingOverlay(); await notify("El archivo no contiene registros."); return; }
    const headers = Object.keys(rows[0]);
    const configs = effectiveColumnConfigs(headers);
    const loadableHeaders = configs
      .filter((column) => column.load_to_db !== false || String(column.calculation_role || "").startsWith("identity_") || ["name", "focal", "po", "project"].includes(column.calculation_role))
      .map((column) => column.excel_header);

    showLoadingOverlay(`Procesando ${rows.length} registros...`);
    const focals = state.currentUser.role === "focal" ? [state.currentUser] : state.users.filter((user) => user.role === "focal");
    const focalNames = new Set(rows.map((raw) => normalizeAssignedExcelPersonRow(raw).focal_name || String(raw.FOCAL || "").trim()).filter(Boolean));
    for (const focalName of focalNames) {
      const focal = await findOrCreateFocal(focalName, focals);
      if (focal && !focals.some((user) => user.id === focal.id)) focals.push(focal);
    }
    const usersByFocalName = new Map(focals.map((user) => [normalizeKey(user.name), user]));
    importId = crypto.randomUUID();
    const importedIds = new Set();
    const importRows = [];
    const personal = rows.map((raw, index) => {
      const filteredRaw = filterRawExcelFields(raw, loadableHeaders);
      const person = excelPersonFromRowObject(filteredRaw, index, usersByFocalName);
      const warnings = identityWarnings(person);
      const existing = findExistingPersonal(person);
      if (existing && isUuid(existing.id)) person.id = existing.id;
      if (!state.users.some((user) => user.id === person.focal_user_id)) {
        person.focal_user_id = (state.currentUser.role === "focal" ? state.currentUser : focals[0])?.id || null;
      }
      person.active_period_id = period?.id || null;
      person.last_import_id = importId;
      person.missing_from_latest_import = false;
      importedIds.add(person.id);
      importRows.push({
        id: crypto.randomUUID(),
        import_id: importId,
        personal_id: isUuid(person.id) ? person.id : null,
        row_number: index + 2,
        raw_fields: raw,
        mapped_fields: filteredRaw,
        warnings,
        created_at: new Date().toISOString()
      });
      return person;
    });
    saveAssignedExcelSnapshot(sheetName, loadableHeaders, rows.map((row) => loadableHeaders.map((header) => row[header] ?? "")));

    let savedWithoutExcelFields = false;
    await persist("personalImports", {
      id: importId,
      period_id: period?.id || null,
      file_name: file.name,
      sheet_name: sheetName,
      row_count: rows.length,
      warnings_count: importRows.reduce((sum, row) => sum + row.warnings.length, 0),
      uploaded_by: state.currentUser.id,
      uploaded_at: new Date().toISOString()
    });
    const dbRows = personal.map(personalDbPayload);
    try {
      await upsertPersonalRows(dbRows);
    } catch (error) {
      if (!isExcelFieldsSchemaError(error)) {
        await deleteRecord("personalImports", importId).catch(() => {});
        hideLoadingOverlay(); await notify(error.message); return;
      }
      savedWithoutExcelFields = true;
      await upsertPersonalRows(personal.map((person) => personalDbPayload(person, { includeExcelFields: false })));
    }
    await batchUpsertImportRows(importRows);
    const missingIds = state.personal.filter((person) => !importedIds.has(person.id)).map((person) => person.id);
    if (missingIds.length) await batchMarkMissingPersonal(missingIds);
    if (period?.id) {
      await state.store.update("periods", period.id, {
        imported_file_name: file.name,
        imported_sheet_name: sheetName,
        imported_rows_count: rows.length,
        imported_warnings_count: importRows.reduce((sum, row) => sum + row.warnings.length, 0),
        updated_at: new Date().toISOString()
      });
    }
    await loadData();
    attachExcelFieldsToLoadedPersonal(personal);

    const createdFocals = state.importedFocalCredentials || [];
    const focalText = createdFocals.length
      ? ` Se crearon ${createdFocals.length} focales nuevos como usuarios AirControl; revisa Usuarios para resetear sus claves si necesitan ingresar.`
      : "";
    state.importedFocalCredentials = [];
    hideLoadingOverlay();
    await notify(savedWithoutExcelFields
      ? `${personal.length} colaboradores cargados desde la hoja ${sheetName}. Ojo: Supabase aun no tiene la columna excel_fields; ejecuta la migración nueva para persistir todas las columnas.${focalText}`
      : `${personal.length} colaboradores cargados desde la hoja ${sheetName}. ${importRows.reduce((sum, row) => sum + row.warnings.length, 0)} advertencias.${focalText}`);
    const { renderApp } = await import("../app-core.js");
    renderApp();
  } catch (error) {
    if (importId) {
      await deleteRecord("personalImports", importId).catch(() => {});
    }
    hideLoadingOverlay();
    await notify(error.message || "Error al procesar el archivo.");
  }
}

export function exportPersonalExcel() {
  if (!window.XLSX) return notify("La librería de Excel aún no está cargada. Verifica la conexión a internet y vuelve a intentar.");
  const headers = assignedExcelHeaders();
  const rows = visiblePersonal().map((person) => headers.reduce((record, header) => {
    record[header] = excelFieldValue(person, header);
    return record;
  }, {}));
  const sheet = XLSX.utils.json_to_sheet(rows, { header: headers });
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, assignedExcelSnapshot().sheet || "TOTAL");
  XLSX.writeFile(book, `personal_asignado_${toDateInput(new Date())}.xlsx`);
}

export async function startPeriodClose() {
  const period = await ensurePeriodForImport();
  if (!period) return notify("No se pudo identificar el periodo activo.");
  if (period.status === "cerrado") return notify("El periodo ya esta cerrado.");
  if (!await confirmAction(`¿Desea cerrar el periodo ${period.month}?\n\nYa no podran registrarse ni editarse vacaciones en este periodo. Solo podra reabrirse por un administrador o supervisor.`, { title: "Cerrar periodo", confirmText: "Cerrar periodo" })) return;
  await updateRecord("periods", period.id, {
    status: "cerrado",
    closed_at: new Date().toISOString(),
    closed_by: state.currentUser.id,
    updated_at: new Date().toISOString()
  });
  await loadData(state.currentUser?.role);
  notify(`Periodo ${period.month} cerrado.`);
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

export async function activateNextPeriod() {
  const current = state.periods.slice().sort((a, b) => String(b.month || "").localeCompare(String(a.month || "")))[0] || null;
  if (!current) return notify("No hay un periodo operativo para avanzar.");
  if (current.status === "abierto") return notify("Primero inicie el cierre del mes operativo actual.");
  const nextMonth = nextMonthValue(current.month);
  if (!await confirmAction(`¿Activar el periodo ${nextMonth} como mes operativo?\n\nEl mes operativo pasara de ${current.month} a ${nextMonth} y las vacaciones quedaran habilitadas desde ${nextMonthValue(nextMonth)}.`, { title: "Activar nuevo periodo", confirmText: "Activar periodo" })) return;
  if (current.status !== "cerrado") {
    await updateRecord("periods", current.id, {
      status: "cerrado",
      closed_at: new Date().toISOString(),
      closed_by: state.currentUser.id,
      updated_at: new Date().toISOString()
    });
  }
  let next = state.periods.find((period) => period.month === nextMonth);
  if (!next) {
    next = {
      id: crypto.randomUUID(),
      month: nextMonth,
      status: "abierto",
      activated_at: new Date().toISOString(),
      activated_by: state.currentUser.id,
      created_at: new Date().toISOString()
    };
    await persist("periods", next);
  } else {
    await updateRecord("periods", next.id, {
      status: "abierto",
      activated_at: new Date().toISOString(),
      activated_by: state.currentUser.id,
      updated_at: new Date().toISOString()
    });
  }
  await loadData(state.currentUser?.role);
  const newActive = state.periods.find((period) => period.month === nextMonth);
  if (newActive?.id) {
    for (const person of state.personal.filter((item) => !item.missing_from_latest_import)) {
      await updateRecord("personal", person.id, {
        active_period_id: newActive.id,
        updated_at: new Date().toISOString()
      });
    }
  }
  notify(`Nuevo periodo ${nextMonth} activo. Vacaciones habilitadas desde ${nextMonthValue(nextMonth)}.`);
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

export async function reopenPeriod() {
  const closedPeriods = state.periods.filter((p) => p.status === "cerrado").sort((a, b) => String(b.month || "").localeCompare(String(a.month || "")));
  if (!closedPeriods.length) return notify("No hay periodos cerrados para reabrir.");
  const target = closedPeriods[0];
  const current = activePeriod();
  if (current && current.status === "abierto" && current.id !== target.id) {
    return notify("Ya existe un periodo abierto. Cierre el periodo actual antes de reabrir otro.");
  }
  if (!await confirmAction(`¿Desea reabrir el periodo ${target.month}?\n\nEsto permitira registrar y editar vacaciones nuevamente.`, { title: "Reabrir periodo", confirmText: "Reabrir periodo" })) return;
  await updateRecord("periods", target.id, {
    status: "abierto",
    closed_at: null,
    closed_by: null,
    updated_at: new Date().toISOString()
  });
  await loadData(state.currentUser?.role);
  notify(`Periodo ${target.month} reabierto.`);
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

async function ensurePeriodForImport() {
  let period = activePeriod();
  if (period) return period;
  period = {
    id: crypto.randomUUID(),
    month: currentMonthValue(),
    status: "abierto",
    activated_at: new Date().toISOString(),
    activated_by: state.currentUser.id,
    created_at: new Date().toISOString()
  };
  await persist("periods", period);
  state.periods.unshift(period);
  return period;
}

// --- Excel field helpers ---

const EXCEL_HEADER_ORDER = [
  "Nro", "Usuario", "MATRIC. BCP", "TM", "FECHA ING INDRA", "FECHA FIN INDRA",
  "FECHA ING BCP", "FECHA NUEVA FIN ACTA", "FECHA FIN ACTA",
  "ROL", "SENIORITY", "Estado Junio", "PO", "CL", "FOCAL",
  "SQUAD REAL", "ULT. POCLAC 04-03", "TIENE MV?", "VACACIONES POR VENCER", "FECHA MAX. DE SALIDA",
  "VACACIONES TRUNCAS", "VACACIONES GANADAS", "VACACIONES JULIO",
  "VACACIONES PENDIENTES", "VACACIONES NEGRAS (Dias Laborables)",
  "ESTADO DE VACACIONES NEGRAS", "COMENTARIO", "PROPUESTAS", "SQUAD ACTA",
  "FECHA DE NACIMIENTO", "DNI", "SUELDO", "ASIG. FAMILIAR", "Tasa", "Tarifa",
  "Inicio Vacaciones", "Fin Vacaciones", "PM", "Celular", "Mail Indra", "Mail BCP"
];

function assignedExcelHeaders() {
  const configured = effectiveColumnConfigs().filter((column) => column.show_in_personal !== false);
  if (configured.length) return configured.map((column) => column.display_name || column.excel_header);
  const rowWithExcelFields = state.personal.find((person) => person.excel_fields && typeof person.excel_fields === "object");
  const available = rowWithExcelFields
    ? Object.keys(rowWithExcelFields.excel_fields)
    : (assignedExcelSnapshot().headers || []);
  if (!available.length) return personalExcelColumns().map((column) => column.label);
  return EXCEL_HEADER_ORDER.filter((h) => available.some((a) => normalizeKey(a) === normalizeKey(h)));
}

export function defaultExcelColumnOrder() {
  return EXCEL_HEADER_ORDER.slice();
}

export function effectiveColumnConfigs(availableHeaders = []) {
  const byConfiguredHeader = new Map((state.columnConfigs || []).map((column) => [normalizeKey(column.excel_header), column]));
  const baseHeaders = availableHeaders.length
    ? availableHeaders
    : (state.columnConfigs?.length ? state.columnConfigs.map((column) => column.excel_header) : EXCEL_HEADER_ORDER);
  const merged = baseHeaders.map((header, index) => {
    const configured = byConfiguredHeader.get(normalizeKey(header));
    return configured || {
      id: "",
      excel_header: header,
      display_name: header,
      display_order: EXCEL_HEADER_ORDER.findIndex((item) => normalizeKey(item) === normalizeKey(header)) + 1 || index + 1,
      data_type: inferredColumnType(header),
      load_to_db: true,
      show_in_personal: true,
      calculation_role: defaultCalculationRole(header)
    };
  });
  return merged
    .filter((column) => column.load_to_db !== false || column.show_in_personal !== false)
    .sort((a, b) => Number(a.display_order || 0) - Number(b.display_order || 0) || String(a.excel_header).localeCompare(String(b.excel_header)));
}

function inferredColumnType(header) {
  const normalized = normalizeKey(header);
  if (normalized.includes("fecha") || normalized.includes("inicio") || normalized.includes("fin")) return "date";
  if (normalized.includes("vacaciones") || ["nro", "sueldo", "tasa", "tarifa"].includes(normalized)) return "number";
  if (normalized.includes("mail") || normalized.includes("correo")) return "email";
  return "text";
}

function defaultCalculationRole(header) {
  const normalized = normalizeKey(header);
  const roles = {
    usuario: "identity_usuario",
    matric_bcp: "identity_matric_bcp",
    tm: "name",
    focal: "focal",
    po: "po",
    squad_real: "project",
    vacaciones_por_vencer: "current_days",
    vacaciones_truncas: "truncated_days",
    vacaciones_pendientes: "final_pending_days",
    vacaciones_negras_dias_laborables: "black_days",
    estado_de_vacaciones_negras: "black_status",
    fecha_max_de_salida: "current_due_date",
    fecha_fin_acta: "truncated_to_current_date"
  };
  return roles[normalized] || null;
}

function personalExcelColumns() {
  return [
    { key: "name", label: "Nombre" },
    { key: "email", label: "Correo" },
    { key: "focal", label: "Focal" },
    { key: "po", label: "PO" },
    { key: "project", label: "Proyecto/Squad" },
    { key: "service_start_date", label: "Ingreso" },
    { key: "current_vacation_days", label: "Vigentes" },
    { key: "current_vacation_due_date", label: "Máxima vigentes" },
    { key: "truncated_vacation_days", label: "Truncas" },
    { key: "truncated_to_current_date", label: "Truncas a vigentes" },
    { key: "status", label: "Estado" }
  ];
}

function assignedExcelSnapshot() {
  try {
    return JSON.parse(localStorage.getItem("aircontrol_personal_excel_snapshot") || "null") || { sheet: "TOTAL", headers: [], rows: [] };
  } catch {
    return { sheet: "TOTAL", headers: [], rows: [] };
  }
}

function saveAssignedExcelSnapshot(sheet, headers, rows) {
  localStorage.setItem("aircontrol_personal_excel_snapshot", JSON.stringify({ sheet, headers, rows }));
}

function filterRawExcelFields(raw, headers) {
  const result = {};
  for (const header of headers) {
    const key = Object.keys(raw).find((item) => normalizeKey(item) === normalizeKey(header));
    if (key) result[header] = raw[key] ?? "";
  }
  return result;
}

function identityWarnings(person) {
  const warnings = [];
  if (!person.usuario_code) warnings.push("Fila sin Usuario; se intentara empatar por MATRIC. BCP.");
  if (!person.usuario_code && !person.matric_bcp) warnings.push("Fila sin Usuario ni MATRIC. BCP; se usara correo o nombre como respaldo.");
  return warnings;
}

function findExistingPersonal(person) {
  const usuario = normalizeKey(person.usuario_code);
  const matric = normalizeKey(person.matric_bcp);
  if (usuario) {
    const byUsuario = state.personal.find((item) => normalizeKey(item.usuario_code || excelRawValue(item, "Usuario")) === usuario);
    if (byUsuario) return byUsuario;
  }
  if (matric) {
    const byMatric = state.personal.find((item) => normalizeKey(item.matric_bcp || excelRawValue(item, "MATRIC. BCP")) === matric);
    if (byMatric) return byMatric;
  }
  return state.personal.find((item) => {
    const sameEmail = person.email && String(item.email || "").toLowerCase() === person.email.toLowerCase();
    return sameEmail || normalizeName(item.name) === normalizeName(person.name);
  });
}

function excelRawValue(person, header) {
  if (!person?.excel_fields || typeof person.excel_fields !== "object") return "";
  const exact = person.excel_fields[header];
  if (exact !== undefined && exact !== null) return exact;
  const normalized = normalizeKey(header);
  const key = Object.keys(person.excel_fields).find((item) => normalizeKey(item) === normalized);
  return key ? person.excel_fields[key] : "";
}

function excelFieldValue(person, header) {
  const sourceHeader = sourceHeaderForDisplay(header);
  const computedValue = computedVacationFieldValue(person, header);
  if (computedValue !== undefined) return computedValue;

  if (person.excel_fields && typeof person.excel_fields === "object") {
    const exact = person.excel_fields[sourceHeader];
    if (exact !== undefined && exact !== null) return exact;
    const normalizedHeader = normalizeKey(sourceHeader);
    const key = Object.keys(person.excel_fields).find((k) => normalizeKey(k) === normalizedHeader);
    if (key) return person.excel_fields[key];
  }
  const fallback = {
    Usuario: person.usuario_code,
    "MATRIC. BCP": person.matric_bcp,
    TM: person.name,
    FOCAL: userName(person.focal_user_id),
    PO: person.po,
    "SQUAD REAL": person.project,
    "FECHA ING INDRA": person.service_start_date,
    "VACACIONES POR VENCER": person.current_vacation_days,
    "VACACIONES PENDIENTES": person.current_vacation_days,
    "FECHA MAX. DE SALIDA": person.current_vacation_due_date,
    "VACACIONES TRUNCAS": person.truncated_vacation_days,
    "FECHA FIN ACTA": person.truncated_to_current_date,
    "Estado Junio": person.status
  };
  return fallback[sourceHeader] ?? fallback[header] ?? "";
}

function sourceHeaderForDisplay(header) {
  const config = (state.columnConfigs || []).find((column) =>
    normalizeKey(column.display_name) === normalizeKey(header) || normalizeKey(column.excel_header) === normalizeKey(header)
  );
  return config?.excel_header || header;
}

function computedVacationFieldValue(person, header) {
  const normalized = normalizeKey(sourceHeaderForDisplay(header));
  const black = rawExcelNumber(person, "VACACIONES NEGRAS (Dias Laborables)");
  if (normalized === "vacaciones_negras_dias_laborables") {
    return black;
  }
  if (normalized === "vacaciones_por_vencer" || normalized === "vacaciones_pendientes") {
    if (normalized === "vacaciones_pendientes") {
      return Number(person.current_vacation_days || 0) + Number(person.truncated_vacation_days || 0) + black;
    }
    return Number(person.current_vacation_days || 0);
  }
  if (normalized === "vacaciones_truncas") {
    return Number(person.truncated_vacation_days || 0);
  }
  const month = vacationMonthFromHeader(header);
  if (month) return vacationDaysForMonth(person.id, month);
  return undefined;
}

function rawExcelNumber(person, header) {
  const number = Number(String(excelRawValue(person, header) ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function vacationMonthFromHeader(header) {
  const normalized = normalizeKey(header);
  const match = normalized.match(/^vacaciones_(enero|febrero|marzo|abril|mayo|junio|julio|agosto|setiembre|septiembre|octubre|noviembre|diciembre)$/);
  if (!match) return "";
  const months = {
    enero: "01",
    febrero: "02",
    marzo: "03",
    abril: "04",
    mayo: "05",
    junio: "06",
    julio: "07",
    agosto: "08",
    setiembre: "09",
    septiembre: "09",
    octubre: "10",
    noviembre: "11",
    diciembre: "12"
  };
  return months[match[1]] || "";
}

function vacationDaysForMonth(personId, monthNumber) {
  const currentYear = String(new Date().getFullYear());
  return state.vacations
    .filter((item) => item.collaborator_id === personId)
    .filter((item) => {
      const month = String(item.month || item.start_date || "").slice(0, 7);
      return month === `${currentYear}-${monthNumber}` || month === monthNumber;
    })
    .reduce((sum, item) => sum + Number(item.days || 0), 0);
}

function excelDisplayValue(value) {
  if (value === null || value === undefined || value === "") return "";
  if (value instanceof Date) return dateText(value);
  if (typeof value === "number") return numberText(value);
  if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return dateText(value);
  if (/^\d{4}-\d{2}-\d{2}\s+/.test(String(value))) return dateText(value);
  if (/^\d{4}-\d{2}-\d{2}T/.test(String(value))) return dateText(value);
  return safeCell(value);
}

function excelPersonFromRowObject(raw, index, usersByFocalName) {
  const row = normalizeAssignedExcelPersonRow(raw);
  const focalName = String(raw.FOCAL || "").trim() || row.focal_name || "Focal";
  const focalKey = normalizeKey(focalName);
  const focal = usersByFocalName.get(focalKey);
  const email = fallbackEmail(row.name || `usuario-${index + 1}`, raw);
  return {
    id: `excel-person-${String(index + 1).padStart(4, "0")}`,
    name: row.name || String(raw.TM || "").trim(),
    email,
    focal_user_id: focal?.id || null,
    usuario_code: row.usuario_code,
    matric_bcp: row.matric_bcp,
    po: row.po,
    project: row.project,
    service_start_date: row.service_start_date,
    current_vacation_days: row.current_vacation_days,
    current_vacation_due_date: row.current_vacation_due_date,
    truncated_vacation_days: row.truncated_vacation_days,
    truncated_to_current_date: row.truncated_to_current_date,
    status: row.status || "activo",
    excel_fields: raw,
    created_at: new Date().toISOString()
  };
}

function personalDbPayload(person, options = {}) {
  const includeExcelFields = options.includeExcelFields !== false;
  const focalExists = isUuid(person.focal_user_id) && state.users.some((user) => user.id === person.focal_user_id);
  const payload = {
    name: person.name,
    email: person.email || null,
    focal_user_id: focalExists ? person.focal_user_id : null,
    usuario_code: person.usuario_code || null,
    matric_bcp: person.matric_bcp || null,
    po: person.po || null,
    project: person.project || null,
    service_start_date: person.service_start_date || null,
    current_vacation_days: Number(person.current_vacation_days || 0),
    current_vacation_due_date: person.current_vacation_due_date || null,
    truncated_vacation_days: Number(person.truncated_vacation_days || 0),
    truncated_to_current_date: person.truncated_to_current_date || null,
    status: person.status === "inactivo" ? "inactivo" : "activo",
    active_period_id: person.active_period_id || null,
    last_import_id: person.last_import_id || null,
    missing_from_latest_import: Boolean(person.missing_from_latest_import),
    updated_at: new Date().toISOString()
  };
  if (includeExcelFields) payload.excel_fields = person.excel_fields || null;
  if (isUuid(person.id)) payload.id = person.id;
  return payload;
}

function isExcelFieldsSchemaError(error) {
  const message = String(error?.message || "");
  return message.includes("excel_fields") && (message.includes("schema cache") || message.includes("column"));
}

function attachExcelFieldsToLoadedPersonal(importedPeople) {
  const byEmail = new Map(importedPeople.filter((person) => person.email).map((person) => [person.email.toLowerCase(), person]));
  const byName = new Map(importedPeople.map((person) => [normalizeName(person.name), person]));
  state.personal = state.personal.map((person) => {
    const source = byEmail.get(String(person.email || "").toLowerCase()) || byName.get(normalizeName(person.name));
    return source?.excel_fields ? { ...person, excel_fields: source.excel_fields } : person;
  });
}

function normalizeAssignedExcelPersonRow(raw) {
  const value = (...names) => {
    const key = Object.keys(raw).find((item) => names.includes(normalizeKey(item)));
    return key ? (raw[key] ?? "") : "";
  };
  const porVencerRaw = value("vacaciones_por_vencer");
  const pendingRaw = value("vacaciones_pendientes", "vigentes", "vacaciones_vigentes");
  return {
    usuario_code: String(value("usuario")).trim(),
    matric_bcp: String(value("matric_bcp", "matricula_bcp", "matric_bcp")).trim(),
    name: normalizePersonDisplayName(value("nombre", "colaborador", "tm")),
    email: String(value("correo", "email", "mail")).trim().toLowerCase(),
    focal_name: String(value("focal", "focal_asignado")).trim(),
    po: String(value("po")).trim(),
    project: String(value("proyecto_squad", "squad", "squad_real", "proyecto")).trim(),
    service_start_date: normalizeAssignedExcelDate(value("fecha_ingreso", "ingreso", "fecha_ing_indra", "fecha_ing_bcp")),
    current_vacation_days: porVencerRaw !== "" ? numberFromExcel(porVencerRaw) : (pendingRaw !== "" ? numberFromExcel(pendingRaw) : 0),
    current_vacation_due_date: normalizeAssignedExcelDate(value("maxima_vigentes", "fecha_max_de_salida", "fecha_maxima_de_salida", "fecha_maxima_uso")),
    truncated_vacation_days: numberFromExcel(value("vacaciones_truncas", "truncas")),
    truncated_to_current_date: normalizeAssignedExcelDate(value("truncas_a_vigentes", "truncas_pasan_a_vigentes", "fecha_fin_acta", "fecha_nueva_fin_acta")),
    status: normalizeStatus(value("estado", "estado_junio"))
  };
}

function numberFromExcel(value) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

function normalizeAssignedExcelDate(value) {
  if (!value || value === "-") return "";
  if (value instanceof Date && !Number.isNaN(value.getTime())) return toDateInput(value);
  return normalizeExcelDate(value);
}

// --- Due date coloring ---

function personalDueTone(person) {
  const blackDays = rawExcelNumber(person, "VACACIONES NEGRAS (Dias Laborables)");
  if (blackDays > 0) return "black-danger";
  const dueDays = Number(excelFieldValue(person, "VACACIONES POR VENCER") || 0);
  const dueDate = parsePersonalExcelDate(excelFieldValue(person, "FECHA MAX. DE SALIDA"));
  if (!dueDays || dueDays <= 0 || !dueDate) return "";
  const period = activePeriod();
  const match = period?.month ? String(period.month).match(/^(\d{4})-(\d{2})$/) : null;
  let twoMonths;
  let fourMonths;
  if (match) {
    const y = Number(match[1]);
    const m = Number(match[2]);
    twoMonths = new Date(y, m + 2, 0);
    fourMonths = new Date(y, m + 4, 0);
  } else {
    const today = new Date(); today.setHours(0, 0, 0, 0);
    twoMonths = new Date(today); twoMonths.setMonth(twoMonths.getMonth() + 2);
    fourMonths = new Date(today); fourMonths.setMonth(fourMonths.getMonth() + 4);
  }
  if (dueDate <= twoMonths) return "danger";
  if (dueDate <= fourMonths) return "warning";
  return "";
}

function personalDueRowClass(person) {
  const tone = personalDueTone(person);
  const classes = ["employee-row"];
  if (tone === "black-danger") classes.push("alert-black-vacations");
  else if (tone === "danger") classes.push("alert-expiring-2m");
  else if (tone === "warning") classes.push("alert-expiring-4m");
  if (personalBusinessBirthdayThisMonth(person)) classes.push("alert-birthday");
  return classes.join(" ");
}

function personalBusinessBirthdayThisMonth(person) {
  const birthday = parsePersonalExcelDate(excelFieldValue(person, "FECHA DE NACIMIENTO"));
  if (!birthday) return false;
  const period = activePeriod();
  const periodMonth = period?.month ? Number(String(period.month).split("-")[1]) : (new Date().getMonth() + 1);
  if (birthday.getMonth() + 1 !== periodMonth) return false;
  const birthdayThisYear = new Date(new Date().getFullYear(), birthday.getMonth(), birthday.getDate());
  return isPersonalBusinessDate(birthdayThisYear);
}

function isPersonalBusinessDate(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const value = toDateInput(date);
  return !state.holidays.some((holiday) => holiday.date === value);
}

function parsePersonalExcelDate(value) {
  if (!value) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) { const d = new Date(value); d.setHours(0, 0, 0, 0); return d; }
  if (typeof value === "number") { const d = new Date(Math.round((value - 25569) * 86400 * 1000)); if (!Number.isNaN(d.getTime())) { d.setHours(0, 0, 0, 0); return d; } }
  const raw = String(value).trim();
  const dmy = raw.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})$/);
  if (dmy) { const year = Number(dmy[3].length === 2 ? `19${dmy[3]}` : dmy[3]); const d = new Date(year, Number(dmy[2]) - 1, Number(dmy[1])); d.setHours(0, 0, 0, 0); return Number.isNaN(d.getTime()) ? null : d; }
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T00:00:00` : raw.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
  const d = new Date(normalized); if (Number.isNaN(d.getTime())) return null; d.setHours(0, 0, 0, 0); return d;
}

// --- Sorting ---

function sortedPersonalRows(rows) {
  const headers = assignedExcelHeaders();
  const defaultKey = headers.find((h) => normalizeKey(h) === "tm") || headers.find((h) => normalizeKey(h) === "nombre") || headers[0];
  const key = state.filters.personalSortKey || defaultKey;
  const direction = state.filters.personalSortDir === "desc" ? -1 : 1;
  return rows.slice().sort((a, b) => comparePersonalValue(personalSortValue(a, key), personalSortValue(b, key)) * direction);
}

function personalSortValue(person, header) {
  return excelFieldValue(person, header);
}

function comparePersonalValue(left, right) {
  const leftNum = Number(String(left ?? "").replace(",", "."));
  const rightNum = Number(String(right ?? "").replace(",", "."));
  if (Number.isFinite(leftNum) && Number.isFinite(rightNum)) return leftNum - rightNum;
  const leftDate = parsePersonalExcelDate(left);
  const rightDate = parsePersonalExcelDate(right);
  if (leftDate && rightDate) return leftDate.getTime() - rightDate.getTime();
  return String(left ?? "").localeCompare(String(right ?? ""), "es", { numeric: true, sensitivity: "base" });
}

function personalSortHeader(header) {
  const headers = assignedExcelHeaders();
  const defaultKey = headers.find((h) => normalizeKey(h) === "tm") || headers.find((h) => normalizeKey(h) === "nombre") || headers[0];
  const active = (state.filters.personalSortKey || defaultKey) === header;
  const dir = active && state.filters.personalSortDir === "desc" ? "desc" : "asc";
  const mark = active ? (dir === "desc" ? " ↓" : " ↑") : "";
  return `<button class="table-sort-btn ${active ? "active" : ""}" data-personal-sort="${encodeURIComponent(header)}" type="button">${safeCell(header)}${mark}</button>`;
}

export function sortPersonalBy(key) {
  const currentKey = state.filters.personalSortKey || "";
  const currentDir = state.filters.personalSortDir || "asc";
  state.filters.personalSortKey = key;
  state.filters.personalSortDir = currentKey === key && currentDir === "asc" ? "desc" : "asc";
  import("../app-core.js").then((mod) => mod.renderActiveTab());
}

// --- Focal helpers ---

export async function findOrCreateFocal(name, focals) {
  const clean = String(name || "").trim();
  const fallback = state.currentUser.role === "focal" ? state.currentUser : focals[0];
  if (!clean) return fallback;
  const existing = state.users.find((user) => user.role === "focal" && normalizeName(user.name) === normalizeName(clean));
  if (existing) return existing;
  if (state.currentUser.role !== "admin") return fallback;

  const email = fallbackEmail(clean);
  const tempPassword = `AirControl-${crypto.randomUUID().slice(0, 8)}`;
  const user = {
    id: crypto.randomUUID(),
    name: normalizePersonDisplayName(clean),
    email,
    role: "focal",
    temp_password: tempPassword,
    must_change_password: true,
    active: true,
    created_at: new Date().toISOString()
  };
  await persist("users", user);
  const savedUser = { ...user };
  delete savedUser.temp_password;
  state.users.push(savedUser);
  state.importedFocalCredentials = state.importedFocalCredentials || [];
  state.importedFocalCredentials.push({ name: savedUser.name, email: savedUser.email });
  return savedUser;
}

function showLoadingOverlay(message) {
  let overlay = document.getElementById("loadingOverlay");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.id = "loadingOverlay";
    overlay.className = "loading-overlay";
    overlay.innerHTML = '<div class="loading-spinner"></div><p class="loading-text"></p>';
    document.body.appendChild(overlay);
  }
  overlay.querySelector(".loading-text").textContent = message || "Procesando...";
  overlay.classList.remove("hidden");
}

function hideLoadingOverlay() {
  const overlay = document.getElementById("loadingOverlay");
  if (overlay) overlay.classList.add("hidden");
}
