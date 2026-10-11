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

/** Гра, що входить до каталогу Game Pass для ПК (Microsoft Store). */
export interface GamePassGame {
  id: string;
  title: string;
  imageUrl: string;
  url: string;
  /** Короткий опис з каталогу (використовується в Telegram-постах). */
  description?: string;
  /** Є у списку «Recently added» каталогу. */
  isNew: boolean;
  /** Є у списку «Most popular» каталогу. */
  isPopular: boolean;
}

export interface NotifiedItem {
  title: string;
  price: number;
  percent: number;
  timestamp: string;
  /** 'xbox_new' — легасі-тип першої версії Game Pass (UI мапить його на 'gamepass'). */
  type: 'free' | 'discount' | 'popular' | 'gamepass' | 'xbox_new';
}

export interface DealsData {
  lastUpdated: string;
  steam: SteamGame[];
  /** Каталог Game Pass для ПК. Поле відсутнє у старих файлах — UI це терпить. */
  gamepass?: GamePassGame[];
  notifiedHistory?: Record<string, NotifiedItem>;
}

export type FilterType =
  | 'all'
  | 'steam_free'
  | 'steam_specials'
  | 'steam_popular'
  | 'gamepass_new'
  | 'gamepass_popular'
  | 'wishlist';

export type SortType = 'default' | 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc' | 'discount-desc';
