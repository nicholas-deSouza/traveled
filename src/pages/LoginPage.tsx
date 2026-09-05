import { MapPinned } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { isSupabaseConfigured } from "../lib/supabase";

export function LoginPage() {
  return <main className="grid min-h-screen place-items-center bg-ink p-5"><section className="w-full max-w-md rounded-3xl bg-mist p-7 md:p-10"><MapPinned className="mb-8 h-8 w-8 text-ember" /><p className="text-sm font-medium uppercase tracking-[0.18em] text-ember">Traveled</p><h1 className="mt-2 font-display text-5xl">Good to see you.</h1><p className="mt-3 text-sm leading-6 text-ink/65">Sign in to add memories and see where your people have been.</p><label className="mt-8 block text-sm font-medium">Email<input type="email" placeholder="you@example.com" className="mt-2 h-11 w-full rounded-xl border border-ink/15 bg-white px-3 outline-none focus:ring-2 focus:ring-ember" /></label><Button className="mt-4 w-full">Send magic link</Button>{!isSupabaseConfigured && <p className="mt-4 text-xs leading-5 text-ink/55">Add Supabase values to <code>.env</code> to enable authentication.</p>}<Link to="/" className="mt-6 block text-center text-sm text-moss hover:underline">Preview the app</Link></section></main>;
}
