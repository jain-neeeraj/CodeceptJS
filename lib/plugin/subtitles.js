const { v4: uuidv4 } = require('uuid');
const fsPromise = require('fs').promises;
const path = require('path');
const event = require('../event');

// This will convert a given timestamp in milliseconds to
// an SRT recognized timestamp, ie HH:mm:ss,SSS
function formatTimestamp(timestampInMs) {
  const date = new Date(0, 0, 0, 0, 0, 0, timestampInMs);
  const hours = date.getHours();
  const minutes = date.getMinutes();
  const seconds = date.getSeconds();
  const ms = timestampInMs - (hours * 3600000 + minutes * 60000 + seconds * 1000);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}#${ms.toString().padStart(3, '0')}`;
}

let steps = {};
let testStartedAt;
/**
 * Automatically captures steps as subtitle, and saves it as an artifact when a video is found for a failed test.
 * Subtitles will be generated in SRT as well as WebVTT format (standard for HTML5) depending on the config parameter
 * "format"
 *
 * #### Configuration
 * ```js
 * plugins: {
 *  subtitles: {
 *    enabled: true,
 *    format: 'WEBVTT'
 *  }
 * }
 * ```
 */
module.exports = function (config) {
  event.dispatcher.on(event.test.before, (_) => {
    testStartedAt = Date.now();
    steps = {};
  });

  event.dispatcher.on(event.step.started, (step) => {
    const stepStartedAt = Date.now();
    step.id = uuidv4();

    let title = `${step.actor}.${step.name}(${step.args ? step.args.join(',') : ''})`;
    if (title.length > 100) {
      title = `${title.substring(0, 100)}...`;
    }

    steps[step.id] = {
      start: formatTimestamp(stepStartedAt - testStartedAt),
      startedAt: stepStartedAt,
      title,
    };
  });

  event.dispatcher.on(event.step.finished, (step) => {
    if (step && step.id && steps[step.id]) {
      steps[step.id].end = formatTimestamp(Date.now() - testStartedAt);
    }
  });

  event.dispatcher.on(event.test.after, async (test) => {
    if (test && test.artifacts && test.artifacts.video) {
      const stepsSortedByStartTime = Object.values(steps);
      stepsSortedByStartTime.sort((stepA, stepB) => {
        return stepA.startedAt - stepB.startedAt;
      });

      // For a VTT subtitle file, every subtitle has to be in the format as mentioned below:
      // WEBVTT
      //
      // 1
      // HH:mm:ss.SSS --> HH:mm:ss.SSS
      // [title]
      //
      // For an SRT file, every subtitle has to be in the format as mentioned below:
      //
      // 1
      // HH:mm:ss,SSS --> HH:mm:ss,SSS
      // [title]
      const subtitleFormat = config.format === 'WEBVTT' ? 'vtt' : 'srt';
      let subtitle = subtitleFormat === 'vtt' ? 'WEBVTT\n\n' : '';
      const msIdentifier = subtitleFormat === 'vtt' ? '.' : ',';
      stepsSortedByStartTime.forEach((step, index) => {
        if (step.end) {
          subtitle = `${subtitle}${index + 1}
${step.start.replace('#', msIdentifier)} --> ${step.end.replace('#', msIdentifier)}
${step.title}

`;
        }
      });
      const { dir: artifactsDirectory, name: fileName } = path.parse(test.artifacts.video);
      await fsPromise.writeFile(`${artifactsDirectory}/${fileName}.${subtitleFormat}`, subtitle);
      test.artifacts.subtitle = `${artifactsDirectory}/${fileName}.${subtitleFormat}`;
    }
  });
};
