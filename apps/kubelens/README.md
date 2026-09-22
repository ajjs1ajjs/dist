# KubeLens — завантаження

Kubernetes desktop IDE (Tauri 2 + Rust + React). Windows 10/11 · x64.

## Завантажити

- [Усі релізи](https://github.com/ajjs1ajjs/dist/releases?q=kubelens)
- Пряме посилання на конкретну версію:
  `https://github.com/ajjs1ajjs/dist/releases/download/kubelens-vX.Y.Z/KubeLens_X.Y.Z_x64-setup.exe`

## Оновлення

Застосунок перевіряє оновлення при старті та встановлює їх на місці — вручну качати не треба.
Джерело — [`latest.json`](latest.json) у цій теці (віддає GitHub Pages), а самі артефакти
лежать у релізах `kubelens-v*`. Оновлення приймається лише з валідним **minisign**-підписом
(публічний ключ вбудовано в застосунок), тож підміна файлу не пройде.

## Перевірка цілісності

Поруч з інсталятором лежить `.sig` (minisign-підпис). Вихідний код — у приватному репозиторії.
