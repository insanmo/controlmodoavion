import { cleanText } from "./utils.js";

let systemDialogResolve = null;

export function notify(message, options = {}) {
  return showSystemDialog({
    title: options.title || "Aviso",
    message,
    confirmText: options.confirmText || "Aceptar"
  });
}

export function confirmAction(message, options = {}) {
  return showSystemDialog({
    title: options.title || "Confirmar acción",
    message,
    confirmText: options.confirmText || "Confirmar",
    cancelText: options.cancelText || "Cancelar",
    needsConfirmation: true
  });
}

export function promptAction(message, defaultValue = "", options = {}) {
  return showSystemDialog({
    title: options.title || "Ingresar dato",
    message,
    confirmText: options.confirmText || "Aceptar",
    cancelText: options.cancelText || "Cancelar",
    needsConfirmation: true,
    showInput: true,
    defaultValue,
    inputType: options.inputType || "text"
  });
}

function showSystemDialog({ title, message, confirmText, cancelText, needsConfirmation = false, showInput = false, defaultValue = "", inputType = "text" }) {
  return new Promise((resolve) => {
    const dialog = ensureSystemDialog();
    const titleEl = dialog.querySelector("[data-system-dialog-title]");
    const messageEl = dialog.querySelector("[data-system-dialog-message]");
    const inputEl = dialog.querySelector("[data-system-dialog-input]");
    const confirmBtn = dialog.querySelector("[data-system-dialog-confirm]");
    const cancelBtn = dialog.querySelector("[data-system-dialog-cancel]");

    titleEl.textContent = cleanText(title);
    messageEl.textContent = cleanText(message);
    confirmBtn.textContent = cleanText(confirmText);
    cancelBtn.textContent = cleanText(cancelText || "Cancelar");
    cancelBtn.classList.toggle("hidden", !needsConfirmation);
    inputEl.style.display = showInput ? "" : "none";
    if (showInput) {
      inputEl.value = defaultValue;
      inputEl.type = inputType;
    }

    const cleanup = (result) => {
      confirmBtn.removeEventListener("click", onConfirm);
      cancelBtn.removeEventListener("click", onCancel);
      dialog.removeEventListener("cancel", onCancel);
      inputEl.removeEventListener("keydown", onInputKeydown);
      if (dialog.open) dialog.close();
      resolve(result);
    };
    const onConfirm = () => {
      if (showInput) {
        const value = inputEl.value?.trim() || defaultValue;
        if (!value) return;
        cleanup(value);
      } else {
        cleanup(true);
      }
    };
    const onCancel = (event) => {
      event?.preventDefault?.();
      cleanup(showInput ? null : false);
    };

    confirmBtn.addEventListener("click", onConfirm);
    cancelBtn.addEventListener("click", onCancel);
    dialog.addEventListener("cancel", onCancel);
    const onInputKeydown = (e) => { if (e.key === "Enter") onConfirm(); };
    inputEl.addEventListener("keydown", onInputKeydown);
    if (dialog.open) dialog.close();
    dialog.showModal();
    if (showInput) inputEl.focus(); else confirmBtn.focus();
  });
}

function ensureSystemDialog() {
  let dialog = document.getElementById("systemMessageDialog");
  if (dialog) return dialog;
  dialog = document.createElement("dialog");
  dialog.id = "systemMessageDialog";
  dialog.className = "modal system-message-modal";
  dialog.innerHTML = `
    <div class="system-message-content">
      <h3 data-system-dialog-title>Aviso</h3>
      <p data-system-dialog-message></p>
      <input data-system-dialog-input class="system-dialog-input" type="text" style="display:none">
      <div class="modal-actions">
        <button class="ghost-btn compact-btn hidden" data-system-dialog-cancel type="button">Cancelar</button>
        <button class="primary-btn compact-btn" data-system-dialog-confirm type="button">Aceptar</button>
      </div>
    </div>
  `;
  document.body.appendChild(dialog);
  return dialog;
}
