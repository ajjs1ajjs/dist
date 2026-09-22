# DiskCleaner — завантаження

Портативний очищувач диска `C:` для Windows 10/11 — один `.exe`, встановлення не потрібне.

## Завантажити

- [Усі релізи](https://github.com/ajjs1ajjs/dist/releases?q=diskcleaner)
- Пряме посилання на конкретну версію:
  `https://github.com/ajjs1ajjs/dist/releases/download/diskcleaner-vX.Y.Z/DiskCleaner.exe`

## Перевірка цілісності

Кожен реліз містить `SHA256SUMS.txt`. Перевірка:

```bat
certutil -hashfile DiskCleaner.exe SHA256
```

Порівняйте з файлом релізу. Незбіг — не запускати.

## Що чистить

Тимчасові файли, кеші Windows / браузерів / NVIDIA, логи, дев-кеші, кошик, залишки білдів.
Агресивні пункти (Windows.old, Prefetch, Go module cache) вимкнені за замовчуванням.

## Запуск

Подвійний клік. Частина пунктів (кеш оновлень Windows, логи CBS, звіти WER) потребує прав
адміністратора — у вікні є кнопка «Перезапустити як адмін».

> exe не підписаний сертифікатом, тож SmartScreen може попередити. Запускайте лише після
> звірки SHA256.
