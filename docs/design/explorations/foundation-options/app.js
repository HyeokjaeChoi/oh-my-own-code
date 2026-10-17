const root = document.documentElement;
const sidebar = document.querySelector("#sidebar");
const panel = document.querySelector("#evidence-panel");
const scrim = document.querySelector("#scrim");
const sidebarOpener = document.querySelector("#open-sidebar");
const panelOpener = document.querySelector("#panel-toggle");
const themeToggle = document.querySelector("#theme-toggle");
const toast = document.querySelector("#toast");
const mobileSidebar = matchMedia("(max-width: 699px)");
const overlayPanel = matchMedia("(max-width: 899px)");
let toastTimer;

function syncScrim() {
  const sidebarModal =
    mobileSidebar.matches && sidebar.classList.contains("is-open");
  const panelModal = overlayPanel.matches && !panel.hidden;
  scrim.hidden = !sidebarModal && !panelModal;
  document.querySelector(".workspace").inert = sidebarModal || panelModal;
  sidebar.inert = panelModal;
  panel.inert = sidebarModal;
  for (const [element, modal] of [
    [sidebar, sidebarModal],
    [panel, panelModal],
  ]) {
    if (modal) {
      element.setAttribute("role", "dialog");
      element.setAttribute("aria-modal", "true");
    } else {
      element.removeAttribute("role");
      element.removeAttribute("aria-modal");
    }
  }
}

function showToast(message) {
  clearTimeout(toastTimer);
  toast.textContent = message;
  toast.hidden = false;
  toastTimer = setTimeout(() => {
    toast.hidden = true;
  }, 4400);
}

function closeSidebar(restore = true) {
  const wasOpen = sidebar.classList.contains("is-open");
  sidebar.classList.remove("is-open");
  sidebarOpener.setAttribute("aria-expanded", "false");
  syncScrim();
  if (wasOpen && restore) sidebarOpener.focus();
}

function openSidebar() {
  if (!mobileSidebar.matches) return;
  closePanel(false);
  sidebar.classList.add("is-open");
  sidebarOpener.setAttribute("aria-expanded", "true");
  syncScrim();
  document.querySelector("#close-sidebar").focus();
}

function closePanel(restore = true) {
  const wasOpen = !panel.hidden;
  panel.hidden = true;
  panelOpener.setAttribute("aria-expanded", "false");
  panelOpener.setAttribute("aria-label", "근거 패널 열기");
  panelOpener.title = "근거 패널 열기";
  syncScrim();
  if (wasOpen && restore) panelOpener.focus();
}

function openPanel() {
  closeSidebar(false);
  panel.hidden = false;
  panelOpener.setAttribute("aria-expanded", "true");
  panelOpener.setAttribute("aria-label", "근거 패널 닫기");
  panelOpener.title = "근거 패널 닫기";
  syncScrim();
  document.querySelector("#close-panel").focus();
}

function setTheme(theme) {
  root.dataset.theme = theme;
  const dark = theme === "dark";
  themeToggle.setAttribute(
    "aria-label",
    dark ? "밝은 모드로 변경" : "어두운 모드로 변경",
  );
  themeToggle
    .querySelector("use")
    .setAttribute("href", dark ? "#i-sun" : "#i-moon");
  themeToggle.setAttribute("aria-pressed", String(dark));
  try {
    localStorage.setItem("omoc-preview-theme", theme);
  } catch {
    /* storage may be disabled */
  }
}

sidebarOpener.addEventListener("click", openSidebar);
document
  .querySelector("#close-sidebar")
  .addEventListener("click", () => closeSidebar());
panelOpener.addEventListener("click", () =>
  panel.hidden ? openPanel() : closePanel(),
);
document
  .querySelector("#close-panel")
  .addEventListener("click", () => closePanel());
scrim.addEventListener("click", () => {
  if (sidebar.classList.contains("is-open")) closeSidebar();
  if (!panel.hidden && overlayPanel.matches) closePanel();
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Tab") {
    const openOverlay = sidebar.classList.contains("is-open")
      ? sidebar
      : !panel.hidden && overlayPanel.matches
        ? panel
        : null;
    if (openOverlay) {
      const focusable = [
        ...openOverlay.querySelectorAll(
          'button, a[href], input, textarea, summary, [tabindex]:not([tabindex="-1"])',
        ),
      ].filter(
        (element) => !element.disabled && element.getClientRects().length,
      );
      const first = focusable[0];
      const last = focusable.at(-1);
      if (!openOverlay.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }
    return;
  }
  if (event.key !== "Escape") return;
  if (sidebar.classList.contains("is-open")) {
    closeSidebar();
    return;
  }
  if (!panel.hidden && overlayPanel.matches) closePanel();
});
mobileSidebar.addEventListener("change", () => closeSidebar(false));
overlayPanel.addEventListener("change", syncScrim);
themeToggle.addEventListener("click", () =>
  setTheme(root.dataset.theme === "dark" ? "light" : "dark"),
);
document.querySelectorAll("[data-demo]").forEach((button) =>
  button.addEventListener("click", () => {
    showToast(
      `${button.dataset.demo}은(는) 예시입니다. 실제 작업은 생성되거나 실행되지 않았습니다.`,
    );
    if (mobileSidebar.matches) closeSidebar();
  }),
);
document.querySelector("#demo-form").addEventListener("submit", (event) => {
  event.preventDefault();
  showToast(
    "정적 미리보기입니다. 메시지가 전송되거나 도구가 실행되지 않았습니다.",
  );
});

let savedTheme;
try {
  savedTheme = localStorage.getItem("omoc-preview-theme");
} catch {
  /* storage may be disabled */
}
setTheme(savedTheme === "dark" ? "dark" : "light");
syncScrim();
