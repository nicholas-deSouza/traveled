import { ArrowUpRight, MapPinned, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { TravelGlobe } from "../components/maps/TravelGlobe";
import { Card } from "../components/ui/card";
import { demoTrips } from "../types/domain";

export function DashboardPage() {
  return (
    <div className="py-5 md:py-8">
      <section className="mb-5 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div><p className="mb-1 text-sm font-medium uppercase tracking-[0.18em] text-ember">The shared atlas</p><h1 className="font-display text-4xl leading-none md:text-6xl">Where we’ve<br />been together.</h1></div>
        <p className="max-w-xs text-sm leading-6 text-ink/65">Spin the globe, trace your memories, and add the moments your group will want to keep.</p>
      </section>
      <section className="relative"><TravelGlobe /><div className="pointer-events-none absolute inset-x-0 bottom-0 rounded-b-3xl bg-gradient-to-t from-ink/60 to-transparent p-5 text-white"><p className="text-xs font-medium uppercase tracking-[0.16em] text-white/70">Your map</p><p className="font-display text-2xl">3 trips · 304 moments</p></div></section>
      <section className="mt-8"><div className="mb-4 flex items-center justify-between"><h2 className="font-display text-2xl">Recent trips</h2><Link className="text-sm text-moss hover:underline" to="/groups/friends">View group</Link></div><div className="grid gap-3 md:grid-cols-3">{demoTrips.map((trip) => <Link key={trip.id} to={`/trips/${trip.id}`}><Card className="group p-4 transition hover:-translate-y-0.5 hover:shadow-md"><div className="mb-10 flex items-center justify-between"><span className="rounded-full bg-sand px-2.5 py-1 text-xs font-medium">{trip.photoCount} photos</span><ArrowUpRight className="h-4 w-4 text-ink/45 transition group-hover:text-ember" /></div><h3 className="font-display text-2xl">{trip.title}</h3><p className="mt-1 text-sm text-ink/60">{trip.location} · {trip.dateRange}</p></Card></Link>)}</div></section>
      <section className="mt-8 rounded-2xl bg-moss p-5 text-white"><div className="flex items-center gap-3"><span className="rounded-full bg-white/15 p-2"><Users className="h-5 w-5" /></span><div><p className="font-medium">Friends</p><p className="text-sm text-white/70">Groups make every trip a shared record.</p></div><MapPinned className="ml-auto h-6 w-6 text-sand" /></div></section>
    </div>
  );
}
