import React, { createContext, useContext, useState, useMemo } from "react";
import { effectiveFilterDefaults } from "./prefs";

const FilterContext = createContext(null);

// Static fallbacks; the user's own defaults (Settings → Preferences) override
// dateRange / clientStatus.
const BASE = { customFrom: "", customTo: "", clientId: "all", serviceId: "all" };

export function FilterProvider({ children }) {
  const [defaults, setDefaultsState] = useState(() => ({ ...BASE, ...effectiveFilterDefaults() }));
  const [dateRange, setDateRange] = useState(defaults.dateRange);
  const [customFrom, setCustomFrom] = useState(defaults.customFrom);
  const [customTo, setCustomTo] = useState(defaults.customTo);
  const [clientStatus, setClientStatus] = useState(defaults.clientStatus);
  const [clientId, setClientId] = useState(defaults.clientId);
  const [serviceId, setServiceId] = useState(defaults.serviceId);

  // Called when the account's preferences load or change: the new defaults
  // become both the "reset" target and the current selection.
  const applyDefaults = (prefs) => {
    const next = { ...BASE, ...effectiveFilterDefaults(prefs) };
    setDefaultsState(next);
    setDateRange(next.dateRange);
    setClientStatus(next.clientStatus);
  };

  const reset = () => {
    setDateRange(defaults.dateRange);
    setCustomFrom(defaults.customFrom);
    setCustomTo(defaults.customTo);
    setClientStatus(defaults.clientStatus);
    setClientId(defaults.clientId);
    setServiceId(defaults.serviceId);
  };

  // Serialized as a query string so any page can just do:
  //   api.listInvoices(filters.toQueryString())
  const toQueryString = () => {
    const params = new URLSearchParams();
    params.set("date_range", dateRange);
    if (dateRange === "custom") {
      if (customFrom) params.set("from", customFrom);
      if (customTo) params.set("to", customTo);
    }
    params.set("client_status", clientStatus);
    params.set("client_id", clientId);
    params.set("service_id", serviceId);
    return params.toString();
  };

  const value = useMemo(() => ({
    dateRange, setDateRange,
    customFrom, setCustomFrom,
    customTo, setCustomTo,
    clientStatus, setClientStatus,
    clientId, setClientId,
    serviceId, setServiceId,
    reset,
    defaults,
    applyDefaults,
    toQueryString,
    // A version key that changes whenever any filter changes — pages can
    // put this in a useEffect dependency array to refetch on filter change.
    key: [dateRange, customFrom, customTo, clientStatus, clientId, serviceId].join("|"),
  }), [dateRange, customFrom, customTo, clientStatus, clientId, serviceId, defaults]);

  return <FilterContext.Provider value={value}>{children}</FilterContext.Provider>;
}

export function useFilters() {
  const ctx = useContext(FilterContext);
  if (!ctx) throw new Error("useFilters must be used inside a FilterProvider");
  return ctx;
}
