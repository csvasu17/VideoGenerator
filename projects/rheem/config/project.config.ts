import type {ProjectConfig} from '../../../core/types';

export const rheemProject: ProjectConfig = {
  id:     'rheem',
  fps:    60,
  width:  1920,
  height: 1080,

  product: {
    name:       'Rheem',
    tagline:    'Built for Performance. Engineered for Life.',
    subTagline: 'Enterprise-Grade Water & HVAC Solutions',
    websiteUrl: 'rheem.com',
    ctaText:    'Transform Operations\nwith Rheem',
    ctaSubtext: 'Join the enterprises redefining water and HVAC operations\nwith intelligent, connected infrastructure',
  },

  theme: {
    primaryColor: '#0066FF',
    accentColor:  '#FF6B00',
  },

  recording: {
    appUrl:    process.env.RHEEM_APP_URL || process.env.APP_URL || '',
    outputDir: 'projects/rheem/recordings',
  },

  // ── Narrative hook ──────────────────────────────────────────────────────
  // Drives the 3s pre-brand problem statement (NarrativeHook scene)
  hook: {
    line1: 'A rooftop unit failed. 2am.',
    line2: 'Nobody knew for 11 hours.',
    line3: 'Six sites. Zero visibility.',
  },

  // ── KPI metrics ─────────────────────────────────────────────────────────
  // Drives the KPI scene — pre-formatted display strings
  kpiMetrics: [
    {value:'60%',   label:'Faster Resolution',  sub:'Service ticket resolution time',          accent:'blue'   as const},
    {value:'40%',   label:'Less Manual Work',    sub:'Reduction in repetitive admin tasks',     accent:'orange' as const},
    {value:'99.9%', label:'System Uptime',       sub:'Equipment availability with AI predictive monitoring', accent:'blue'   as const},
    {value:'3.2x',  label:'ROI — Year One',      sub:'Return on investment, first 12 months',  accent:'orange' as const},
  ],

  // ── Audio / media ────────────────────────────────────────────────────────
  // Add audio files here when ready:
  //   backgroundMusic: 'projects/rheem/media/background-music.mp3',
  //   voiceover:       'projects/rheem/media/voiceover.mp3',
  media: {
    musicVolume:      0.25,
    voiceoverVolume:  1.0,
  },

  // ── Burned-in captions ────────────────────────────────────────────────────
  // Add timed captions here when voiceover is recorded.
  // startFrame/endFrame are global composition frame numbers.
  // captions: [
  //   { startFrame: 180, endFrame: 330, text: 'Rheem TotalView gives you complete visibility...' },
  // ],

  scenes: [
    {type:'intro',           durationInFrames:  900},
    {type:'problem',         durationInFrames: 1200},
    {type:'solution',        durationInFrames: 1200},
    {type:'productDemo',     durationInFrames: 2100},
    {type:'features',        durationInFrames: 1200},
    {type:'metrics',         durationInFrames: 1200},
    {type:'customerJourney', durationInFrames:  900},
    {type:'outro',           durationInFrames:  900},
  ],

  content: {
    problems: [
      {icon:'warning',  title:'Manual Processes',         description:'Teams spending hours on repetitive maintenance scheduling and reporting tasks'},
      {icon:'clock',    title:'Slow Response Times',      description:'Critical equipment failures go undetected, causing costly unplanned downtime'},
      {icon:'link',     title:'Fragmented Systems',       description:'Disconnected tools create data silos and operational blind spots across facilities'},
      {icon:'trending_down', title:'Operational Inefficiency', description:'Lack of predictive maintenance drives repair costs up by 40% annually'},
      {icon:'visibility_off', title:'Poor Visibility',   description:'No real-time insight into equipment performance across distributed portfolios'},
    ],

    features: [
      {icon:'bolt',      title:'Smart Automation',      description:'AI-powered scheduling and predictive maintenance workflows',          accent:'blue'},
      {icon:'sensors',   title:'Real-Time Monitoring',  description:'Live equipment telemetry across all facilities in one dashboard',      accent:'orange'},
      {icon:'dashboard', title:'Centralized Dashboard', description:'Unified command center for your entire HVAC and water fleet',          accent:'blue'},
      {icon:'analytics', title:'Analytics & Insights',  description:'Deep performance analytics with actionable AI recommendations',        accent:'orange'},
      {icon:'sync',      title:'Workflow Optimization', description:'Streamlined service dispatch and field technician management',         accent:'blue'},
      {icon:'corporate_fare', title:'Enterprise Scalable', description:'Built to manage thousands of units across global portfolios',      accent:'orange'},
    ],

    metrics: [
      {value:60,  suffix:'%', label:'Faster Resolution',  description:'Reduction in service ticket resolution time',    accent:'blue',   decimals:0},
      {value:40,  suffix:'%', label:'Less Manual Effort', description:'Fewer manual data entry tasks per technician',   accent:'orange', decimals:0},
      {value:99.9,suffix:'%', label:'System Uptime',      description:'Equipment availability with predictive maintenance', accent:'blue', decimals:1},
      {value:3.2, suffix:'x', label:'ROI Improvement',    description:'Return on investment within first year',         accent:'orange', decimals:1},
    ],

    customerJourney: [
      {step:'01', title:'Connect',  description:'Integrate Rheem IoT sensors across your facility fleet'},
      {step:'02', title:'Monitor',  description:'Real-time telemetry streams to your unified dashboard'},
      {step:'03', title:'Analyze',  description:'AI surfaces anomalies and maintenance predictions'},
      {step:'04', title:'Act',      description:'Automated work orders dispatched to field technicians'},
      {step:'05', title:'Optimize', description:'Continuous learning improves efficiency over time'},
    ],

    solutionNodes: [
      {id:'iot',   label:'IoT Sensors',  icon:'sensors', x:140,  y:200},
      {id:'cloud', label:'Rheem Cloud',  icon:'cloud',   x:480,  y:200},
      {id:'ai',    label:'AI Engine',    icon:'memory',  x:820,  y:200},
      {id:'dash',  label:'Dashboard',    icon:'dashboard',x:1160,y:200},
      {id:'field', label:'Field Ops',    icon:'build',   x:300,  y:440},
      {id:'mgmt',  label:'Management',   icon:'business',x:700,  y:440},
      {id:'api',   label:'Integrations', icon:'hub',     x:1060, y:440},
    ],

    solutionEdges: [
      {from:'iot',   to:'cloud'},
      {from:'cloud', to:'ai'},
      {from:'ai',    to:'dash'},
      {from:'cloud', to:'field'},
      {from:'ai',    to:'mgmt'},
      {from:'dash',  to:'api'},
      {from:'field', to:'mgmt'},
      {from:'mgmt',  to:'api'},
    ],
  },
};
