/**
 * Ticket Sasa — API client
 * Auth header type is "JWT" not "Bearer" per SIMPLE_JWT config.
 * All backend bugs from v1 README have been fixed server-side.
 */

const TicketSasaAPI = (() => {
  const BASE_URL = window.APP_CONFIG.API_BASE;
  const AUTH_BASE = window.APP_CONFIG.AUTH_BASE;

  const ACCESS_KEY  = "ticketsasa_access";
  const REFRESH_KEY = "ticketsasa_refresh";

  const ROLE_ADMIN_CODE      = "A";
  const ROLE_CLIENT_CODE     = "U";
  const ROLE_TECHNICIAN_CODE = "T";

  // ── token storage ──────────────────────────────────────────────────────
  const getAccessToken  = () => localStorage.getItem(ACCESS_KEY);
  const getRefreshToken = () => localStorage.getItem(REFRESH_KEY);
  const setTokens = ({ access, refresh }) => {
    if (access)  localStorage.setItem(ACCESS_KEY, access);
    if (refresh) localStorage.setItem(REFRESH_KEY, refresh);
  };
  const clearTokens = () => {
    localStorage.removeItem(ACCESS_KEY);
    localStorage.removeItem(REFRESH_KEY);
  };
  const isLoggedIn = () => !!getAccessToken();

  // ── low-level fetch ─────────────────────────────────────────────────────
  async function request(path, { method = "GET", body, auth = true, isRetry = false } = {}) {
    const headers = { "Content-Type": "application/json" };
    if (auth && getAccessToken()) headers["Authorization"] = `JWT ${getAccessToken()}`;

    const res = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

    if (res.status === 401 && auth && !isRetry && getRefreshToken()) {
      if (await tryRefresh()) return request(path, { method, body, auth, isRetry: true });
      clearTokens();
      throw new ApiError("Session expired. Please log in again.", 401, null);
    }
    return parseResponse(res);
  }

  async function authRequest(path, { method = "GET", body } = {}) {
    const res = await fetch(`${AUTH_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    return parseResponse(res);
  }

  async function tryRefresh() {
    try {
      const data = await authRequest("/jwt/refresh/", { method: "POST", body: { refresh: getRefreshToken() } });
      setTokens({ access: data.access });
      return true;
    } catch { return false; }
  }

  class ApiError extends Error {
    constructor(message, status, payload) { super(message); this.status = status; this.payload = payload; }
  }

  async function parseResponse(res) {
    let data = null;
    const text = await res.text();
    if (text) { try { data = JSON.parse(text); } catch { data = text; } }
    if (!res.ok) throw new ApiError(extractErrorMessage(data) || `Request failed (${res.status})`, res.status, data);
    return data;
  }

  function extractErrorMessage(data) {
    if (!data) return null;
    if (typeof data === "string") return data;
    if (data.detail) return data.detail;
    const firstKey = Object.keys(data)[0];
    if (firstKey && Array.isArray(data[firstKey])) return `${firstKey}: ${data[firstKey][0]}`;
    return null;
  }

  // ── auth ────────────────────────────────────────────────────────────────
  async function register({ username, email, password, first_name, last_name, role }) {
    return authRequest("/users/", { method: "POST", body: { username, email, password, first_name, last_name, role } });
  }

  async function login({ username, password }) {
    const data = await authRequest("/jwt/create/", { method: "POST", body: { username, password } });
    setTokens(data);
    return data;
  }

  function logout() { clearTokens(); }

  async function getCurrentUser() {
    try {
      const headers = { "Content-Type": "application/json" };
      if (getAccessToken()) headers["Authorization"] = `JWT ${getAccessToken()}`;
      let res = await fetch(`${AUTH_BASE}/users/me/`, { headers });
      if (res.status === 401 && getRefreshToken()) {
        if (await tryRefresh()) {
          headers["Authorization"] = `JWT ${getAccessToken()}`;
          res = await fetch(`${AUTH_BASE}/users/me/`, { headers });
        }
      }
      const user = await parseResponse(res);
      return { ...user, is_staff: user.role === ROLE_ADMIN_CODE };
    } catch (err) { clearTokens(); throw err; }
  }

  // ── tickets ─────────────────────────────────────────────────────────────
  async function listTickets(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/tickets/${qs ? `?${qs}` : ""}`);
  }
  async function getTicket(id)          { return request(`/tickets/${id}/`); }
  async function createTicket(payload)  { return request(`/tickets/`, { method: "POST", body: payload }); }
  async function updateTicket(id, patch){ return request(`/tickets/${id}/`, { method: "PATCH", body: patch }); }
  async function deleteTicket(id)       { return request(`/tickets/${id}/`, { method: "DELETE" }); }

  // ── worklogs ─────────────────────────────────────────────────────────────
  async function listWorklogs(ticketId) {
    return request(`/tickets/${ticketId}/worklogs/`);
  }
  async function addWorklog(ticketId, { notes, is_completed_worklog }) {
    return request(`/tickets/${ticketId}/worklogs/`, { method: "POST", body: { notes, is_completed_worklog } });
  }
  async function updateWorklog(ticketId, worklogId, patch) {
    return request(`/tickets/${ticketId}/worklogs/${worklogId}/`, { method: "PATCH", body: patch });
  }
  async function deleteWorklog(ticketId, worklogId) {
    return request(`/tickets/${ticketId}/worklogs/${worklogId}/`, { method: "DELETE" });
  }

  // ── AI summary ──────────────────────────────────────────────────────────
  async function generateAiSummary(ticketId) {
    return request(`/tickets/${ticketId}/ai-summary/`, { method: "POST", body: {} });
  }
  async function getAiSummary(ticketId) {
    // GET returns list scoped to the ticket (get_queryset filters by tickets_pk)
    // category/priority returned as single-char codes — decode on the frontend
    const all     = await request(`/tickets/${ticketId}/ai-summary/`, { method: "GET" });
    const results = Array.isArray(all) ? all : (all.results || []);
    return results[0] || null;
  }

  // ── assignments ─────────────────────────────────────────────────────────
  async function listAssignments(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/assignment/${qs ? `?${qs}` : ""}`);
  }
  // AssignmentSerializer.user is PrimaryKeyRelatedField(queryset=User.filter(role='T'))
  // so we send user integer id and ticket integer id
  async function createAssignment({ ticket, user }) {
    return request(`/assignment/`, { method: "POST", body: { ticket, user } });
  }
  async function deleteAssignment(id) {
    return request(`/assignment/${id}/`, { method: "DELETE" });
  }

  // ── technicians (admin only) ─────────────────────────────────────────────
  async function listTechnicians(params = {}) {
    const qs = new URLSearchParams(params).toString();
    return request(`/technicians${qs ? `?${qs}` : ""}`);
  }

  return {
    ApiError,
    isLoggedIn, register, login, logout, getCurrentUser,
    listTickets, getTicket, createTicket, updateTicket, deleteTicket,
    listWorklogs, addWorklog, updateWorklog, deleteWorklog,
    generateAiSummary, getAiSummary,
    listAssignments, createAssignment, deleteAssignment,
    listTechnicians,
  };
})();
