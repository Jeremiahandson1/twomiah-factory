// Soft warnings before an event is saved — allowed with a confirm, never blocked (T16 L1 / L2, the way
// venue systems do it): a past date (venues back-date walk-ins and migrated history) and more guests
// than the room holds (a 30-seat room hosts 60 standing; a hard fire-code maximum is a separate number).
// The server accepts both; API callers get no prompt. On an edit only a CHANGED date / room / head count
// prompts, so re-saving a past event for another reason is not nagged.
export interface SpaceCapacity { id: string; name?: string; seatedCapacity?: number | null; standingCapacity?: number | null }
export interface EventRiskFields { eventDate: string; guestCount: string | number; spaceId: string }
export interface EventRiskOriginal { eventDate?: string; guestCount?: number | null; spaceId?: string | null }

export const localToday = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

export function confirmEventRisks(next: EventRiskFields, spaces: SpaceCapacity[], original?: EventRiskOriginal): boolean {
  const dateChanged = !original || original.eventDate !== next.eventDate;
  if (dateChanged && next.eventDate && next.eventDate < localToday() && !window.confirm(`${next.eventDate} is in the past — log it as a past event anyway?`)) return false;
  const guests = Number(next.guestCount || 0);
  const space = spaces.find((s) => s.id === next.spaceId);
  const cap = space ? Math.max(Number(space.seatedCapacity || 0), Number(space.standingCapacity || 0)) : 0;
  const roomOrHeadsChanged = !original || (original.spaceId || '') !== (next.spaceId || '') || Number(original.guestCount || 0) !== guests;
  if (roomOrHeadsChanged && cap > 0 && guests > cap && !window.confirm(`${guests} guests is more than ${space?.name || 'that room'} holds (${cap} at most) — save anyway?`)) return false;
  return true;
}
