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
  colorSpace?: string;
}

export interface GetVideoResolutionOptions {
  timeout?: number;
  signal?: AbortSignal;
  fetch?: typeof globalThis.fetch;
  pick?: "highest" | "lowest" | "all";
  sniff?: boolean;
}
