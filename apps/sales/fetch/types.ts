export interface SteamGame {
  id: string;
  title: string;
  imageUrl: string;
  originalPrice: number;
  discountPrice: number;
  discountPercent: number;
  currency: string;
  url: string;
  isSpecial: boolean;
  isFree: boolean;
  isPopular: boolean;
}

export interface NotifiedItem {
  title: string;
  price: number;
  percent: number;
  timestamp: string;
  type: 'free' | 'discount' | 'popular';
}

export interface DealsData {
  lastUpdated: string;
  steam: SteamGame[];
  notifiedHistory?: Record<string, NotifiedItem>;
}

export type FilterType = 'all' | 'steam_free' | 'steam_specials' | 'steam_popular' | 'wishlist';

export type SortType = 'default' | 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc' | 'discount-desc';
