<div align="center">

<img src="docs/banner.svg" width="100%" alt="IT-Enterprise Distribution">

### Публічний канал розповсюдження

Тут немає вихідного коду — лише **інсталятори та готові збірки** для користувачів.

<br>

<a href="#bck"><img src="https://img.shields.io/badge/BCK-Ubuntu-2EA44F?style=for-the-badge&logo=linux&logoColor=white" alt="BCK"></a>
<a href="#calculator"><img src="https://img.shields.io/badge/Resource_Calculator-Windows-512BD4?style=for-the-badge&logo=dotnet&logoColor=white" alt="Resource Calculator"></a>
<a href="#diskcleaner"><img src="https://img.shields.io/badge/DiskCleaner-Windows-0078D4?style=for-the-badge&logo=windows&logoColor=white" alt="DiskCleaner"></a>
<a href="#gym"><img src="https://img.shields.io/badge/Gym_Tracker-PWA-FF6B6B?style=for-the-badge&logo=pwa&logoColor=white" alt="Gym Tracker"></a>
<a href="#kubelens"><img src="https://img.shields.io/badge/KubeLens-Windows-24C8DB?style=for-the-badge&logo=kubernetes&logoColor=white" alt="KubeLens"></a>
<a href="#monitoring"><img src="https://img.shields.io/badge/PyMon_NOC-Ubuntu-E95420?style=for-the-badge&logo=ubuntu&logoColor=white" alt="PyMon NOC"></a>
<a href="#mygit"><img src="https://img.shields.io/badge/MyGit-Ubuntu-181717?style=for-the-badge&logo=git&logoColor=white" alt="MyGit"></a>
<a href="#rdm"><img src="https://img.shields.io/badge/RDM_Manager-Windows-6366F1?style=for-the-badge&logo=windows&logoColor=white" alt="RDM Manager"></a>
<a href="#sales"><img src="https://img.shields.io/badge/Game_Sales-PWA-C084FC?style=for-the-badge&logo=steam&logoColor=white" alt="Game Sales"></a>
<a href="#uptime-monitor"><img src="https://img.shields.io/badge/Uptime_Monitor-Ubuntu-14B8A6?style=for-the-badge&logo=linux&logoColor=white" alt="Uptime Monitor"></a>

<sub><b>10 продуктів</b> &nbsp;·&nbsp; Linux &nbsp;·&nbsp; Windows &nbsp;·&nbsp; Web / PWA &nbsp;·&nbsp; зібрано локально, перевірено SHA-256</sub>

</div>

---

<a id="products"></a>

## 📦 Продукти

| | Продукт | Платформа | Призначення |
|---|---|---|---|
| 🗄️ | **BCK** | Ubuntu 24 / 25 / 26 · x86_64 | Enterprise backup & disaster recovery (Veeam-альтернатива) |
| 🧮 | **Resource Calculator** | Windows 10 / 11 · x64 | Розрахунок ресурсів IT-інфраструктури за матрицею сайзингу |
| 🧹 | **DiskCleaner** | Windows 10 / 11 · x64 | Чистка диска `C:` — тимчасові файли, кеші, логи, залишки білдів |
| 🏋️ | **Gym Tracker** | Web · PWA | Офлайн-трекер тренувань і прогресу тіла |
| 🔭 | **KubeLens** | Windows 10 / 11 · x64 | Kubernetes desktop IDE — workloads, логи, Helm, топологія |
| 📡 | **PyMon NOC** | Ubuntu 24 / 25 / 26 · amd64/arm64 | Моніторинг інфраструктури та NOC-дашборд |
| 🐙 | **MyGit** | Ubuntu 24 / 25 / 26 · amd64/arm64 | Self-hosted Git-платформа (GitLab/Gitea-альтернатива) |
| 🔌 | **RDM Manager** | Windows 10 / 11 · x64 | Менеджер віддалених підключень (SSH/RDP) для SRE/DevOps |
| 🎮 | **Game Sales** | Web · PWA | Радар знижок і безкоштовних ігор (Steam / Epic) |
| ⏱️ | **Uptime Monitor** | Ubuntu / Debian 24 / 25 / 26 · amd64/arm64 | Моніторинг доступності та SSL, сповіщення, SLA-звіти |

