import type { AtlasTrip, Photo } from '../lib/groups';

export const parisTrip: AtlasTrip = {
  id: 'paris', group_id: 'friends', created_by: 'member', color: '#123456',
  title: 'Paris', description: null, starts_on: null, ends_on: null,
  groupName: 'Friends', photoCount: 1,
};

export const parisPhoto: Photo = {
  id: 'one', trip_id: 'paris', storage_path: 'one.jpg', uploaded_by: 'member',
  latitude: 48.8566, longitude: 2.3522, url: 'blob:one',
};
