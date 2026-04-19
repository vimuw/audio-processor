import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';
import { splitMp3, joinMp3Blobs } from './mp3Helper';

export class FFmpegHelper {
    constructor() {
        this.ffmpeg = new FFmpeg();
        this.loaded = false;
    }

    async load(onLog) {
        if (this.loaded) return;

        if (onLog) {
            this.ffmpeg.on('log', ({ message }) => onLog(message));
        }

        try {
            const basePath = import.meta.env.BASE_URL || '/';
            if (onLog) onLog("Loading FFmpeg core files...");
            const [coreURL, wasmURL, workerURL] = await Promise.all([
                toBlobURL(`${basePath}ffmpeg/ffmpeg-core.js`, 'text/javascript'),
                toBlobURL(`${basePath}ffmpeg/ffmpeg-core.wasm`, 'application/wasm'),
                toBlobURL(`${basePath}ffmpeg/ffmpeg-core.worker.js`, 'text/javascript'),
            ]);

            if (onLog) onLog("Initializing FFmpeg...");
            await this.ffmpeg.load({
                coreURL,
                wasmURL,
                workerURL,
            });

            this.loaded = true;
            if (onLog) onLog("FFmpeg loaded successfully.");
        } catch (e) {
            throw new Error(typeof e === 'string' ? e : (e.message || JSON.stringify(e)));
        }
    }

    async convertAndSplit(file, segmentTime, onProgress, bitrate = '192k') {
        if (!this.loaded) throw new Error("FFmpeg not loaded");

        const isAlreadyMp3 = file.name.toLowerCase().endsWith('.mp3');

        if (isAlreadyMp3) {
            // Pure JS path: frame-boundary scan + Blob.slice() — zero WASM I/O
            console.log('Starting split (pure JS frame scan)...');
            const results = await splitMp3(file, segmentTime);
            if (onProgress) onProgress({ progress: 1 });
            return results;
        }

        // Non-MP3: transcode via FFmpeg with fastest LAME settings
        const inputName = 'input' + file.name.substring(file.name.lastIndexOf('.'));
        await this.ffmpeg.writeFile(inputName, await fetchFile(file));

        if (onProgress) this.ffmpeg.on('progress', onProgress);

        console.log(`Starting split (encode at ${bitrate})...`);

        try {
            await this.ffmpeg.exec([
                '-i', inputName,
                '-c:a', 'libmp3lame',
                '-b:a', bitrate,
                '-compression_level', '0',
                '-f', 'segment',
                '-segment_time', segmentTime.toString(),
                '-reset_timestamps', '1',
                'segment_%03d.mp3'
            ]);
        } finally {
            if (onProgress) this.ffmpeg.off('progress', onProgress);
        }

        // Read outputs
        const files = await this.ffmpeg.listDir('.');
        const segmentFiles = files.filter(f => f.name.startsWith('segment_') && f.name.endsWith('.mp3'));

        let results;
        try {
            results = await Promise.all(segmentFiles.map(async (f) => {
                const data = await this.ffmpeg.readFile(f.name);
                return { name: f.name, data: new Blob([data.buffer], { type: 'audio/mpeg' }) };
            }));
        } finally {
            await Promise.all([...segmentFiles.map(f => this.ffmpeg.deleteFile(f.name)), this.ffmpeg.deleteFile(inputName)]);
        }

        return results;
    }