---

<a id="download"></a>

## ⬇️ Завантаження

### Встановлення одною командою

Одна команда і **встановлює, і оновлює**: конфіг, база, користувачі та пароль зберігаються,
замінюється лише бінарник.

| Продукт | Команда |
|---|---|
| 🗄️ **BCK** | `curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/bck/install.sh \| sudo bash` |
| 📡 **PyMon NOC** | `curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/monitoring/install.sh \| sudo bash` |
| 🐙 **MyGit** | `curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/mygit/install.sh \| sudo bash` |
| ⏱️ **Uptime Monitor** | `curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/uptime-monitor/install.sh \| sudo bash` |

---

<a id="bck"></a>

### 🗄️ BCK

<a href="https://github.com/ajjs1ajjs/dist/releases?q=bck"><img src="https://img.shields.io/badge/BCK-Ubuntu_24%2F25%2F26-2EA44F?style=flat-square&logo=linux&logoColor=white" alt="BCK · Ubuntu"></a>

Enterprise backup & disaster recovery (Veeam-альтернатива).

```bash
curl -fsSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/bck/install.sh | sudo bash
```

- Встановлює `bckd`, `bck-agent`, `bck`, `bck-proxy` і вебконсоль.
- Реєструє systemd-сервіс з автоперезапуском при збої.
- Перевіряє SHA256 архіву перед встановленням.

