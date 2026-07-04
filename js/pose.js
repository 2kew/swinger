// MediaPipe Pose wrapper. Loaded lazily (dynamic import from CDN) so the
// app shell works without network; analysis needs connectivity once to
// fetch the model, after which the browser cache usually serves it.

const CDN = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14';
const MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task';

let landmarkerPromise = null;

export function getPoseLandmarker(onStatus) {
  if (!landmarkerPromise) {
    landmarkerPromise = create(onStatus).catch((err) => {
      landmarkerPromise = null;
      throw err;
    });
  }
  return landmarkerPromise;
}

async function create(onStatus) {
  onStatus?.('Loading pose model…');
  const vision = await import(`${CDN}/vision_bundle.mjs`);
  const fileset = await vision.FilesetResolver.forVisionTasks(`${CDN}/wasm`);
  const options = (delegate) => ({
    baseOptions: { modelAssetPath: MODEL_URL, delegate },
    runningMode: 'VIDEO',
    numPoses: 1,
    minPoseDetectionConfidence: 0.5,
    minPosePresenceConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });
  try {
    return await vision.PoseLandmarker.createFromOptions(fileset, options('GPU'));
  } catch {
    onStatus?.('GPU unavailable, falling back to CPU…');
    return vision.PoseLandmarker.createFromOptions(fileset, options('CPU'));
  }
}

// Step through the video at a fixed rate and detect the pose per frame.
export async function extractFrames(video, onProgress, opts = {}) {
  const fps = opts.fps || 30;
  const maxSeconds = opts.maxSeconds || 25;
  const landmarker = await getPoseLandmarker(onProgress ? (msg) => onProgress(0, msg) : undefined);

  const duration = Math.min(video.duration || 0, maxSeconds);
  if (!duration || !isFinite(duration)) throw new Error('Could not read the video length.');

  const step = 1 / fps;
  const total = Math.floor(duration / step);
  const frames = [];
  let lastTs = -1;

  for (let i = 0; i <= total; i++) {
    const t = Math.min(duration - 0.001, i * step);
    await seekTo(video, t);
    // detectForVideo requires strictly increasing timestamps.
    let ts = Math.round(t * 1000);
    if (ts <= lastTs) ts = lastTs + 1;
    lastTs = ts;
    const res = landmarker.detectForVideo(video, ts);
    frames.push({
      t,
      lm: res.landmarks?.[0] || null,
      wlm: res.worldLandmarks?.[0] || null,
    });
    if (onProgress && i % 3 === 0) onProgress(i / total, `Analyzing swing… ${Math.round((i / total) * 100)}%`);
  }
  onProgress?.(1, 'Crunching the numbers…');
  return frames;
}

function seekTo(video, t) {
  return new Promise((resolve, reject) => {
    const onSeeked = () => { cleanup(); resolve(); };
    const onError = () => { cleanup(); reject(new Error('Video seek failed.')); };
    const cleanup = () => {
      video.removeEventListener('seeked', onSeeked);
      video.removeEventListener('error', onError);
      clearTimeout(timer);
    };
    const timer = setTimeout(() => { cleanup(); resolve(); }, 2000);
    video.addEventListener('seeked', onSeeked);
    video.addEventListener('error', onError);
    video.currentTime = t;
  });
}
