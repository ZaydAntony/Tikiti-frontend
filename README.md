# Ticket Sasa — frontend

A role-aware helpdesk UI for the [Ticket-manager](https://github.com/ZaydAntony/Ticket-manager) Django REST backend. Vanilla HTML/CSS/JS + Bootstrap 5, no build step.

## Running it

This is a static site — any static file server works.

```bash
cd ticketsasa-frontend
python3 -m http.server 8080
```

Then open `http://localhost:8080/login.html`.

By default the app calls the API at the same origin it's served from (`/api/v1`, `/auth`). If your backend is hosted elsewhere, set these **before** `js/api.js` loads, e.g. by adding a small inline `<script>` in each HTML file's `<head>`:

```html
<script>
  window.TICKET_SASA_API_BASE = "https://your-api.example.com/api/v1";
  window.TICKET_SASA_AUTH_BASE = "https://your-api.example.com/auth";
</script>
```

**This requires CORS to be enabled on the backend** — see [Known backend issues](#known-backend-issues), #1.

## Architecture

- `js/api.js` — every API call lives here. Owns auth headers, token refresh, and error normalization. No other file talks to `fetch` directly.
- `js/auth.js` — session/role helpers. Wraps the API's identity probe and layers the local technician roster on top (see #5 below).
- `js/shell.js` — renders the role-aware sidebar shell, shared by every page.
- `css/style.css` — design tokens and components layered on Bootstrap.
- `*.html` — one file per page, each a thin script that calls the modules above and renders into `#ts-page-content`.
- `test-role-probe.js` — a Node script that loads the **real, unmodified** `js/api.js` and drives it against a live backend instance (admin/technician/client accounts, full ticket lifecycle). Useful for re-verifying after any backend change: `node test-role-probe.js` (edit the hardcoded test credentials/URLs at the top first).

No frontend framework, no bundler — open any `.html` file's source and you're reading exactly what runs in the browser.

## Known backend issues

Found by reading the code and confirmed by running the actual server and exercising every endpoint with curl and the real client code (`test-role-probe.js`) — not assumed. Each one is worked around client-side where possible; where it isn't, the UI says so honestly instead of pretending the feature works. None of these were patched in the backend repo, per the brief — they're listed here so they're easy to fix later.

#### 1. No CORS headers
`django-cors-headers` isn't installed or configured. If this frontend is hosted on a different origin than the API (which it will be, in any real deployment), every request is blocked by the browser. Not something a frontend can route around — it's enforced before any client code runs.

**Fix:** `pip install django-cors-headers`, add `"corsheaders"` to `INSTALLED_APPS`, `"corsheaders.middleware.CorsMiddleware"` near the top of `MIDDLEWARE`, and set `CORS_ALLOWED_ORIGINS` (or `CORS_ALLOW_ALL_ORIGINS = True` for development).

#### 2. Auth header scheme is `JWT`, not `Bearer`
`SIMPLE_JWT["AUTH_HEADER_TYPES"] = ("JWT",)` in settings. Easy to get wrong since `Bearer` is far more common; `js/api.js` sends `Authorization: JWT <token>` deliberately.

#### 3. `/tickets/<id>/ai-summary/` is broken on every method
`AiSummarry.get_serializer_context()` reads `self.kwargs["Ticket_pk"]` (capital, wrong key) — but the URL registers the kwarg as lowercase `ticket_pk`. `get_serializer_context` runs on **every** request the view handles, so this isn't just a `POST`/create bug: plain `GET` (list) 500s too. There's currently no way to read or write an AI summary through this endpoint at all.

Confirmed live:
```
GET /api/v1/tickets/<id>/ai-summary/  → 500 KeyError: 'Ticket_pk'
POST /api/v1/tickets/<id>/ai-summary/ → 500 KeyError: 'Ticket_pk'
```

Separately, even once that's fixed, `GET` is **unscoped** — it lists every `Ai_summarry` row in the system rather than filtering by the ticket in the URL. `js/api.js`'s `getAiSummary()` already filters client-side by `ticket` id so this will work transparently once the kwarg bug is patched.

**Fix:** change both occurrences of `self.kwargs["Ticket_pk"]` / `self.kwargs["Ticket_id"]` in `AiSummarry` to `self.kwargs["ticket_pk"]` (match the URL's actual kwarg name), and scope the `GET` queryset by it too: `Ai_summarry.objects.filter(ticket_id=self.kwargs["ticket_pk"])`.

The frontend wires the "Generate" button and summary display up correctly per the documented contract and shows a clear in-context message when this 500s, rather than failing silently or crashing.

#### 4. Ticket serializer never returns `status`, `description`, or timestamps
`TicketSerializer` (`Ticket_management/serializers.py`) only exposes `id, title, location, user, ai_summarry, ticket_worklogs`. This is true for every role on both list and detail (the viewset has one `get_serializer_class()` shared by list/retrieve). A status-based Kanban board has no `status` field to sort by, for anyone.

The board (`board.html`) reflects this honestly: every ticket lands in an "Unsorted" column with a visible explanation, rather than faking a sort order. The four status columns (`Pending`/`Assigned`/`In progress`/`Completed`) are already wired to the model's actual status codes (`P`/`A`/`I`/`C`) and will sort automatically the moment `status` is added to the serializer — no frontend change needed.

**Fix:** add `"status", "description", "created_at"` to `TicketSerializer.Meta.fields`.

#### 5. `GET /auth/users/me/` 500s for every account
Djoser's `current_user` serializer setting points at `"Profiles.serializers.Serializer"` — a class that doesn't exist in `Profiles/serializers.py` (only `UserCreateSerializer` is defined). This means **no endpoint anywhere returns the logged-in user's own `role` or `is_staff`** — not `/auth/users/me/` (broken), not `/auth/users/<id>/` (Djoser's default serializer there only returns `email`/`id`/`username`).

Worked around in `js/api.js`'s `getCurrentUser()`:
1. Decode `user_id` out of the JWT access token (no API call needed).
2. Fetch `/auth/users/<id>/` for the username/email (this endpoint works).
3. Probe `/api/v1/assignment/`, which is `IsAdminUser`-gated and doesn't depend on any data existing — `200` means admin, `403` means not. This is the one reliable admin/non-admin signal anywhere in the API.

**Fix:** point `DJOSER["SERIALIZERS"]["current_user"]` at a real serializer that includes `role` and `is_staff` — e.g. a small `UserSerializer(serializers.ModelSerializer)` with `fields = ["id", "username", "email", "role", "is_staff"]`. Once that exists, `getCurrentUser()` can call it directly and the probing in this file becomes unnecessary.

#### 6. Technician role is not detectable from the API, and worklog access is effectively admin-only
Two compounding issues:

- `TicketViewSet.get_queryset()` only special-cases `user.is_staff`; everyone else (including technicians) is filtered to `Ticket.objects.filter(user=user)` — tickets *they personally created*. A technician who hasn't created tickets sees an empty list, identical in shape to a client with zero tickets. There's no queryset-based signal that says "this is a technician."
- `IsTechnician.has_permission()` (gates `WorklogViewSet`) compares `user.role == "Technician"`, but `User.role` is a single-character code field (`choices=USER_ROLES`, e.g. `"T"`). That comparison can never be true for a real technician account — confirmed live, a technician account gets `403` on every worklog call, the same as a plain client. Only admins (who pass via the `is_staff` check first, since `IsTechnician` allows staff through) can use worklogs at all right now.

Net effect: there is currently no working endpoint that distinguishes "technician" from "client" — not by data shape, not by permission boundary. The frontend's identity probe (`js/api.js`) only ever returns `admin` or `client`.

Per your direction, technician access in this build is **admin-granted but stored client-side**: the "Technicians" page (admin only) lets an admin mark a username as a technician, stored in that browser's `localStorage`. This is explicitly **not** a real privilege system — it's per-browser, doesn't sync across devices, and the technician needs to log in on the same browser the grant happened on to see technician views. It exists so the product can demonstrate "admin grants technician access" as a flow today, while being honest that it isn't backed by a database field yet. It governs **frontend display only** — the real worklog endpoint is still 403ing technicians regardless of this roster, because of the bug above, so the worklog form is shown to admins only.

**Fix (two parts):**
1. In `Ticket_management/permissions.py`, change `IsTechnician` to compare against the actual stored code: `return user.role == User.USER_TECHNICIAN` (or whatever the constant is named in `Profiles/models.py`), not the string `"Technician"`.
2. In `TicketViewSet.get_queryset()`, decide what technicians should see — likely tickets assigned to them via the `Assignment` model — and filter accordingly, e.g. `Ticket.objects.filter(assignment__user=user)` for technicians, in addition to the existing `is_staff` and own-tickets branches.

Once both are fixed, swap the local roster in `js/auth.js` for a real check against the user's actual role (the comment block at the top of that file points to exactly what to change).

## What's deliberately *not* faked

Anywhere the API doesn't return data or a feature is broken server-side, the UI says so in plain language rather than hiding it or inventing placeholder data:

- Ticket detail shows exactly the fields the API returns — no fabricated description or status.
- The board's "Unsorted" column and its banner explain why, rather than silently sorting nothing into four empty columns.
- The AI summary panel explains the 500 in context rather than showing a spinner forever or a generic error.
- The Technicians page explicitly labels itself as a stopgap and explains what would replace it.

This was a deliberate choice for a portfolio piece: a reviewer poking at a button that quietly fails (or worse, shows fake data) reads worse than one that fails with a clear, accurate explanation.