[📜 Скрипт встановлення](apps/bck/install.sh) &nbsp;·&nbsp; [⬇️ Усі релізи BCK](https://github.com/ajjs1ajjs/dist/releases?q=bck)

---

<a id="calculator"></a>

### 🧮 Resource Calculator

<a href="https://github.com/ajjs1ajjs/dist/releases?q=calculator"><img src="https://img.shields.io/badge/Resource_Calculator-Windows_10%2F11-512BD4?style=flat-square&logo=dotnet&logoColor=white" alt="Resource Calculator · Windows"></a>

Портативний застосунок для Windows — **один `.exe`**, встановлення не потрібне.

<a href="https://github.com/ajjs1ajjs/dist/releases?q=calculator">
  <img src="https://img.shields.io/badge/Download-latest-512BD4?style=for-the-badge" alt="Завантажити останню версію">
</a>

- Завантажте `ITE.ResourceCalculator.exe`, звірте з `SHA256SUMS.txt`, запустіть.
- Далі програма **оновлюється сама** — читає релізи цього репозиторію.

[📖 Деталі та перевірка](apps/calculator/README.md) &nbsp;·&nbsp; [⬇️ Усі релізи Calculator](https://github.com/ajjs1ajjs/dist/releases?q=calculator)

---

<a id="diskcleaner"></a>

### 🧹 DiskCleaner

<a href="https://github.com/ajjs1ajjs/dist/releases?q=diskcleaner"><img src="https://img.shields.io/badge/DiskCleaner-Windows_10%2F11-0078D4?style=flat-square&logo=windows&logoColor=white" alt="DiskCleaner · Windows"></a>

Портативний очищувач диска `C:` — **один `.exe`**, встановлення не потрібне.

<a href="https://github.com/ajjs1ajjs/dist/releases?q=diskcleaner">
  <img src="https://img.shields.io/badge/Download-latest-0078D4?style=for-the-badge" alt="Завантажити останню версію">
</a>

- Завантажте `DiskCleaner.exe`, звірте з `SHA256SUMS.txt`, запустіть.
- Агресивні пункти (Windows.old, Prefetch) вимкнені за замовчуванням.

[📖 Деталі та перевірка](apps/diskcleaner/README.md) &nbsp;·&nbsp; [⬇️ Усі релізи DiskCleaner](https://github.com/ajjs1ajjs/dist/releases?q=diskcleaner)

---

<a id="gym"></a>

### 🏋️ Gym Tracker

<a href="https://ajjs1ajjs.github.io/dist/gym/"><img src="https://img.shields.io/badge/Gym_Tracker-Web_%2F_PWA-FF6B6B?style=flat-square&logo=pwa&logoColor=white" alt="Gym Tracker · PWA"></a>

Офлайн-first PWA — працює у браузері, встановлюється на телефон, дані зберігаються локально.

<a href="https://ajjs1ajjs.github.io/dist/gym/">
  <img src="https://img.shields.io/badge/Open-live_app-FF6B6B?style=for-the-badge" alt="Відкрити застосунок">
</a>

- Відкрийте у браузері або додайте на головний екран телефона.
- Збірка застосунку лежить у [`gym/`](gym/) (GitHub Pages).

[📖 Деталі](apps/gym/README.md)

---

<a id="kubelens"></a>

### 🔭 KubeLens

<a href="https://github.com/ajjs1ajjs/dist/releases?q=kubelens"><img src="https://img.shields.io/badge/KubeLens-Windows_10%2F11-24C8DB?style=flat-square&logo=kubernetes&logoColor=white" alt="KubeLens · Windows"></a>

Kubernetes desktop IDE для Windows — **один інсталятор NSIS**, оновлюється всередині застосунку.

<a href="https://github.com/ajjs1ajjs/dist/releases?q=kubelens">
  <img src="https://img.shields.io/badge/Download-latest-24C8DB?style=for-the-badge" alt="Завантажити останню версію">
</a>

- Завантажте `KubeLens_*_x64-setup.exe`, встановіть, запустіть.
- Далі застосунок сам перевіряє оновлення при старті (підпис minisign).

[📖 Деталі та перевірка](apps/kubelens/README.md) &nbsp;·&nbsp; [⬇️ Усі релізи KubeLens](https://github.com/ajjs1ajjs/dist/releases?q=kubelens)

---

<a id="monitoring"></a>

### 📡 PyMon NOC

<a href="https://github.com/ajjs1ajjs/dist/releases?q=monitoring"><img src="https://img.shields.io/badge/PyMon_NOC-Ubuntu_24%2F25%2F26-E95420?style=flat-square&logo=ubuntu&logoColor=white" alt="PyMon NOC · Ubuntu"></a>

Сервер моніторингу інфраструктури — одна команда встановлює **і оновлює** (Ubuntu 24/25/26).

```bash
curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/monitoring/install.sh | sudo bash
```

- Ставить systemd-сервіс; конфіг, база й користувачі зберігаються при оновленні.
- Перевіряє SHA-256 бінарника перед встановленням.

[📜 Скрипт встановлення](apps/monitoring/install.sh) &nbsp;·&nbsp; [📖 Деталі](apps/monitoring/README.md) &nbsp;·&nbsp; [⬇️ Усі релізи PyMon](https://github.com/ajjs1ajjs/dist/releases?q=monitoring)

---

<a id="mygit"></a>

### 🐙 MyGit

<a href="https://github.com/ajjs1ajjs/dist/releases?q=mygit"><img src="https://img.shields.io/badge/MyGit-Ubuntu_24%2F25%2F26-181717?style=flat-square&logo=git&logoColor=white" alt="MyGit · Ubuntu"></a>

Self-hosted Git-платформа — одна команда встановлює **і оновлює** (Ubuntu 24/25/26).

```bash
curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/mygit/install.sh | sudo bash
```

- Ставить systemd-сервіс; дані, репозиторії й користувачі зберігаються при оновленні.
- Перевіряє SHA-256 бінарника перед встановленням.

[📜 Скрипт встановлення](apps/mygit/install.sh) &nbsp;·&nbsp; [📖 Деталі](apps/mygit/README.md) &nbsp;·&nbsp; [⬇️ Усі релізи MyGit](https://github.com/ajjs1ajjs/dist/releases?q=mygit)

---

<a id="rdm"></a>

### 🔌 RDM Manager

<a href="https://github.com/ajjs1ajjs/dist/releases?q=rdm"><img src="https://img.shields.io/badge/RDM_Manager-Windows_10%2F11-6366F1?style=flat-square&logo=windows&logoColor=white" alt="RDM Manager · Windows"></a>

Менеджер віддалених підключень для Windows — **NSIS-інсталятор** або portable ZIP,
оновлюється всередині застосунку.

<a href="https://github.com/ajjs1ajjs/dist/releases?q=rdm">
  <img src="https://img.shields.io/badge/Download-latest-6366F1?style=for-the-badge" alt="Завантажити останню версію">
</a>

- `RDM.Manager_<версія>_x64-setup.exe` — інсталятор; `…Portable.zip` — портативна версія.
- Далі застосунок сам перевіряє оновлення при старті (підпис minisign).

[📖 Деталі](apps/rdm/README.md) &nbsp;·&nbsp; [⬇️ Усі релізи RDM](https://github.com/ajjs1ajjs/dist/releases?q=rdm)

---

<a id="sales"></a>

### 🎮 Game Sales

<a href="https://ajjs1ajjs.github.io/dist/sales/"><img src="https://img.shields.io/badge/Game_Sales-Web_%2F_PWA-C084FC?style=flat-square&logo=steam&logoColor=white" alt="Game Sales · PWA"></a>

Персональний радар знижок і безкоштовних ігор — Steam та Epic Games Store.
Оновлюється автоматично кілька разів на добу.

<a href="https://ajjs1ajjs.github.io/dist/sales/">
  <img src="https://img.shields.io/badge/Open-live_site-C084FC?style=for-the-badge" alt="Відкрити сайт">
</a>

- Відкрийте у браузері або встановіть як застосунок (PWA), працює офлайн.
- Дані й збірка лежать у [`sales/`](sales/); збір даних — у [`apps/sales/fetch/`](apps/sales/fetch/).
- Telegram-канал: [@salesgamesua](https://t.me/salesgamesua).

[📖 Деталі](apps/sales/README.md)

---

<a id="uptime-monitor"></a>

### ⏱️ Uptime Monitor

<a href="https://github.com/ajjs1ajjs/dist/releases?q=uptime"><img src="https://img.shields.io/badge/Uptime_Monitor-Ubuntu_%2F_Debian-14B8A6?style=flat-square&logo=linux&logoColor=white" alt="Uptime Monitor · Ubuntu"></a>

Моніторинг доступності сайтів, сервісів і SSL-сертифікатів — одна команда встановлює
**і оновлює** (Ubuntu/Debian 24/25/26).

```bash
curl -sSL https://raw.githubusercontent.com/ajjs1ajjs/dist/main/apps/uptime-monitor/install.sh | sudo bash
```

- Ставить systemd-сервіс; конфіг, БД, користувачі та пароль зберігаються при оновленні.
- Перевіряє SHA-256 бінарника (`checksums.txt`) перед встановленням.
- Невдалий старт не рапортується як успіх — бінарник відкочується.

[📜 Скрипт встановлення](apps/uptime-monitor/install.sh) &nbsp;·&nbsp; [📖 Деталі](apps/uptime-monitor/README.md) &nbsp;·&nbsp; [⬇️ Усі релізи Uptime Monitor](https://github.com/ajjs1ajjs/dist/releases?q=uptime)

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
| PyMon NOC | `monitoring-v<версія>` | `monitoring-v3.3.2` |
| MyGit | `mygit-v<версія>` | `mygit-v3.7.0` |
| RDM Manager | `rdm-v<версія>` | `rdm-v2.1.5` |
| Uptime Monitor | `uptime-v<версія>` | `uptime-v3.7.2` |

---

<a id="palette"></a>

## 🎨 Палітра

Кожен продукт має власний акцентний колір — він використовується в бейджах і посиланнях.

| Продукт | Акцент | Продукт | Акцент |
|---|---|---|---|
| 🗄️ BCK | `#2EA44F` | 🐙 MyGit | `#181717` |
| 🧮 Resource Calculator | `#512BD4` | 🔌 RDM Manager | `#6366F1` |
| 🧹 DiskCleaner | `#0078D4` | 🎮 Game Sales | `#C084FC` |
| 🏋️ Gym Tracker | `#FF6B6B` | ⏱️ Uptime Monitor | `#14B8A6` |
| 🔭 KubeLens | `#24C8DB` | 📡 PyMon NOC | `#E95420` |

---

<a id="structure"></a>

## 🗂️ Структура

```
apps/<продукт>/install.sh    інсталятор (Ubuntu/Debian)
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
- Текстові асети (`checksums.txt`, `SHA256SUMS.txt`) заливати з **LF**, не CRLF —
  інакше інсталятори не знаходять запис у файлі.
- Сюди не потрапляє жоден вихідний файл — лише install-скрипти та build-артефакти.

</details>
