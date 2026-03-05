# Audio Processor

Ideally, this application allows you to split large audio files or join multiple audio files using ffmpeg purely in the browser.

## How to Run

1.  **Install Dependencies**
    Open a terminal in the project folder and run:
    ```bash
    npm install
    ```

2.  **Ensure FFmpeg Assets are Present**
    The application relies on `ffmpeg-core` files being available in the `public/ffmpeg` directory.
    If they are missing, you can copy them from `node_modules/@ffmpeg/core/dist/esm/`:
    - `ffmpeg-core.js` -> `public/ffmpeg/ffmpeg-core.js`
    - `ffmpeg-core.wasm` -> `public/ffmpeg/ffmpeg-core.wasm`
    - `ffmpeg-core.worker.js` -> `public/ffmpeg/ffmpeg-core.worker.js`

    (I have already done this for you in this session.)

3.  **Start the Development Server**
    Run:
    ```bash
    npm run dev
    ```

4.  **Open in Browser**
    The terminal will show a local URL (usually `http://localhost:5173`).
    Open this link in your browser (Chrome or Edge recommended due to `SharedArrayBuffer` requirements).

## Troubleshooting

-   **"Engine failed to load"**: Check if `SharedArrayBuffer` is available. The app includes `coi-serviceworker.js` to handle headers needed for this, but ensuring you are on `localhost` or a secure context (HTTPS) is critical. Use a modern browser.
-   **Missing ffmpeg files**: Re-check step 2.

## Technologies Used

-   React + Vite
-   @ffmpeg/ffmpeg (WebAssembly)
-   Lucide React (Icons)
