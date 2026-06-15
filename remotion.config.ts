import {Config} from '@remotion/cli/config';

Config.setVideoImageFormat('jpeg');
Config.setOverwriteOutput(true);
Config.setConcurrency(4);
// Increase delayRender timeout — large MP4 files need more time to decode
Config.setDelayRenderTimeoutInMilliseconds(60000);
