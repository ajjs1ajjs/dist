# Resource Calculator — завантаження

Портативний застосунок для Windows 10/11 — один `.exe`, self-contained, встановлення
не потрібне. Просто завантажте файл у будь-яку теку й запустіть.

## Завантажити

- [Усі релізи](https://github.com/ajjs1ajjs/dist/releases?q=calculator)
- Пряме посилання на конкретну версію:
  `https://github.com/ajjs1ajjs/dist/releases/download/calculator-vX.Y.Z/ITE.ResourceCalculator.exe`

## Перевірка цілісності

Кожен реліз містить `SHA256SUMS.txt`. Перевірка (PowerShell):

```powershell
(Get-FileHash .\ITE.ResourceCalculator.exe -Algorithm SHA256).Hash
```

## Підпис

exe підписаний Authenticode самопідписаним сертифікатом. Windows SmartScreen
може попередити — це нормально (сертифікат не від публічної CA); довіру несе пін відбитка
сертифіката всередині застосунку, тому підроблене/змінене оновлення буде відкинуте.

## Оновлення

Застосунок оновлюється сам: читає список релізів цього репозиторію і бере найновіший із
тегом `calculator-v*`. Достатньо запустити встановлену версію — вона запропонує оновлення.
