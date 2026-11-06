import React, { useEffect, useState } from "react";
import { api } from "../api/client";
import LogViewer from "../components/LogViewer";
import { t } from "../i18n";

const fetchLogs = (qs) => api.platformLogs(qs);
const fetchFilters = () => api.platformLogFilters();

export default function PlatformLogs() {
  const [agencies, setAgencies] = useState([]);
  useEffect(() => { api.platformAgencies().then(setAgencies).catch(() => {}); }, []);
  return (
    <div style={{ padding: 28 }}>
      <div style={{ marginBottom: 16 }}>
        <div style={{ fontSize: 22, fontWeight: 700 }}>{t("سجل المنصة")}</div>
        <div style={{ fontSize: 13, color: "var(--ink-3)" }}>{t("نشاط كل الوكالات في مكان واحد — فلتر بالوكالة أو المستخدم أو الحدث.")}</div>
      </div>
      <LogViewer fetchLogs={fetchLogs} fetchFilters={fetchFilters} agencies={agencies} />
    </div>
  );
}
