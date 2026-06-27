/**
 * Ticket Sasa — session/auth helpers.
 *
 * Role comes directly from /auth/users/me/ (role field, now fixed backend).
 * is_staff is synthesized client-side from role === "A".
 * getEffectiveRole() checks the API role first, then falls back to the
 * local technician roster (localStorage) for accounts that have role="T"
 * in the DB but whose technician permissions are not yet fully enforced
 * server-side (worklogs still only let admins through due to is_staff gate).
 */

const TicketSasaAuth = (() => {
  const ROLE_ADMIN       = "A";
  const ROLE_CLIENT      = "U";
  const ROLE_TECHNICIAN  = "T";

  const ROLE_LABELS = {
    [ROLE_ADMIN]:      "Admin",
    [ROLE_CLIENT]:     "User",
    [ROLE_TECHNICIAN]: "Technician",
  };

  const TECH_ROSTER_KEY = "ticketsasa_technician_roster";

  let cachedUser = null;

  // ---- local technician roster (kept for backward compat / manual override) ---

  function getTechnicianRoster() {
    try { return JSON.parse(localStorage.getItem(TECH_ROSTER_KEY) || "{}"); }
    catch { return {}; }
  }
  function setTechnicianRoster(roster) {
    localStorage.setItem(TECH_ROSTER_KEY, JSON.stringify(roster));
  }
  function grantTechnician(username) {
    const r = getTechnicianRoster(); r[username] = true; setTechnicianRoster(r);
  }
  function revokeTechnician(username) {
    const r = getTechnicianRoster(); delete r[username]; setTechnicianRoster(r);
  }
  function isOnTechnicianRoster(username) {
    return !!getTechnicianRoster()[username];
  }

  // ---- role helpers ---------------------------------------------------

  function getEffectiveRole(user) {
    if (!user) return ROLE_CLIENT;
    // API role is now real — trust it first
    if (user.role === ROLE_ADMIN)      return ROLE_ADMIN;
    if (user.role === ROLE_TECHNICIAN) return ROLE_TECHNICIAN;
    // Local roster as a manual override for edge cases
    if (isOnTechnicianRoster(user.username)) return ROLE_TECHNICIAN;
    return ROLE_CLIENT;
  }

  function isStaffRole(user) {
    return !!(user && (user.is_staff || user.role === ROLE_ADMIN));
  }

  function isTechnician(user) {
    return getEffectiveRole(user) === ROLE_TECHNICIAN;
  }

  function isClient(user) {
    return getEffectiveRole(user) === ROLE_CLIENT;
  }

  async function requireAuth() {
    if (!TicketSasaAPI.isLoggedIn()) { redirectToLogin(); return null; }
    try {
      const user = await TicketSasaAPI.getCurrentUser();
      cachedUser = user;
      return user;
    } catch {
      redirectToLogin();
      return null;
    }
  }

  function redirectToLogin() {
    const here = encodeURIComponent(window.location.pathname + window.location.search);
    window.location.href = `login.html?next=${here}`;
  }

  function getCachedUser() { return cachedUser; }

  function logout() {
    TicketSasaAPI.logout();
    window.location.href = "login.html";
  }

  return {
    ROLE_ADMIN, ROLE_CLIENT, ROLE_TECHNICIAN, ROLE_LABELS,
    isStaffRole, isTechnician, isClient, getEffectiveRole,
    getTechnicianRoster, grantTechnician, revokeTechnician, isOnTechnicianRoster,
    requireAuth, getCachedUser, logout,
  };
})();
