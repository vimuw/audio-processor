import { FFmpeg } from '@ffmpeg/ffmpeg';
import { toBlobURL } from '@ffmpeg/util';

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
            if (onLog) onLog("Loading ffmpeg-core.js...");
            const coreURL = await toBlobURL(`/ffmpeg/ffmpeg-core.js`, 'text/javascript');

            if (onLog) onLog("Loading ffmpeg-core.wasm...");
            const wasmURL = await toBlobURL(`/ffmpeg/ffmpeg-core.wasm`, 'application/wasm');

            if (onLog) onLog("Loading ffmpeg-core.worker.js...");
            const workerURL = await toBlobURL(`/ffmpeg/ffmpeg-core.worker.js`, 'text/javascript');

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

        const inputName = 'input' + file.name.substring(file.name.lastIndexOf('.'));
        // Write file to memfs
        await this.ffmpeg.writeFile(inputName, await fetchFile(file));

        if (onProgress) {
            this.ffmpeg.on('progress', onProgress);
        }

        console.log(`Starting conversion with bitrate ${bitrate}...`);

        await this.ffmpeg.exec([
            '-i', inputName,
            '-c:a', 'libmp3lame',
            '-b:a', bitrate,
            '-f', 'segment',
            '-segment_time', segmentTime.toString(),
            'segment_%03d.mp3'
        ]);

        // Read outputs
        const files = await this.ffmpeg.listDir('.');
        const segmentFiles = files.filter(f => f.name.startsWith('segment_') && f.name.endsWith('.mp3'));

        const results = [];
        for (const f of segmentFiles) {
            const data = await this.ffmpeg.readFile(f.name);
            results.push({
                name: f.name,
                data: new Blob([data.buffer], { type: 'audio/mpeg' })
            });
            // Cleanup file from memfs to free memory
            await this.ffmpeg.deleteFile(f.name);
        }

        // Cleanup input
        await this.ffmpeg.deleteFile(inputName);

        return results;
    }

    async joinAudios(files, onProgress) {
        if (!this.loaded) throw new Error("FFmpeg not loaded");
        if (!files || files.length === 0) throw new Error("No files provided");

        if (onProgress) {
            this.ffmpeg.on('progress', onProgress);
        }

        const inputNames = [];
        // Write all files to memfs
        for (let i = 0; i < files.length; i++) {
            const file = files[i];
            const ext = file.name.substring(file.name.lastIndexOf('.'));
            const inputName = `join_input_${i}${ext}`;
            await this.ffmpeg.writeFile(inputName, await fetchFile(file));
            inputNames.push(inputName);
        }

        const outputName = 'joined_output.mp3';
        console.log("Starting join...");

        // Strategy: We can use the concat demuxer or concat filter.
        // Concat filter is more robust for different codecs but requires re-encoding (which we want anyway for consistency).
        // Command: -i input0 -i input1 ... -filter_complex "[0:a][1:a]...concat=n=N:v=0:a=1[out]" -map "[out]" output.mp3

        const inputArgs = [];
        inputNames.forEach(name => {
            inputArgs.push('-i', name);
        });

        const filterComplex = inputNames.map((_, i) => `[${i}:a]`).join('') + `concat=n=${inputNames.length}:v=0:a=1[out]`;

        await this.ffmpeg.exec([
            ...inputArgs,
            '-filter_complex', filterComplex,
            '-map', '[out]',
            '-c:a', 'libmp3lame',
            '-b:a', '192k',
            outputName
        ]);

        const data = await this.ffmpeg.readFile(outputName);
        const result = {
            name: 'joined_audio.mp3',
            data: new Blob([data.buffer], { type: 'audio/mpeg' })
        };

        // Cleanup
        for (const name of inputNames) {
            await this.ffmpeg.deleteFile(name);
        }
        await this.ffmpeg.deleteFile(outputName);

        return [result];
    }

    async convertToMp3(file, onProgress) {
        if (!this.loaded) throw new Error("FFmpeg not loaded");

        if (onProgress) {
            this.ffmpeg.on('progress', onProgress);
        }

        const inputName = 'input' + file.name.substring(file.name.lastIndexOf('.'));
        const outputName = 'output.mp3';

        // Write file
        await this.ffmpeg.writeFile(inputName, await fetchFile(file));

        console.log("Starting MP3 conversion...");

        await this.ffmpeg.exec([
            '-i', inputName,
            '-vn', // Disable video
            '-ar', '44100',
            '-ac', '2',
            '-b:a', '192k',
            outputName
        ]);

        const data = await this.ffmpeg.readFile(outputName);
        const result = {
            name: file.name.substring(0, file.name.lastIndexOf('.')) + '.mp3',
            data: new Blob([data.buffer], { type: 'audio/mpeg' })
        };

        // Cleanup
        await this.ffmpeg.deleteFile(inputName);
        await this.ffmpeg.deleteFile(outputName);

        return [result];
    }
}

// Helper to fetch file content
async function fetchFile(file) {
    return new Uint8Array(await file.arrayBuffer());
}

export const ffmpegHelper = new FFmpegHelper();
