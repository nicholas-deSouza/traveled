export type TripSummary = {
  id: string;
  title: string;
  location: string;
  dateRange: string;
  photoCount: number;
  longitude: number;
  latitude: number;
};

export const demoTrips: TripSummary[] = [
  { id: "portugal-2026", title: "Portugal 2026", location: "Lisbon & Porto", dateRange: "May 4–11", photoCount: 142, longitude: -8.1, latitude: 39.5 },
  { id: "montreal-2025", title: "Montreal weekend", location: "Montréal, Canada", dateRange: "Oct 18–21", photoCount: 67, longitude: -73.57, latitude: 45.5 },
  { id: "big-sur-2025", title: "California coast", location: "Big Sur, USA", dateRange: "Aug 9–13", photoCount: 95, longitude: -121.8, latitude: 36.3 },
];
