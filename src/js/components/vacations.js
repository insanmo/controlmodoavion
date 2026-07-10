import { state } from "../state.js";
import { safeCell, dateText, dateTimeText, monthLabel, monthName, titleText, slug, personInitials, svgIcon, toDateInput, normalizeKey, calculateVacationDerived } from "../utils.js";
import { visiblePersonal, collaboratorName, userName, emailStatusLabel, getEmailStatus, filteredVacations, activePeriod, canCurrentUserWriteVacations, minStartDateForType, operationalMonthValue, vacationMinMonthValue } from "./common.js";
import { filterToolbar } from "./common.js";
import { collaboratorColorIndex, calculateVacationBalance, vacationTruncasUsageMap } from "./dashboard.js";
import { persist, updateRecord, deleteRecord } from "../db.js";
import { notify, confirmAction } from "../ui.js";

export function renderVacationForm(content) {
  const rows = filteredVacations();
  content.innerHTML = `
    ${filterToolbar({ hideExport: state.currentUser.role === "supervisor" })}
    ${state.showVacationForm ? embeddedVacationFormTemplate() : ""}
    <section class="dashboard-card vacation-list-card">
      <div class="vacation-list-header">
        <h3>Registros de vacaciones</h3>
        <span class="records-count">Mostrando ${rows.length ? 1 : 0} a ${rows.length} de ${rows.length} registros</span>
      </div>
      ${vacationTable(rows, { actions: true })}
    </section>
  `;
}

export function renderConsolidated(content) {
  if (state.currentUser.role === "supervisor" && !state.filters.status) {
    state.filters.status = "Completado";
  }
  const rows = filteredVacations({ includeHistorical: true });
  content.innerHTML = `
    ${filterToolbar({ showPeriod: true, allowEmptyMonth: true })}
    ${state.showVacationForm ? embeddedVacationFormTemplate() : ""}
    <section class="dashboard-card vacation-list-card consolidated-table-card">
      <div class="vacation-list-header">
        <h3>Registros consolidados</h3>
        <span class="records-count">Mostrando ${rows.length ? 1 : 0} a ${rows.length} de ${rows.length} registros</span>
      </div>
      ${vacationTable(rows, { actions: state.currentUser.role === "admin" || state.currentUser.role === "focal" })}
      ${rows.length ? `<div class="pagination-row">
        <button class="ghost-btn compact-btn" type="button">${svgIcon("chevronLeft")}</button>
        <button class="primary-btn compact-btn" type="button">1</button>
        <button class="ghost-btn compact-btn" type="button">${svgIcon("chevronRight")}</button>
      </div>` : ""}
    </section>
  `;
}

