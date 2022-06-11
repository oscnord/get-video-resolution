# Get video resolution

Get the resolution (width and height) of a video. Can be a local video or a HLS stream.

## Requirements

### ffprobe

To be able to extract the video dimensions `ffprobe` needs to be installed.

**MacOS:**

```bash
brew install ffprobe
```

**Ubuntu:**

```bash
sudo apt-get install ffprobe
```

## Usage

```TypeScript
import { getVideoResolution } from "@oscnord/get-video-resolution";

const resolution = await getVideoResolution('https://www.example-stream/manifest.m3u8');
console.log(resolution); // { width: 1920, height: 1080 }
```
