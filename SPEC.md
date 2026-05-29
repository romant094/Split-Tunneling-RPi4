# RPi VPN Gateway — Спека для агента

## Контекст

Raspberry Pi 4 должен стать VPN-шлюзом для домашней сети.
Логика маршрутизации: **весь трафик → VPN (AmneziaWG), RU-подсети → провайдер напрямую**.

Устройства в сети получают RPi как шлюз по умолчанию через DHCP на Keenetic.

---

## Топология сети

```
Интернет
   ↓
Keenetic (192.168.1.1, PPPoE → провайдер Small Telecom)
   ↓ (eth0)
RPi4 (IP уточнить у пользователя)
   ↓
Устройства в LAN (шлюз = IP RPi)
```

---

## Переменные окружения

| Переменная | Значение |
|---|---|
| `KEENETIC_GW` | `192.168.1.1` |
| `VPN_SERVER_IP` | `YOUR_VPN_SERVER_IP` |
| `VPN_IFACE` | `awg0` |
| `RPI_LAN_IP` | уточнить у пользователя |
| `LAN_SUBNET` | `192.168.1.0/24` (уточнить) |

---

## Задачи

### 1. Установка AmneziaWG

```bash
# Проверить есть ли уже
which awg || which wg

# Если нет — установить
sudo apt update
sudo apt install -y wireguard-tools
# AmneziaWG: собрать из исходников или установить deb если есть
```

Пользователь предоставит конфиг для AmneziaWG отдельно.
Сохранить конфиг в `/etc/amnezia/amneziawg/awg0.conf`.
Поднять интерфейс: `sudo awg-quick up awg0`.

---

### 2. Включить IP forwarding

```bash
# Временно
sudo sysctl -w net.ipv4.ip_forward=1

# Постоянно
echo "net.ipv4.ip_forward=1" | sudo tee -a /etc/sysctl.conf
sudo sysctl -p
```

---

### 3. Настройка маршрутизации — скрипт `/etc/routing.sh`

Скрипт должен выполнять следующее при каждом запуске:

1. **Скачать** список RU-подсетей:
   ```
   https://russia.iplist.opencck.org/?format=text&data=cidr4
   ```

2. **Сбросить** текущие маршруты (кроме локальных и маршрута до VPN-сервера).

3. **Установить дефолтный маршрут через VPN:**
   ```bash
   ip route add default dev awg0
   ```

4. **Добавить маршрут до VPN-сервера через провайдера** (критично — иначе петля):
   ```bash
   ip route add YOUR_VPN_SERVER_IP/32 via 192.168.1.1
   ```

5. **Добавить маршруты для RU-подсетей через провайдера:**
   ```bash
   # для каждой подсети из списка:
   ip route add <CIDR> via 192.168.1.1
   ```

6. **Добавить маршрут для локальной сети:**
   ```bash
   ip route add 192.168.1.0/24 dev eth0
   ```

Скрипт сделать идемпотентным — повторный запуск не должен падать с ошибкой.

---

### 4. NAT (masquerade)

RPi должен делать NAT для устройств в LAN:

```bash
sudo iptables -t nat -A POSTROUTING -o awg0 -j MASQUERADE
sudo iptables -t nat -A POSTROUTING -o eth0 -j MASQUERADE
```

Сохранить правила iptables чтобы выживали после перезагрузки:
```bash
sudo apt install -y iptables-persistent
sudo netfilter-persistent save
```

---

### 5. Автозапуск скрипта маршрутизации

Создать systemd-сервис `/etc/systemd/system/vpn-routing.service`:

```ini
[Unit]
Description=VPN Routing Setup
After=network-online.target awg-quick@awg0.service
Wants=network-online.target

[Service]
Type=oneshot
ExecStart=/etc/routing.sh
RemainAfterExit=yes

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl enable vpn-routing
sudo systemctl start vpn-routing
```

---

### 6. Автозапуск AmneziaWG

Создать systemd-сервис для awg0 если не создан автоматически при установке:

```bash
sudo systemctl enable awg-quick@awg0
sudo systemctl start awg-quick@awg0
```

Порядок запуска при загрузке системы:
1. `awg-quick@awg0` — поднимает VPN-интерфейс
2. `vpn-routing` — применяет маршруты (зависит от awg0)

---

### 7. Обновление маршрутов по расписанию

Список RU-подсетей обновляется — добавить cron для ежедневного обновления:

```bash
# создать файл /etc/cron.daily/update-vpn-routes
#!/bin/bash
/etc/routing.sh >> /var/log/vpn-routing.log 2>&1
```

```bash
sudo chmod +x /etc/cron.daily/update-vpn-routes
```

---

### 8. Скрипт полного отката — `/etc/vpn-rollback.sh`

Скрипт должен полностью вернуть RPi в состояние обычного хоста без какой-либо маршрутизации.

Скрипт выполняет:

