import { useState } from 'react';
import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { LifeBuoy, LogOut, Menu, Sparkles } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import { ROLE_LABEL } from '../lib/constants';

// The page frame shared by both layouts: brown sidebar on the left, top bar, page content.
// On phones the sidebar is hidden and opens with the menu button.
export default function Shell({ navItems, topBarRight }) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);

  async function handleLogout() {
    await logout();
    navigate('/login');
  }

  return (
    <div className="min-h-screen bg-bg">
      {/* Dark background behind the open menu (phones only) */}
      {menuOpen && <div className="fixed inset-0 z-30 bg-black/40 md:hidden" onClick={() => setMenuOpen(false)} />}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-64 flex-col bg-brown text-white transition-transform print:hidden md:translate-x-0 ${
          menuOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex items-center gap-2 px-5 py-5 text-lg font-bold">
          <Sparkles size={20} className="text-gold" />
          GrowwPilot
        </div>

        <nav className="flex-1 space-y-1 overflow-y-auto px-3">
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              onClick={() => setMenuOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 rounded-lg px-3 py-2 text-sm ${
                  isActive ? 'bg-gold font-medium text-ink' : 'text-white/80 hover:bg-white/10'
                }`
              }
            >
              <Icon size={18} />
              {label}
            </NavLink>
          ))}
        </nav>

        <div className="border-t border-white/15 px-5 py-4">
          <p className="text-sm font-medium">{user.name}</p>
          <p className="text-xs text-white/60">{ROLE_LABEL[user.role]}</p>
          {user.role !== 'SUPER_ADMIN' && (
            <a
              href="mailto:support@growwpilot.com?subject=Help%20with%20GrowwPilot"
              className="mt-3 flex items-center gap-2 text-sm text-white/80 hover:text-white"
            >
              <LifeBuoy size={16} /> Need help?
            </a>
          )}
          <button
            onClick={handleLogout}
            className="mt-3 flex items-center gap-2 text-sm text-white/80 hover:text-white"
          >
            <LogOut size={16} /> Log out
          </button>
        </div>
      </aside>

      <div className="md:pl-64 print:pl-0">
        <header className="sticky top-0 z-20 flex h-14 print:hidden items-center justify-between border-b border-border bg-bg px-4 md:px-8">
          <button
            onClick={() => setMenuOpen(true)}
            className="rounded p-1 text-ink hover:bg-surface md:hidden"
            aria-label="Open menu"
          >
            <Menu size={22} />
          </button>
          <div className="ml-auto">{topBarRight}</div>
        </header>

        <main className="p-4 md:p-8 print:p-0">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
