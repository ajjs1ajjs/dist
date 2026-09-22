<div align="center">

<img src="docs/banner.svg" width="100%" alt="IT-Enterprise Distribution">

### Публічний канал розповсюдження

Тут **немає вихідного коду** — лише інсталятори та готові збірки, призначені для
завантаження користувачам. Код продуктів лежить у приватних репозиторіях.

![BCK · Ubuntu](https://img.shields.io/badge/BCK-Ubuntu-2EA44F?style=for-the-badge&logo=linux&logoColor=white)
![Resource Calculator · Windows](https://img.shields.io/badge/Resource_Calculator-Windows-512BD4?style=for-the-badge&logo=dotnet&logoColor=white)

</div>

---

## 📦 Що тут є

| Продукт | Платформа | Призначення | Код (приватний) |
|---|---|---|---|
| 🗄️ **[BCK](#-bck--резервне-копіювання)** | Ubuntu 24 / 25 / 26 · x86_64 | Enterprise backup & disaster recovery (Veeam-альтернатива) | [ajjs1ajjs/BCK](https://github.com/ajjs1ajjs/BCK) |
| 🧮 **[Resource Calculator](#-resource-calculator--сайзинг)** | Windows 10 / 11 · x64 | Розрахунок ресурсів IT-інфраструктури за матрицею сайзингу | [ajjs1ajjs/Calculator-servers](https://github.com/ajjs1ajjs/Calculator-servers) |

---

## 🗄️ BCK — резервне копіювання

Одна команда встановлює **і оновлює**: повторний запуск робить апгрейд на місці,
зберігаючи конфігурацію та дані.

```bash
curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/bck/install.sh | sudo bash
```

- Встановлює `bckd`, `bck-agent`, `bck`, `bck-proxy` і вебконсоль.
- Реєструє systemd-сервіс з автоперезапуском при збої.
- Перевіряє SHA256 архіву перед встановленням.

→ [Скрипт встановлення](apps/bck/install.sh) · [Усі релізи BCK](https://github.com/ajjs1ajjs/dist/releases?q=bck) · [Код проєкту](https://github.com/ajjs1ajjs/BCK)

---

## 🧮 Resource Calculator — сайзинг

Портативний застосунок для Windows — **один `.exe`**, встановлення не потрібне.

<a href="https://github.com/ajjs1ajjs/dist/releases?q=calculator">
  <img src="https://img.shields.io/badge/Download-latest-00A0C6?style=for-the-badge" alt="Завантажити останню версію">
</a>

- Завантажте `ITE.ResourceCalculator.exe`, звірте з `SHA256SUMS.txt`, запустіть.
- Далі програма **оновлюється сама** — читає релізи цього репозиторію.

→ [Деталі та перевірка](apps/calculator/README.md) · [Усі релізи Calculator](https://github.com/ajjs1ajjs/dist/releases?q=calculator) · [Код проєкту](https://github.com/ajjs1ajjs/Calculator-servers)

---

## ✅ Цілісність і підпис

- Кожен реліз містить `SHA256SUMS.txt` — звіряйте хеш перед запуском.
- `ITE.ResourceCalculator.exe` підписаний **Authenticode** (самопідписаний сертифікат
  IT-Enterprise). Застосунок приймає оновлення лише з підписом, що збігається з піном
  відбитка сертифіката в його коді, — підмінити файл не вийде.

---

## 🔖 Теги релізів

Репозиторій спільний для кількох продуктів, тож `/releases/latest` тут не
використовується — кожен продукт шукає свій реліз за префіксом тега:

| Продукт | Шаблон тега | Приклад |
|---|---|---|
| BCK | `bck-v<версія>` | `bck-v0.10.0` |
| Resource Calculator | `calculator-v<версія>` | `calculator-v2.5.0` |

---

## 🗂️ Структура

```
apps/<продукт>/install.sh    інсталятор (BCK)
apps/<продукт>/README.md     інструкція для продуктів без інсталятора
releases (теги)              <продукт>-v<версія>
```

---

<details>
<summary><b>Для супроводу (як публікується реліз)</b></summary>

- Артефакти збираються **локально** й заливаються сюди — без CI-хвилин і черг.
- Створення релізу:

  ```bash
  gh release create calculator-vX.Y.Z --repo ajjs1ajjs/dist \
    ITE.ResourceCalculator.exe SHA256SUMS.txt --generate-notes
  ```

- Тег **мусить** мати правильний префікс (`bck-v` / `calculator-v`), інакше
  відповідний застосунок не побачить оновлення.
- Сюди не потрапляє жоден вихідний файл — лише install-скрипти та build-артефакти.

</details>
