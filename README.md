<div align="center">

<img src="docs/banner.svg" width="100%" alt="IT-Enterprise Distribution">

### Публічний канал розповсюдження

Це **відкритий репозиторій для оновлень і завантажень** — тут немає вихідного коду,
лише інсталятори та готові збірки, призначені користувачам.

![BCK · Ubuntu](https://img.shields.io/badge/BCK-Ubuntu-2EA44F?style=for-the-badge&logo=linux&logoColor=white)
![Resource Calculator · Windows](https://img.shields.io/badge/Resource_Calculator-Windows-512BD4?style=for-the-badge&logo=dotnet&logoColor=white)
![DiskCleaner · Windows](https://img.shields.io/badge/DiskCleaner-Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white)
![Gym Tracker · PWA](https://img.shields.io/badge/Gym_Tracker-PWA-ff6b6b?style=for-the-badge&logo=pwa&logoColor=white)
![KubeLens · Windows](https://img.shields.io/badge/KubeLens-Windows-24c8db?style=for-the-badge&logo=tauri&logoColor=white)
![PyMon NOC · Ubuntu](https://img.shields.io/badge/PyMon_NOC-Ubuntu-E95420?style=for-the-badge&logo=ubuntu&logoColor=white)
![MyGit · Ubuntu](https://img.shields.io/badge/MyGit-Ubuntu-181717?style=for-the-badge&logo=git&logoColor=white)

**[📦 Продукти](#products)** &nbsp;·&nbsp; **[⬇️ Завантаження](#download)** &nbsp;·&nbsp; **[✅ Підпис і цілісність](#verify)** &nbsp;·&nbsp; **[🔖 Теги релізів](#tags)** &nbsp;·&nbsp; **[🗂️ Структура](#structure)**

</div>

---

<a id="products"></a>

## 📦 Продукти

| Продукт | Платформа | Призначення |
|---|---|---|
| 🗄️ **BCK** | Ubuntu 24 / 25 / 26 · x86_64 | Enterprise backup & disaster recovery (Veeam-альтернатива) |
| 🧮 **Resource Calculator** | Windows 10 / 11 · x64 | Розрахунок ресурсів IT-інфраструктури за матрицею сайзингу |
| 🧹 **DiskCleaner** | Windows 10 / 11 · x64 | Чистка диска `C:` — тимчасові файли, кеші, логи, залишки білдів |
| 🏋️ **Gym Tracker** | Web · PWA (GitHub Pages) | Офлайн-трекер тренувань і прогресу тіла |
| 🔭 **KubeLens** | Windows 10 / 11 · x64 | Kubernetes desktop IDE — workloads, логи, Helm, топологія |
| 📡 **PyMon NOC** | Ubuntu 24 / 25 / 26 · amd64/arm64 | Моніторинг інфраструктури та NOC-дашборд |
| 🐙 **MyGit** | Ubuntu 24 / 25 / 26 · amd64/arm64 | Self-hosted Git-платформа (GitLab/Gitea-альтернатива) |

---

<a id="download"></a>

## ⬇️ Завантаження

### 🗄️ BCK

Одна команда встановлює **і оновлює**: повторний запуск робить апгрейд на місці,
зберігаючи конфігурацію та дані.

```bash
curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/bck/install.sh | sudo bash
```

- Встановлює `bckd`, `bck-agent`, `bck`, `bck-proxy` і вебконсоль.
- Реєструє systemd-сервіс з автоперезапуском при збої.
- Перевіряє SHA256 архіву перед встановленням.

[📜 Скрипт встановлення](apps/bck/install.sh) &nbsp;·&nbsp; [⬇️ Усі релізи BCK](https://github.com/ajjs1ajjs/dist/releases?q=bck)

### 🧮 Resource Calculator

Портативний застосунок для Windows — **один `.exe`**, встановлення не потрібне.

<a href="https://github.com/ajjs1ajjs/dist/releases?q=calculator">
  <img src="https://img.shields.io/badge/Download-latest-00A0C6?style=for-the-badge" alt="Завантажити останню версію">
</a>

- Завантажте `ITE.ResourceCalculator.exe`, звірте з `SHA256SUMS.txt`, запустіть.
- Далі програма **оновлюється сама** — читає релізи цього репозиторію.

[📖 Деталі та перевірка](apps/calculator/README.md) &nbsp;·&nbsp; [⬇️ Усі релізи Calculator](https://github.com/ajjs1ajjs/dist/releases?q=calculator)

### 🧹 DiskCleaner

Портативний очищувач диска `C:` — **один `.exe`**, встановлення не потрібне.

<a href="https://github.com/ajjs1ajjs/dist/releases?q=diskcleaner">
  <img src="https://img.shields.io/badge/Download-latest-00A0C6?style=for-the-badge" alt="Завантажити останню версію">
</a>

- Завантажте `DiskCleaner.exe`, звірте з `SHA256SUMS.txt`, запустіть.
- Агресивні пункти (Windows.old, Prefetch) вимкнені за замовчуванням.

[📖 Деталі та перевірка](apps/diskcleaner/README.md) &nbsp;·&nbsp; [⬇️ Усі релізи DiskCleaner](https://github.com/ajjs1ajjs/dist/releases?q=diskcleaner)

### 🏋️ Gym Tracker

Офлайн-first PWA — працює у браузері, встановлюється на телефон, дані зберігаються локально.

<a href="https://ajjs1ajjs.github.io/dist/gym/">
  <img src="https://img.shields.io/badge/Open-live_app-ff6b6b?style=for-the-badge" alt="Відкрити застосунок">
</a>

- Відкрийте у браузері або додайте на головний екран телефона.
- Збірка застосунку лежить у [`gym/`](gym/) (GitHub Pages).

[📖 Деталі](apps/gym/README.md)

### 🔭 KubeLens

Kubernetes desktop IDE для Windows — **один інсталятор NSIS**, оновлюється всередині застосунку.

<a href="https://github.com/ajjs1ajjs/dist/releases?q=kubelens">
  <img src="https://img.shields.io/badge/Download-latest-24c8db?style=for-the-badge" alt="Завантажити останню версію">
</a>

- Завантажте `KubeLens_*_x64-setup.exe`, встановіть, запустіть.
- Далі застосунок сам перевіряє оновлення при старті (підпис minisign).

[📖 Деталі та перевірка](apps/kubelens/README.md) &nbsp;·&nbsp; [⬇️ Усі релізи KubeLens](https://github.com/ajjs1ajjs/dist/releases?q=kubelens)

### 📡 PyMon NOC

Сервер моніторингу інфраструктури — одна команда встановлює **і оновлює** (Ubuntu 24/25/26).

```bash
curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/monitoring/install.sh | sudo bash
```

- Ставить systemd-сервіс; конфіг, база й користувачі зберігаються при оновленні.
- Перевіряє SHA-256 бінарника перед встановленням.

[📜 Скрипт встановлення](apps/monitoring/install.sh) &nbsp;·&nbsp; [📖 Деталі](apps/monitoring/README.md) &nbsp;·&nbsp; [⬇️ Усі релізи PyMon](https://github.com/ajjs1ajjs/dist/releases?q=monitoring)

### 🐙 MyGit

Self-hosted Git-платформа — одна команда встановлює **і оновлює** (Ubuntu 24/25/26).

```bash
curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/mygit/install.sh | sudo bash
```

- Ставить systemd-сервіс; дані, репозиторії й користувачі зберігаються при оновленні.
- Перевіряє SHA-256 бінарника перед встановленням.

[📜 Скрипт встановлення](apps/mygit/install.sh) &nbsp;·&nbsp; [📖 Деталі](apps/mygit/README.md) &nbsp;·&nbsp; [⬇️ Усі релізи MyGit](https://github.com/ajjs1ajjs/dist/releases?q=mygit)

---

<a id="verify"></a>

## ✅ Підпис і цілісність

- Кожен реліз містить `SHA256SUMS.txt` — звіряйте хеш перед запуском.
- `ITE.ResourceCalculator.exe` і `DiskCleaner.exe` підписані **Authenticode**
  (самопідписаний сертифікат IT-Enterprise). Застосунки приймають оновлення лише з
  підписом, що збігається з піном відбитка сертифіката в їхньому коді, — підмінити
  файл не вийде.

---

<a id="tags"></a>

## 🔖 Теги релізів

Репозиторій спільний для кількох продуктів, тож `/releases/latest` тут не
використовується — кожен продукт шукає свій реліз за префіксом тега:

| Продукт | Шаблон тега | Приклад |
|---|---|---|
| BCK | `bck-v<версія>` | `bck-v0.10.0` |
| Resource Calculator | `calculator-v<версія>` | `calculator-v2.5.0` |
| DiskCleaner | `diskcleaner-v<версія>` | `diskcleaner-v1.4.0` |
| Gym Tracker | `gym-v<версія>` | `gym-v3.5.0` |
| KubeLens | `kubelens-v<версія>` | `kubelens-v0.3.29` |
| PyMon NOC | `monitoring-v<версія>` | `monitoring-v3.3.0` |
| MyGit | `mygit-v<версія>` | `mygit-v3.6.0` |

---

<a id="structure"></a>

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
