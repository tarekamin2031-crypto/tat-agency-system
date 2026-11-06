import React, { useEffect, useState } from "react";

// Listens for "tat:toast" window events (see notifyError / notifySuccess in
// api/client.js) and shows a short-lived message in the corner.
export default function Toaster() {
  const [toasts, setToasts] = useState([]);

  useEffect(() => {
    const onToast = (e) => {
      const id = Date.now() + Math.random();
      setToasts((t) => [...t.slice(-3), { id, ...e.detail }]);
      setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 5000);
    };
    window.addEventListener("tat:toast", onToast);
    return () => window.removeEventListener("tat:toast", onToast);
  }, []);

  return (
    <div className="tat-toaster">
      {toasts.map((t) => (
        <div key={t.id} className={`tat-toast ${t.type === "error" ? "error" : "success"}`} role="status">
          {t.message}
        </div>
      ))}
    </div>
  );
}
