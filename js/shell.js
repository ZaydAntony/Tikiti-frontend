const TicketSasaShell = (() => {
  const ICONS = {
    board:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="4" width="7" height="16" rx="1.5"/><rect x="14" y="4" width="7" height="9" rx="1.5"/></svg>`,
    list:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>`,
    plus:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 5v14M5 12h14"/></svg>`,
    people: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="9" cy="8" r="3.2"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><circle cx="17.5" cy="9" r="2.6"/><path d="M14.8 14.2c2.7.3 4.7 2.4 4.7 5.3"/></svg>`,
    chart:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 3v18h18"/><path d="M18 9l-5 5-4-4-4 4"/></svg>`,
    ticket: `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 9a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4V9Z"/></svg>`,
  };

  // Admin:       Board · All Tickets · Technicians · Assignments
  // Technician:  Overview · My Assignments
  // Client:      My Tickets · New Ticket
  function navLinksFor(user) {
    const role = TicketSasaAuth.getEffectiveRole(user);
    if (role === 'A') return [
      { href:'board.html',              icon:'board',  label:'Board'        },
      { href:'tickets.html',            icon:'list',   label:'All Tickets'  },
      { href:'admin-technicians.html',  icon:'people', label:'Technicians'  },
      { href:'assignments.html',        icon:'ticket', label:'Assignments'  },
    ];
    if (role === 'T') return [
      { href:'tech-overview.html',      icon:'chart',  label:'Overview'     },
      { href:'tech-assignments.html',   icon:'ticket', label:'My Assignments'},
    ];
    return [
      { href:'tickets.html',    icon:'list', label:'My Tickets' },
      { href:'new-ticket.html', icon:'plus', label:'New Ticket' },
    ];
  }

  function render(user, { activeHref } = {}) {
    const root = document.getElementById('ts-shell-root');
    if (!root) return null;
    const role  = TicketSasaAuth.getEffectiveRole(user);
    const label = TicketSasaAuth.ROLE_LABELS[role] || 'User';
    const links = navLinksFor(user);

    root.innerHTML = `
      <div class="ts-shell">
        <aside class="ts-sidebar">
          <a class="ts-brand" href="${links[0]?.href || '#'}">
              <span class="ts-brand-mark">
                  <img src="./logo.png" alt="Ticket Sasa Logo" class="ts-logo">
              </span>
              <span class="ts-brand-text">Ticket Sasa</span>
          </a>
          <div class="ts-role-pill">${escapeHtml(user.username)} · <strong>${label}</strong></div>
          <nav class="ts-nav">
            ${links.map(l => `<a class="ts-nav-link${l.href === activeHref ? ' active' : ''}" href="${l.href}">
              ${ICONS[l.icon]}<span>${l.label}</span>
            </a>`).join('')}
          </nav>
          <div class="ts-sidebar-footer">
            <button class="ts-logout-btn" id="ts-logout">Sign out</button>
          </div>
        </aside>
        <main class="ts-main"><div id="ts-page-content"></div></main>
      </div>`;

    document.getElementById('ts-logout').addEventListener('click', () => TicketSasaAuth.logout());
    return document.getElementById('ts-page-content');
  }

  function escapeHtml(s) {
    const d = document.createElement('div');
    d.textContent = s == null ? '' : String(s);
    return d.innerHTML;
  }

  return { render, escapeHtml };
})();