    async joinAudios(files, onProgress) {
        if (!this.loaded) throw new Error("FFmpeg not loaded");
        if (!files || files.length === 0) throw new Error("No files provided");

        const allMp3 = files.every(f => f.name.toLowerCase().endsWith('.mp3'));

        if (allMp3) {
            // Pure JS path: Blob concatenation — zero WASM, zero I/O overhead
            console.log('Starting join (pure JS blob concat)...');
            const result = await joinMp3Blobs(files);
            if (onProgress) onProgress({ progress: 1 });
            return [result];
        }

        // Mixed formats: filter_complex re-encode via FFmpeg
        const inputNames = files.map((file, i) => `join_input_${i}${file.name.substring(file.name.lastIndexOf('.'))}`);

        let totalDurationUs = 0;
        if (onProgress) {
            const durations = await Promise.all(files.map(getAudioDuration));
            totalDurationUs = durations.reduce((sum, d) => sum + d, 0) * 1_000_000;
        }

        const progressHandler = onProgress
            ? ({ progress, time }) => {
                const p = totalDurationUs > 0
                    ? Math.min(1, time / totalDurationUs)
                    : Math.min(1, Math.max(0, Number(progress) || 0));
                onProgress({ progress: p });
            }
            : null;

        // Read all files into memory in parallel, then write sequentially to memfs
        const fileBuffers = await Promise.all(files.map(fetchFile));
        for (let i = 0; i < files.length; i++) {
            await this.ffmpeg.writeFile(inputNames[i], fileBuffers[i]);
        }

        const outputName = 'joined_output.mp3';
        const inputArgs = [];
        inputNames.forEach(name => { inputArgs.push('-i', name); });
        const filterComplex = inputNames.map((_, i) => `[${i}:a]`).join('') + `concat=n=${inputNames.length}:v=0:a=1[out]`;

        if (progressHandler) this.ffmpeg.on('progress', progressHandler);
        console.log('Starting join (re-encode)...');
        try {
            await this.ffmpeg.exec([
                ...inputArgs,
                '-filter_complex', filterComplex,
                '-map', '[out]',
                '-c:a', 'libmp3lame',
                '-b:a', '192k',
                '-compression_level', '0',
                outputName
            ]);
        } finally {
            if (progressHandler) this.ffmpeg.off('progress', progressHandler);
        }

        let result;
        try {
            const data = await this.ffmpeg.readFile(outputName);
            result = {
                name: 'joined_audio.mp3',
                data: new Blob([data.buffer], { type: 'audio/mpeg' })
            };
        } finally {
            await Promise.all([...inputNames.map(n => this.ffmpeg.deleteFile(n)), this.ffmpeg.deleteFile(outputName)]);
        }

        return [result];
    }

    async convertToMp3(file, onProgress) {
        if (!this.loaded) throw new Error("FFmpeg not loaded");

        const inputName = 'input' + file.name.substring(file.name.lastIndexOf('.'));
        const outputName = 'output.mp3';

        // Write file
        await this.ffmpeg.writeFile(inputName, await fetchFile(file));

        console.log("Starting MP3 conversion...");

        if (onProgress) {
            this.ffmpeg.on('progress', onProgress);
        }

        try {
            await this.ffmpeg.exec([
                '-i', inputName,
                '-vn', // Disable video
                '-ar', '44100',
                '-ac', '2',
                '-c:a', 'libmp3lame',
                '-b:a', '192k',
                '-compression_level', '0',
                outputName
            ]);
        } finally {
            if (onProgress) {
                this.ffmpeg.off('progress', onProgress);
            }
        }

        let result;
        try {
            const data = await this.ffmpeg.readFile(outputName);
            result = {
                name: file.name.substring(0, file.name.lastIndexOf('.')) + '.mp3',
                data: new Blob([data.buffer], { type: 'audio/mpeg' })
            };
        } finally {
            // Cleanup
            await this.ffmpeg.deleteFile(inputName);
            await this.ffmpeg.deleteFile(outputName);
        }

        return [result];
    }
}

// Helper to fetch file content
async function fetchFile(file) {
    return new Uint8Array(await file.arrayBuffer());
}

// Helper to get audio duration in seconds
function getAudioDuration(file) {
    return new Promise((resolve) => {
        const url = URL.createObjectURL(file);
        const audio = new Audio(url);
        audio.onloadedmetadata = () => {
            URL.revokeObjectURL(url);
            resolve(isFinite(audio.duration) ? audio.duration : 0);
        };
        audio.onerror = () => {
            URL.revokeObjectURL(url);
            resolve(0);
        };
    });
}

export const ffmpegHelper = new FFmpegHelper();
