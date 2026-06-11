# mylog_analytics

Log aggregation, exploration, and analytics stack running inside Docker.
Managed entirely from the log-agent UI dashboard — no terminal needed.

## Stack

| Service  | Port | What it does |
|----------|------|--------------|
| **log-agent** | 8893 | Management dashboard (FastAPI + Web UI) |
| **Loki**      | 3100 | Log storage and querying (LogQL) |
| **Promtail**  | 9080 | Log shipper — scrapes all Docker containers |
| **Grafana**   | 3000 | Visualization dashboards |

## Quick Start

**1. Start the container (HOST)**
```bash
bash dockerspace/host_scripts/start.sh
```

**2. Login and build (inside container)**
```bash
bash dockerspace/host_scripts/loginto_docker.sh
cd log-agent && bash build.sh
```

**3. Start the log agent**
```bash
bash start.sh
```

**4. Open dashboard**
```
http://localhost:8893
```

**5. From the Stack tab — start in order:**
- ▶ Start Loki
- ▶ Start Promtail
- ▶ Start Grafana

## Directory Structure

```
mylog_analytics/
├── dockerspace/
│   ├── Dockerfile               ← ubuntu:22.04 base
│   ├── project.conf             ← container name, ports
│   ├── host_scripts/            ← start/stop/login (run on HOST)
│   └── config/                  ← Loki, Promtail, Grafana configs
└── log-agent/
    ├── server.py                ← FastAPI management API
    ├── build.sh                 ← installs Loki, Promtail, Grafana, Python deps
    ├── start.sh                 ← starts uvicorn
    ├── requirements.txt
    ├── agent.conf.example       ← copy to agent.conf, set ANTHROPIC_API_KEY
    └── static/                  ← Web UI
        ├── index.html
        ├── css/
        └── js/panels/
            ├── stack.js         ← service start/stop controls
            ├── explorer.js      ← LogQL query UI
            ├── grafana.js       ← Grafana browser link
            └── chat.js          ← AI log analysis chat
```

## MCP Integration

Grafana has an official MCP server (`grafana/mcp-grafana`).
Once Grafana is running, Claude can query logs, metrics, and alerts directly
without the dashboard UI.

## Volumes (mountspace)

| Mount path | Purpose |
|------------|---------|
| `mountspace/logs/` | Host log files → `/host-logs` |
| `mountspace/loki-data/` | Loki storage → `/loki-data` |
| `mountspace/grafana-data/` | Grafana state → `/grafana-data` |
| `/var/run/docker.sock` | Promtail Docker log scraping |
