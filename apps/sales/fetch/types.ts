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
  isDlc?: boolean;
  parentAppId?: string;
  reviewPercent?: number;
  reviewCount?: number;
  reviewLabel?: string;
  popularRank?: number;
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
  originalPrice?: number;
  discountPrice?: number;
  discountPercent?: number;
  currency?: string;
  isDeal?: boolean;
}

export type PsPlusTier = 'essential' | 'extra';

/** Гра або підписна пропозиція PlayStation 5 (PS Store / PS Plus). */
export interface PlayStationGame {
  id: string;
  title: string;
  imageUrl: string;
  url: string;
  description?: string;
  originalPrice?: number;
  discountPrice?: number;
  discountPercent?: number;
  currency?: string;
  isDeal: boolean;
  isPopular: boolean;
  isPsPlusExclusive?: boolean;
  psPlusTier?: PsPlusTier;
  psPlusMonth?: string;
  popularRank?: number;
}

export interface NotifiedItem {
  title: string;
  price: number;
  percent: number;
  timestamp: string;
  /** 'xbox_new' — легасі-тип першої версії Game Pass (UI мапить його на 'gamepass'). */
  type:
    | 'free'
    | 'discount'
    | 'popular'
    | 'dlc'
    | 'gamepass'
    | 'gamepass_deal'
    | 'xbox_new'
    | 'ps_deal'
    | 'ps_essential'
    | 'ps_extra';
}

export interface SourceUpdates {
  steam?: string;
  gamepass?: string;
  playstation?: string;
}

export interface PriceObservation {
  date: string;
  price: number;
  currency: string;
}

export interface DealsData {
  lastUpdated: string;
  sourceUpdates?: SourceUpdates;
  priceHistory?: Record<string, PriceObservation[]>;
  steam: SteamGame[];
  /** Каталог Game Pass для ПК. Поле відсутнє у старих файлах — UI це терпить. */
  gamepass?: GamePassGame[];
  /** PlayStation 5: знижки, топи продажів, PS Plus Essential та PS Plus Extra. */
  playstation?: PlayStationGame[];
  notifiedHistory?: Record<string, NotifiedItem>;
}

export type PlatformTab = 'all' | 'steam' | 'gamepass' | 'playstation' | 'wishlist';

export type FilterType =
  | 'all'
  | 'steam_all'
  | 'steam_free'
  | 'steam_specials'
  | 'steam_popular'
  | 'steam_dlc'
  | 'gamepass_all'
  | 'gamepass_new'
  | 'gamepass_popular'
  | 'gamepass_deals'
  | 'ps_all'
  | 'ps_essential'
  | 'ps_extra'
  | 'ps_deals'
  | 'ps_popular'
  | 'wishlist';

export type SortType = 'default' | 'name-asc' | 'name-desc' | 'price-asc' | 'price-desc' | 'discount-desc';
