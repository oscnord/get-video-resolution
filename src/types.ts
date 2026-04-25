export interface Resolution {
  width: number;
  height: number;
}

export interface VideoInfo {
  width: number;
  height: number;
  duration?: number;
  codec?: string;
  framerate?: number;
  bitrate?: number;
  aspectRatio?: string;
  hdr?: boolean;
  rotation?: number;
  bitDepth?: number;
  encrypted?: boolean;
  audioTracks?: AudioTrack[];
  subtitleTracks?: SubtitleTrack[];
}

export interface ParsedMetadata {
  width: number;
  height: number;
  duration?: number;
  codec?: string;
  framerate?: number;
  hdr: boolean;
  rotation?: number;
  bitDepth?: number;
  audioTracks?: AudioTrack[];
}

export interface AudioTrack {
  codec?: string;
  language?: string;
  channels?: number;
}

export interface SubtitleTrack {
  language?: string;
  codec?: string;
}

export interface GetVideoResolutionOptions {
  timeout?: number;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  pick?: "highest" | "lowest" | "all";
  sniff?: boolean;
}
