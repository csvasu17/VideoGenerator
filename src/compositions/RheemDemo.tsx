import React from 'react';
import {AbsoluteFill, Sequence, useVideoConfig} from 'remotion';
import {IntroScene}               from '../scenes/01-Intro/IntroScene';
import {ProblemScene}             from '../scenes/02-Problem/ProblemScene';
import {SolutionScene}            from '../scenes/03-Solution/SolutionScene';
import {ProductDemoScene}         from '../scenes/04-ProductDemo/ProductDemoScene';
import {FeaturesScene}            from '../scenes/05-Features/FeaturesScene';
import {MetricsScene}             from '../scenes/06-Metrics/MetricsScene';
import {CustomerExperienceScene}  from '../scenes/07-CustomerExperience/CustomerExperienceScene';
import {ClosingScene}             from '../scenes/08-Closing/ClosingScene';
import {ChapterTimeline}          from '../components/ChapterTimeline';
import videoConfig from '../config/videoConfig.json';

const {scenes} = videoConfig;

const chapters = [
  {label:'Intro',     startFrame: scenes.intro.startFrame,             endFrame: scenes.intro.startFrame             + scenes.intro.durationInFrames},
  {label:'Challenge', startFrame: scenes.problem.startFrame,           endFrame: scenes.problem.startFrame           + scenes.problem.durationInFrames},
  {label:'Solution',  startFrame: scenes.solution.startFrame,          endFrame: scenes.solution.startFrame          + scenes.solution.durationInFrames},
  {label:'Demo',      startFrame: scenes.productDemo.startFrame,       endFrame: scenes.productDemo.startFrame       + scenes.productDemo.durationInFrames},
  {label:'Features',  startFrame: scenes.features.startFrame,          endFrame: scenes.features.startFrame          + scenes.features.durationInFrames},
  {label:'Metrics',   startFrame: scenes.metrics.startFrame,           endFrame: scenes.metrics.startFrame           + scenes.metrics.durationInFrames},
  {label:'Journey',   startFrame: scenes.customerExperience.startFrame,endFrame: scenes.customerExperience.startFrame + scenes.customerExperience.durationInFrames},
  {label:'Close',     startFrame: scenes.closing.startFrame,           endFrame: scenes.closing.startFrame           + scenes.closing.durationInFrames},
];

export const RheemDemo: React.FC = () => {
  const {durationInFrames} = useVideoConfig();

  return (
    <AbsoluteFill style={{background:'#080810', fontFamily:'"Inter",system-ui,sans-serif'}}>

      <Sequence from={scenes.intro.startFrame} durationInFrames={scenes.intro.durationInFrames}>
        <IntroScene />
      </Sequence>

      <Sequence from={scenes.problem.startFrame} durationInFrames={scenes.problem.durationInFrames}>
        <ProblemScene />
      </Sequence>

      <Sequence from={scenes.solution.startFrame} durationInFrames={scenes.solution.durationInFrames}>
        <SolutionScene />
      </Sequence>

      <Sequence from={scenes.productDemo.startFrame} durationInFrames={scenes.productDemo.durationInFrames}>
        <ProductDemoScene />
      </Sequence>

      <Sequence from={scenes.features.startFrame} durationInFrames={scenes.features.durationInFrames}>
        <FeaturesScene />
      </Sequence>

      <Sequence from={scenes.metrics.startFrame} durationInFrames={scenes.metrics.durationInFrames}>
        <MetricsScene />
      </Sequence>

      <Sequence from={scenes.customerExperience.startFrame} durationInFrames={scenes.customerExperience.durationInFrames}>
        <CustomerExperienceScene />
      </Sequence>

      <Sequence from={scenes.closing.startFrame} durationInFrames={scenes.closing.durationInFrames}>
        <ClosingScene />
      </Sequence>

      {/* Global chapter timeline - shown throughout */}
      <ChapterTimeline chapters={chapters} totalFrames={durationInFrames} />

    </AbsoluteFill>
  );
};
