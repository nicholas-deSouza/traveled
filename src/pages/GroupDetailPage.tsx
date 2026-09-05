import { Plus, Users } from "lucide-react";
import { Link } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { demoTrips } from "../types/domain";

export function GroupDetailPage() {
  return <div className="py-8"><p className="text-sm font-medium uppercase tracking-[.18em] text-ember">Your group</p><div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="font-display text-5xl">The wanderers</h1><p className="mt-2 text-ink/65">Five friends, three shared trips, countless detours.</p></div><Button><Plus className="mr-1.5 h-4 w-4" />Create a trip</Button></div><Card className="mt-8 flex items-center gap-3 p-5"><span className="rounded-full bg-sand p-2"><Users className="h-5 w-5" /></span><p className="text-sm"><strong>5 members</strong><br /><span className="text-ink/60">Everyone here can view and add photos.</span></p></Card><div className="mt-6 grid gap-3 md:grid-cols-3">{demoTrips.map((trip) => <Link to={`/trips/${trip.id}`} key={trip.id}><Card className="p-4 hover:shadow-md"><p className="text-sm text-ink/60">{trip.dateRange}</p><h2 className="mt-8 font-display text-2xl">{trip.title}</h2><p className="text-sm text-ink/60">{trip.location}</p></Card></Link>)}</div></div>;
}
