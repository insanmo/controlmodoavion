import { state } from "./state.js";
import { cleanMojibake, escapeHtml } from "./security.js";

export function cleanText(value) {
  return cleanMojibake(value);
}

export function safeHtml(value) {
  return escapeHtml(cleanMojibake(value));
}

export function safeCell(value) {
  return safeHtml(value);
}

export function toDateInput(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function toMonth(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
}

export function dateText(value) {
  if (!value) return "";
  const raw = String(value);
  const normalized = /^\d{4}-\d{2}-\d{2}$/.test(raw)
    ? `${raw}T00:00:00`
    : raw.replace(/^(\d{4}-\d{2}-\d{2})\s+/, "$1T");
  const date = value instanceof Date ? value : new Date(normalized);
  if (Number.isNaN(date.getTime())) return safeCell(value);
  return `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
}

export function dateTimeText(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return safeCell(value);
  return `${dateText(date)} ${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

export function monthName(month) {
  const [year, monthIndex] = month.split("-").map(Number);
  return new Date(year, monthIndex - 1, 1)
    .toLocaleDateString("es-PE", { month: "long", year: "numeric" })
    .replace(/^./, (char) => char.toUpperCase());
}

export function monthLabel(month) {
  if (!month) return "";
  return monthName(month).slice(0, 3) + " " + month.slice(0, 4);
}

export function numberText(value) {
  const number = Number(value || 0);
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/\.?0+$/, "");
}

export function numberFromExcel(value) {
  const number = Number(String(value ?? "").replace(",", "."));
  return Number.isFinite(number) ? number : 0;
}

export function slug(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
}

export function titleText(value) {
  return cleanText(String(value || "").replace(/_/g, " ")).replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export function normalizeKey(value) {
  return String(value || "").normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
}

export function normalizeName(value) {
  return normalizeKey(String(value || "").replace(",", " "));
}

export function normalizePersonDisplayName(value) {
  const raw = String(value || "").trim().replace(/\s+/g, " ");
  if (!raw) return "";
  const reordered = raw.includes(",") ? raw.split(",").reverse().join(" ") : raw;
  return reordered.toLocaleLowerCase("es-PE").replace(/\b[\p{L}]/gu, (char) => char.toLocaleUpperCase("es-PE"));
}

export function normalizeExcelDate(value) {
  if (!value) return "";
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  if (/^\d+(\.\d+)?$/.test(value)) {
    const excelEpoch = new Date(Date.UTC(1899, 11, 30));
    excelEpoch.setUTCDate(excelEpoch.getUTCDate() + Number(value));
    return toDateInput(new Date(excelEpoch.getUTCFullYear(), excelEpoch.getUTCMonth(), excelEpoch.getUTCDate()));
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : toDateInput(date);
}

export function normalizeStatus(value) {
  const raw = String(value || "").trim().toLowerCase();
  return raw === "inactivo" ? "inactivo" : "activo";
}

export function fallbackEmail(name, raw = {}) {
  const user = String(raw.Usuario || raw.usuario || "").trim();
  if (user) return `usuario${user}@indra.com`.toLowerCase();
  const slugged = normalizeKey(name).replace(/_/g, ".").replace(/\.+/g, ".").replace(/^\.|\.$/g, "");
  return `${slugged || crypto.randomUUID()}@indra.com`.toLowerCase();
}

export function userInitials(user) {
  const source = user?.name || user?.email || "Usuario";
  const parts = source.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function personInitials(name) {
  const parts = String(name || "").trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "NA";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return `${parts[0][0]}${parts[parts.length - 1][0]}`.toUpperCase();
}

export function inputField(name, label, type, value = "") {
  return `<label>${safeCell(label)}<input name="${name}" type="${type}" value="${safeCell(value ?? "")}" ${["name", "email", "start_date", "end_date", "days"].includes(name) ? "required" : ""}></label>`;
}

export function selectField(name, label, options, selectedValue = "") {
  const values = options.map((option) => Array.isArray(option) ? option : [option, option]);
  return `<label>${safeCell(label)}<select name="${name}" required>${values.map(([value, text]) => `<option value="${safeCell(value)}" ${String(selectedValue || "") === String(value) ? "selected" : ""}>${safeCell(text)}</option>`).join("")}</select></label>`;
}

export function selectFieldInner(name, options, selectedValue = "") {
  return `<select name="${name}" required>${options.map(([value, text]) => `<option value="${value}" ${String(selectedValue || "") === String(value) ? "selected" : ""}>${safeCell(text)}</option>`).join("")}</select>`;
}

export function svgIcon(name) {
  const paths = {
    home: '<path d="m3 11 9-8 9 8"/><path d="M5 10v10h14V10"/><path d="M9 20v-6h6v6"/>',
    calendar: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18"/>',
    calendarDays: '<rect x="3" y="4" width="18" height="17" rx="2"/><path d="M8 2v4M16 2v4M3 10h18M8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01"/>',
    bar: '<path d="M4 20V10M10 20V4M16 20v-7M22 20H2"/>',
    users: '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
    user: '<path d="M20 21a8 8 0 0 0-16 0"/><circle cx="12" cy="7" r="4"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    settings: '<path d="M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.88l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 .6V20a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1-.6 1.7 1.7 0 0 0-1.88.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-.6-1H4a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 .6-1 1.7 1.7 0 0 0-.34-1.88l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-.6V4a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 .6 1.7 1.7 0 0 0 1.88-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.4 9c.2.35.4.69.6 1H20a2 2 0 1 1 0 4h-.1c-.2.31-.4.65-.5 1Z"/>',
    edit: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    close: '<path d="M18 6 6 18M6 6l12 12"/>',
    file: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
    chevronLeft: '<path d="m15 18-6-6 6-6"/>',
    chevronRight: '<path d="m9 18 6-6-6-6"/>',
    checklist: '<path d="M3 7h11M3 12h11M3 17h7"/><path d="m17 13 2 2 4-4"/>',
    radar: '<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/><path d="M12 3v4M12 17v4M3 12h4M17 12h4"/>',
    notes: '<path d="M5 3h11l4 4v14H5z"/><path d="M9 12h7M9 16h7M9 8h4"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    trash: '<path d="M3 6h18M8 6V4h8v2M19 6l-1 14H6L5 6M10 11v6M14 11v6"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
    pin: '<path d="M12 17v5"/><path d="M9 3h6l-1 7 3 3H7l3-3-1-7Z"/>',
    alert: '<path d="M12 3 2 20h20L12 3Z"/><path d="M12 9v5M12 17h.01"/>',
    shield: '<path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3Z"/>',
    flag: '<path d="M4 21V4h12l-2 4 2 4H4"/>'
  };
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${paths[name] || paths.home}</svg>`;
}

export function countBy(rows, getter) {
  return rows.reduce((acc, row) => {
    const key = getter(row);
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
}

export function toMonthInput(value) {
  if (!value) return "";
  return value.slice(0, 7);
}

export function overlapsMonth(item, month) {
  return item.start_date <= `${month}-31` && item.end_date >= `${month}-01`;
}

export function calculateVacationDerived(startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T00:00:00`);
  const returnDate = new Date(end);
  do {
    returnDate.setDate(returnDate.getDate() + 1);
  } while (!isBusinessDate(returnDate));
  const days = Math.floor((end - start) / 86400000) + 1;
  return { returnDate, days };
}

function isBusinessDate(date) {
  const day = date.getDay();
  if (day === 0 || day === 6) return false;
  const value = toDateInput(date);
  return !state.holidays?.some((holiday) => holiday.date === value);
}

