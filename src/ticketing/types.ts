// SportsWeb One — Ticketing Module — shared types

export type TkEventStatus = 'draft' | 'published' | 'cancelled' | 'completed';

export interface TicketTemplate {
  /** Primary brand colour used across the sales page (hex). */
  brandColor?: string;
  /** Optional club logo shown in the header. */
  logoUrl?: string;
  /** Any additional template fields used by the ticket renderer. */
  [key: string]: unknown;
}

export interface TkEvent {
  id: string;
  club_id: string;
  name: string;
  slug: string;
  description: string | null;
  venue_name: string | null;
  venue_address: string | null;
  starts_at: string | null;
  ends_at: string | null;
  timezone: string;
  status: TkEventStatus;
  capacity: number | null;
  is_free: boolean;
  currency: string;
  cover_image_url: string | null;
  ticket_template: TicketTemplate;
}

export interface TkTicketType {
  id: string;
  event_id: string;
  club_id: string;
  name: string;
  description: string | null;
  price_cents: number;
  quantity_total: number | null;
  quantity_sold: number;
  max_per_order: number;
  sales_start_at: string | null;
  sales_end_at: string | null;
  sort_order: number;
  is_active: boolean;
}

/** A single line the buyer has chosen. */
export interface CartItem {
  ticket_type_id: string;
  quantity: number;
}

/** Result of the tk_quote_order RPC. Server is the source of truth. */
export interface TkQuoteLine {
  ticket_type_id: string;
  name: string;
  quantity: number;
  unit_price_cents: number;
  line_total_cents: number;
}

export interface TkQuote {
  event_id: string;
  currency: string;
  subtotal_cents: number;
  /** Equals subtotal_cents — buyer pays face value (no surcharge). */
  total_cents: number;
  ticket_count: number;
  lines: TkQuoteLine[];
}

export interface BuyerDetails {
  name: string;
  email: string;
  phone: string;
}
