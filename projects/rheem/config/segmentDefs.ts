/**
 * segmentDefs.ts — Rheem segment display metadata.
 * IDs must match workflow clip IDs in workflows.ts.
 * No zoomRegions — let the clean recordings speak for themselves.
 */

import type {SegmentDef} from '../../../automation/types';

export const SEGMENT_DEFS: SegmentDef[] = [
  {id:'login',         sceneId:'productDemo', label:'Secure Login',            subtitle:'Enterprise SSO and role-based access control',                  accent:'blue',   keywords:['login','signin','auth']},
  {id:'dashboard',     sceneId:'productDemo', label:'Dashboard',               subtitle:'Real-time operational command center',                           accent:'blue',   keywords:['dashboard','home','overview']},
  {id:'sites',         sceneId:'productDemo', label:'Enterprise Sites',         subtitle:'Manage deployments across your entire portfolio',                accent:'orange', keywords:['sites','site','location']},
  {id:'site-detail',   sceneId:'productDemo', label:'Site Intelligence',        subtitle:'3D floor mapping with live device status',                       accent:'blue',   keywords:['site-detail','floor','3d']},
  {id:'alarms',        sceneId:'productDemo', label:'Alarms & Fault Detection', subtitle:'Real-time critical alerts with severity triage',                 accent:'orange', keywords:['alarms','alerts','faults']},
  {id:'devices',       sceneId:'productDemo', label:'Device Fleet',             subtitle:'27 connected units monitored live across all sites',             accent:'blue',   keywords:['devices','equipment','fleet']},
  {id:'device-detail', sceneId:'productDemo', label:'Device Intelligence',      subtitle:'Live telemetry, predictive insights, and remote control',        accent:'orange', keywords:['device-detail','rtu','unit']},
  {id:'insights',      sceneId:'productDemo', label:'Insights & Analytics',     subtitle:'Operational intelligence and performance trending',              accent:'blue',   keywords:['insights','analytics','reports']},
  {id:'ai-predict',    sceneId:'productDemo', label:'AI Predictions',           subtitle:'Predictive fault detection before failures occur',               accent:'orange', keywords:['ai-predict','ai','predictive']},
  {id:'simulator',     sceneId:'productDemo', label:'Simulator',                subtitle:'Model equipment behavior and test scenarios safely',             accent:'blue',   keywords:['simulator','simulate']},
  {id:'users',         sceneId:'productDemo', label:'User Management',          subtitle:'Role-based access control across your enterprise',               accent:'orange', keywords:['users','user','admin']},
  {id:'settings',      sceneId:'productDemo', label:'Settings',                 subtitle:'System configuration, integrations, and preferences',            accent:'blue',   keywords:['settings','config']},
  {id:'rheem-totalview',sceneId:'productDemo',label:'Rheem TotalView',          subtitle:'Enterprise-wide equipment visibility platform',                  accent:'orange', keywords:['totalview','rheem-total']},
];