1. Остановить и выключить из автозапуска сервисы:
```bash
sudo systemctl stop vpn-routing
sudo systemctl disable vpn-routing
sudo systemctl stop awg-quick@awg0
sudo systemctl disable awg-quick@awg0
```

2. Опустить VPN-интерфейс:
```bash
sudo awg-quick down awg0
```

3. Сбросить все маршруты и восстановить дефолтный через Keenetic:
```bash
ip route flush table main
ip route add default via 192.168.1.1
ip route add 192.168.1.0/24 dev eth0
```

4. Удалить правила NAT:
```bash
sudo iptables -t nat -F POSTROUTING
sudo netfilter-persistent save
```

5. Удалить cron:
```bash
sudo rm -f /etc/cron.daily/update-vpn-routes
```

6. Вывести сообщение:
```
Rollback complete. RPi is now a regular host.
Default gateway: 192.168.1.1
Remember to update DHCP gateway on Keenetic back to 192.168.1.1.
```

Скрипт НЕ удаляет:
- Конфиг awg0.conf (оставить для повторного запуска)
- Установленные пакеты
- Сам скрипт routing.sh

---

## Проверка после настройки

```bash
# 1. Дефолтный маршрут — должен идти через awg0
ip route show default

# 2. Маршрут до VPN-сервера — должен идти через 192.168.1.1
ip route get YOUR_VPN_SERVER_IP

# 3. Маршрут до RU-ресурса (например Яндекс) — должен идти через eth0/192.168.1.1
ip route get 77.88.8.8

# 4. Маршрут до зарубежного ресурса — должен идти через awg0
ip route get 8.8.8.8

# 5. Проверить что трафик реально идёт через VPN
curl --interface awg0 https://ifconfig.me
```

---

## Что НЕ трогать

- Конфигурацию Keenetic — только DHCP настройка шлюза (отдельно, вручную пользователем)
- OpenVPN (tun0) — существующий корпоративный туннель Promwad не трогать
- Docker-контейнеры если есть

---

## Настройка Keenetic DHCP (вручную пользователем)

Выполнять **после** того как RPi полностью настроен и проверен.

1. Открыть веб-интерфейс Keenetic: http://192.168.1.1
2. Левое меню → **Мои сети и Wi-Fi** → вкладка **Default**
3. Прокрутить до раздела **Параметры IP**
4. Нажать **Скрыть настройки DHCP** (разворачивает поля)
5. Найти поле **Адрес шлюза** (сейчас пустое)
6. Вписать IP RPi (например `192.168.1.XX`)
7. Нажать **Сохранить**

После сохранения все устройства при следующем обновлении DHCP-аренды получат RPi как шлюз. Для мгновенного применения — переподключить Wi-Fi или сделать `ipconfig /release && ipconfig /renew` на Windows.

**Откат:** то же самое, но поле "Адрес шлюза" очистить → Сохранить.

---

## Инструкция по эксплуатации

### Быстрый статус

```bash
sudo systemctl status vpn-routing
sudo systemctl status awg-quick@awg0
sudo awg show
ip route show default
curl https://ifconfig.me   # должен вернуть IP VPN-сервера
```

### Временно выключить VPN (без отката)

```bash
sudo systemctl stop vpn-routing
sudo systemctl stop awg-quick@awg0
sudo ip route flush table main
sudo ip route add default via 192.168.1.1
sudo ip route add 192.168.1.0/24 dev eth0
```

Трафик пойдёт напрямую через Keenetic.

### Включить снова

```bash
sudo systemctl start awg-quick@awg0
sudo systemctl start vpn-routing
```

### Обновить список RU-подсетей вручную

```bash
sudo /etc/routing.sh
```

### Перезапуск при зависшем туннеле

Симптом: интернет не работает, `awg show` показывает handshake > 3 минут.

```bash
sudo systemctl restart awg-quick@awg0
sudo systemctl restart vpn-routing
```

### Полный откат

```bash
sudo /etc/vpn-rollback.sh
```

После этого вернуть DHCP на Keenetic: шлюз = 192.168.1.1.

### Логи

```bash
sudo journalctl -u vpn-routing -n 50
sudo journalctl -u awg-quick@awg0 -n 50
tail -50 /var/log/vpn-routing.log
```

---

## Файлы системы

| Файл | Назначение |
|---|---|
| `/etc/amnezia/amneziawg/awg0.conf` | Конфиг VPN-туннеля |
| `/etc/routing.sh` | Маршрутизация (запуск при старте + cron) |
| `/etc/vpn-rollback.sh` | Полный откат |
| `/etc/systemd/system/vpn-routing.service` | Systemd-сервис |
| `/etc/cron.daily/update-vpn-routes` | Ежедневное обновление подсетей |
| `/var/log/vpn-routing.log` | Лог обновлений |

---

## Конфиг AmneziaWG

Пользователь предоставит отдельно в процессе выполнения задачи.
