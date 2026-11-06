import React from "react";
import { api } from "../api/client";
import LogViewer from "../components/LogViewer";
import { EmptyBox } from "../components/Bits";
import { useAccount } from "../context/AccountContext";
import { t } from "../i18n";

const fetchLogs = (qs) => api.listLogs(qs);
const fetchFilters = () => api.logFilters();

export default function Logs() {
  const { can } = useAccount();
  if (!can("logs", "view")) return <div style={{ padding: 28 }}><EmptyBox>{t("مفيش عندك صلاحية لسجل النشاط")}</EmptyBox></div>;
  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{t("سجل النشاط")}</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("كل ما يحدث في الوكالة: من عمل إيه ومتى، مع القيم قبل وبعد التعديل. دوس على أي سطر للتفاصيل.")}</div>
      </div>
      <LogViewer fetchLogs={fetchLogs} fetchFilters={fetchFilters} />
    </div>
  );
}
