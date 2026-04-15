# ☁️ Oracle Cloud Deployment Guide: Nifty Positional Algo

This guide provides step-by-step instructions to host your Nifty Positional Iron Condor algorithm on a **Free Tier Oracle Cloud (OCI)** instance.

---

## 🚀 1. Provisioning your Instance
1.  **Sign in**: [Oracle Cloud Console](https://cloud.oracle.com/?region=ap-mumbai-1).
2.  **Navigate**: Compute > Instances > Create Instance.
3.  **Image**: Choose **Ubuntu 22.04** (Always Free Eligible).
4.  **Shape**: Select **VM.Standard.E4.Flex** (the free ARM shape is best).
5.  **Networking**: Ensure "Assign a public IPv4 address" is checked.
6.  **SSH Keys**: Download the **Private Key (.key)** to your computer.
7.  **Create**: Wait for the instance to show "Running".

---

## 🛠️ 2. Server Preparation
Once the instance is running, connect via SSH (replace `<your-ip>` and `<your-key.key>`):
```bash
ssh -i your-key.key ubuntu@<your-ip>
```

### Install Node.js (v20+)
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### Clone and Install Project
```bash
git clone https://github.com/kunalrbhatia/niftyicifalgo.git
cd niftyicifalgo
npm install
```

### Configure Environment Variables
Create your `.env` file and paste your credentials:
```bash
nano .env
```
*Note: Ensure `ANGEL_PUBLIC_IP` matches your Oracle Instance's public IP.*

---

## 📅 3. Scheduling with CRON (3:00 PM IST)
Oracle Cloud servers typically use **UTC time**. 
*   **3:00 PM IST** = **09:30 AM UTC**.
*   **9:00 AM IST** = **03:30 AM UTC** (Time to refresh tokens).

Open the crontab editor:
```bash
crontab -e
```

Add these two lines at the bottom:
```cron
# 1. Refresh Scrip Master daily at 09:00 AM IST (03:30 AM UTC)
30 03 * * * cd /home/ubuntu/niftyicifalgo && /usr/bin/node filter_scrips.js >> /home/ubuntu/niftyicifalgo/logs/cron_refresh.log 2>&1

# 2. Run Algo Daily Check at 03:00 PM IST (09:30 AM UTC)
30 09 * * * cd /home/ubuntu/niftyicifalgo && /usr/bin/node index.js >> /home/ubuntu/niftyicifalgo/logs/cron_algo.log 2>&1
```

---

## 🔐 4. Angel One Whitelisting (CRITICAL)
Your Oracle Cloud server has a **static public IP**. You **MUST** whitelist this IP in your Angel One SmartAPI portal:
1.  Run `curl ifconfig.me` on your server to get its IP.
2.  Log in to [SmartAPI Portal](https://smartapi.angelbroking.com/).
3.  Go to your App Settings and add the IP to the **Whitelisted IPs** section.

---

## 📊 5. Monitoring Logs
To check if your algo ran successfully via CRON:
```bash
tail -f /home/ubuntu/niftyicifalgo/logs/cron_algo.log
```
Or check the application logs directly:
```bash
tail -f /home/ubuntu/niftyicifalgo/logs/app.log
```

---
**Setup Complete!** Your algo will now autonomously manage your Nifty Monthly Iron Condor every trading day.
