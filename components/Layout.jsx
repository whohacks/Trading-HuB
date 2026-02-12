import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/router";
import { MoreVertical } from "lucide-react";

const navItems = [
  { href: "/", label: "Dashboard" },
  { href: "/alerts", label: "Alerts" },
  { href: "/journal", label: "Journal" },
  { href: "/analytics", label: "Analytics" },
];

export default function Layout({ children, user }) {
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [router.pathname]);

  return (
    <div className="app-shell">
      <div className="app-nav-shell">
        <header className="topbar app-card">
          <div className="brand-wrap">
            <h1 className="brand">Trading HuB</h1>
          </div>
          <div className="topbar-actions">
            <button
              type="button"
              className="ghost menu-trigger"
              aria-label="Open menu"
              onClick={() => setMenuOpen((prev) => !prev)}
            >
              <MoreVertical size={16} />
            </button>
            {menuOpen ? (
              <div className="top-menu app-card">
                <Link className="top-menu-link" href="/settings">
                  Settings
                </Link>
              </div>
            ) : null}
          </div>
        </header>
      </div>

      <main className="page-wrap">
        <div className="page-content">{children}</div>
      </main>

      <nav className="main-nav app-card bottom-nav">
        {navItems.map((item) => {
          const active = router.pathname === item.href;
          return (
            <Link
              key={item.href}
              className={active ? "nav-link active" : "nav-link"}
              href={item.href}
            >
              {item.label}
            </Link>
          );
        })}
      </nav>
    </div>
  );
}
