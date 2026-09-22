# Game Sales Aggregator — сайт

Персональний радар знижок і безкоштовних ігор — автоматично збирає пропозиції з
**Steam**, **Epic Games Store** та **Xbox Game Pass (PC)** і публікує їх на сайті та в
Telegram-каналі [@salesgamesua](https://t.me/salesgamesua).

## Відкрити

**https://ajjs1ajjs.github.io/dist/sales/**

Сайт статичний (SPA + PWA) — встановлюється на телефон/ПК і працює офлайн. Дані знижок
лежать у [`sales/data/deals.json`](../../sales/data/deals.json) і оновлюються автоматично
кілька разів на добу.

## Оновлення даних

- [`fetch/`](fetch/) — скрипт збору знижок (Epic/Steam/Xbox → Telegram).
- [`.github/workflows/sales-scheduler.yml`](../../.github/workflows/sales-scheduler.yml) —
  запускає його за розкладом (09/15/18/21 UTC), записує свіжі `deals.json` та
  `notified-history.json` у `sales/data/` і публікує (GitHub Pages деплоїться з `main`).

Потрібні секрети репозиторію: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

Вихідний код застосунку — у приватному репозиторії.
