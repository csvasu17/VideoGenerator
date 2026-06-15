/**
 * workflows.ts — Comprehensive Rheem demo workflow definitions.
 *
 * Each clip navigates like a real user: every tab, filter, and option is clicked.
 * Target duration: 20–35 seconds per clip for a rich, dynamic recording.
 *
 * Edit only this file to change what gets recorded — no other code needs changing.
 */

import type {ProjectWorkflows} from '../../../automation/workflow-types';

export const rheemWorkflows: ProjectWorkflows = {
  projectId:   'rheem',
  appUrl:      process.env.RHEEM_APP_URL || process.env.APP_URL || 'https://acl-rheem.vercel.app',
  credentials: {
    username: process.env.APP_USERNAME || '',
    password: process.env.APP_PASSWORD || '',
  },

  clips: [

    // ─── 0. Rheem TotalView — fleet overview (15s) ──────────────────────────
    // Navigate directly to /dashboard (confirmed working) as the fleet overview.
    {
      id:'rheem-totalview', title:'Rheem TotalView', subtitle:'Enterprise-wide equipment visibility platform', accent:'orange', holdMs:2000, interactionDiscovery:true,
      steps:[
        {type:'navigate', url:'/dashboard'},
        {type:'wait',     ms:3000},
        // Scroll to reveal all summary stats
        {type:'scroll',   y:300},
        {type:'wait',     ms:1200},
        {type:'scroll',   y:600},
        {type:'wait',     ms:1000},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1500},
        // Interact with any site/fleet filter if present
        {type:'click',    selector:'[role="tab"]:nth-child(1)', optional:true, waitAfter:1000},
        {type:'wait',     ms:1000},
        {type:'scroll',   y:200},
        {type:'wait',     ms:800},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1500},
      ],
    },

    // ─── 1. Dashboard (20s) ─────────────────────────────────────────────────
    {
      id:'dashboard', title:'Dashboard', subtitle:'Real-time operational command center', accent:'blue', holdMs:2500, interactionDiscovery:true,
      steps:[
        {type:'navigate', url:'/dashboard'},
        {type:'wait',     ms:2500},
        // Show top summary stats
        {type:'scroll',   y:300},
        {type:'wait',     ms:1200},
        {type:'scroll',   y:600},
        {type:'wait',     ms:1200},
        {type:'scroll',   y:900},
        {type:'wait',     ms:1000},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1500},
        // Click any dashboard filter / tab if present
        {type:'click',    selector:'[role="tab"]:nth-child(2)', optional:true, waitAfter:1500},
        {type:'click',    selector:'[role="tab"]:nth-child(1)', optional:true, waitAfter:1000},
        {type:'scroll',   y:400},
        {type:'wait',     ms:1000},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1500},
      ],
    },

    // ─── 2. Enterprise Sites Directory (18s) ────────────────────────────────
    {
      id:'sites', title:'Enterprise Sites', subtitle:'Manage deployments across your entire portfolio', accent:'orange', holdMs:2500,
      steps:[
        {type:'navigate', url:'/sites'},
        {type:'wait',     ms:2500},
        // Show all site cards
        {type:'scroll',   y:250},
        {type:'wait',     ms:1000},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1200},
        // Hover over site cards to reveal actions
        {type:'hover',    text:'Greenwood Corporate', optional:true, waitAfter:800},
        {type:'hover',    text:'Northridge Middle',   optional:true, waitAfter:800},
        {type:'hover',    text:'Orchid',              optional:true, waitAfter:800},
        {type:'hover',    text:'Summit Industrial Park', optional:true, waitAfter:800},
        {type:'hover',    text:'Urban Heaven',        optional:true, waitAfter:800},
        {type:'wait',     ms:1500},
      ],
    },

    // ─── 3. Site Intelligence — all tabs + 3D floor (35s) ───────────────────
    {
      id:'site-detail', title:'Site Intelligence', subtitle:'3D floor mapping with live device status per floor', accent:'blue', holdMs:2500,
      steps:[
        {type:'navigate', url:'/sites'},
        {type:'wait',     ms:2500},
        {type:'click',    text:'Northridge Middle', optional:true, waitAfter:2500},
        {type:'tab_click',text:'Overview',   optional:true, waitAfter:1500},
        {type:'scroll',   y:400},
        {type:'wait',     ms:1200},
        {type:'scroll',   y:0},
        {type:'wait',     ms:800},
        {type:'tab_click',text:'Site Info',  optional:true, waitAfter:2500},
        {type:'wait',     ms:1000},
        {type:'click',    text:'2nd Floor',  optional:true, waitAfter:1500},
        {type:'click',    text:'3rd Floor',  optional:true, waitAfter:1500},
        {type:'click',    text:'1st Floor',  optional:true, waitAfter:1200},
        {type:'wait',     ms:1000},
        {type:'tab_click',text:'IAQ',        optional:true, waitAfter:1800},
        {type:'scroll',   y:300},
        {type:'wait',     ms:1000},
        {type:'scroll',   y:0},
        {type:'tab_click',text:'Analytics',  optional:true, waitAfter:2000},
        {type:'scroll',   y:400},
        {type:'wait',     ms:1500},
        {type:'scroll',   y:0},
        {type:'tab_click',text:'Alerts',     optional:true, waitAfter:1500},
        {type:'scroll',   y:200},
        {type:'wait',     ms:1000},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1500},
      ],
    },

    // ─── 4. Alarms & Fault Detection (20s) ──────────────────────────────────
    {
      id:'alarms', title:'Alarms & Fault Detection', subtitle:'Real-time critical alerts with severity triage', accent:'orange', holdMs:2500,
      steps:[
        {type:'navigate', url:'/alarms'},
        {type:'wait',     ms:2500},
        // Click severity filters if present
        {type:'click',    text:'Critical',  optional:true, waitAfter:1200},
        {type:'click',    text:'Warning',   optional:true, waitAfter:1200},
        {type:'click',    text:'All',       optional:true, waitAfter:1000},
        {type:'click',    text:'Active',    optional:true, waitAfter:1000},
        {type:'scroll',   y:400},
        {type:'wait',     ms:1200},
        // Click first alarm to see details
        {type:'click',    selector:'[class*="alarm"]:first-child, [class*="alert-row"]:first-child, tr:first-child', optional:true, waitAfter:2000},
        {type:'key',      key:'Escape',     waitAfter:500},
        {type:'scroll',   y:600},
        {type:'wait',     ms:1000},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1500},
      ],
    },

    // ─── 5. Device Fleet Grid — all filter options (22s) ────────────────────
    {
      id:'devices', title:'Device Fleet', subtitle:'27 connected units monitored live across all sites', accent:'blue', holdMs:2500,
      steps:[
        {type:'navigate', url:'/devices'},
        {type:'wait',     ms:2500},
        // Cycle through device type filters
        {type:'click',    text:'ONLINE',  optional:true, waitAfter:1200},
        {type:'click',    text:'OFFLINE', optional:true, waitAfter:1200},
        {type:'click',    text:'COOLER',  optional:true, waitAfter:1200},
        {type:'click',    text:'WATER',   optional:true, waitAfter:1200},
        {type:'click',    text:'AIR',     optional:true, waitAfter:1200},
        {type:'click',    text:'TOTAL',   optional:true, waitAfter:1000},
        // Switch between grid and list view if available
        {type:'click',    selector:'[aria-label*="list" i], [title*="list" i], [class*="list-view"]',  optional:true, waitAfter:1200},
        {type:'click',    selector:'[aria-label*="grid" i], [title*="grid" i], [class*="grid-view"]',  optional:true, waitAfter:1200},
        // Scroll through the device grid
        {type:'scroll',   y:400},
        {type:'wait',     ms:1200},
        {type:'scroll',   y:800},
        {type:'wait',     ms:1000},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1500},
      ],
    },

    // ─── 6. Device Intelligence — all 6 tabs deep dive (40s) ────────────────
    {
      id:'device-detail', title:'Device Intelligence', subtitle:'Live telemetry, predictive insights, and remote control', accent:'orange', holdMs:3000,
      steps:[
        {type:'navigate', url:'/devices'},
        {type:'wait',     ms:2500},
        // Click into first connected device
        {type:'click',    text:'RTU F202401367', optional:true, waitAfter:2500},
        // If specific device not found, click any first device card
        {type:'click',    selector:'[class*="device-card"]:not([class*="offline"]):first-child, [class*="DeviceCard"]:first-child', optional:true, waitAfter:2500},

        // ── Overview tab — scroll all sections ──
        {type:'tab_click',text:'Overview',     optional:true, waitAfter:1000},
        {type:'scroll',   y:300},
        {type:'wait',     ms:1200},
        {type:'scroll',   y:600},
        {type:'wait',     ms:1200},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1000},

        // ── Analytics tab ──
        {type:'tab_click',text:'Analytics',    waitAfter:2000},
        {type:'scroll',   y:300},
        {type:'wait',     ms:1500},
        // Click any time range selector
        {type:'click',    text:'7D',  optional:true, waitAfter:1200},
        {type:'click',    text:'30D', optional:true, waitAfter:1200},
        {type:'click',    text:'24H', optional:true, waitAfter:1200},
        {type:'scroll',   y:400},
        {type:'wait',     ms:1200},
        {type:'scroll',   y:0},
        {type:'wait',     ms:800},

        // ── Controls tab ──
        {type:'tab_click',text:'Controls',     waitAfter:2000},
        {type:'scroll',   y:300},
        {type:'wait',     ms:1500},
        {type:'scroll',   y:0},
        {type:'wait',     ms:800},

        // ── Schedule tab ──
        {type:'tab_click',text:'Schedule',     optional:true, waitAfter:2000},
        {type:'scroll',   y:300},
        {type:'wait',     ms:1200},
        {type:'scroll',   y:0},
        {type:'wait',     ms:800},

        // ── Maintenance tab ──
        {type:'tab_click',text:'Maintenance',  optional:true, waitAfter:2000},
        {type:'scroll',   y:300},
        {type:'wait',     ms:1500},
        {type:'scroll',   y:0},
        {type:'wait',     ms:800},

        // ── Device Info tab ──
        {type:'tab_click',text:'Device Info',  optional:true, waitAfter:1500},
        {type:'scroll',   y:300},
        {type:'wait',     ms:1000},
        {type:'scroll',   y:0},

        // ── Back to Overview ──
        {type:'tab_click',text:'Overview',     optional:true, waitAfter:1500},
        {type:'wait',     ms:1000},
      ],
    },

    // ─── 7. Insights & Analytics (22s) ──────────────────────────────────────
    {
      id:'insights', title:'Insights & Analytics', subtitle:'Operational intelligence and performance trending', accent:'blue', holdMs:2500, interactionDiscovery:true,
      steps:[
        {type:'navigate', url:'/insights'},
        {type:'wait',     ms:2500},
        // Click available tabs/sections
        {type:'click',    selector:'[role="tab"]:nth-child(1)', optional:true, waitAfter:1500},
        {type:'scroll',   y:400},
        {type:'wait',     ms:1500},
        {type:'click',    selector:'[role="tab"]:nth-child(2)', optional:true, waitAfter:1500},
        {type:'scroll',   y:400},
        {type:'wait',     ms:1200},
        {type:'click',    selector:'[role="tab"]:nth-child(3)', optional:true, waitAfter:1500},
        {type:'scroll',   y:400},
        {type:'wait',     ms:1200},
        // Time range selectors
        {type:'click',    text:'7D',  optional:true, waitAfter:1200},
        {type:'click',    text:'30D', optional:true, waitAfter:1200},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1500},
      ],
    },

    // ─── 8. AI Predictions (30s+) ────────────────────────────────────────────
    {
      id:'ai-predict', title:'AI Predictions', subtitle:'Predictive fault detection before failures occur', accent:'orange', holdMs:3000, interactionDiscovery:true,
      steps:[
        {type:'navigate', url:'/ai-predict'},
        {type:'wait',     ms:8000},   // long wait — AI page is heavy, needs full load
        // Try to wait for actual content element
        {type:'click',    selector:'[role="tab"]:nth-child(1)', optional:true, waitAfter:2000},
        {type:'scroll',   y:300},
        {type:'wait',     ms:2000},
        {type:'scroll',   y:600},
        {type:'wait',     ms:1500},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1500},
        {type:'click',    selector:'[role="tab"]:nth-child(2)', optional:true, waitAfter:2500},
        {type:'scroll',   y:300},
        {type:'wait',     ms:1500},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1000},
        {type:'click',    text:'High Risk',   optional:true, waitAfter:1500},
        {type:'click',    text:'Medium Risk', optional:true, waitAfter:1500},
        {type:'click',    text:'Low Risk',    optional:true, waitAfter:1200},
        {type:'click',    text:'All',         optional:true, waitAfter:1200},
        {type:'scroll',   y:400},
        {type:'wait',     ms:1500},
        {type:'scroll',   y:0},
        {type:'wait',     ms:2000},
      ],
    },

    // ─── 9. Simulator (20s) ──────────────────────────────────────────────────
    {
      id:'simulator', title:'Simulator', subtitle:'Model equipment behavior and test scenarios safely', accent:'blue', holdMs:2500, interactionDiscovery:true,
      steps:[
        {type:'navigate', url:'/simulator'},
        {type:'wait',     ms:2500},
        {type:'click',    selector:'[role="tab"]:nth-child(1)', optional:true, waitAfter:1500},
        {type:'scroll',   y:400},
        {type:'wait',     ms:1500},
        {type:'click',    selector:'[role="tab"]:nth-child(2)', optional:true, waitAfter:1500},
        {type:'scroll',   y:400},
        {type:'wait',     ms:1200},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1500},
      ],
    },

    // ─── 10. User Management (18s) ───────────────────────────────────────────
    {
      id:'users', title:'User Management', subtitle:'Role-based access control across your enterprise', accent:'orange', holdMs:2500,
      steps:[
        {type:'navigate', url:'/users'},
        {type:'wait',     ms:2500},
        {type:'scroll',   y:300},
        {type:'wait',     ms:1200},
        // Click any role filter tabs
        {type:'click',    text:'Admin',    optional:true, waitAfter:1000},
        {type:'click',    text:'Operator', optional:true, waitAfter:1000},
        {type:'click',    text:'Viewer',   optional:true, waitAfter:1000},
        {type:'click',    text:'All',      optional:true, waitAfter:1000},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1500},
      ],
    },

    // ─── 11. Enterprise Integrations (25s) ───────────────────────────────────
    {
      id:'settings', title:'Enterprise Integrations', subtitle:'Open APIs, BMS connectors, and enterprise system integrations', accent:'blue', holdMs:2500,
      steps:[
        {type:'navigate', url:'/settings'},
        {type:'wait',     ms:3000},
        // Jump to integrations tab directly
        {type:'click',    text:'Integrations',  optional:true, waitAfter:2000},
        {type:'scroll',   y:300},
        {type:'wait',     ms:1500},
        {type:'scroll',   y:600},
        {type:'wait',     ms:1200},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1200},
        // If no integrations tab, cycle through available tabs
        {type:'click',    selector:'[role="tab"]:nth-child(2)', optional:true, waitAfter:1500},
        {type:'scroll',   y:300},
        {type:'wait',     ms:1200},
        {type:'scroll',   y:0},
        {type:'click',    selector:'[role="tab"]:nth-child(3)', optional:true, waitAfter:1500},
        {type:'scroll',   y:300},
        {type:'wait',     ms:1200},
        {type:'scroll',   y:0},
        {type:'wait',     ms:1500},
      ],
    },

  ],
};
