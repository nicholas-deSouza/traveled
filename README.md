# Traveled

Shared travel memories, mapped from your photos.

Traveled is a group-based travel journal: friends create a group, manually create trips, upload their photos, and explore shared memories on an interactive globe and detailed map.

## Stack

- Vite, React, TypeScript
- Tailwind CSS and locally owned shadcn/ui-style components
- MapLibre GL JS globe projection
- Supabase Auth, Postgres, Storage, and Row Level Security

## Local setup

1. Install dependencies: `pnpm install`
2. Copy `.env.example` to `.env` and fill in the Supabase URL and anon key.
3. In Supabase SQL Editor, run `supabase/migrations/0001_initial_schema.sql`.
4. Start the app: `pnpm dev`

The app displays OpenFreeMap's detailed Liberty vector style when `VITE_MAP_STYLE_URL` is absent. It includes administrative boundaries and city labels as the user zooms in. Set that environment variable to your selected production vector-tile style before deploying.

## MVP domain model

```text
User ↔ Group Membership
Group → Trips
Trip → Photos
```

Every group member can view and contribute photos to that group’s trips. Photo files belong in the private `trip-photos` bucket under `<group-id>/<trip-id>/<filename>`. The database migration includes the RLS and Storage policies enforcing that boundary.

## Current scaffold

- Polished demo routes for login, dashboard, group, and trip detail
- Globe with sample trip markers and the country-to-city zoom model
- Supabase client boundary that is safe to run before credentials are added
- Initial database, Storage, and RLS migration

## Next build steps

1. Connect Supabase magic-link authentication.
2. Replace demo trips with group/trip queries.
3. Build the create-group and create-trip flows.
4. Add file upload plus EXIF timestamp/GPS extraction via `exifr`.
5. Render uploaded photo metadata as pins on the globe/map.
