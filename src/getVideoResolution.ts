/* eslint-disable @typescript-eslint/no-var-requires */
import util from 'util';

export type resolution = {
  width: number;
  height: number;
};

/**
 * Get the resolution of a video
 * @param url The URL of the video
 * @returns The resolution of the video
 * @throws Error if the video resolution could not be retrieved
 * @example
 * ```
 * const resolution = await getVideoResolution('https://www.example-stream/manifest.m3u8');
 * console.log(resolution); // { width: 1920, height: 1080 }
 * ```
 */
export async function getVideoResolution(url: string): Promise<resolution> {
  const nbStreams = await getNumberOfStreams(url);
  for (let i = 0; i <= nbStreams; i++) {
    const stream = (nbStreams - i);
    try {
      return await getWidthAndHeight(url, stream);
    } catch (error) {
      // ignore error and try next stream
      continue;
    }
  }
  throw new Error('Could not get video resolution!');
}

async function getWidthAndHeight(url: string, nbStreams: number): Promise<resolution> {
  const exec = util.promisify(require('child_process').execFile);
  const { stdout } = await exec('ffprobe', [
    '-v',
    'error',
    '-select_streams',
    `v:${nbStreams}`,
    '-show_entries',
    'stream=width,height',
    '-of',
    'default=nw=1',
    url,
  ]);
  const out = stdout.toString('utf8');
  const width = /width=(\d+)/.exec(out);
  const height = /height=(\d+)/.exec(out);
  if (!width || !height) {
    throw new Error('Error getting video resolution!');
  }
  return {
    width: parseInt(width[1]),
    height: parseInt(height[1]),
  }
}

async function getNumberOfStreams(url: string): Promise<number> {
  const exec = util.promisify(require('child_process').execFile);
  const { stdout } = await exec('ffprobe', [
    '-select_streams',
    'v',
    '-show_entries',
    'format=nb_streams',
    '-v',
    '0',
    '-of',
    'compact=p=0:nk=1',
    url,
  ])
  const out = stdout[0].toString('utf8');
  const nbStreams = parseInt(out, 10);
  if (nbStreams === 0) {
    throw new Error('No video stream found!');
  }
  return nbStreams;
}
