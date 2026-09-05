import { ImagePlus, MapPin } from "lucide-react";
import { useParams } from "react-router-dom";
import { Button } from "../components/ui/button";
import { Card } from "../components/ui/card";
import { demoTrips } from "../types/domain";

export function TripDetailPage() {
  const { tripId } = useParams();
  const trip = demoTrips.find((entry) => entry.id === tripId) ?? demoTrips[0];
  return <div className="py-8"><p className="text-sm font-medium uppercase tracking-[.18em] text-ember">The wanderers</p><div className="mt-2 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><h1 className="font-display text-5xl">{trip.title}</h1><p className="mt-2 text-ink/65">{trip.location} · {trip.dateRange}</p></div><Button><ImagePlus className="mr-1.5 h-4 w-4" />Add photos</Button></div><Card className="mt-8 grid min-h-72 place-items-center overflow-hidden bg-gradient-to-br from-moss via-ink to-[#204F66] p-6 text-center text-white"><div><MapPin className="mx-auto mb-3 h-8 w-8 text-sand" /><p className="font-display text-3xl">Photo map</p><p className="mt-2 max-w-sm text-sm text-white/70">Map pins will come from each uploaded photo’s GPS metadata.</p></div></Card><section className="mt-8"><h2 className="font-display text-2xl">Moments</h2><div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-4">{Array.from({ length: 8 }).map((_, i) => <div key={i} className="aspect-square rounded-2xl bg-gradient-to-br from-sand via-[#d9b48b] to-ember/80" />)}</div></section></div>;
}
