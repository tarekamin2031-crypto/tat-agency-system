// Report export helpers (no dependencies).

// Excel-friendly CSV: UTF-8 BOM so Arabic text opens correctly, CRLF rows,
// and proper quoting of commas / quotes / line breaks.
export function downloadCsv(filename, rows) {
  const esc = (v) => {
    const s = v === null || v === undefined ? "" : String(v);
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = rows.map((r) => r.map(esc).join(",")).join("\r\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1500);
}

// Print / "Save as PDF" through the browser. Always prints on the light theme
// (dark backgrounds waste ink and look wrong on paper), then restores the user's theme.
export function printReport() {
  const root = document.documentElement;
  const previous = root.getAttribute("data-theme");
  root.setAttribute("data-theme", "light");
  const restore = () => {
    if (previous) root.setAttribute("data-theme", previous);
    window.removeEventListener("afterprint", restore);
  };
  window.addEventListener("afterprint", restore);
  setTimeout(() => window.print(), 80);
  setTimeout(restore, 60000); // safety net if afterprint never fires
}
