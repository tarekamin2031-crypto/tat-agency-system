import { getStoredUser } from "../api/client";
import { NAV_GROUPS, ADMIN_GROUP, ACCOUNT_GROUP, PLATFORM_GROUP } from "../components/navItems";

// `perms` is { module: [actions] } as sent by the server (/auth/me, login).
export function hasPerm(perms, module, action = "view") {
  return !!(perms && Array.isArray(perms[module]) && perms[module].includes(action));
}

// True when the user may view at least one of the listed modules.
// `modules` may be a string, an array, or empty/undefined (= no restriction).
export function canAny(user, modules) {
  const list = !modules ? [] : Array.isArray(modules) ? modules : [modules];
  if (!list.length) return true;
  return list.some((m) => hasPerm(user && user.permissions, m, "view"));
}

export function canSeeItem(user, item) {
  if (item.platformOnly) return !!(user && user.isPlatformAdmin);
  return canAny(user, item.perm);
}

// Sidebar / search groups this user may see (empty groups are dropped).
export function visibleGroups(user) {
  return [...NAV_GROUPS, ADMIN_GROUP, PLATFORM_GROUP, ACCOUNT_GROUP]
    .map((g) => ({ ...g, items: g.items.filter((i) => canSeeItem(user, i)) }))
    .filter((g) => g.items.length);
}

// First page of the app this user is allowed to open (used for the start-page fallback).
export function firstAllowedPath(user = getStoredUser()) {
  const items = [...NAV_GROUPS, ADMIN_GROUP, PLATFORM_GROUP].flatMap((g) => g.items);
  const hit = items.find((i) => canSeeItem(user, i));
  return hit ? hit.to : "/settings";
}
