export const PHOTO_CHANGED_EVENT = 'traveled:photo-changed';
export function notifyPhotoChanged(tripId?: string) {
  window.dispatchEvent(new CustomEvent(PHOTO_CHANGED_EVENT, { detail: { tripId } }));
}
