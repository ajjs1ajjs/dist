# Game Sales Aggregator — сайт

Персональний радар знижок і безкоштовних ігор — автоматично збирає найкращі пропозиції зі **Steam** (акції, знижки, лідери продажу) і публікує їх на сайті та в Telegram-каналі [@salesgamesua](https://t.me/salesgamesua).

## Відкрити

**https://ajjs1ajjs.github.io/dist/sales/**

Сайт статичний (SPA + PWA) — встановлюється на телефон/ПК і працює офлайн. Дані знижок лежать у [`sales/data/deals.json`](../../sales/data/deals.json) і оновлюються автоматично.

## Оновлення даних

- [`fetch/`](fetch/) — скрипт збору знижок (Steam API → Telegram).
- [`cron/`](cron/) — Cloudflare Worker, що викликає воркфлоу 4 рази на добу
  (06/10/14/18 UTC = 09/13/17/21 за Києвом влітку): GitHub `schedule`
  затримується на години, тому основний тригер — зовнішній, а розклад у
  воркфлоу — страховка. Пости йдуть лише за новими знижками (≥50%).
- [`.github/workflows/sales-scheduler.yml`](../../.github/workflows/sales-scheduler.yml) — запускає парсер, записує свіжі `deals.json` та `notified-history.json` у `sales/data/` і публікує (GitHub Pages деплоїться з `main`).

Потрібні секрети: у репо — `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`; у воркера — `GITHUB_TOKEN` (fine-grained PAT, тільки цей репо, Actions: write).

Вихідний код застосунку — у приватному репозиторії.
