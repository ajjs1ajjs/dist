# Game Sales Aggregator — сайт

Персональний радар знижок і безкоштовних ігор — автоматично збирає найкращі пропозиції зі **Steam** (акції, знижки, лідери продажу) і публікує їх на сайті та в Telegram-каналі [@salesgamesua](https://t.me/salesgamesua).

## Відкрити

**https://ajjs1ajjs.github.io/dist/sales/**

Сайт статичний (SPA + PWA) — встановлюється на телефон/ПК і працює офлайн. Дані знижок лежать у [`sales/data/deals.json`](../../sales/data/deals.json) і оновлюються автоматично.

## Оновлення даних

- [`fetch/`](fetch/) — скрипт збору знижок (Steam API → Telegram).
- [`.github/workflows/sales-scheduler.yml`](../../.github/workflows/sales-scheduler.yml) — запускає парсер за розкладом щодня о 07:00 UTC (09:00 за Києвом взимку / 10:00 влітку), записує свіжі `deals.json` та `notified-history.json` у `sales/data/` і публікує (GitHub Pages деплоїться з `main`).

Потрібні секрети репозиторію: `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`.

Вихідний код застосунку — у приватному репозиторії.
