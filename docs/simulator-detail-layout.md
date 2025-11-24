# Simulator Detail Page · Layout Flow & Wireframe

## Flowchart

```
[Sidebar Navigation]
      |
      v
[Simulator Detail Shell]
      |
      +-->[Header Bar]
      |       - Breadcrumb / back link
      |       - Lifecycle badge
      |       - Global actions (start/stop/fault)
      |
      +-->[Data Fetch Layer]
      |       - Simulator detail (REST)
      |       - Sessions list (REST)
      |       - Meter values (REST bootstrap)
      |       - Fault definitions (REST)
      |       - Live channel (WebSocket)
      |
      +-->[State Stores]
      |       - sessionsByConnector  <------+
      |       - meterTimelines ------------|------+
      |       - timelineEvents ------------|--+   |
      |       - telemetryFeed  <-----------+  |   |
      |                                     |  |   |
      v                                     |  |   |
[Presentation Grid]                         |  |   |
  ├─ Left Column                            |  |   |
  │     ├─ Overview & Connectors            |  |   |
  │     ├─ Meter Info (depends on meterTimelines & sessionsByConnector)
  │     └─ Session summary                  |  |   |
  ├─ Right Column                           |  |   |
  │     └─ LiveGraph (consumes meterTimelines + connector selection)
  └─ Full-width row                         |  |   |
        └─ Event Timeline (timelineEvents + telemetryFeed)
```

## Desktop Wireframe (not to scale)

```
┌────────────────────────────────────── Header / Breadcrumb ──────────────────────────────────────┐
│ Back ◁  Simulator Alias / Charger ID                         Lifecycle Badge      Primary CTA   │
└─────────────────────────────────────────────────────────────────────────────────────────────────┘

┌────────────── Left Column (min 420px, 40%) ──────────────┐  ┌───────────── Right Column (60%) ─────────────┐
│ Overview Card                                            │  │ Live Telemetry Panel                         │
│ ┌──────────────────────────────────────────────────────┐ │  │ ┌──────────────────────────────────────────┐ │
│ │ Simulator status, heartbeat, firmware, protocol     │ │  │ │ Graph Header: Connector selector, status │ │
│ └──────────────────────────────────────────────────────┘ │  │ │ badge, last update                       │ │
│                                                           │  │ ├─────────────── Mini-Chart Stack ────────┤ │
│ Connectors & Actions                                      │  │ │ ┌ Power (kW) chart                     ┐│ │
│ ┌──────────────────────────────────────────────────────┐ │  │ │ ├ Current (A) chart                    ┤│ │
│ │ Connector chips, start/stop buttons, fault link      │ │  │ │ └ Energy (kWh) chart (freeze badge)    ┘│ │
│ └──────────────────────────────────────────────────────┘ │  │ └──────────────────────────────────────────┘ │
│                                                           │  │ Meter snapshots footer (total energy)       │
│ Meter Info & Session Summary                             │  └──────────────────────────────────────────────┘
│ ┌──────────────────────────────────────────────────────┐ │
│ │ Key telemetry stats (energy, duration, voltage,     │ │
│ │ idTag, CMS Tx). Session timeline chips.             │ │
│ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┘

┌──────────────────────────────────── Full-width Event Timeline (spans both columns) ─────────────────────────┐
│ Telemetry feed badges (left)                                Vertical timeline feed (right)                 │
│ Streaming status + filters align with grid gutters.                                                         │
└────────────────────────────────────────────────────────────────────────────────────────────────────────────┘

Responsive notes:
- ≥1440px: columns maintain 40/60 split with 32px gutter; cards share equal heights using grid auto-rows.
- ≤1024px: columns collapse to single column (Meter Info above Graph stack); timeline remains full width but now
           follows the stacked content.
- ≤768px: graph mini-charts shrink to 100% width with reduced height (120px), status badges wrap under headings.

## Example UI Mock (values included)

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ ◁ Back to Simulators       Blink_HQ / Simulator #1          CONNECTED badge    │
│ Breadcrumb: Home / Simulators / 1                      CTA: Start Charging     │
└──────────────────────────────────────────────────────────────────────────────┘

┌─────────────── Row 1 (two cards) ────────────────┐ ┌──────────────────────── Row 1 contd. ─────────────────────┐
│ Overview Card                                    │ │ Connectors & Capabilities                                 │
│  Protocol: 1.6J        Heartbeat: 60s            │ │  Connector #1  | CCS1  | Available (pill)                 │
│  Status Interval: 60s  Meter Interval: 1s        │ │  Max kW: 7.2    Phase: —  Inject Fault (button)          │
│  TLS Required: No       Last heartbeat: 17/11/25  │ │  Capabilities chips: RemoteStartStop · Diagnostics        │
└──────────────────────────────────────────────────┘ └────────────────────────────────────────────────────────────┘

┌─────────────── Left Column (40%) ────────────────┐ ┌──────────────────────── Right Column (60%) ────────────────┐
│ Meter Info (primary connector: #1)              │ │ Live Power · Current · Energy                              │
│ ┌─────────────────────────────────────────────┐ │ │ Header: Connector select pill + status badges (e.g.       │
│ │ Energy: 0.234 kWh (+0.002)                  │ │ │ COMPLETED purple)      Tx: 000000026, Updated 10:29:18   │
│ │ Meter Start: 0.353 kWh  | Meter Stop: 0.587 │ │ │                                                            │
│ │ Duration: 00:02:26      | Power: 6.0 kW     │ │ │ Mini-charts (each 150px tall, 16px spacing):               │
│ │ ID Tag: USR_1          | Voltage/Current: — │ │ │   1) Power (kW) line chart (black)                        │
│ │ CMS Tx: 000000026                               │ │   2) Current (A) line chart (green)                       │
│ └─────────────────────────────────────────────┘ │ │   3) Energy (kWh) area chart (purple, “FROZEN” badge)     │
│ Session Snapshot                                 │ │ Footer: “Total energy delivered: 0.234 kWh”                │
│ ┌─────────────────────────────────────────────┐ │ └────────────────────────────────────────────────────────────┘
│ │ Active Tx: 000000026  | User: USR_1        │ │
│ │ Stage pills: Authorized → Charging → Completed (highlight current) │
│ │ Pricing: $0.20/kWh    Estimated Cost: $0.12                      │
│ └─────────────────────────────────────────────┘ │
└────────────────────────────────────────────────┘ └──────────────────────────────────────────────────────────────┘

┌──────────────────────────────────────────── Event Timeline (full width) ─────────────────────────────────────────┐
│ Latest Samples (table-style):                                                                                   │
│   10:29:18  Connector #1 · 5.98 kW · 15 A · 0.587 kWh                                                           │
│   10:29:17  Connector #1 · 4.30 kW · 11 A · 0.585 kWh                                                           │
│ Timeline Feed (right column inside card):                                                                       │
│   10:28:56  Session completed (Connector #1)                                                                    │
│   10:26:12  Charging started                                                                                     │
│   10:25:43  RemoteStartTransaction accepted                                                                     │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```
```
