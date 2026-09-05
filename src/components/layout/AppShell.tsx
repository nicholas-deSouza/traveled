import { Compass, MapPinned, Plus, Users } from "lucide-react";
import { Link, NavLink, Outlet } from "react-router-dom";
import { Button } from "../ui/button";
import { cn } from "../../lib/utils";

const navItems = [
  { to: "/", label: "Explore", icon: Compass },
  { to: "/groups/friends", label: "Groups", icon: Users },
];

export function AppShell() {
  return (
    <div className="min-h-screen p-3 md:p-5">
      <header className="mx-auto flex max-w-7xl items-center justify-between rounded-2xl border border-ink/10 bg-white/80 px-4 py-3 backdrop-blur md:px-5">
        <Link to="/" className="flex items-center gap-2 font-display text-2xl tracking-tight"><MapPinned className="h-5 w-5 text-ember" /> Traveled</Link>
        <nav className="hidden items-center gap-1 sm:flex">
          {navItems.map(({ to, label, icon: Icon }) => <NavLink key={to} to={to} className={({ isActive }) => cn("flex items-center gap-2 rounded-full px-3 py-2 text-sm", isActive ? "bg-ink text-white" : "text-ink/65 hover:bg-ink/5")}><Icon className="h-4 w-4" />{label}</NavLink>)}
        </nav>
        <Button size="sm"><Plus className="mr-1.5 h-4 w-4" />New trip</Button>
      </header>
      <main className="mx-auto max-w-7xl"><Outlet /></main>
    </div>
  );
}