export async function saveVacation(event) {
  event.preventDefault();
  if (!canCurrentUserWriteVacations()) return notify("El periodo estÃ¡ cerrado. Los focales no pueden registrar ni editar vacaciones.");
  const form = new FormData(event.currentTarget);
  const id = form.get("id");
  const existingVacation = id ? state.vacations.find((item) => item.id === id) : null;
  const person = state.personal.find((item) => item.id === form.get("collaborator_id"));
  if (!person) return notify("Selecciona un colaborador.");
  if (state.currentUser.role === "focal" && person.focal_user_id !== state.currentUser.id) return notify("No puedes registrar vacaciones de otro equipo.");

  const startDate = form.get("start_date");
  const endDate = form.get("end_date");
  const type = form.get("type");
  if (!startDate || !endDate) return notify("Ingresa fecha inicio y fecha fin.");
  if (endDate < startDate) return notify("La fecha fin no puede ser anterior a la fecha inicio.");
  if (!id) {
    const operationalMonth = operationalMonthValue();
    const minForType = minStartDateForType(type);
    if (startDate < minForType) {
      if (type === "vacaciones" || type === "otro") {
        return notify(`Las vacaciones solo pueden registrarse desde ${monthName(vacationMinMonthValue())} en adelante.`);
      }
      return notify(`Los registros de ${titleText(type)} deben estar dentro del mes operativo actual (${monthName(operationalMonth)}).`);
    }
    if ((type === "tarde libre" || type === "descanso médico") && startDate.slice(0, 7) !== operationalMonth) {
      return notify(`Los registros de ${titleText(type)} deben estar dentro del mes operativo actual (${monthName(operationalMonth)}).`);
    }
  }
  const derived = calculateVacationDerived(startDate, endDate);
  if (!derived.days) return notify("El rango no contiene días válidos.");

  const returnDate = form.get("return_date") || (derived.returnDate ? toDateInput(derived.returnDate) : "");
  if (!returnDate) return notify("Ingresa la fecha de retorno.");
  if (returnDate <= endDate) return notify("La fecha de retorno debe ser posterior a la fecha fin.");
  const overlappingVacation = state.vacations.find((item) =>
    item.id !== id
    && item.collaborator_id === person.id
    && item.type === type
    && sameActivePeriod(item)
    && rangesOverlap(startDate, endDate, item.start_date, item.end_date)
  );
  if (overlappingVacation) return notify("Ya existe un registro para este colaborador que se cruza con esas fechas.");

  const emailStatus = form.get("email_status") || "pendiente";
  if (emailStatus === "si" && !form.get("email_date")) return notify("Ingresa la fecha de correo.");

  const vacation = {
    collaborator_id: person.id,
    focal_user_id: state.currentUser.role === "focal" ? state.currentUser.id : (form.get("focal_user_id") || person.focal_user_id || null),
    po: String(form.get("po") || "").trim(),
    project: String(form.get("project") || "").trim(),
    type: form.get("type"),
    start_date: startDate,
    end_date: endDate,
    return_date: returnDate,
    days: derived.days,
    month: String(startDate).slice(0, 7),
    period_id: existingVacation?.period_id || activePeriod()?.id || null,
    status: form.get("status_edit") || "Pendiente",
    email_status: emailStatus,
    email_sent: emailStatus === "si",
    email_date: emailStatus === "si" ? form.get("email_date") : null,
    po_approval: form.get("po_approval") || "pendiente",
    coverage_confirmed: form.get("coverage_confirmed") || "pendiente",
    coverage_owner: String(form.get("coverage_owner") || "").trim(),
    notes: String(form.get("notes") || "").trim(),
    registered_formal: existingVacation?.registered_formal || form.get("registered_formal") === "on",
    registered_gabin: form.get("registered_gabin") === "on"
  };

  if (vacation.po_approval === "si") {
    vacation.status = "Completado";
  }

  try {
    const vacationId = id || crypto.randomUUID();
    const nextVacation = {
      id: vacationId,
      ...vacation,
      used_truncas: false,
      created_by: existingVacation?.created_by || state.currentUser.id,
      created_at: existingVacation?.created_at || new Date().toISOString()
    };
    const affectedBalances = [];

    if (existingVacation && existingVacation.collaborator_id !== person.id) {
      const previousPerson = state.personal.find((item) => item.id === existingVacation.collaborator_id);
      if (previousPerson) {
        const previousVacations = state.vacations.filter((item) => item.collaborator_id === previousPerson.id && item.id !== id && sameActivePeriod(item));
        affectedBalances.push({ person: previousPerson, result: calculateVacationBalance(previousPerson, previousVacations) });
      }
    }

    const proposedVacations = state.vacations
      .filter((item) => item.collaborator_id === person.id && item.id !== id && sameActivePeriod(item))
      .concat(nextVacation);
    const newBalance = calculateVacationBalance(person, proposedVacations);
    const usage = newBalance.allocations.get(vacationId);
    nextVacation.used_truncas = Boolean(usage?.usedTruncas);
    nextVacation.used_black_vacations = Boolean(usage?.usedBlack);
    nextVacation.black_vacation_days = usage?.blackDays || 0;
    nextVacation.current_vacation_days_used = usage?.currentDays || 0;
    nextVacation.truncated_vacation_days_used = usage?.truncatedDays || 0;
    nextVacation.formal_vacation_days = usage?.formalDays || 0;
    nextVacation.registered_formal = nextVacation.formal_vacation_days === 0 && !["descanso médico", "tarde libre"].includes(nextVacation.type) ? true : nextVacation.registered_formal;
    affectedBalances.push({ person, result: newBalance });

    if (id) {
      await updateVacationRow(id, {
        ...vacation,
        registered_formal: nextVacation.registered_formal,
        used_truncas: nextVacation.used_truncas,
        used_black_vacations: nextVacation.used_black_vacations,
        black_vacation_days: nextVacation.black_vacation_days,
        current_vacation_days_used: nextVacation.current_vacation_days_used,
        truncated_vacation_days_used: nextVacation.truncated_vacation_days_used,
        formal_vacation_days: nextVacation.formal_vacation_days,
        updated_at: new Date().toISOString()
      });
      notify("Registro actualizado.");
    } else {
      await persistVacationRow(nextVacation);
      notify(nextVacation.used_black_vacations || nextVacation.used_truncas
        ? `Registro guardado. Uso saldo: ${usageText(usage)}.`
        : "Registro guardado.");
    }

    for (const balance of affectedBalances) {
      await updateRecord("personal", balance.person.id, {
        current_vacation_days: balance.result.current,
        truncated_vacation_days: balance.result.truncated,
        excel_fields: vacationBalanceExcelFields(balance.person, balance.result),
        updated_at: new Date().toISOString()
      });
    }
  } catch (err) {
    if (err.message !== "Saldo insuficiente") throw err;
    return;
  }

  state.showVacationForm = false;
  state.editingVacationId = null;
  state.prefillVacationPersonId = null;
  state.prefillVacationDefaults = null;
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

export async function removeVacation(id) {
  const vacation = state.vacations.find((item) => item.id === id);
  if (!vacation) return;
  if (!canCurrentUserWriteVacations()) return notify("El periodo estÃ¡ cerrado. Los focales no pueden eliminar registros.");
  if (state.currentUser.role === "focal" && vacation.focal_user_id !== state.currentUser.id) return notify("No puedes eliminar registros de otro equipo.");
  const name = collaboratorName(vacation.collaborator_id);
  const confirmed = await confirmAction(`Eliminar el registro de ${name} del ${dateText(vacation.start_date)} al ${dateText(vacation.end_date)}?`, {
    title: "Eliminar registro",
    confirmText: "Eliminar"
  });
  if (!confirmed) return;
  const person = state.personal.find((item) => item.id === vacation.collaborator_id);
  const balance = person
    ? calculateVacationBalance(person, state.vacations.filter((item) => item.collaborator_id === person.id && item.id !== id && sameActivePeriod(item)))
    : null;
  await deleteRecord("vacations", id);
  if (person && balance) {
    await updateRecord("personal", person.id, {
      current_vacation_days: balance.current,
      truncated_vacation_days: balance.truncated,
      excel_fields: vacationBalanceExcelFields(person, balance),
      updated_at: new Date().toISOString()
    });
  }
  state.showVacationForm = false;
  state.editingVacationId = null;
  state.prefillVacationPersonId = null;
  notify("Registro eliminado.");
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

export async function markFormalRegistered(checkbox) {
  if (!checkbox.checked) return;
  await updateRecord("vacations", checkbox.dataset.toggleFormal, { registered_formal: true });
  checkbox.disabled = true;
  const { renderApp } = await import("../app-core.js");
  renderApp();
}

export function openDetail(id) {
  const item = state.vacations.find((row) => row.id === id);
  document.getElementById("detailContent").innerHTML = `
    <h3>${collaboratorName(item.collaborator_id)}</h3>
    <p>${dateText(item.start_date)} al ${dateText(item.end_date)} | Retorno: ${dateText(item.return_date)}</p>
    ${vacationTable([item], { actions: false })}
    <div class="modal-actions"><button class="primary-btn" onclick="document.getElementById('detailDialog').close()" type="button">Cerrar</button></div>
  `;
  document.getElementById("detailDialog").showModal();
}

export function exportExcel() {
  if (!window.XLSX) {
    return notify("La librería de exportación aún no está cargada. Verifica la conexión a internet y vuelve a intentar.");
  }
  const usageMap = vacationTruncasUsageMap();
  const rows = filteredVacations({ includeHistorical: true }).map((item) => {
    const usage = usageFor(item, usageMap);
    return {
      Colaborador: collaboratorName(item.collaborator_id),
      Focal: userName(item.focal_user_id),
      PO: item.po,
      Proyecto: item.project,
      Tipo: item.type,
      Inicio: item.start_date,
      Fin: item.end_date,
      Retorno: item.return_date,
      Dias: item.days,
      Mes: item.month,
      Estado: item.status,
      CorreoEnviado: emailStatusLabel(item),
      FechaCorreo: item.email_date,
      GABIN: item.registered_gabin ? "si" : "no",
      ConformePO: item.po_approval,
      CoberturaConfirmada: item.coverage_confirmed,
      ResponsableCobertura: item.coverage_owner,
      Observaciones: item.notes,
      DiasVacacionesNegras: usage.blackDays,
      DiasPorVencer: usage.currentDays,
      DiasTruncas: usage.truncatedDays,
      DiasFormales: usage.formalDays,
      SaldoFinalPendiente: finalPendingDaysFor(item.collaborator_id),
      RegistradoSistemaFormal: usage.formalDays === 0 ? "no aplica" : (item.registered_formal ? "si" : "no"),
      UsaVacacionesNegras: usage.usedBlack || item.used_black_vacations ? "si" : "no",
      UsaVacacionesTruncas: usage.usedTruncas || item.used_truncas ? "si" : "no",
      UltimaActualizacion: item.updated_at ? dateTimeText(item.updated_at) : ""
    };
  });
  const sheet = XLSX.utils.json_to_sheet(rows);
  const book = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(book, sheet, "Base Vacaciones");
  XLSX.writeFile(book, `control-modo-avion-consolidado-${toMonth(new Date())}.xlsx`);
}

function toMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

function embeddedVacationFormTemplate() {
  const people = visiblePersonal();
  const vacation = state.editingVacationId ? state.vacations.find((item) => item.id === state.editingVacationId) : null;
  const prefillId = vacation ? vacation.collaborator_id : state.prefillVacationPersonId;
  const selectedPerson = prefillId ? people.find((person) => person.id === prefillId) : null;
  const defaults = vacation ? {} : (state.prefillVacationDefaults || {});
  const isFormalDisabled = Boolean(vacation?.registered_formal);
  const startDate = vacation?.start_date || defaults.start_date || "";
  const endDate = vacation?.end_date || defaults.end_date || "";
  const currentMonth = startDate ? startDate.slice(0, 7) : "";
  const selectedType = vacation?.type || defaults.type || "vacaciones";
  const periodMin = minStartDateForType(selectedType);
  const minStartDate = vacation?.start_date || defaults.start_date || periodMin;
  const derivedDefaults = startDate && endDate ? calculateVacationDerived(startDate, endDate) : {};
  const returnDateValue = vacation?.return_date || (derivedDefaults.returnDate ? toDateInput(derivedDefaults.returnDate) : "");

  return `
    <section class="dashboard-card embedded-vacation-panel">
      <div class="dashboard-card-header">
        <div>
          <h3>${vacation ? "Editar registro" : "Nuevo registro"}</h3>
          <p>Completa todos los campos del registro. El retorno, días y mes se calculan automáticamente.</p>
        </div>
        <button class="ghost-btn compact-btn" id="cancelEmbeddedVacationBtn" type="button">Cerrar</button>
      </div>
      <form id="embeddedVacationForm" class="embedded-vacation-form full-vacation-form">
        <input type="hidden" name="id" value="${vacation?.id || ""}">
        <input type="hidden" name="days" value="${vacation?.days || derivedDefaults.days || ""}">
        <input type="hidden" name="month" value="${currentMonth}">
        ${collaboratorSearchField(people, selectedPerson?.id || "")}
        ${vacationFocalField(vacation, selectedPerson)}
        <label>PO<input name="po" value="${safeCell(vacation?.po || vacationPersonPo(selectedPerson))}"></label>
        <label>Proyecto/Squad<input name="project" value="${safeCell(vacation?.project || vacationPersonProject(selectedPerson))}"></label>
        <label>Tipo<select name="type" required>${["vacaciones", "tarde libre", "descanso médico", "otro"].map((type) => `<option value="${type}" ${(vacation?.type || defaults.type || "vacaciones") === type ? "selected" : ""}>${titleText(type)}</option>`).join("")}</select></label>
        <label>Fecha inicio<input name="start_date" type="date" min="${minStartDate}" value="${startDate}" required></label>
        <label>Fecha fin<input name="end_date" type="date" min="${minStartDate}" value="${endDate}" required></label>
        <label>Mes<input data-auto-month value="${monthText(currentMonth)}" readonly></label>
        <label>Retorno<input name="return_date" data-auto-return type="date" value="${returnDateValue}" required></label>
        <label>Días<input data-auto-days value="${vacation?.days || derivedDefaults.days || "-"}" readonly></label>
        <label>Estado<select name="status_edit">${["Pendiente", "Completado", "Reprogramado", "Observado"].map((status) => `<option value="${status}" ${(vacation?.status || defaults.status || "Pendiente") === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
        <label>Correo<select name="email_status">${["pendiente", "si", "no"].map((status) => `<option value="${status}" ${getEmailStatus(vacation) === status ? "selected" : ""}>${emailStatusDisplay(status)}</option>`).join("")}</select></label>
        <label>Fecha correo<input name="email_date" type="date" value="${vacation?.email_date || ""}"></label>
        <label class="check-field gabin-check" id="gabinCheckField" style="${(vacation?.type || defaults.type || "vacaciones") === "descanso médico" ? "" : "display:none"}"><input name="registered_gabin" type="checkbox" ${vacation?.registered_gabin ? "checked" : ""}> Registrado en GABIN</label>
        <label>Conforme PO<select name="po_approval">${["pendiente", "si", "no"].map((status) => `<option value="${status}" ${(vacation?.po_approval || "pendiente") === status ? "selected" : ""}>${emailStatusDisplay(status)}</option>`).join("")}</select></label>
        <label>Cobertura<select name="coverage_confirmed">${["pendiente", "si", "no"].map((status) => `<option value="${status}" ${(vacation?.coverage_confirmed || "pendiente") === status ? "selected" : ""}>${emailStatusDisplay(status)}</option>`).join("")}</select></label>
        <label>Responsable cobertura<input name="coverage_owner" value="${safeCell(vacation?.coverage_owner || "")}"></label>
        <label class="span-2">Obs.<textarea name="notes">${safeCell(vacation?.notes || "")}</textarea></label>
        <label class="check-field formal-check"><input name="registered_formal" type="checkbox" ${vacation?.registered_formal ? "checked" : ""} ${isFormalDisabled ? "disabled" : ""}> Registrado en sistema formal</label>
        <div class="embedded-actions span-4">
          <button class="ghost-btn" id="cancelEmbeddedVacationBtn2" type="button">Cancelar</button>
          <button class="primary-btn" type="submit">Guardar registro</button>
        </div>
      </form>
    </section>
  `;
}

function collaboratorSearchField(people, selectedId = "") {
  const selected = people.find((person) => person.id === selectedId);
  return `
    <label class="collaborator-search-label">Colaborador
      <input data-collaborator-search value="${safeCell(selected?.name || "")}" placeholder="Buscar colaborador..." autocomplete="off" required>
      <input type="hidden" name="collaborator_id" value="${safeCell(selected?.id || "")}">
      <div class="collaborator-results hidden" data-collaborator-results></div>
    </label>
  `;
}

function vacationFocalField(vacation, selectedPerson) {
  if (state.currentUser.role === "focal") {
    return `<label>Focal<input name="focal_display" value="${safeCell(state.currentUser.name)}" readonly><input type="hidden" name="focal_user_id" value="${state.currentUser.id}"></label>`;
  }
  const focalOptions = state.users.filter((user) => user.role === "focal").map((user) => [user.id, user.name]);
  const selectedFocal = vacationFocalUser(selectedPerson, vacation?.focal_user_id);
  return `<label>Focal<select name="focal_user_id"><option value=""></option>${focalOptions.map(([value, text]) => `<option value="${value}" ${String(selectedFocal?.id || "") === String(value) ? "selected" : ""}>${safeCell(text)}</option>`).join("")}</select></label>`;
}

function vacationFocalUser(person, fallbackId = "") {
  if (!person) return state.users.find((user) => user.id === fallbackId) || null;
  const focalName = vacationFocalName(person);
  if (focalName) return state.users.find((user) => user.role === "focal" && normalizeKey(user.name) === normalizeKey(focalName)) || null;
  return state.users.find((user) => user.id === (fallbackId || person.focal_user_id)) || null;
}

function vacationFocalName(person) {
  if (!person) return "";
  return String(rawExcelField(person, "FOCAL") || "").trim();
}

function vacationPersonPo(person) {
  if (!person) return "";
  return rawExcelField(person, "PO") || person?.po || "";
}

function vacationPersonProject(person) {
  if (!person) return "";
  return rawExcelField(person, "SQUAD REAL") || rawExcelField(person, "Proyecto/Squad") || rawExcelField(person, "SQUAD") || rawExcelField(person, "Proyecto") || person?.project || "";
}

function rawExcelField(person, header) {
  if (!person?.excel_fields || typeof person.excel_fields !== "object") return "";
  const exact = person.excel_fields[header];
  if (exact !== undefined && exact !== null) return exact;
  const normalizedHeader = normalizeKey(header);
  const key = Object.keys(person.excel_fields).find((item) => normalizeKey(item) === normalizedHeader);
  return key ? person.excel_fields[key] : "";
}

function monthText(value) {
  return value ? monthName(value) : "-";
}

function emailStatusDisplay(status) {
  if (status === "si") return "Sí";
  if (status === "no") return "No";
  return "Pendiente";
}

export function bindCollaboratorSearch(form) {
  const input = form.querySelector("[data-collaborator-search]");
  const results = form.querySelector("[data-collaborator-results]");
  const hidden = form.elements.collaborator_id;
  if (!input || !hidden) return;
  const people = visiblePersonal();
  const findMatch = () => people.find((person) => person.id === hidden.value || person.name === input.value || normalizeKey(person.name) === normalizeKey(input.value));
  const selectPerson = (person) => {
    input.value = person.name;
    hidden.value = person.id;
    const focal = state.currentUser.role === "focal" ? state.currentUser : vacationFocalUser(person);
    if (form.elements.focal_user_id && state.currentUser.role !== "focal") form.elements.focal_user_id.value = focal?.id || "";
    if (form.elements.focal_display) form.elements.focal_display.value = focal?.name || "";
    if (form.elements.po) form.elements.po.value = vacationPersonPo(person);
    if (form.elements.project) form.elements.project.value = vacationPersonProject(person);
    if (results) results.classList.add("hidden");
  };
  const renderResults = () => {
    if (!results) return;
    const query = normalizeKey(input.value);
    if (!query || query.length < 2) { results.classList.add("hidden"); results.innerHTML = ""; return; }
    const matches = people
      .filter((person) => !query || normalizeKey(collaboratorSearchText(person)).includes(query))
      .slice(0, 12);
    if (!matches.length) {
      results.innerHTML = `<div class="collaborator-result muted">Sin coincidencias</div>`;
      results.classList.remove("hidden");
      return;
    }
    results.innerHTML = matches.map((person) => `<button class="collaborator-result" data-collaborator-option="${person.id}" type="button"><strong>${safeCell(person.name)}</strong><span>${safeCell(collaboratorMetaText(person))}</span></button>`).join("");
    results.classList.remove("hidden");
    results.querySelectorAll("[data-collaborator-option]").forEach((button) => {
      button.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        const person = people.find((item) => item.id === button.dataset.collaboratorOption);
        if (person) selectPerson(person);
      });
    });
  };
  const sync = () => { const match = findMatch(); hidden.value = match?.id || ""; if (match) selectPerson(match); else renderResults(); };
  input.addEventListener("input", () => { hidden.value = ""; renderResults(); });
  input.addEventListener("focus", renderResults);
  input.addEventListener("change", sync);
  input.addEventListener("blur", () => setTimeout(() => results?.classList.add("hidden"), 140));
  if (hidden.value) sync();
  else results?.classList.add("hidden");
}

function collaboratorSearchText(person) {
  return [person.name, vacationPersonPo(person), vacationPersonProject(person)].filter(Boolean).join(" ");
}

function collaboratorMetaText(person) {
  return [vacationPersonPo(person), vacationPersonProject(person)].filter(Boolean).join(" | ");
}

async function persistVacationRow(row) {
  const payload = { ...row };
  delete payload.used_truncas;
  await persist("vacations", payload);
}

async function updateVacationRow(id, row) {
  const payload = { ...row };
  delete payload.used_truncas;
  await updateRecord("vacations", id, payload);
}

function usageFor(item, usageMap = vacationTruncasUsageMap()) {
  const usage = usageMap.get(item.id) || {};
  const blackDays = Number(usage.blackDays ?? item.black_vacation_days ?? 0);
  const currentDays = Number(usage.currentDays ?? item.current_vacation_days_used ?? item.days ?? 0);
  const truncatedDays = Number(usage.truncatedDays ?? item.truncated_vacation_days_used ?? 0);
  const formalDays = Number(usage.formalDays ?? item.formal_vacation_days ?? (currentDays + truncatedDays));
  return {
    blackDays,
    currentDays,
    truncatedDays,
    formalDays,
    usedBlack: Boolean(usage.usedBlack || item.used_black_vacations || blackDays > 0),
    usedTruncas: Boolean(usage.usedTruncas || item.used_truncas || truncatedDays > 0)
  };
}

function usageText(usage = {}) {
  const parts = [];
  if (Number(usage.blackDays || 0) > 0) parts.push(`${usage.blackDays} negras`);
  if (Number(usage.currentDays || 0) > 0) parts.push(`${usage.currentDays} por vencer`);
  if (Number(usage.truncatedDays || 0) > 0) parts.push(`${usage.truncatedDays} truncas`);
  return parts.join(" + ") || "0 días";
}

function finalPendingDaysFor(collaboratorId) {
  const person = state.personal.find((item) => item.id === collaboratorId);
  if (!person) return "";
  try {
    return calculateVacationBalance(person).pending;
  } catch {
    return "";
  }
}

function vacationRowClass(usage = {}) {
  return [
    usage.usedBlack ? "used-black-row" : "",
    usage.usedTruncas ? "used-trunca-row" : ""
  ].filter(Boolean).join(" ");
}

function formalStatusCell(item, usage = {}) {
  if (Number(usage.formalDays || 0) <= 0) {
    return `<span class="muted-cell" title="Este registro solo descuenta vacaciones negras">No aplica</span>`;
  }
  return `<input type="checkbox" data-toggle-formal="${item.id}" ${item.registered_formal ? "checked disabled" : ""} ${state.currentUser.role === "focal" ? "disabled" : ""}>`;
}

function sameActivePeriod(item) {
  const period = activePeriod();
  return !period || !item.period_id || item.period_id === period.id;
}

function rangesOverlap(startA, endA, startB, endB) {
  return startA <= endB && endA >= startB;
}

function vacationBalanceExcelFields(person, result) {
  const fields = person.excel_fields && typeof person.excel_fields === "object" ? { ...person.excel_fields } : {};
  fields.__aircontrol_vacation_base_black = result.base.black;
  fields.__aircontrol_vacation_base_current = result.base.current;
  fields.__aircontrol_vacation_base_truncated = result.base.truncated;
  fields["VACACIONES NEGRAS (Dias Laborables)"] = result.black;
  fields["VACACIONES POR VENCER"] = result.current;
  fields["VACACIONES TRUNCAS"] = result.truncated;
  fields["VACACIONES PENDIENTES"] = result.pending;
  fields["ESTADO DE VACACIONES NEGRAS"] = result.black < result.base.black ? "Planificadas" : (fields["ESTADO DE VACACIONES NEGRAS"] || "Pendientes");
  return fields;
}

export function syncEmbeddedVacationDerivedFields() {
  const form = document.getElementById("embeddedVacationForm");
  if (!form) return;
  const type = form.elements.type?.value;
  const typeMin = minStartDateForType(type);
  if (form.elements.start_date) form.elements.start_date.min = typeMin;
  const start = form.elements.start_date?.value;
  const end = form.elements.end_date?.value;
  if (form.elements.end_date) {
    form.elements.end_date.min = start || typeMin;
    if (start && end && end < start) form.elements.end_date.value = "";
  }
  const derived = calculateVacationDerived(start, end);
  form.elements.return_date.value = derived.returnDate ? toDateInput(derived.returnDate) : "";
  form.elements.days.value = derived.days || "";
  form.elements.month.value = start ? start.slice(0, 7) : "";
  const returnLabel = form.querySelector("[data-auto-return]");
  const daysLabel = form.querySelector("[data-auto-days]");
  const monthLabelEl = form.querySelector("[data-auto-month]");
  if (returnLabel) returnLabel.value = derived.returnDate ? toDateInput(derived.returnDate) : "";
  if (daysLabel) daysLabel.value = derived.days || "-";
  if (monthLabelEl) monthLabelEl.value = monthText(form.elements.month.value);
}

function vacationTable(rows, options = {}) {
  if (!rows.length) {
    return `<div class="vacation-empty-state"><strong>Sin registros.</strong><span>Cuando agregues vacaciones, apareceran en esta tabla.</span></div>`;
  }
  const usageMap = vacationTruncasUsageMap();
  const header = `
    <thead><tr>
      <th>Colaborador</th><th>Focal</th><th>PO</th><th>Proyecto/Squad</th><th>Tipo</th>
      <th>Inicio</th><th>Fin</th><th>Retorno</th><th>Dias</th><th>Mes</th><th>Estado</th><th>Uso saldo</th>
      <th>Correo</th><th>GABIN</th><th>Conforme PO</th><th>Cobertura</th>
      <th>Responsable cobertura</th><th>Obs.</th><th>Sist. formal</th><th>Ult. actualización</th>${options.actions ? "<th>Acciones</th>" : ""}
    </tr></thead>
  `;
  const body = rows.map((item) => {
    const usage = usageFor(item, usageMap);
    return `
      <tr class="${vacationRowClass(usage)}">
        <td><span class="person-cell vacation-person-cell"><span class="person-avatar color-${collaboratorColorIndex(item.collaborator_id)}">${personInitials(collaboratorName(item.collaborator_id))}</span><span class="person-name">${safeCell(collaboratorName(item.collaborator_id))}</span></span></td>
        <td>${safeCell(userName(item.focal_user_id))}</td>
        <td>${safeCell(item.po || "")}</td>
        <td>${safeCell(item.project || "")}</td>
        <td>${titleText(item.type || "")}</td>
        <td>${dateText(item.start_date)}</td>
        <td>${dateText(item.end_date)}</td>
        <td>${dateText(item.return_date)}</td>
        <td>${item.days || 0}</td>
        <td>${monthLabel(item.month)}</td>
        <td><span class="status ${slug(item.status)}">${safeCell(item.status || "")}</span></td>
        <td>${usageText(usage)}</td>
        <td>${emailStatusLabel(item)} ${item.email_date ? `<br>${dateText(item.email_date)}` : ""}</td>
        <td>${item.registered_gabin ? "sí" : "no"}</td>
        <td>${safeCell(item.po_approval || "")}</td>
        <td>${safeCell(item.coverage_confirmed || "")}</td>
        <td>${safeCell(item.coverage_owner || "-")}</td>
        <td>${safeCell(item.notes || "")}</td>
        <td>${formalStatusCell(item, usage)}</td>
        <td>${dateTimeText(item.updated_at)}</td>
        ${options.actions ? `<td><div class="table-action-buttons"><button class="edit-square" data-edit-vacation="${item.id}" type="button">${svgIcon("edit")}</button><button class="delete-square" data-delete-vacation="${item.id}" type="button">${svgIcon("trash")}</button></div></td>` : ""}
      </tr>
    `;
  }).join("");
  return `<div class="table-wrap vacation-table-wrap"><table class="vacation-table">${header}<tbody>${body}</tbody></table></div>`;
}

function legacyVacationTable(rows, options = {}) {
  if (!rows.length) {
    return `<div class="vacation-empty-state"><strong>Sin registros.</strong><span>Cuando agregues vacaciones, aparecerán en esta tabla.</span></div>`;
  }
  const truncasBadge = `<span class="truncas-badge" title="Esta solicitud consume d\u00edas de vacaciones truncas">Usa truncas</span>`;
  return `<div class="table-wrap vacation-table-wrap"><table class="vacation-table"><thead><tr><th>Colaborador</th><th>Focal</th><th>PO</th><th>Proyecto/Squad</th><th>Tipo</th><th>Inicio</th><th>Fin</th><th>Retorno</th><th>D\u00edas</th><th>Mes</th><th>Estado</th><th>Correo</th><th>GABIN</th><th>Conforme PO</th><th>Cobertura</th><th>Responsable cobertura</th><th>Obs.</th><th>Sist. formal</th><th>Ult. actualizaci\u00f3n</th>${options.actions ? "<th>Acciones</th>" : ""}</tr></thead><tbody>${rows.map((item) => `<tr class="${item.used_truncas ? "used-trunca-row" : ""}"><td><span class="person-cell">${item.used_truncas ? truncasBadge + " " : ""}<span class="person-avatar color-${collaboratorColorIndex(item.collaborator_id)}">${personInitials(collaboratorName(item.collaborator_id))}</span>${collaboratorName(item.collaborator_id)}</span></td><td>${userName(item.focal_user_id)}</td><td>${item.po || ""}</td><td>${item.project || ""}</td><td>${titleText(item.type || "")}</td><td>${dateText(item.start_date)}</td><td>${dateText(item.end_date)}</td><td>${dateText(item.return_date)}</td><td>${item.days || 0}</td><td>${monthLabel(item.month)}</td><td><span class="status ${slug(item.status)}">${item.status || ""}</span></td><td>${emailStatusLabel(item)} ${item.email_date ? `<br>${dateText(item.email_date)}` : ""}</td><td>${item.registered_gabin ? "s\u00ed" : "no"}</td><td>${item.po_approval || ""}</td><td>${item.coverage_confirmed || ""}</td><td>${item.coverage_owner || "-"}</td><td>${item.notes || ""}</td><td><input type="checkbox" data-toggle-formal="${item.id}" ${item.registered_formal ? "checked disabled" : ""} ${state.currentUser.role === "focal" ? "disabled" : ""}></td><td>${dateTimeText(item.updated_at)}</td>${options.actions ? `<td><div class="table-action-buttons"><button class="edit-square" data-edit-vacation="${item.id}" type="button">${svgIcon("edit")}</button><button class="delete-square" data-delete-vacation="${item.id}" type="button">${svgIcon("trash")}</button></div></td>` : ""}</tr>`).join("") || `<tr><td colspan="${options.actions ? 20 : 19}">Sin registros.</td></tr>`}</tbody></table></div>`;
}
