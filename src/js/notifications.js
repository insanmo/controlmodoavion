import { state } from "./state.js";
import { numberText, dateText } from "./utils.js";
import { dueSoonPeople, warningDuePeople, birthdayPeopleThisMonth } from "./components/dashboard.js";
import { collaboratorName, visibleVacations } from "./components/common.js";

export function notificationItems() {
  const items = [];
  dueSoonPeople().forEach((person) => items.push({
    key: `due:${person.id}:${person.current_vacation_due_date}:${person.current_vacation_days}`,
    tone: "danger",
    title: "Vacaciones por vencer",
    text: `${person.name} tiene ${numberText(person.current_vacation_days)} dias pendientes hasta ${dateText(person.current_vacation_due_date)}.`
  }));
  warningDuePeople().forEach((person) => items.push({
    key: `due-warning:${person.id}:${person.current_vacation_due_date}:${person.current_vacation_days}`,
    tone: "warning",
    title: "Vacaciones proximas",
    text: `${person.name} vence el ${dateText(person.current_vacation_due_date)} con ${numberText(person.current_vacation_days)} dias pendientes.`
  }));
  birthdayPeopleThisMonth().filter((item) => item.needsRest).forEach((item) => items.push({
    key: `birthday:${item.person.id}:${dateText(item.date)}`,
    tone: "warning",
    title: "Cumpleanos habil",
    text: `${item.person.name} cumple el ${dateText(item.date)}. Registrar descanso de medio dia.`
  }));
  visibleVacationsFiltered().filter((item) => item.po_approval !== "si").forEach((item) => items.push({
    key: `po:${item.id}:${item.po_approval || "pendiente"}`,
    tone: "info",
    title: "Sin conforme PO",
    text: `${collaboratorName(item.collaborator_id)} - ${dateText(item.start_date)}.`
  }));
  visibleVacationsFiltered().filter((item) => item.coverage_confirmed !== "si").forEach((item) => items.push({
    key: `coverage:${item.id}:${item.coverage_confirmed || "pendiente"}`,
    tone: "info",
    title: "Cobertura pendiente",
    text: `${collaboratorName(item.collaborator_id)} necesita confirmacion de cobertura.`
  }));
  if (state.currentUser?.role === "admin") {
    state.passwordRequests.filter((item) => item.status === "pendiente").forEach((item) => items.push({
      key: `password:${item.id}:${item.status}`,
      tone: "danger",
      title: "Recuperacion pendiente",
      text: `${item.email} solicito una contrasena temporal.`
    }));
  }
  return items.filter((item) => !isNotificationDismissed(item.key));
}

function visibleVacationsFiltered() {
  return visibleVacations();
}

export function dismissedNotificationKeys() {
  try {
    return new Set(JSON.parse(localStorage.getItem("aircontrol_dismissed_notifications") || "[]"));
  } catch {
    return new Set();
  }
}

export function saveDismissedNotificationKeys(keys) {
  localStorage.setItem("aircontrol_dismissed_notifications", JSON.stringify([...keys]));
}

export function isNotificationDismissed(key) {
  return dismissedNotificationKeys().has(key);
}
